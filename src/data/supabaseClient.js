const env = import.meta.env || {};
const injectedConfig = globalThis.CONTENTOS_CONFIG || {};

const supabaseUrl = env.SUPABASE_URL || injectedConfig.SUPABASE_URL;
const supabaseAnonKey = env.SUPABASE_ANON_KEY || injectedConfig.SUPABASE_ANON_KEY;
const createClient = globalThis.supabase?.createClient;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && createClient);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase não configurado. Confira SUPABASE_URL e SUPABASE_ANON_KEY no .env.");
  }

  return supabase;
}
