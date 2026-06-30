import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// True only when both env vars are present. The app uses this to show a clear
// "backend not configured" state instead of crashing when keys are missing.
export const isConfigured = Boolean(url && anonKey)

// Frontend uses the ANON key only — never the service_role key.
export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
