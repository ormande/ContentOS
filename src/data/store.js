import { isSupabaseConfigured, requireSupabase } from "./supabaseClient.js";

const emptyState = {
  ideas: [],
  pieces: [],
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
    texts,
    files,
    publications,
    library,
    aiSettings
  ] = await Promise.all([
    selectAll(client, "ideas", "created_at", { ascending: false }),
    selectAll(client, "pieces", "due", { ascending: true, nullsFirst: false }),
    selectAll(client, "texts", "title", { ascending: true }),
    selectAll(client, "files", "updated_at", { ascending: false }),
    selectAll(client, "publications", "published_at", { ascending: false }),
    selectAll(client, "library", "created_at", { ascending: false }),
    client.from("ai_settings").select("*").eq("id", 1).maybeSingle()
  ]);

  if (aiSettings.error) throw aiSettings.error;

  return reconcileStateLinks({
    ideas: ideas.map(fromIdeaRow),
    pieces: pieces.map(fromPieceRow),
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
  await syncRows(client, "texts", nextState.texts.map(toTextRow));
  await syncRows(client, "files", nextState.files.map(toFileRow));
  await syncRows(client, "publications", nextState.publications.map(toPublicationRow));
  await upsertRows(client, "library", nextState.library.map(toLibraryRow).filter(Boolean), "category,name");
  await upsertRows(client, "ai_settings", [toAiRow(nextState.ai)]);
}

export function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function selectAll(client, table, orderColumn, orderOptions) {
  let query = client.from(table).select("*");

  if (orderColumn) {
    query = query.order(orderColumn, orderOptions);
  }

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

function fromIdeaRow(row) {
  return {
    id: row.id,
    title: row.title,
    source: row.source || "",
    angle: row.angle || "",
    tags: row.tags || [],
    priority: row.priority || "",
    createdAt: row.created_at || ""
  };
}

function toIdeaRow(idea) {
  return {
    id: idea.id,
    title: idea.title,
    source: idea.source || null,
    angle: idea.angle || null,
    tags: idea.tags || [],
    priority: idea.priority || null,
    created_at: idea.createdAt || new Date().toISOString().slice(0, 10)
  };
}

function fromPieceRow(row) {
  return {
    id: row.id,
    title: row.title,
    format: row.format || "",
    moment: row.moment || "",
    owner: row.owner || "",
    due: row.due || "",
    ideaId: row.idea_id || null,
    materials: row.materials || [],
    textIds: row.text_ids || [],
    publicationIds: row.publication_ids || []
  };
}

function toPieceRow(piece) {
  return {
    id: piece.id,
    title: piece.title,
    format: piece.format || null,
    moment: piece.moment || null,
    owner: piece.owner || null,
    due: piece.due || null,
    idea_id: piece.ideaId || null,
    materials: piece.materials || [],
    text_ids: piece.textIds || [],
    publication_ids: piece.publicationIds || []
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
    hashtags: row.hashtags || []
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
    hashtags: text.hashtags || []
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
    views: 0,
    likes: 0,
    saves: 0,
    shares: 0,
    comments: 0
  };
}

function reconcileStateLinks(state) {
  const nextState = clone(state);
  const textIdsByPiece = new Map(nextState.pieces.map(piece => [piece.id, []]));
  const publicationIdsByPiece = new Map(nextState.pieces.map(piece => [piece.id, []]));

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

  nextState.pieces = nextState.pieces.map(piece => ({
    ...piece,
    textIds: textIdsByPiece.get(piece.id) || [],
    publicationIds: publicationIdsByPiece.get(piece.id) || []
  }));

  return nextState;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
