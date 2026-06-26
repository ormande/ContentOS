export const assistantGateway = {
  isEnabled() {
    return true;
  },

  buildInsightsReport({ dashboard, state, range, previousRange }) {
    const currentItems = filterItemsByRange(dashboard?.contentItems || [], range);
    const previousItems = filterItemsByRange(dashboard?.contentItems || [], previousRange);
    const currentTotals = sumMetrics(currentItems);
    const previousTotals = sumMetrics(previousItems);
    const bestContent = findBestContent(currentItems);
    const topType = findTopContentType(currentItems, dashboard?.byContentType || []);
    const comparison = buildComparison(currentTotals, previousTotals);

    return {
      rangeLabel: formatRangeLabel(range),
      summary: buildSummaryParagraph(currentTotals, topType),
      bestContent,
      alert: buildAlert(comparison),
      nextSuggestion: buildNextSuggestion(topType, state),
      totals: currentTotals
    };
  },

  collectCaptionContext(state) {
    const hashtags = new Map();
    const seoTerms = new Map();

    for (const text of state?.texts || []) {
      for (const hashtag of text.hashtags || []) {
        const key = normalizeToken(hashtag);
        if (!key) continue;
        hashtags.set(key, {
          label: hashtag.startsWith("#") ? hashtag : `#${hashtag}`,
          count: (hashtags.get(key)?.count || 0) + 1
        });
      }

      for (const term of text.seoTerms || []) {
        const key = normalizeToken(term);
        if (!key) continue;
        seoTerms.set(key, {
          label: term,
          count: (seoTerms.get(key)?.count || 0) + 1
        });
      }
    }

    return {
      hashtags: [...hashtags.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      seoTerms: [...seoTerms.values()].sort((a, b) => b.count - a.count).slice(0, 8)
    };
  },

  improveCaption({ title, theme, platform, pieceTitle, rules, context }) {
    const hook = title?.trim() || `A ideia de hoje sobre ${theme}`;
    const body = [
      `Gancho: ${hook}.`,
      `Corpo: ${theme}. ${pieceTitle ? `A peça "${pieceTitle}" entra como prova visual.` : "Mostre um exemplo prático logo no primeiro bloco."}`,
      "CTA: salva este conteúdo se quiser repetir a estrutura depois."
    ].join(" ");

    const chosenSeo = (context?.seoTerms || []).slice(0, 3).map(item => item.label);
    const chosenHashtags = (context?.hashtags || [])
      .slice(0, Math.min(rules?.hashtagLimit || 0, 5))
      .map(item => item.label);

    return {
      title: hook,
      platform,
      body: fitCaptionToRule(body, rules?.characterLimit || 2200),
      seoTerms: chosenSeo,
      hashtags: chosenHashtags
    };
  }
};

function filterItemsByRange(items, range) {
  return items.filter(item => {
    if (!item?.publishedAt) return false;
    const date = new Date(item.publishedAt);
    if (range?.start && date < range.start) return false;
    if (range?.end && date > range.end) return false;
    return true;
  });
}

function sumMetrics(items) {
  return items.reduce((acc, item) => ({
    reach: acc.reach + Number(item.metrics?.reach || 0),
    views: acc.views + Number(item.metrics?.views || 0),
    likes: acc.likes + Number(item.metrics?.likes || 0),
    saves: acc.saves + Number(item.metrics?.saves || 0),
    shares: acc.shares + Number(item.metrics?.shares || 0),
    comments: acc.comments + Number(item.metrics?.comments || 0)
  }), {
    reach: 0,
    views: 0,
    likes: 0,
    saves: 0,
    shares: 0,
    comments: 0
  });
}

function findBestContent(items) {
  const scored = items.map(item => {
    const engagement = Number(item.metrics?.likes || 0)
      + Number(item.metrics?.comments || 0) * 2
      + Number(item.metrics?.saves || 0) * 3
      + Number(item.metrics?.shares || 0) * 3;
    const base = Math.max(Number(item.metrics?.reach || 0), Number(item.metrics?.views || 0), 1);
    return {
      item,
      score: engagement / base,
      engagement
    };
  }).sort((left, right) => right.score - left.score);

  return scored[0] || null;
}

function findTopContentType(items, fallbackTypes) {
  const localCounts = new Map();
  for (const item of items) {
    const key = item.contentType || "unknown";
    localCounts.set(key, (localCounts.get(key) || 0) + 1);
  }

  if (localCounts.size) {
    const [contentType] = [...localCounts.entries()].sort((left, right) => right[1] - left[1])[0];
    return contentType;
  }

  const firstFallback = [...fallbackTypes].sort((left, right) => (right.count || 0) - (left.count || 0))[0];
  return firstFallback?.contentType || "reel";
}

function buildComparison(currentTotals, previousTotals) {
  const currentValue = currentTotals.views + currentTotals.saves * 2 + currentTotals.shares * 2;
  const previousValue = previousTotals.views + previousTotals.saves * 2 + previousTotals.shares * 2;
  if (!previousValue) {
    return {
      deltaPercent: currentValue > 0 ? 100 : 0,
      direction: currentValue > 0 ? "up" : "flat"
    };
  }

  const deltaPercent = Math.round(((currentValue - previousValue) / previousValue) * 100);
  return {
    deltaPercent,
    direction: deltaPercent > 10 ? "up" : deltaPercent < -10 ? "down" : "flat"
  };
}

function buildSummaryParagraph(totals, topType) {
  return `No período de ${formatContentType(topType)}, o app leu ${formatNumber(totals.reach)} de alcance, ${formatNumber(totals.views)} views, ${formatNumber(totals.likes)} curtidas, ${formatNumber(totals.saves)} salvamentos e ${formatNumber(totals.shares)} compartilhamentos. O destaque fica para os salvamentos, que costumam sinalizar conteúdo de valor.`;
}

function buildAlert(comparison) {
  if (comparison.direction === "up") {
    return `Pico detectado: o período atual está ${Math.abs(comparison.deltaPercent)}% acima do anterior no indicador combinado de views, salvamentos e compartilhamentos.`;
  }

  if (comparison.direction === "down") {
    return `Queda detectada: o período atual está ${Math.abs(comparison.deltaPercent)}% abaixo do anterior. Vale revisar formato, gancho e timing.`;
  }

  return "Sem variação brusca no período. O desempenho está estável em relação à janela anterior.";
}

function buildNextSuggestion(topType, state) {
  const topIdeaTag = findTopIdeaTag(state);
  const hook = topIdeaTag ? ` com foco na tag "${topIdeaTag}"` : "";
  return `Próximo conteúdo sugerido: publique um ${formatContentType(topType)}${hook}, repetindo o formato que mais sustenta alcance e complementando com CTA voltado para salvamentos.`;
}

function findTopIdeaTag(state) {
  const counts = new Map();
  for (const idea of state?.ideas || []) {
    for (const tag of idea.tags || []) {
      const key = normalizeToken(tag);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const entry = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return entry?.[0] || "";
}

function fitCaptionToRule(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function normalizeToken(value) {
  return String(value || "").replace(/^#/, "").trim().toLowerCase();
}

function formatContentType(type) {
  const labels = {
    reel: "Reels",
    post: "posts",
    carousel: "carrosséis",
    video: "vídeos",
    story: "stories",
    unknown: "conteúdos"
  };

  return labels[type] || labels.unknown;
}

function formatRangeLabel(range) {
  if (!range?.start || !range?.end) return "este período";
  return `${range.start.toLocaleDateString("pt-BR")} a ${range.end.toLocaleDateString("pt-BR")}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}
