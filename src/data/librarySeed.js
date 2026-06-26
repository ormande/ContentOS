import { SCRIPT_STRUCTURE_KEYS, SCRIPT_STRUCTURES } from "./scriptStructures.js";

const DEFAULT_PLATFORMS = ["instagram", "tiktok", "shorts"];

/**
 * @param {ReturnType<import("./store.js").createEmptyState>} state
 * @returns {{ state: ReturnType<import("./store.js").createEmptyState>; seeded: boolean }}
 */
export function applyLibrarySeedIfEmpty(state) {
  if ((state.library || []).length > 0) {
    return { state, seeded: false };
  }

  const createdAt = new Date().toISOString();
  state.library = buildLibrarySeedEntries().map(entry => ({
    id: crypto.randomUUID(),
    context: [],
    platforms: [...DEFAULT_PLATFORMS],
    notes: "",
    example: "",
    metadata: {},
    createdAt,
    ...entry
  }));

  return { state, seeded: true };
}

export function buildLibrarySeedEntries() {
  return [
    ...buildStructureEntries(),
    ...buildHookEntries(),
    ...buildFormatEntries(),
    ...buildCameraAngleEntries(),
    ...buildMusicEntries(),
    ...buildSoundEffectEntries(),
    ...buildCtaEntries(),
    ...buildTextHeaderEntries()
  ];
}

function buildStructureEntries() {
  return SCRIPT_STRUCTURE_KEYS.map(templateKey => ({
    name: SCRIPT_STRUCTURES[templateKey].label,
    category: "estrutura_roteiro",
    metadata: { templateKey },
    notes: `Estrutura piloto com campos de ${SCRIPT_STRUCTURES[templateKey].label.toLowerCase()}.`
  }));
}

function buildHookEntries() {
  const visual = [
    { name: "Close no rosto", notes: "Abre com rosto em close e expressão forte." },
    { name: "Objeto na mão", notes: "Mostra o objeto principal antes de falar." },
    { name: "Corte seco + texto", notes: "Primeiro frame com texto grande na tela." },
    { name: "Movimento de câmera", notes: "Pan ou zoom rápido para prender atenção." },
    { name: "Antes e depois", notes: "Split ou transição visual entre estados." },
    { name: "Contagem regressiva", notes: "3-2-1 visual antes da revelação." },
    { name: "B-roll impactante", notes: "Imagem forte sem fala nos primeiros segundos." },
    { name: "Reação exagerada", notes: "Expressão facial amplificada no frame inicial." }
  ];

  const textual = [
    { name: "Pergunta polêmica", notes: "Abre com pergunta que divide opiniões." },
    { name: "Ninguém te contou que…", notes: "Curiosidade com promessa de revelação." },
    { name: "Estatística chocante", notes: "Número ou dado surpreendente na abertura." },
    { name: "Confissão pessoal", notes: "Primeira pessoa com vulnerabilidade." },
    { name: "Afirmação contraintuitiva", notes: "Frase que desafia o senso comum." },
    { name: "Pare de fazer X", notes: "Comando direto contra um hábito comum." },
    { name: "História em uma frase", notes: "Micro-narrativa que cria tensão imediata." },
    { name: "Promessa de transformação", notes: "O que muda se a pessoa assistir até o fim." }
  ];

  return [
    ...visual.map(item => ({ ...item, category: "gancho", metadata: { hookType: "visual" } })),
    ...textual.map(item => ({ ...item, category: "gancho", metadata: { hookType: "textual" } }))
  ];
}

function buildFormatEntries() {
  return [
    { name: "Falando pra câmera", notes: "Apresentador direto ao público." },
    { name: "Voiceover + b-roll", notes: "Narração sobre imagens de apoio." },
    { name: "POV", notes: "Câmera na perspectiva de quem vive a cena." },
    { name: "Green screen", notes: "Fundo trocado com elemento visual." },
    { name: "Tela dividida", notes: "Dois quadros simultâneos." },
    { name: "Trend remix", notes: "Formato adaptado de áudio ou trend em alta." },
    { name: "Gravação de tela", notes: "Tutorial ou demonstração digital." },
    { name: "Cards em sequência", notes: "Slides ou cards com uma ideia por tela." }
  ].map(item => ({ ...item, category: "formato" }));
}

function buildCameraAngleEntries() {
  return [
    { name: "Close-up rosto", notes: "Enquadramento do rosto para conexão." },
    { name: "Medium shot", notes: "Cintura para cima, equilíbrio entre pessoa e contexto." },
    { name: "Wide / ambiente", notes: "Mostra o cenário completo." },
    { name: "Overhead", notes: "Câmera de cima para demonstrações." },
    { name: "POV primeira pessoa", notes: "Olhar de quem executa a ação." },
    { name: "Tripé fixo", notes: "Câmera estável para fala direta." },
    { name: "Handheld dinâmico", notes: "Movimento manual para energia." }
  ].map(item => ({ ...item, category: "angulo_camera" }));
}

function buildMusicEntries() {
  return [
    {
      name: "Lo-fi suave",
      notes: "Trilha calma para conteúdo educacional ou reflexivo.",
      context: ["educacional", "storytelling"]
    },
    {
      name: "Phonk / hype",
      notes: "Energia alta para trends e cortes rápidos.",
      context: ["trend", "ranking"]
    },
    {
      name: "Trending audio",
      notes: "Áudio em alta na plataforma no momento.",
      context: ["trend", "react"]
    },
    {
      name: "Sem música",
      notes: "Foco total na voz e nos efeitos pontuais.",
      context: ["tutorial", "yapper"]
    },
    {
      name: "Beat drop no gancho",
      notes: "Música entra forte no segundo 2-3.",
      context: ["storytelling", "react"]
    }
  ].map(item => ({ ...item, category: "musica" }));
}

function buildSoundEffectEntries() {
  return [
    { name: "Whoosh", notes: "Transição entre cenas ou cortes." },
    { name: "Ding / notificação", notes: "Destaque de insight ou dica." },
    { name: "Tap / click", notes: "Ação na tela ou demonstração." },
    { name: "Risada / reação", notes: "Tom bem-humorado ou react." },
    { name: "Suspense", notes: "Tensão antes de revelação." }
  ].map(item => ({ ...item, category: "efeito_sonoro" }));
}

function buildCtaEntries() {
  return [
    { name: "Salva pra ver depois", notes: "Ideal para conteúdo educacional ou listas." },
    { name: "Comenta sua opinião", notes: "Engajamento em yapper, react e tier list." },
    { name: "Segue para mais", notes: "Crescimento de audiência." },
    { name: "Marca alguém", notes: "Compartilhamento social do conteúdo." },
    { name: "Link na bio", notes: "Conversão para produto ou recurso." },
    { name: "Compartilha com quem precisa", notes: "Distribuição orgânica do vídeo." }
  ].map(item => ({ ...item, category: "cta" }));
}

function buildTextHeaderEntries() {
  return [
    { name: "Pergunta na tela", notes: "Header curto em forma de pergunta." },
    { name: "Número + promessa", notes: "Ex.: 3 erros que…" },
    { name: "Antes → Depois", notes: "Contraste visual em duas palavras." },
    { name: "Palavra-chave SEO", notes: "Termo principal para busca." }
  ].map(item => ({ ...item, category: "text_header" }));
}
