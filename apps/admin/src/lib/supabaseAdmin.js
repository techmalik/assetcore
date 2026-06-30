import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// True only when both env vars are present.
export const isConfigured = Boolean(url && anonKey)

// Backoffice client. ANON key only — never the service_role key. A distinct
// storageKey keeps admin sessions isolated from the tenant app (apps/app), so
// the two never collide in a shared browser. This client is used ONLY for auth
// and reading the caller's own platform_admins row; all data goes via lib/api.js.
export const supabaseAdmin = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'assetcore-admin-auth',
      },
    })
  : null

// Base URL for the admin-api Edge Function.
export const adminApiBase =
  import.meta.env.VITE_ADMIN_API_URL || (url ? `${url}/functions/v1/admin-api` : '')
