import { isSupabaseConfigured, requireSupabase } from "./supabaseClient.js";

const LOCAL_STATE_KEY = "contentos-local-state-v1";

const emptyState = {
  ideas: [],
  pieces: [],
  scripts: [],
  pieceComponents: [],
  texts: [],
  files: [],
  publications: [],
  library: [],
  ai: {
    enabled: true,
    provider: "local",
    plannedHooks: [
      "resumir o desempenho do mês até hoje",
      "apontar o melhor conteúdo do período",
      "sinalizar quedas e picos relevantes",
      "gerar legendas com SEO e hashtags do histórico"
    ]
  }
};

export const platformRules = {
  instagram: {
    label: "Instagram",
    hashtagLimit: 5,
    characterLimit: 2200,
    note: "1 bloco: título, corpo e até 5 hashtags (uma palavra), separados por linha em branco"
  },
  tiktok: {
    label: "TikTok",
    hashtagLimit: 5,
    characterLimit: 4000,
    note: "1 bloco: título, corpo e até 5 hashtags (uma palavra), separados por linha em branco"
  },
  shorts: {
    label: "YouTube Shorts",
    hashtagLimit: 5,
    characterLimit: 5000,
    titleLimit: 100,
    tagsLimit: 500,
    note: "título (100), descrição (5k) e tags (500)"
  }
};

export const ideaStatuses = ["disponivel", "em_producao", "reaproveitavel"];
export const pieceComponentSlots = [
  "hook",
  "format",
  "script_structure",
  "camera_angle",
  "music",
  "sound_effect",
  "cta",
  "text_header"
];

export function createEmptyState() {
  return clone(emptyState);
}

export async function loadState() {
  const localState = loadLocalState();

  if (!isSupabaseConfigured) {
    console.warn("Supabase não configurado. Usando estado vazio temporário.");
    return localState || createEmptyState();
  }

  const client = requireSupabase();
  try {
    const [
      ideas,
      pieces,
      scripts,
      pieceComponents,
      texts,
      files,
      publications,
      library,
      aiSettings
    ] = await Promise.all([
      selectAll(client, "ideas", "created_at", { ascending: false }),
      selectAllSafe(client, "pieces", "updated_at", { ascending: false }, []),
      selectAllSafe(client, "scripts", "updated_at", { ascending: false }, []),
      selectAllSafe(client, "piece_components", "order_index", { ascending: true }, []),
      selectAll(client, "texts", "updated_at", { ascending: false }),
      selectAll(client, "files", "updated_at", { ascending: false }),
      selectAll(client, "publications", "published_at", { ascending: false }),
      selectAll(client, "library", "created_at", { ascending: false }),
      selectAiSettingsSafe(client)
    ]);

    const remoteState = reconcileStateLinks({
      ideas: ideas.map(fromIdeaRow),
      pieces: pieces.map(fromPieceRow),
      scripts: scripts.map(fromScriptRow),
      pieceComponents: pieceComponents.map(fromPieceComponentRow),
      texts: texts.map(fromTextRow),
      files: files.map(fromFileRow),
      publications: publications.map(fromPublicationRow),
      library: library.map(fromLibraryRow),
      ai: fromAiRow(aiSettings?.data)
    });

    if (localState && shouldPreferLocalState(localState, remoteState)) {
      return reconcileStateLinks(localState);
    }

    return remoteState;
  } catch (error) {
    console.warn("Falha ao carregar do Supabase. Usando cache local.", error);
    return localState || createEmptyState();
  }
}

export async function saveState(state) {
  const nextState = reconcileStateLinks(state);
  saveLocalState(nextState);

  if (!isSupabaseConfigured) {
    console.warn("Supabase não configurado. Alterações mantidas apenas em memória.");
    return;
  }

  const client = requireSupabase();
  const syncErrors = [];

  await tryRemoteSync(() => syncRows(client, "ideas", nextState.ideas.map(toIdeaRow)), "ideas", syncErrors);
  await tryRemoteSync(() => syncRows(client, "pieces", nextState.pieces.map(toPieceRow)), "pieces", syncErrors);
  await tryRemoteSync(() => syncRows(client, "scripts", nextState.scripts.map(toScriptRow)), "scripts", syncErrors);
  await tryRemoteSync(() => syncRows(client, "piece_components", nextState.pieceComponents.map(toPieceComponentRow)), "piece_components", syncErrors);
  await tryRemoteSync(() => syncRows(client, "texts", nextState.texts.map(toTextRow)), "texts", syncErrors);
  await tryRemoteSync(() => syncRows(client, "files", nextState.files.map(toFileRow)), "files", syncErrors);
  await tryRemoteSync(() => syncRows(client, "publications", nextState.publications.map(toPublicationRow)), "publications", syncErrors);
  await tryRemoteSync(() => upsertRows(client, "library", nextState.library.map(toLibraryRow).filter(Boolean), "category,name"), "library", syncErrors);
  await tryRemoteSync(() => upsertRows(client, "ai_settings", [toAiRow(nextState.ai)]), "ai_settings", syncErrors);
  await tryRemoteSync(() => syncInstagramMediaLinks(client, nextState.pieces), "instagram_media", syncErrors);

  if (syncErrors.length) {
    throw new Error(`Parte do salvamento remoto falhou: ${syncErrors.join(", ")}. Os dados ficaram no cache local deste navegador.`);
  }
}

export function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function selectAll(client, table, orderColumn, orderOptions) {
  let query = client.from(table).select("*");
  if (orderColumn) query = query.order(orderColumn, orderOptions);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function selectAllSafe(client, table, orderColumn, orderOptions, fallback) {
  try {
    return await selectAll(client, table, orderColumn, orderOptions);
  } catch (error) {
    console.warn(`Tabela ${table} indisponível no Supabase.`, error);
    return fallback;
  }
}

async function selectAiSettingsSafe(client) {
  try {
    return await client.from("ai_settings").select("*").eq("id", 1).maybeSingle();
  } catch (error) {
    console.warn("Tabela ai_settings indisponível no Supabase.", error);
    return { data: null, error: null };
  }
}

async function syncRows(client, table, rows) {
  const { data: existingRows, error: selectError } = await client.from(table).select("id");
  if (selectError) throw selectError;

  const existingIds = new Set((existingRows || []).map(row => row.id));
  const nextIds = new Set(rows.map(row => row.id));
  const idsToDelete = [...existingIds].filter(id => !nextIds.has(id));
  const rowsToInsert = rows.filter(row => !existingIds.has(row.id));
  const rowsToUpdate = rows.filter(row => existingIds.has(row.id));

  if (idsToDelete.length) {
    const { error } = await client.from(table).delete().in("id", idsToDelete);
    if (error) throw error;
  }

  if (rowsToInsert.length) {
    const { error } = await client.from(table).insert(rowsToInsert);
    if (error) throw error;
  }

  for (const row of rowsToUpdate) {
    const { id, ...changes } = row;
    const { error } = await client.from(table).update(changes).eq("id", id);
    if (error) throw error;
  }
}

async function upsertRows(client, table, rows, onConflict) {
  if (!rows.length) return;
  const options = onConflict ? { onConflict } : undefined;
  const { error } = await client.from(table).upsert(rows, options);
  if (error) throw error;
}

async function tryRemoteSync(run, label, errors) {
  try {
    await run();
  } catch (error) {
    console.warn(`Falha ao sincronizar ${label} no Supabase.`, error);
    errors.push(label);
  }
}

async function syncInstagramMediaLinks(client, pieces) {
  const { data: mediaRows, error } = await client
    .from("instagram_media")
    .select("id, ig_media_id, permalink, piece_id");

  if (error) {
    console.warn("Não foi possível atualizar os vínculos das mídias do Instagram.", error);
    return;
  }

  const pieceByMediaId = new Map();
  const pieceByPermalink = new Map();

  for (const piece of pieces) {
    const mediaId = normalizeText(piece.distribution?.igMediaId);
    const permalink = normalizeText(piece.distribution?.permalink);
    if (mediaId) pieceByMediaId.set(mediaId, piece.id);
    if (permalink) pieceByPermalink.set(permalink, piece.id);
  }

  for (const media of mediaRows || []) {
    const nextPieceId = pieceByMediaId.get(normalizeText(media.ig_media_id))
      || pieceByPermalink.get(normalizeText(media.permalink))
      || null;

    if (nextPieceId === (media.piece_id || null)) continue;

    const { error: updateError } = await client
      .from("instagram_media")
      .update({ piece_id: nextPieceId })
      .eq("id", media.id);

    if (updateError) {
      console.warn(`Não foi possível atualizar o vínculo da mídia ${media.id}.`, updateError);
    }
  }
}

function fromIdeaRow(row) {
  return {
    id: row.id,
    title: row.title,
    source: row.source || "",
    description: row.description || "",
    angle: row.angle || "",
    tags: row.tags || [],
    priority: row.priority || "média",
    status: ideaStatuses.includes(row.status) ? row.status : "disponivel",
    createdAt: row.created_at || ""
  };
}

function toIdeaRow(idea) {
  return {
    id: idea.id,
    title: idea.title,
    source: idea.source || null,
    description: idea.description || null,
    angle: idea.angle || null,
    tags: idea.tags || [],
    priority: idea.priority || null,
    status: ideaStatuses.includes(idea.status) ? idea.status : "disponivel",
    created_at: idea.createdAt || new Date().toISOString().slice(0, 10)
  };
}

function fromPieceRow(row) {
  return {
    id: row.id,
    title: row.title,
    ideaId: row.idea_id || null,
    platforms: row.platforms || [],
    currentPhase: row.current_phase || "brief",
    brief: normalizeBrief(row.brief, row),
    capture: normalizeCapture(row.capture, row),
    edit: normalizeEdit(row.edit_phase, row),
    distribution: normalizeDistribution(row.distribution),
    due: row.due || "",
    owner: row.owner || "",
    textIds: [],
    publicationIds: [],
    scriptId: null,
    componentIds: [],
    updatedAt: row.updated_at || ""
  };
}

function toPieceRow(piece) {
  return {
    id: piece.id,
    title: piece.title,
    idea_id: piece.ideaId || null,
    platforms: normalizePlatformList(piece.platforms),
    current_phase: piece.currentPhase || "brief",
    brief: normalizeBrief(piece.brief, piece),
    capture: normalizeCapture(piece.capture, piece),
    edit_phase: normalizeEdit(piece.edit, piece),
    distribution: normalizeDistribution(piece.distribution),
    due: piece.due || null,
    owner: piece.owner || null,
    updated_at: new Date().toISOString()
  };
}

function fromScriptRow(row) {
  return {
    id: row.id,
    pieceId: row.piece_id,
    template: row.template || "storytelling",
    fields: normalizeScriptFields(row.fields, row.template),
    updatedAt: row.updated_at || ""
  };
}

function toScriptRow(script) {
  return {
    id: script.id,
    piece_id: script.pieceId,
    template: script.template,
    fields: normalizeScriptFields(script.fields, script.template),
    updated_at: new Date().toISOString()
  };
}

function fromPieceComponentRow(row) {
  return {
    id: row.id,
    pieceId: row.piece_id,
    libraryItemId: row.library_item_id || null,
    slot: pieceComponentSlots.includes(row.slot) ? row.slot : "hook",
    required: Boolean(row.required),
    used: Boolean(row.used),
    notes: row.notes || "",
    orderIndex: Number(row.order_index || 0)
  };
}

function toPieceComponentRow(component) {
  return {
    id: component.id,
    piece_id: component.pieceId,
    library_item_id: component.libraryItemId || null,
    slot: pieceComponentSlots.includes(component.slot) ? component.slot : "hook",
    required: Boolean(component.required),
    used: Boolean(component.used),
    notes: component.notes || null,
    order_index: Number(component.orderIndex || 0)
  };
}

function fromTextRow(row) {
  return {
    id: row.id,
    pieceId: row.piece_id || null,
    platform: row.platform,
    title: row.title,
    body: row.body || "",
    seoTerms: row.seo_terms || [],
    hashtags: row.hashtags || [],
    instagramCaption: row.instagram_caption || "",
    tiktokCaption: row.tiktok_caption || "",
    ytTitle: row.yt_title || "",
    ytDescription: row.yt_description || "",
    ytTags: row.yt_tags || "",
    updatedAt: row.updated_at || ""
  };
}

function toTextRow(text) {
  return {
    id: text.id,
    piece_id: text.pieceId || null,
    platform: text.platform || "instagram",
    title: text.title || findPieceTitleFallback(text.pieceId),
    body: text.body || null,
    seo_terms: text.seoTerms || [],
    hashtags: text.hashtags || [],
    instagram_caption: text.instagramCaption || null,
    tiktok_caption: text.tiktokCaption || null,
    yt_title: text.ytTitle || null,
    yt_description: text.ytDescription || null,
    yt_tags: text.ytTags || null,
    updated_at: new Date().toISOString()
  };
}

function findPieceTitleFallback(pieceId) {
  return pieceId ? "Legenda" : "Legenda";
}

function fromFileRow(row) {
  return {
    id: row.id,
    pieceId: row.piece_id || null,
    name: row.name,
    kind: row.kind || "",
    version: row.version || "",
    location: row.location || "",
    updatedAt: row.updated_at || ""
  };
}

function toFileRow(file) {
  return {
    id: file.id,
    piece_id: file.pieceId || null,
    name: file.name,
    kind: file.kind || null,
    version: file.version || null,
    location: file.location || null,
    updated_at: file.updatedAt || new Date().toISOString().slice(0, 10)
  };
}

function fromPublicationRow(row) {
  return {
    id: row.id,
    pieceId: row.piece_id || null,
    platform: row.platform,
    publishedAt: row.published_at || "",
    url: row.url || "",
    metrics: row.metrics || defaultMetrics()
  };
}

function toPublicationRow(publication) {
  return {
    id: publication.id,
    piece_id: publication.pieceId || null,
    platform: publication.platform,
    published_at: publication.publishedAt || null,
    url: publication.url || null,
    metrics: publication.metrics || defaultMetrics()
  };
}

function fromLibraryRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    context: row.context || [],
    platforms: row.platforms || [],
    notes: row.notes || "",
    example: row.example || "",
    createdAt: row.created_at || ""
  };
}

function toLibraryRow(item) {
  if (!item.name || !item.category) return null;
  return {
    id: isUuid(item.id) ? item.id : undefined,
    name: item.name,
    category: item.category,
    context: item.context || [],
    platforms: item.platforms || [],
    notes: item.notes || null,
    example: item.example || null,
    created_at: item.createdAt || undefined
  };
}

function fromAiRow(row) {
  if (!row) return clone(emptyState.ai);
  return {
    enabled: Boolean(row.enabled),
    provider: row.provider || null,
    plannedHooks: row.planned_hooks || []
  };
}

function toAiRow(ai) {
  return {
    id: 1,
    enabled: Boolean(ai?.enabled),
    provider: ai?.provider || null,
    planned_hooks: ai?.plannedHooks || []
  };
}

function defaultMetrics() {
  return {
    reach: 0,
    views: 0,
    likes: 0,
    saves: 0,
    shares: 0,
    comments: 0,
    profileViews: 0,
    followers: 0,
    impressions: 0
  };
}

function normalizeBrief(brief, fallback = {}) {
  return {
    objective: brief?.objective || "",
    promise: brief?.promise || "",
    platforms: normalizePlatformList(brief?.platforms || fallback?.platforms || []),
    cta: brief?.cta || fallback?.brief?.cta || "",
    owner: brief?.owner || fallback?.owner || ""
  };
}

function normalizeCapture(capture, fallback = {}) {
  return {
    driveUrl: capture?.driveUrl || ""
  };
}

function normalizeEdit(edit, fallback = {}) {
  return {
    headerRecommendation: edit?.headerRecommendation || "",
    headerSuggestions: edit?.headerSuggestions || []
  };
}

function normalizeDistribution(distribution) {
  return {
    igMediaId: distribution?.igMediaId || "",
    permalink: distribution?.permalink || ""
  };
}

function normalizeScriptFields(fields, template) {
  const nextFields = { ...getTemplateDefaults(template), ...(fields || {}) };
  if (template === "tutorial") {
    nextFields.steps = Array.isArray(nextFields.steps)
      ? nextFields.steps
      : String(nextFields.steps || "").split("\n").map(item => item.trim()).filter(Boolean);
  }
  return nextFields;
}

function reconcileStateLinks(state) {
  const nextState = clone(state);
  const textIdsByPiece = new Map(nextState.pieces.map(piece => [piece.id, []]));
  const publicationIdsByPiece = new Map(nextState.pieces.map(piece => [piece.id, []]));
  const scriptIdByPiece = new Map();
  const componentIdsByPiece = new Map(nextState.pieces.map(piece => [piece.id, []]));

  nextState.texts = consolidateTexts(nextState.texts);

  nextState.texts.forEach(text => {
    if (text.pieceId && textIdsByPiece.has(text.pieceId)) {
      textIdsByPiece.get(text.pieceId).push(text.id);
    }
  });

  nextState.publications.forEach(publication => {
    if (publication.pieceId && publicationIdsByPiece.has(publication.pieceId)) {
      publicationIdsByPiece.get(publication.pieceId).push(publication.id);
    }
  });

  nextState.scripts.forEach(script => {
    scriptIdByPiece.set(script.pieceId, script.id);
  });

  nextState.pieceComponents.forEach(component => {
    if (component.pieceId && componentIdsByPiece.has(component.pieceId)) {
      componentIdsByPiece.get(component.pieceId).push(component.id);
    }
  });

  nextState.pieces = nextState.pieces.map(piece => ({
    ...piece,
    brief: normalizeBrief(piece.brief, piece),
    capture: normalizeCapture(piece.capture, piece),
    edit: normalizeEdit(piece.edit, piece),
    distribution: normalizeDistribution(piece.distribution),
    platforms: normalizePlatformList(piece.platforms || piece.brief?.platforms || []),
    textIds: textIdsByPiece.get(piece.id) || [],
    publicationIds: publicationIdsByPiece.get(piece.id) || [],
    scriptId: scriptIdByPiece.get(piece.id) || null,
    componentIds: componentIdsByPiece.get(piece.id) || []
  }));

  nextState.ideas = nextState.ideas.map(idea => ({
    ...idea,
    status: ideaStatuses.includes(idea.status) ? idea.status : "disponivel"
  }));

  return nextState;
}

function getTemplateDefaults(template) {
  if (template === "educacional") {
    return {
      problema: "",
      solucao: "",
      prova: "",
      cta: ""
    };
  }

  if (template === "tutorial") {
    return {
      steps: []
    };
  }

  return {
    oQueAconteceu: "",
    onde: "",
    quando: "",
    quemEstava: "",
    comoFoi: "",
    desfecho: "",
    aprendizado: ""
  };
}

function normalizePlatformList(platforms) {
  const unique = new Set((platforms || []).filter(Boolean));
  return [...unique].filter(item => ["instagram", "tiktok", "shorts"].includes(item));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function listToMultiline(items) {
  return Array.isArray(items) ? items.filter(Boolean).join("\n") : "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadLocalState() {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Não foi possível ler o cache local do ContentOS.", error);
    return null;
  }
}

function saveLocalState(state) {
  try {
    globalThis.localStorage?.setItem(LOCAL_STATE_KEY, JSON.stringify({
      ...state,
      __savedAt: new Date().toISOString()
    }));
  } catch (error) {
    console.warn("Não foi possível salvar o cache local do ContentOS.", error);
  }
}

function shouldPreferLocalState(localState, remoteState) {
  if (!hasMeaningfulContent(remoteState) && hasMeaningfulContent(localState)) return true;

  const localSavedAt = Date.parse(localState?.__savedAt || "") || 0;
  const remoteSavedAt = Math.max(
    ...[
      ...remoteState.ideas.map(item => Date.parse(item.createdAt || "") || 0),
      ...remoteState.pieces.map(item => Date.parse(item.updatedAt || "") || 0),
      ...remoteState.scripts.map(item => Date.parse(item.updatedAt || "") || 0),
      ...remoteState.texts.map(item => Date.parse(item.updatedAt || "") || 0),
      ...remoteState.files.map(item => Date.parse(item.updatedAt || "") || 0),
      ...remoteState.library.map(item => Date.parse(item.createdAt || "") || 0)
    ],
    0
  );

  return localSavedAt > remoteSavedAt;
}

function hasMeaningfulContent(state) {
  return Boolean(
    state?.ideas?.length
    || state?.pieces?.length
    || state?.scripts?.length
    || state?.pieceComponents?.length
    || state?.texts?.length
    || state?.files?.length
    || state?.publications?.length
    || state?.library?.length
  );
}

function consolidateTexts(texts) {
  const grouped = new Map();
  const orphans = [];

  for (const text of texts || []) {
    if (!text.pieceId) {
      orphans.push(normalizeCaptionRecord(text));
      continue;
    }

    if (!grouped.has(text.pieceId)) {
      grouped.set(text.pieceId, normalizeCaptionRecord({
        ...text,
        instagramCaption: "",
        tiktokCaption: "",
        ytTitle: "",
        ytDescription: "",
        ytTags: ""
      }));
    }

    const caption = grouped.get(text.pieceId);
    if (text.instagramCaption || text.platform === "instagram") {
      caption.instagramCaption = text.instagramCaption || legacyInstagramCaption(text) || caption.instagramCaption;
    }
    if (text.tiktokCaption || text.platform === "tiktok") {
      caption.tiktokCaption = text.tiktokCaption || legacyTiktokCaption(text) || caption.tiktokCaption;
    }
    if (text.platform === "shorts" || text.ytTitle || text.ytDescription || text.ytTags) {
      caption.ytTitle = text.ytTitle || caption.ytTitle;
      caption.ytDescription = text.ytDescription || caption.ytDescription;
      caption.ytTags = text.ytTags || caption.ytTags;
    }
    caption.updatedAt = [caption.updatedAt, text.updatedAt].filter(Boolean).sort().at(-1) || caption.updatedAt;
    caption.id = caption.id || text.id;
  }

  return [...grouped.values(), ...orphans];
}

function normalizeCaptionRecord(text) {
  return {
    id: text.id,
    pieceId: text.pieceId || null,
    platform: text.platform || "instagram",
    title: text.title || "",
    body: text.body || "",
    seoTerms: text.seoTerms || [],
    hashtags: text.hashtags || [],
    instagramCaption: text.instagramCaption || legacyInstagramCaption(text),
    tiktokCaption: text.tiktokCaption || legacyTiktokCaption(text),
    ytTitle: text.ytTitle || "",
    ytDescription: text.ytDescription || "",
    ytTags: text.ytTags || "",
    updatedAt: text.updatedAt || ""
  };
}

function legacyInstagramCaption(text) {
  if (text.platform !== "instagram") return "";
  const parts = [text.title, text.body].map(item => String(item || "").trim()).filter(Boolean);
  const tags = (text.hashtags || []).map(tag => (String(tag).startsWith("#") ? tag : `#${tag}`)).join(" ");
  if (tags) parts.push(tags);
  return parts.join("\n\n");
}

function legacyTiktokCaption(text) {
  if (text.platform !== "tiktok") return "";
  const parts = [text.title, text.body].map(item => String(item || "").trim()).filter(Boolean);
  const tags = (text.hashtags || []).map(tag => (String(tag).startsWith("#") ? tag : `#${tag}`)).join(" ");
  if (tags) parts.push(tags);
  return parts.join("\n\n");
}
