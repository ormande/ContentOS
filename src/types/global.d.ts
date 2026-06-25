interface ImportMeta {
  env?: Record<string, string | undefined>;
}

interface Window {
  CONTENTOS_CONFIG?: Record<string, string | undefined>;
  supabase?: {
    createClient?: (url: string, anonKey: string) => unknown;
  };
}
