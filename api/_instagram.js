import { createClient } from "@supabase/supabase-js";

const graphVersion = process.env.META_GRAPH_API_VERSION || "v25.0";
const facebookGraphBaseUrl = `https://graph.facebook.com/${graphVersion}`;
const instagramGraphBaseUrl = `https://graph.instagram.com/${graphVersion}`;
const instagramAuthScopes = [
  "instagram_business_basic"
];
const facebookAuthScopes = [
  "instagram_basic",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement"
];

export function sendJson(response, status, payload) {
  response.status(status).json(payload);
}

export function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      persistSession: false
    }
  });
}

export function hasMetaConfig() {
  if (!process.env.META_REDIRECT_URI) return false;

  if (getMetaAuthMode() === "facebook") {
    return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
  }

  return Boolean(getInstagramAppId() && getInstagramAppSecret());
}

export function createEmptyDashboard() {
  return {
    isConfigured: hasMetaConfig(),
    account: null,
    lastSyncAt: null,
    totals: normalizeMetrics(),
    byContentType: [],
    contentItems: []
  };
}

export function buildMetaAuthUrl() {
  if (getMetaAuthMode() === "facebook") {
    const authUrl = new URL("https://www.facebook.com/dialog/oauth");
    authUrl.searchParams.set("client_id", process.env.META_APP_ID);
    authUrl.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI);
    authUrl.searchParams.set("scope", facebookAuthScopes.join(","));
    authUrl.searchParams.set("response_type", "code");

    return authUrl.toString();
  }

  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", getInstagramAppId());
  authUrl.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI);
  authUrl.searchParams.set("scope", instagramAuthScopes.join(","));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("force_authentication", "1");
  authUrl.searchParams.set("enable_fb_login", "0");

  return authUrl.toString();
}

export async function handleDashboard(response) {
  const supabase = createSupabaseAdmin();
  const emptyDashboard = createEmptyDashboard();

  if (!supabase) {
    sendJson(response, 200, emptyDashboard);
    return;
  }

  const [{ data: accounts, error: accountError }, { data: media, error: mediaError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    supabase.from("instagram_accounts").select("*").order("connected_at", { ascending: false }).limit(1),
    supabase.from("instagram_media").select("*, pieces(title)").order("published_at", { ascending: false }).limit(100),
    supabase.from("instagram_insight_snapshots").select("*").order("captured_at", { ascending: false }).limit(500)
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

export async function handleCallback(request, response) {
  if (!hasMetaConfig()) {
    sendJson(response, 400, { error: "Variáveis da Meta não configuradas." });
    return;
  }

  const code = request.query?.code;
  if (!code) {
    sendJson(response, 400, { error: "Callback da Meta sem code OAuth." });
    return;
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    sendJson(response, 400, { error: "Supabase admin não configurado." });
    return;
  }

  const connectedAccount = getMetaAuthMode() === "facebook"
    ? await connectWithFacebookLogin(supabase, code)
    : await connectWithInstagramLogin(supabase, code);

  await syncInstagramAccount(supabase, connectedAccount);
  response.redirect(302, "/#dashboard");
}

async function connectWithFacebookLogin(supabase, code) {
  const shortToken = await graphGet("/oauth/access_token", {
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code
  }, facebookGraphBaseUrl);

  const longToken = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortToken.access_token
  }, facebookGraphBaseUrl);

  const pages = await graphGet("/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url,name}",
    access_token: longToken.access_token
  }, facebookGraphBaseUrl);

  const page = (pages.data || []).find(item => item.instagram_business_account);
  if (!page) {
    throw new Error("Nenhuma conta Instagram Business ou Creator conectada às páginas deste usuário.");
  }

  const instagramAccount = page.instagram_business_account;
  const expiresAt = longToken.expires_in
    ? new Date(Date.now() + Number(longToken.expires_in) * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("instagram_accounts")
    .upsert({
      ig_user_id: instagramAccount.id,
      username: instagramAccount.username || null,
      account_name: instagramAccount.name || page.name || null,
      profile_picture_url: instagramAccount.profile_picture_url || null,
      access_token: page.access_token || longToken.access_token,
      token_expires_at: expiresAt,
      auth_provider: "facebook",
      connected_at: new Date().toISOString()
    }, { onConflict: "ig_user_id" })
    .select()
    .single();

  if (error) throw error;

  return data;
}

async function connectWithInstagramLogin(supabase, code) {
  const shortToken = await exchangeInstagramCode(code);
  const longToken = await graphGet("/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: getInstagramAppSecret(),
    access_token: shortToken.access_token
  }, instagramGraphBaseUrl);

  const profile = await graphGet("/me", {
    fields: "user_id,username,account_type,profile_picture_url",
    access_token: longToken.access_token || shortToken.access_token
  }, instagramGraphBaseUrl);

  const igUserId = String(profile.user_id || profile.id || shortToken.user_id);
  const expiresAt = longToken.expires_in
    ? new Date(Date.now() + Number(longToken.expires_in) * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("instagram_accounts")
    .upsert({
      ig_user_id: igUserId,
      username: profile.username || null,
      account_name: profile.username || null,
      profile_picture_url: profile.profile_picture_url || null,
      access_token: longToken.access_token || shortToken.access_token,
      token_expires_at: expiresAt,
      auth_provider: "instagram",
      connected_at: new Date().toISOString()
    }, { onConflict: "ig_user_id" })
    .select()
    .single();

  if (error) throw error;

  return data;
}
export async function handleSync(response) {
  const supabase = createSupabaseAdmin();

  if (!hasMetaConfig()) {
    sendJson(response, 200, {
      status: "not_configured",
      message: "A Meta API ainda não está configurada."
    });
    return;
  }

  if (!supabase) {
    sendJson(response, 400, { error: "Supabase admin não configurado." });
    return;
  }

  const { data: accounts, error } = await supabase
    .from("instagram_accounts")
    .select("*")
    .order("connected_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const account = accounts?.[0];
  if (!account) {
    sendJson(response, 200, {
      status: "not_connected",
      message: "Conecte uma conta Instagram antes de sincronizar."
    });
    return;
  }

  const result = await syncInstagramAccount(supabase, account);
  sendJson(response, 200, { status: "success", ...result });
}

async function syncInstagramAccount(supabase, account) {
  const { data: syncRun, error: syncError } = await supabase
    .from("instagram_sync_runs")
    .insert({
      account_id: account.id,
      status: "running"
    })
    .select()
    .single();

  if (syncError) throw syncError;

  try {
    const accountInsightPayload = await getAccountInsights(account);
    const accountMetrics = normalizeInsightPayload(accountInsightPayload);
    const { error: accountSnapshotError } = await supabase
      .from("instagram_insight_snapshots")
      .insert({
        account_id: account.id,
        media_id: null,
        source_type: "account",
        content_type: "unknown",
        metric_date: new Date().toISOString().slice(0, 10),
        metrics: accountMetrics,
        raw: accountInsightPayload
      });

    let snapshotsCreated = accountSnapshotError ? 0 : 1;

    const mediaResponse = await graphGet(`/${account.ig_user_id}/media`, {
      fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp",
      limit: "50",
      access_token: account.access_token
    }, getGraphBaseUrlForAccount(account));

    let mediaSynced = 0;

    for (const media of mediaResponse.data || []) {
      const mediaType = classifyMedia(media);
      const { data: savedMedia, error: mediaError } = await supabase
        .from("instagram_media")
        .upsert({
          account_id: account.id,
          ig_media_id: media.id,
          caption: media.caption || null,
          media_type: mediaType,
          permalink: media.permalink || null,
          thumbnail_url: media.thumbnail_url || null,
          published_at: media.timestamp || null,
          raw: media
        }, { onConflict: "ig_media_id" })
        .select()
        .single();

      if (mediaError) throw mediaError;
      mediaSynced += 1;

      const insightPayload = await getMediaInsights(media.id, account.access_token, account);
      const metrics = normalizeInsightPayload(insightPayload);

      const { error: snapshotError } = await supabase
        .from("instagram_insight_snapshots")
        .insert({
          account_id: account.id,
          media_id: savedMedia.id,
          source_type: "media",
          content_type: mediaType,
          metric_date: new Date().toISOString().slice(0, 10),
          metrics,
          raw: insightPayload
        });

      if (!snapshotError) snapshotsCreated += 1;
    }

    await supabase
      .from("instagram_accounts")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", account.id);

    await supabase
      .from("instagram_sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        media_synced: mediaSynced,
        snapshots_created: snapshotsCreated
      })
      .eq("id", syncRun.id);

    return { mediaSynced, snapshotsCreated };
  } catch (error) {
    await supabase
      .from("instagram_sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: error.message
      })
      .eq("id", syncRun.id);

    throw error;
  }
}

async function getAccountInsights(account) {
  const metrics = "impressions,reach,profile_views,follower_count";

  try {
    return await graphGet(`/${account.ig_user_id}/insights`, {
      metric: metrics,
      period: "day",
      access_token: account.access_token
    }, getGraphBaseUrlForAccount(account));
  } catch (error) {
    return {
      data: [],
      error: error.message
    };
  }
}

async function getMediaInsights(mediaId, accessToken, account) {
  const metrics = "reach,views,likes,comments,saved,shares,total_interactions";

  try {
    return await graphGet(`/${mediaId}/insights`, {
      metric: metrics,
      access_token: accessToken
    }, getGraphBaseUrlForAccount(account));
  } catch (error) {
    return {
      data: [],
      error: error.message
    };
  }
}

async function exchangeInstagramCode(code) {
  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: getInstagramAppId(),
      client_secret: getInstagramAppSecret(),
      grant_type: "authorization_code",
      redirect_uri: process.env.META_REDIRECT_URI,
      code
    })
  });

  const payload = await response.json();

  if (!response.ok || payload.error) {
    throw new Error(payload.error_message || payload.error?.message || "Erro ao trocar code do Instagram por token.");
  }

  return payload;
}

async function graphGet(path, params, baseUrl = facebookGraphBaseUrl) {
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || "Erro ao chamar a Meta Graph API.");
  }

  return payload;
}

function getMetaAuthMode() {
  return process.env.META_AUTH_MODE === "instagram" ? "instagram" : "facebook";
}

function getInstagramAppId() {
  return process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID;
}

function getInstagramAppSecret() {
  return process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET;
}

function getGraphBaseUrlForAccount(account) {
  return account.auth_provider === "facebook" ? facebookGraphBaseUrl : instagramGraphBaseUrl;
}

function normalizeInsightPayload(payload = {}) {
  const metrics = normalizeMetrics();

  (payload.data || []).forEach(item => {
    const value = Array.isArray(item.values) ? item.values.at(-1)?.value : item.value;
    const numberValue = Number(value || 0);

    if (item.name === "reach") metrics.reach = numberValue;
    if (item.name === "impressions") metrics.impressions = numberValue;
    if (item.name === "profile_views") metrics.profileViews = numberValue;
    if (item.name === "follower_count") metrics.followers = numberValue;
    if (item.name === "views" || item.name === "plays") metrics.views = numberValue;
    if (item.name === "likes") metrics.likes = numberValue;
    if (item.name === "comments") metrics.comments = numberValue;
    if (item.name === "saved" || item.name === "saves") metrics.saves = numberValue;
    if (item.name === "shares") metrics.shares = numberValue;
  });

  return metrics;
}

function normalizeMetrics(metrics = {}) {
  return {
    reach: Number(metrics.reach || 0),
    impressions: Number(metrics.impressions || 0),
    profileViews: Number(metrics.profileViews || metrics.profile_views || 0),
    followers: Number(metrics.followers || metrics.follower_count || 0),
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
    impressions: left.impressions + right.impressions,
    profileViews: left.profileViews + right.profileViews,
    followers: Math.max(left.followers, right.followers),
    views: left.views + right.views,
    likes: left.likes + right.likes,
    comments: left.comments + right.comments,
    saves: left.saves + right.saves,
    shares: left.shares + right.shares
  };
}

function classifyMedia(media) {
  if (media.media_product_type === "REELS") return "reel";
  if (media.media_product_type === "STORY") return "story";
  if (media.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (media.media_type === "VIDEO") return "video";
  if (media.media_type === "IMAGE") return "post";
  return "unknown";
}

