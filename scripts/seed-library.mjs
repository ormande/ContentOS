import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildLibrarySeedEntries } from "../src/data/librarySeed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

function loadEnv() {
  const envPath = join(root, ".env");
  const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY || ""
  };
}

function buildSeedRows() {
  const createdAt = new Date().toISOString();
  return buildLibrarySeedEntries().map(entry => ({
    id: crypto.randomUUID(),
    name: entry.name,
    category: entry.category,
    context: "context" in entry && Array.isArray(entry.context) ? entry.context : [],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: entry.notes || "",
    example: "example" in entry ? String(entry.example || "") : "",
    metadata: "metadata" in entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
    created_at: createdAt
  }));
}

async function main() {
  const env = loadEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;

  if (!env.SUPABASE_URL || !key) {
    console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env");
    process.exit(1);
  }

  const client = createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false }
  });

  const rows = buildSeedRows();
  console.log(`Preparando seed da biblioteca: ${rows.length} itens.`);

  const { data: existing, error: selectError } = await client.from("library").select("id");
  if (selectError) {
    console.error("Erro ao ler biblioteca:", selectError.message);
    process.exit(1);
  }

  if (existing?.length) {
    const ids = existing.map(row => row.id);
    const { error: deleteError } = await client.from("library").delete().in("id", ids);
    if (deleteError) {
      console.error("Erro ao limpar biblioteca:", deleteError.message);
      process.exit(1);
    }
    console.log(`Removidos ${ids.length} item(ns) antigo(s).`);
  }

  const batchSize = 50;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await client.from("library").insert(batch);
    if (error) {
      console.error("Erro ao inserir seed:", error.message);
      if (error.message.includes("library_context")) {
        console.error("\nRode no Supabase SQL Editor os ALTER TYPE de supabase/schema.sql (valores trend, ranking, react, tutorial, yapper).");
      }
      process.exit(1);
    }
  }

  console.log(`Biblioteca seedada com ${rows.length} itens.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
