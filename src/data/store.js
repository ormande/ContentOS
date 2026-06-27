import { isSupabaseConfigured, requireSupabase } from "./supabaseClient.js";
import { applyLibrarySeedIfEmpty } from "./librarySeed.js";
import { getTemplateDefaults, normalizeScriptFieldsForTemplate } from "./scriptStructures.js";
import { linkInstagramMediaToPieces } from "./instagramMediaLinks.js";

const LEGACY_LOCAL_STATE_KEY = "contentos-local-state-v1";

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
  if (!isSupabaseConfigured) {
    throw new Error("Supabase não configurado. Confira SUPABASE_URL e SUPABASE_ANON_KEY no ambiente.");
  }

  const client = requireSupabase();
  const legacyState = readLegacyLocalState();
  if (legacyState) {
    try {
      const remoteState = await fetchRemoteState(client);
      const normalized = reconcileStateLinks(legacyState);
      normalized.library = remoteState.library;
      normalized.pieceComponents = remapPieceComponentLibraryIds(
        normalized.pieceComponents,
        legacyState.library,
        remoteState.library
      );
      await syncStateToSupabase(client, normalized);
      console.info("Cache legado migrado para o Supabase.");
    } catch (error) {
      console.warn("Não foi possível migrar o cache legado.", error);
    } finally {
      clearLegacyLocalCache();
    }
  }

  const remoteState = await fetchRemoteState(client);
  return finalizeLoadedState(remoteState);
}

export async function reloadStateFromSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase não configurado. Confira SUPABASE_URL e SUPABASE_ANON_KEY no ambiente.");
  }

  const client = requireSupabase();
  const remoteState = await fetchRemoteState(client);
  return finalizeLoadedState(remoteState);
}

async function upsertRowsById(client, table, items, toRow) {
  const rows = (items || []).map(toRow).filter(Boolean);
  if (!rows.length) return;
  const { error } = await client.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

async function syncPieceComponents(client, pieces, components) {
  const rows = (components || []).map(toPieceComponentRow).filter(Boolean);
  if (rows.length) {
    const { error } = await client.from("piece_components").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }

  const managedPieceIds = (pieces || []).map(piece => piece.id).filter(Boolean);
  if (!managedPieceIds.length) return;

  const localIds = new Set((components || []).map(component => component.id));
  const { data: remoteRows, error: selectError } = await client
    .from("piece_components")
    .select("id, piece_id")
    .in("piece_id", managedPieceIds);
  if (selectError) throw selectError;

  const idsToDelete = (remoteRows || [])
    .filter(row => !localIds.has(row.id))
    .map(row => row.id);

  if (!idsToDelete.length) return;

  const { error } = await client.from("piece_components").delete().in("id", idsToDelete);
  if (error) throw error;
}

async function fetchRemoteState(client) {
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

  return reconcileStateLinks({
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
}

function finalizeLoadedState(state) {
  const { state: nextState, seeded } = applyLibrarySeedIfEmpty(reconcileStateLinks(state));
  if (seeded) {
    nextState.__librarySeeded = true;
  }
  return nextState;
}

export async function saveState(state) {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase não configurado. Confira SUPABASE_URL e SUPABASE_ANON_KEY no ambiente.");
  }

  const client = requireSupabase();
  await syncStateToSupabase(client, reconcileStateLinks(state));
}

async function syncStateToSupabase(client, nextState) {
  const syncErrors = [];

  await tryRemoteSync(() => upsertRowsById(client, "ideas", nextState.ideas, toIdeaRow), "ideas", syncErrors);
  await tryRemoteSync(() => upsertRowsById(client, "pieces", nextState.pieces, toPieceRow), "pieces", syncErrors);
  await tryRemoteSync(() => upsertRowsById(client, "scripts", nextState.scripts, toScriptRow), "scripts", syncErrors);
  await tryRemoteSync(() => upsertRows(client, "library", nextState.library.map(toLibraryRow).filter(Boolean), "category,name"), "library", syncErrors);
  await tryRemoteSync(
    () => syncPieceComponents(
      client,
      nextState.pieces,
      preparePieceComponentsForSync(nextState.pieceComponents, nextState.library)
    ),
    "piece_components",
    syncErrors
  );
  await tryRemoteSync(() => upsertRowsById(client, "texts", nextState.texts, toTextRow), "texts", syncErrors);
  await tryRemoteSync(() => upsertRowsById(client, "files", nextState.files, toFileRow), "files", syncErrors);
  await tryRemoteSync(() => upsertRowsById(client, "publications", nextState.publications, toPublicationRow), "publications", syncErrors);
  await tryRemoteSync(() => upsertRows(client, "ai_settings", [toAiRow(nextState.ai)]), "ai_settings", syncErrors);
  await tryRemoteSync(
    () => linkInstagramMediaToPieces(client, nextState.pieces, nextState.publications),
    "instagram_media",
    syncErrors
  );

  if (syncErrors.length) {
    throw new Error(`Falha ao salvar no Supabase: ${syncErrors.join(", ")}.`);
  }
}

export async function deletePieceRemote(pieceId) {
  if (!pieceId) return;
  if (!isSupabaseConfigured) return;

  const client = requireSupabase();
  await deleteRemoteByField(client, "texts", "piece_id", pieceId);
  await deleteRemoteById(client, "pieces", pieceId);
}

export async function deleteIdeaRemote(ideaId) {
  if (!ideaId) return;
  if (!isSupabaseConfigured) return;

  const client = requireSupabase();
  await deleteRemoteById(client, "ideas", ideaId);
}

export async function deleteLibraryItemRemote(itemId) {
  if (!itemId) return;
  if (!isSupabaseConfigured) return;

  const client = requireSupabase();
  await deleteRemoteById(client, "library", itemId);
}

export async function deleteTextsByPieceRemote(pieceId) {
  if (!pieceId) return;
  if (!isSupabaseConfigured) return;

  const client = requireSupabase();
  await deleteRemoteByField(client, "texts", "piece_id", pieceId);
}

export async function deletePieceComponentRemote(componentId) {
  if (!componentId) return;
  if (!isSupabaseConfigured) return;

  const client = requireSupabase();
  await deleteRemoteById(client, "piece_components", componentId);
}

async function deleteRemoteById(client, table, id) {
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) throw error;
}

async function deleteRemoteByField(client, table, field, value) {
  const { error } = await client.from(table).delete().eq(field, value);
  if (error) throw error;
}

export { getTemplateDefaults } from "./scriptStructures.js";

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
    const criticalTables = ["pieces", "scripts", "piece_components"];
    if (criticalTables.includes(table) && Array.isArray(fallback) && fallback.length === 0) {
      throw new Error(`Tabela crítica "${table}" falhou ao carregar. Sync abortado para proteger os dados.`);
    }
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

export async function refreshInstagramMediaLinks(pieces, publications = []) {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase não configurado.");
  }

  const client = requireSupabase();
  return linkInstagramMediaToPieces(client, pieces, publications);
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
  if (!script?.id || String(script.id).startsWith("local-")) return null;
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
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
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
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
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
  return normalizeScriptFieldsForTemplate(template, fields);
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

function libraryIdentityKey(item) {
  return `${item.category}\0${item.name}`;
}

function remapPieceComponentLibraryIds(components, legacyLibrary, remoteLibrary) {
  const legacyById = new Map((legacyLibrary || []).map(item => [item.id, item]));
  const remoteByKey = new Map((remoteLibrary || []).map(item => [libraryIdentityKey(item), item.id]));
  const remoteIds = new Set((remoteLibrary || []).map(item => item.id));

  return (components || []).map(component => {
    if (!component.libraryItemId) return component;
    if (remoteIds.has(component.libraryItemId)) return component;

    const legacyItem = legacyById.get(component.libraryItemId);
    if (!legacyItem) return { ...component, libraryItemId: null };

    const remoteId = remoteByKey.get(libraryIdentityKey(legacyItem));
    return remoteId ? { ...component, libraryItemId: remoteId } : { ...component, libraryItemId: null };
  });
}

function preparePieceComponentsForSync(components, library) {
  const libraryIds = new Set((library || []).map(item => item.id).filter(Boolean));
  return (components || []).map(component => ({
    ...component,
    libraryItemId: libraryIds.has(component.libraryItemId) ? component.libraryItemId : null
  }));
}

function readLegacyLocalState() {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_LOCAL_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const hasContent = Boolean(
      parsed?.ideas?.length
      || parsed?.pieces?.length
      || parsed?.scripts?.length
      || parsed?.pieceComponents?.length
      || parsed?.texts?.length
      || parsed?.files?.length
      || parsed?.publications?.length
      || parsed?.library?.length
    );
    return hasContent ? parsed : null;
  } catch (error) {
    console.warn("Não foi possível ler o cache legado do ContentOS.", error);
    return null;
  }
}

function clearLegacyLocalCache() {
  try {
    globalThis.localStorage?.removeItem(LEGACY_LOCAL_STATE_KEY);
  } catch (error) {
    console.warn("Não foi possível limpar o cache legado do ContentOS.", error);
  }
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
