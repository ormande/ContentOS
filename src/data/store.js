import { isSupabaseConfigured, requireSupabase } from "./supabaseClient.js";

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
    note: "até 5 hashtags"
  },
  tiktok: {
    label: "TikTok",
    hashtagLimit: Infinity,
    characterLimit: 4000,
    note: "hashtags livres"
  },
  shorts: {
    label: "YouTube Shorts",
    hashtagLimit: 3,
    characterLimit: 100,
    note: "até 100 caracteres"
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
    console.warn("Supabase não configurado. Usando estado vazio temporário.");
    return createEmptyState();
  }

  const client = requireSupabase();
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
    selectAll(client, "pieces", "updated_at", { ascending: false }),
    selectAll(client, "scripts", "updated_at", { ascending: false }),
    selectAll(client, "piece_components", "order_index", { ascending: true }),
    selectAll(client, "texts", "updated_at", { ascending: false }),
    selectAll(client, "files", "updated_at", { ascending: false }),
    selectAll(client, "publications", "published_at", { ascending: false }),
    selectAll(client, "library", "created_at", { ascending: false }),
    client.from("ai_settings").select("*").eq("id", 1).maybeSingle()
  ]);

  if (aiSettings.error) throw aiSettings.error;

  return reconcileStateLinks({
    ideas: ideas.map(fromIdeaRow),
    pieces: pieces.map(fromPieceRow),
    scripts: scripts.map(fromScriptRow),
    pieceComponents: pieceComponents.map(fromPieceComponentRow),
    texts: texts.map(fromTextRow),
    files: files.map(fromFileRow),
    publications: publications.map(fromPublicationRow),
    library: library.map(fromLibraryRow),
    ai: fromAiRow(aiSettings.data)
  });
}

export async function saveState(state) {
  if (!isSupabaseConfigured) {
    console.warn("Supabase não configurado. Alterações mantidas apenas em memória.");
    return;
  }

  const client = requireSupabase();
  const nextState = reconcileStateLinks(state);

  await syncRows(client, "ideas", nextState.ideas.map(toIdeaRow));
  await syncRows(client, "pieces", nextState.pieces.map(toPieceRow));
  await syncRows(client, "scripts", nextState.scripts.map(toScriptRow));
  await syncRows(client, "piece_components", nextState.pieceComponents.map(toPieceComponentRow));
  await syncRows(client, "texts", nextState.texts.map(toTextRow));
  await syncRows(client, "files", nextState.files.map(toFileRow));
  await syncRows(client, "publications", nextState.publications.map(toPublicationRow));
  await upsertRows(client, "library", nextState.library.map(toLibraryRow).filter(Boolean), "category,name");
  await upsertRows(client, "ai_settings", [toAiRow(nextState.ai)]);
  await syncInstagramMediaLinks(client, nextState.pieces);
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
    platform: text.platform,
    title: text.title,
    body: text.body || null,
    seo_terms: text.seoTerms || [],
    hashtags: text.hashtags || [],
    yt_title: text.ytTitle || null,
    yt_description: text.ytDescription || null,
    yt_tags: text.ytTags || null,
    updated_at: new Date().toISOString()
  };
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
    cameraPlan: capture?.cameraPlan || "",
    takes: capture?.takes || "",
    materials: capture?.materials || listToMultiline(fallback?.materials || []),
    driveUrl: capture?.driveUrl || ""
  };
}

function normalizeEdit(edit, fallback = {}) {
  return {
    notes: edit?.notes || "",
    musicDirection: edit?.musicDirection || "",
    soundDirection: edit?.soundDirection || "",
    textHeaders: edit?.textHeaders || ""
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
