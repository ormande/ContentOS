function readConfig() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ""
  };
}

export default function handler(_request, response) {
  response.setHeader("Content-Type", "text/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(200).send(`globalThis.CONTENTOS_CONFIG = ${JSON.stringify(readConfig())};`);
}
