import {
  buildPieceInstagramLookups,
  findPieceIdForInstagramMedia,
  normalizePermalinkValue,
  permalinksMatch
} from "./permalinkUtils.js";

export async function linkInstagramMediaToPieces(supabase, pieces, publications = []) {
  const { data: mediaRows, error } = await supabase
    .from("instagram_media")
    .select("id, ig_media_id, permalink, piece_id");

  if (error) {
    throw error;
  }

  const lookups = buildPieceInstagramLookups(pieces, publications);
  let linked = 0;

  for (const media of mediaRows || []) {
    const nextPieceId = findPieceIdForInstagramMedia(lookups, {
      ig_media_id: media.ig_media_id,
      permalink: media.permalink
    });

    if (nextPieceId === (media.piece_id || null)) continue;

    const { error: updateError } = await supabase
      .from("instagram_media")
      .update({ piece_id: nextPieceId })
      .eq("id", media.id);

    if (updateError) {
      console.warn(`Não foi possível atualizar o vínculo da mídia ${media.id}.`, updateError);
      continue;
    }

    if (nextPieceId) linked += 1;
  }

  return { linked, scanned: mediaRows?.length || 0 };
}

export function findInstagramMediaIdForPermalink(contentItems, permalink) {
  const normalized = normalizePermalinkValue(permalink);
  if (!normalized) return "";

  const match = (contentItems || []).find(item => permalinksMatch(item.permalink, normalized));
  return match?.instagramMediaId || "";
}
