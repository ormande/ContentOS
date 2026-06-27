/** @typedef {{ key: string; label: string; multiline?: boolean; hint?: string; list?: boolean }} ScriptFieldDef */

/** @type {Record<string, { label: string; fields: ScriptFieldDef[] }>} */
export const SCRIPT_STRUCTURES = {
  storytelling: {
    label: "Storytelling",
    fields: [
      { key: "oQueAconteceu", label: "O que aconteceu" },
      { key: "onde", label: "Onde" },
      { key: "quando", label: "Quando" },
      { key: "quemEstava", label: "Quem estava" },
      { key: "comoFoi", label: "Como foi" },
      { key: "desfecho", label: "Qual desfecho" },
      { key: "aprendizado", label: "O que aprendeu" }
    ]
  },
  educacional: {
    label: "Educacional",
    fields: [
      { key: "problema", label: "Problema" },
      { key: "solucao", label: "Solução" },
      { key: "prova", label: "Prova" },
      { key: "cta", label: "CTA" }
    ]
  },
  tutorial: {
    label: "Tutorial",
    fields: [
      {
        key: "steps",
        label: "Passos numerados",
        multiline: true,
        list: true,
        hint: "Um passo por linha, no formato 1. Faça isso…"
      }
    ]
  },
  ranking: {
    label: "Ranking / Listicle",
    fields: [
      { key: "tema", label: "Tema" },
      { key: "numeroItens", label: "Número de itens" },
      {
        key: "itens",
        label: "Itens com posição",
        multiline: true,
        hint: "Liste do 1º ao último lugar, um item por linha. Ex.: 1. Primeiro item"
      },
      { key: "ganchoAbertura", label: "Gancho de abertura" },
      { key: "cta", label: "CTA" }
    ]
  },
  tier_list: {
    label: "Tier List",
    fields: [
      { key: "tema", label: "Tema" },
      {
        key: "categorias",
        label: "Categorias (S/A/B/C)",
        multiline: true,
        hint: "Uma categoria por linha. Ex.: S — indispensável"
      },
      {
        key: "itensPorCategoria",
        label: "Itens por categoria",
        multiline: true,
        hint: "Agrupe por categoria. Ex.: S: item A, item B"
      },
      { key: "justificativa", label: "Justificativa", multiline: true },
      { key: "cta", label: "CTA" }
    ]
  },
  yapper: {
    label: "Yapper",
    fields: [
      { key: "opiniao", label: "Opinião principal (take a stance)" },
      {
        key: "argumentos",
        label: "Argumentos de apoio",
        multiline: true,
        hint: "Um argumento por linha"
      },
      { key: "provocacao", label: "Provocação ao público" },
      { key: "cta", label: "CTA" }
    ]
  },
  react: {
    label: "React",
    fields: [
      { key: "referencia", label: "Conteúdo de referência" },
      { key: "reacaoInicial", label: "Reação inicial" },
      { key: "analise", label: "Análise", multiline: true },
      { key: "conclusao", label: "Conclusão" },
      { key: "cta", label: "CTA" }
    ]
  },
  clone: {
    label: "Clone",
    fields: [
      { key: "referencia", label: "Referência (criador/vídeo)" },
      { key: "adaptacaoGancho", label: "Adaptação do gancho" },
      { key: "conteudoProprio", label: "Conteúdo próprio", multiline: true },
      { key: "diferencial", label: "Diferencial" }
    ]
  },
  b_roll_video_humor: {
    label: "B-roll + Vídeo (Humor)",
    fields: [
      { key: "textHook", label: "Text hook", hint: "Texto de abertura que comanda a piada." },
      { key: "situacaoCotidiana", label: "Situação cotidiana", multiline: true, hint: "Qual situação observacional está sendo mostrada?" },
      { key: "viradaOuContraste", label: "Virada ou contraste", multiline: true, hint: "O que muda ou quebra a expectativa?" },
      { key: "cenaPrincipalBroll", label: "Cena principal de b-roll", multiline: true },
      { key: "cenaDeReforco", label: "Cena de reforço", multiline: true },
      { key: "fechamentoVisual", label: "Fechamento visual", multiline: true, hint: "Imagem final que sela a piada." }
    ]
  },
  voiceover_b_roll_humor: {
    label: "Voiceover + B-roll (Humor)",
    fields: [
      { key: "textHook", label: "Text hook", hint: "Texto de abertura na tela." },
      { key: "contexto", label: "Contexto", multiline: true, hint: "Situação inicial da história." },
      { key: "oQueAconteceu", label: "O que aconteceu", multiline: true },
      { key: "detalheObservacional", label: "Detalhe observacional", multiline: true, hint: "Ponto cotidiano que gera identificação." },
      { key: "virada", label: "Virada", multiline: true, hint: "Momento em que a história fica engraçada." },
      { key: "fechamento", label: "Fechamento", multiline: true }
    ]
  }
};

export const SCRIPT_STRUCTURE_KEYS = Object.keys(SCRIPT_STRUCTURES);

const LEGACY_NAME_MAP = [
  ["tutorial", "tutorial"],
  ["tier", "tier_list"],
  ["ranking", "ranking"],
  ["listicle", "ranking"],
  ["yapper", "yapper"],
  ["react", "react"],
  ["clone", "clone"],
  ["b roll", "b_roll_video_humor"],
  ["b-roll", "b_roll_video_humor"],
  ["video + b roll", "b_roll_video_humor"],
  ["broll + video", "b_roll_video_humor"],
  ["voiceover", "voiceover_b_roll_humor"],
  ["voz off", "voiceover_b_roll_humor"],
  ["narracao + b roll", "voiceover_b_roll_humor"],
  ["voiceover + b roll", "voiceover_b_roll_humor"],
  ["educa", "educacional"],
  ["story", "storytelling"]
];

export function getStructureFieldDefs(templateKey) {
  return SCRIPT_STRUCTURES[templateKey]?.fields || SCRIPT_STRUCTURES.storytelling.fields;
}

export function getStructureLabel(templateKey) {
  return SCRIPT_STRUCTURES[templateKey]?.label || "Storytelling";
}

export function isKnownTemplateKey(templateKey) {
  return Boolean(SCRIPT_STRUCTURES[templateKey]);
}

export function getTemplateDefaults(templateKey) {
  const fields = getStructureFieldDefs(templateKey);
  const defaults = {};
  for (const field of fields) {
    defaults[field.key] = field.list ? [] : "";
  }
  return defaults;
}

export function resolveTemplateKeyFromLibraryItem(item) {
  const fromMetadata = item?.metadata?.templateKey;
  if (fromMetadata && isKnownTemplateKey(fromMetadata)) {
    return fromMetadata;
  }
  const token = normalizeToken(`${item?.name || ""} ${item?.notes || ""}`);
  for (const [needle, templateKey] of LEGACY_NAME_MAP) {
    if (token.includes(needle)) return templateKey;
  }
  return "storytelling";
}

export function readScriptFieldsFromForm(templateKey, form) {
  const defs = getStructureFieldDefs(templateKey);
  const formData = new FormData(form);
  const fields = {};

  for (const field of defs) {
    const raw = String(formData.get(field.key) || "").trim();
    if (field.list) {
      fields[field.key] = raw
        .split("\n")
        .map(item => item.trim())
        .filter(Boolean);
    } else {
      fields[field.key] = raw;
    }
  }

  return fields;
}

export function normalizeScriptFieldsForTemplate(templateKey, fields) {
  const defs = getStructureFieldDefs(templateKey);
  const next = getTemplateDefaults(templateKey);

  for (const field of defs) {
    const value = fields?.[field.key];
    if (field.list) {
      next[field.key] = Array.isArray(value)
        ? value.map(item => String(item || "").trim()).filter(Boolean)
        : String(value || "")
          .split("\n")
          .map(item => item.trim())
          .filter(Boolean);
    } else {
      next[field.key] = String(value ?? "").trim();
    }
  }

  return next;
}

export function formatScriptFieldValue(field, value) {
  if (field.list) {
    return Array.isArray(value) ? value.join("\n") : String(value || "");
  }
  return String(value || "");
}

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
