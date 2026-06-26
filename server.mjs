import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { handleAiGenerate } from "./api/_ai.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 4179);
const runtimeConfig = loadRuntimeConfig();
const serverConfig = loadServerConfig();
const supabaseAdmin = createSupabaseAdmin();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function resolveRequestPath(url) {
  const parsedUrl = new URL(url, `http://localhost:${port}`);
  const decodedPath = decodeURIComponent(parsedUrl.pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(root, safePath));

  if (!filePath.startsWith(resolve(root))) {
    return null;
  }

  return filePath;
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    console.error(error);
    sendJson(response, 500, { error: "Erro interno do ContentOS." });
  });
});

async function handleRequest(request, response) {
  const parsedUrl = new URL(request.url, `http://localhost:${port}`);

  if (parsedUrl.pathname === "/contentos-config.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(`globalThis.CONTENTOS_CONFIG = ${JSON.stringify(runtimeConfig)};`);
    return;
  }

  if (parsedUrl.pathname === "/api/instagram/dashboard") {
    await handleInstagramDashboard(response);
    return;
  }

  if (parsedUrl.pathname === "/api/instagram/connect") {
    handleInstagramConnect(response);
    return;
  }

  if (parsedUrl.pathname === "/api/instagram/callback") {
    sendJson(response, 501, {
      status: "pending",
      message: "Callback OAuth reservado. Troca de code por token entra na próxima etapa da integração Meta."
    });
    return;
  }

  if (parsedUrl.pathname === "/api/instagram/sync") {
    await handleInstagramSync(request, response);
    return;
  }

  if (parsedUrl.pathname === "/api/ai/generate") {
    await handleAiGenerate(request, response, {
      apiKey: serverConfig.GEMINI_API_KEY
    });
    return;
  }

  const filePath = resolveRequestPath(request.url);

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Arquivo não encontrado.");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store"
  });

  createReadStream(filePath).pipe(response);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`ContentOS rodando em http://localhost:${port}`);
  console.log("Pressione Ctrl+C para parar.");
});

function loadRuntimeConfig() {
  const envPath = join(root, ".env");
  const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};

  return {
    SUPABASE_URL: process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY || ""
  };
}

function loadServerConfig() {
  const envPath = join(root, ".env");
  const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};

  return {
    SUPABASE_URL: process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY || "",
    META_APP_ID: process.env.META_APP_ID || fileEnv.META_APP_ID || "",
    META_APP_SECRET: process.env.META_APP_SECRET || fileEnv.META_APP_SECRET || "",
    INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID || fileEnv.INSTAGRAM_APP_ID || "",
    INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET || fileEnv.INSTAGRAM_APP_SECRET || "",
    META_REDIRECT_URI: process.env.META_REDIRECT_URI || fileEnv.META_REDIRECT_URI || `http://127.0.0.1:${port}/api/instagram/callback`,
    META_AUTH_MODE: process.env.META_AUTH_MODE || fileEnv.META_AUTH_MODE || "facebook",
    META_LOGIN_CONFIG_ID: process.env.META_LOGIN_CONFIG_ID || fileEnv.META_LOGIN_CONFIG_ID || "",
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION || fileEnv.META_GRAPH_API_VERSION || "v25.0",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || fileEnv.GEMINI_API_KEY || ""
  };
}

function createSupabaseAdmin() {
  const key = serverConfig.SUPABASE_SERVICE_ROLE_KEY || serverConfig.SUPABASE_ANON_KEY;
  if (!serverConfig.SUPABASE_URL || !key) return null;

  return createClient(serverConfig.SUPABASE_URL, key, {
    auth: {
      persistSession: false
    }
  });
}

async function handleInstagramDashboard(response) {
  const emptyDashboard = createEmptyInstagramDashboard();

  if (!supabaseAdmin) {
    sendJson(response, 200, emptyDashboard);
    return;
  }

  const [{ data: accounts, error: accountError }, { data: media, error: mediaError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    supabaseAdmin.from("instagram_accounts").select("*").order("connected_at", { ascending: false }).limit(1),
    supabaseAdmin.from("instagram_media").select("*, pieces(title)").order("published_at", { ascending: false }).limit(100),
    supabaseAdmin.from("instagram_insight_snapshots").select("*").order("captured_at", { ascending: false }).limit(500)
  ]);

  if (accountError || mediaError || snapshotError) {
    sendJson(response, 200, emptyDashboard);
    return;
  }

  const account = accounts?.[0] || null;
  const latestSnapshotsByMedia = new Map();
  const accountSnapshots = [];

  (snapshots || []).forEach(snapshot => {
    if (snapshot.source_type === "account") {
      accountSnapshots.push(snapshot);
      return;
    }

    if (snapshot.media_id && !latestSnapshotsByMedia.has(snapshot.media_id)) {
      latestSnapshotsByMedia.set(snapshot.media_id, snapshot);
    }
  });

  const contentItems = (media || []).map(item => {
    const snapshot = latestSnapshotsByMedia.get(item.id);

    return {
      id: item.id,
      instagramMediaId: item.ig_media_id,
      contentType: item.media_type || "unknown",
      caption: item.caption || "",
      permalink: item.permalink || "",
      publishedAt: item.published_at,
      linkedVideoTitle: item.pieces?.title || "",
      metrics: normalizeMetrics(snapshot?.metrics)
    };
  });

  const totals = contentItems.reduce((total, item) => addMetrics(total, item.metrics), normalizeMetrics());
  const byContentType = Object.values(contentItems.reduce((groups, item) => {
    const key = item.contentType || "unknown";
    groups[key] ||= { contentType: key, count: 0, metrics: normalizeMetrics() };
    groups[key].count += 1;
    groups[key].metrics = addMetrics(groups[key].metrics, item.metrics);
    return groups;
  }, {}));

  sendJson(response, 200, {
    isConfigured: hasMetaConfig(),
    account: account ? {
      id: account.id,
      username: account.username,
      accountName: account.account_name,
      instagramUserId: account.ig_user_id
    } : null,
    lastSyncAt: account?.last_sync_at || accountSnapshots[0]?.captured_at || null,
    totals,
    byContentType,
    contentItems
  });
}

function handleInstagramConnect(response) {
  if (!hasMetaConfig()) {
    sendJson(response, 200, {
      status: "not_configured",
      message: "Configure META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no .env antes de conectar."
    });
    return;
  }

  const isFacebookMode = serverConfig.META_AUTH_MODE === "facebook";
  const authUrl = new URL(isFacebookMode ? "https://www.facebook.com/dialog/oauth" : "https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", isFacebookMode ? serverConfig.META_APP_ID : getInstagramAppId());
  authUrl.searchParams.set("redirect_uri", serverConfig.META_REDIRECT_URI);
  if (isFacebookMode && serverConfig.META_LOGIN_CONFIG_ID) {
    authUrl.searchParams.set("config_id", serverConfig.META_LOGIN_CONFIG_ID);
  } else {
    authUrl.searchParams.set("scope", isFacebookMode
      ? [
        "instagram_basic",
        "instagram_manage_insights",
        "business_management",
        "pages_show_list",
        "pages_read_engagement"
      ].join(",")
      : [
        "instagram_business_basic"
      ].join(","));
  }
  authUrl.searchParams.set("response_type", "code");
  if (!isFacebookMode) {
    authUrl.searchParams.set("force_authentication", "1");
    authUrl.searchParams.set("enable_fb_login", "0");
  }

  response.writeHead(302, { Location: authUrl.toString() });
  response.end();
}

async function handleInstagramSync(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Método não permitido." });
    return;
  }

  if (!hasMetaConfig()) {
    sendJson(response, 200, {
      status: "not_configured",
      message: "A sincronização será habilitada depois que a Meta API estiver configurada no .env."
    });
    return;
  }

  sendJson(response, 501, {
    status: "pending",
    message: "Arquitetura de sync pronta. A próxima etapa troca o OAuth code por token e busca mídia/insights na Graph API."
  });
}

function hasMetaConfig() {
  if (!serverConfig.META_REDIRECT_URI) return false;
  if (serverConfig.META_AUTH_MODE === "facebook") {
    return Boolean(serverConfig.META_APP_ID && serverConfig.META_APP_SECRET);
  }

  return Boolean(getInstagramAppId() && getInstagramAppSecret());
}

function getInstagramAppId() {
  return serverConfig.INSTAGRAM_APP_ID || serverConfig.META_APP_ID;
}

function getInstagramAppSecret() {
  return serverConfig.INSTAGRAM_APP_SECRET || serverConfig.META_APP_SECRET;
}

function createEmptyInstagramDashboard() {
  return {
    isConfigured: hasMetaConfig(),
    account: null,
    lastSyncAt: null,
    totals: normalizeMetrics(),
    byContentType: [],
    contentItems: []
  };
}

function normalizeMetrics(metrics = {}) {
  return {
    reach: Number(metrics.reach || 0),
    views: Number(metrics.views || metrics.plays || 0),
    likes: Number(metrics.likes || 0),
    comments: Number(metrics.comments || 0),
    saves: Number(metrics.saves || metrics.saved || 0),
    shares: Number(metrics.shares || 0)
  };
}

function addMetrics(left, right) {
  return {
    reach: left.reach + right.reach,
    views: left.views + right.views,
    likes: left.likes + right.likes,
    comments: left.comments + right.comments,
    saves: left.saves + right.saves,
    shares: left.shares + right.shares
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function parseEnv(source) {
  return source.split(/\r?\n/).reduce((env, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return env;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return env;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
    return env;
  }, {});
}
