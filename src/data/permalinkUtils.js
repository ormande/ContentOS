export function normalizePermalinkValue(value) {
  return String(value || "").trim();
}

export function extractInstagramPermalinkKey(value) {
  const normalized = normalizePermalinkValue(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized.startsWith("http") ? normalized : `https://${normalized}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const markerIndex = parts.findIndex(part => ["reel", "p", "tv"].includes(part.toLowerCase()));
    if (markerIndex >= 0 && parts[markerIndex + 1]) {
      return parts[markerIndex + 1].toLowerCase();
    }
  } catch {
    // ignore invalid URLs
  }

  return normalized.toLowerCase().replace(/\/$/, "");
}

export function stripPermalinkQuery(value) {
  const normalized = normalizePermalinkValue(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized.startsWith("http") ? normalized : `https://${normalized}`);
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return normalized.replace(/\/$/, "");
  }
}

export function permalinksMatch(left, right) {
  const leftKey = extractInstagramPermalinkKey(left);
  const rightKey = extractInstagramPermalinkKey(right);
  if (leftKey && rightKey && leftKey === rightKey) return true;

  const leftStripped = stripPermalinkQuery(left);
  const rightStripped = stripPermalinkQuery(right);
  if (!leftStripped || !rightStripped) return false;

  return leftStripped === rightStripped
    || leftStripped.replace(/\/$/, "") === rightStripped.replace(/\/$/, "");
}

export function findPieceIdForInstagramMedia(pieceLookups, media) {
  const mediaId = normalizePermalinkValue(media.igMediaId || media.ig_media_id);
  if (mediaId && pieceLookups.byMediaId.has(mediaId)) {
    return pieceLookups.byMediaId.get(mediaId);
  }

  const permalinkKey = extractInstagramPermalinkKey(media.permalink);
  if (permalinkKey && pieceLookups.byPermalinkKey.has(permalinkKey)) {
    return pieceLookups.byPermalinkKey.get(permalinkKey);
  }

  for (const entry of pieceLookups.byPermalink) {
    if (permalinksMatch(entry.permalink, media.permalink)) {
      return entry.pieceId;
    }
  }

  return null;
}

export function buildPieceInstagramLookups(pieces, publications = []) {
  const byMediaId = new Map();
  const byPermalinkKey = new Map();
  const byPermalink = [];

  for (const piece of pieces || []) {
    const mediaId = normalizePermalinkValue(piece.distribution?.igMediaId);
    const permalink = normalizePermalinkValue(piece.distribution?.permalink);

    if (mediaId) byMediaId.set(mediaId, piece.id);
    if (permalink) {
      const key = extractInstagramPermalinkKey(permalink);
      if (key) byPermalinkKey.set(key, piece.id);
      byPermalink.push({ pieceId: piece.id, permalink });
    }
  }

  for (const publication of publications || []) {
    const permalink = normalizePermalinkValue(publication.url);
    if (!permalink || !publication.pieceId) continue;
    const key = extractInstagramPermalinkKey(permalink);
    if (key && !byPermalinkKey.has(key)) byPermalinkKey.set(key, publication.pieceId);
    byPermalink.push({ pieceId: publication.pieceId, permalink });
  }

  return { byMediaId, byPermalinkKey, byPermalink };
}
