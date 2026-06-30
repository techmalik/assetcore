// Auth + capability guard for the admin-api Edge Function.
//
// Every request is gated here: validate the caller's JWT, confirm they are an
// active platform admin, then expose a SERVICE-ROLE client for cross-org work.
// The service-role key lives only in Edge Function env — never in any frontend.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// Thrown to short-circuit a handler with an HTTP error.
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Service-role client: bypasses RLS. Use for all cross-org reads/writes.
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Platform capability model (mirrors apps/admin/src/lib/rbac.js) ───────────
type Cap =
  | 'org:read' | 'org:write' | 'org:suspend'
  | 'user:read' | 'user:write'
  | 'billing:read' | 'billing:write'
  | 'impersonate'
  | 'admin:read' | 'admin:write'
  | 'audit:read'

const ROLE_CAPS: Record<string, Cap[] | ['*']> = {
  superadmin: ['*'],
  admin: [
    'org:read', 'org:write', 'org:suspend', 'user:read', 'user:write',
    'billing:read', 'billing:write', 'impersonate', 'admin:read', 'audit:read',
  ],
  support: ['org:read', 'user:read', 'billing:read', 'impersonate', 'audit:read'],
  billing: ['org:read', 'billing:read', 'billing:write', 'audit:read'],
}

export function hasCap(role: string, cap: Cap): boolean {
  const caps = ROLE_CAPS[role]
  if (!caps) return false
  return caps[0] === '*' || (caps as Cap[]).includes(cap)
}

export interface AdminCtx {
  user: { id: string; email?: string }
  role: string
  svc: SupabaseClient
  ip: string
}

// Validate the bearer token, assert active platform_admins membership, and
// return a context carrying a service-role client.
export async function requireAdmin(req: Request): Promise<AdminCtx> {
  const authz = req.headers.get('Authorization') ?? ''
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  if (!token) throw new HttpError(401, 'Missing bearer token')

  // Resolve the user from their JWT (anon client, caller's token).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) throw new HttpError(401, 'Invalid session')

  const svc = serviceClient()
  const { data: admin } = await svc
    .from('platform_admins')
    .select('role,status')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (!admin || admin.status !== 'active') {
    throw new HttpError(403, 'Not a platform administrator')
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  return { user: { id: userData.user.id, email: userData.user.email }, role: admin.role, svc, ip }
}

export function requireCap(ctx: AdminCtx, cap: Cap): void {
  if (!hasCap(ctx.role, cap)) throw new HttpError(403, `Missing capability: ${cap}`)
}
