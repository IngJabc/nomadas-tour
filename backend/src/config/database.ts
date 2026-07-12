import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const ADMIN_OPTIONS = {
  auth: { autoRefreshToken: false, persistSession: false },
};

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, ADMIN_OPTIONS);

// Second client with the same key — NEVER used for auth.getUser(), so its auth
// state stays clean and all queries bypass RLS via the service_role key.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, ADMIN_OPTIONS);
