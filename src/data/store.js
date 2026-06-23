const STORAGE_KEY = "contentos.workspace.v1";

const seedState = {
  ideas: [
    {
      id: "idea-001",
      title: "Rotina de bastidor antes de gravar",
      source: "nota solta",
      angle: "Mostrar preparação real sem parecer tutorial engessado",
      tags: ["bastidor", "processo", "criador"],
      priority: "alta",
      createdAt: "2026-06-23"
    },
    {
      id: "idea-002",
      title: "Erros comuns ao transformar vídeo longo em corte",
      source: "pergunta recorrente",
      angle: "Lista rápida com exemplos visuais",
      tags: ["cortes", "shorts", "retencao"],
      priority: "média",
      createdAt: "2026-06-23"
    }
  ],
  pieces: [
    {
      id: "piece-001",
      title: "Como organizar versões de vídeo",
      format: "short vertical",
      moment: "edição",
      owner: "Você",
      due: "2026-06-28",
      ideaId: "idea-002",
      materials: ["bruto-01.mov", "editado-sem-legenda.mp4"],
      textIds: ["text-001"],
      publicationIds: []
    }
  ],
  texts: [
    {
      id: "text-001",
      pieceId: "piece-001",
      platform: "instagram",
      title: "Organização de versões sem perder arquivo",
      body: "Se você também vive entre vídeo bruto, editado, legendado e versão final, salve este fluxo para não se perder na produção.",
      seoTerms: ["organização de conteúdo", "versões de vídeo", "produção de vídeos"],
      hashtags: ["#conteudo", "#videomaker", "#criadores", "#organizacao", "#shorts"]
    },
    {
      id: "text-002",
      pieceId: "piece-001",
      platform: "shorts",
      title: "Organize versões de vídeo",
      body: "Fluxo simples para separar bruto, editado, legendado e final sem perder nada.",
      seoTerms: ["versões de vídeo", "produção de conteúdo"],
      hashtags: ["#Shorts"]
    }
  ],
  files: [
    {
      id: "file-001",
      pieceId: "piece-001",
      name: "editado-sem-legenda.mp4",
      kind: "vídeo editado",
      version: "sem legenda",
      location: "Pasta local",
      updatedAt: "2026-06-23"
    },
    {
      id: "file-002",
      pieceId: "piece-001",
      name: "bruto-01.mov",
      kind: "vídeo bruto",
      version: "original",
      location: "Pasta local",
      updatedAt: "2026-06-23"
    }
  ],
  publications: [],
  library: [
    {
      id: "lib-001",
      name: "Formato: erro comum + correção",
      type: "estrutura",
      reuseFor: "TikTok, Reels, Shorts",
      notes: "Começa com erro específico, mostra consequência, fecha com ação prática."
    }
  ],
  ai: {
    enabled: false,
    provider: null,
    plannedHooks: [
      "sugerir próximos passos da peça",
      "revisar SEO e hashtags",
      "adaptar legenda por plataforma",
      "encontrar peças incompletas"
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
    characterLimit: 150,
    note: "até 150 caracteres"
  }
};

export function loadState() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return structuredClone(seedState);

  try {
    return { ...structuredClone(seedState), ...JSON.parse(stored) };
  } catch {
    return structuredClone(seedState);
  }
}

export function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
