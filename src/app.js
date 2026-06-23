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

const platformRules = {
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

const assistantGateway = {
  isEnabled(state) {
    return Boolean(state.ai?.enabled);
  },

  async suggestNextSteps() {
    return { status: "disabled", suggestions: [] };
  },

  async improveCaption() {
    return { status: "disabled", caption: null };
  },

  async auditWorkspace() {
    return { status: "disabled", findings: [] };
  }
};

function loadState() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return clone(seedState);

  try {
    return { ...clone(seedState), ...JSON.parse(stored) };
  } catch {
    return clone(seedState);
  }
}

function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const sections = [
  { id: "ideas", label: "Ideias", kicker: "captura", title: "Ideias", metric: state => `${state.ideas.length} ideias` },
  { id: "pieces", label: "Peças", kicker: "produção", title: "Peças em movimento", metric: state => `${state.pieces.length} peças` },
  { id: "texts", label: "Textos", kicker: "distribuição", title: "Legendas por plataforma", metric: state => `${state.texts.length} textos` },
  { id: "files", label: "Arquivos", kicker: "materiais", title: "Versões e arquivos", metric: state => `${state.files.length} arquivos` },
  { id: "publications", label: "Publicações", kicker: "histórico", title: "Saídas publicadas", metric: state => `${state.publications.length} registros` },
  { id: "library", label: "Biblioteca", kicker: "reaproveitamento", title: "Formatos e referências", metric: state => `${state.library.length} itens` },
  { id: "assistant", label: "IA auxiliar", kicker: "arquitetura", title: "Assistente auxiliar", metric: () => "desativada" }
];

let state = loadState();
let currentSection = window.location.hash.replace("#", "") || "ideas";

const nav = document.querySelector("#sectionNav");
const contentArea = document.querySelector("#contentArea");
const sectionKicker = document.querySelector("#sectionKicker");
const sectionTitle = document.querySelector("#sectionTitle");
const sectionMetric = document.querySelector("#sectionMetric");
const globalSearch = document.querySelector("#globalSearch");
const newIdeaBtn = document.querySelector("#newIdeaBtn");
const newPieceBtn = document.querySelector("#newPieceBtn");

function persistAndRender() {
  saveState(state);
  render();
}

function setSection(sectionId) {
  currentSection = sectionId;
  window.location.hash = sectionId;
  render();
}

function renderNav() {
  nav.innerHTML = sections.map(section => `
    <button class="nav-item ${section.id === currentSection ? "active" : ""}" type="button" data-section="${section.id}">
      <span>${section.label}</span>
      <small>${section.metric(state)}</small>
    </button>
  `).join("");

  nav.querySelectorAll("[data-section]").forEach(button => {
    button.addEventListener("click", () => setSection(button.dataset.section));
  });
}

function render() {
  const section = sections.find(item => item.id === currentSection) || sections[0];
  sectionKicker.textContent = section.kicker;
  sectionTitle.textContent = section.title;
  sectionMetric.textContent = section.metric(state);
  renderNav();

  const query = globalSearch.value.trim().toLowerCase();
  const renderers = {
    ideas: renderIdeas,
    pieces: renderPieces,
    texts: renderTexts,
    files: renderFiles,
    publications: renderPublications,
    library: renderLibrary,
    assistant: renderAssistant
  };

  contentArea.innerHTML = renderers[section.id](query);
  attachSectionEvents();
}

function matchesQuery(values, query) {
  if (!query) return true;
  return values.filter(Boolean).join(" ").toLowerCase().includes(query);
}

function renderDropdown({ name, label, value, options }) {
  const selected = options.find(option => option.value === value) || options[0];

  return `
    <div class="dropdown-field" data-dropdown>
      <input type="hidden" name="${name}" value="${selected.value}" />
      <button class="dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span>
          <small>${label}</small>
          <strong data-dropdown-label>${selected.label}</strong>
        </span>
        <i aria-hidden="true"></i>
      </button>
      <div class="dropdown-menu" role="listbox">
        ${options.map(option => `
          <button class="dropdown-option ${option.value === selected.value ? "selected" : ""}" type="button" role="option" aria-selected="${option.value === selected.value}" data-value="${option.value}">
            ${option.label}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderIdeas(query) {
  const ideas = state.ideas.filter(idea => matchesQuery([idea.title, idea.source, idea.angle, idea.tags.join(" ")], query));
  if (!ideas.length) return emptyState();

  return `
    <div class="grid two">
      <form class="panel form-panel" id="ideaForm">
        <h3>Captura rápida</h3>
        <input name="title" placeholder="Ideia" required />
        <input name="source" placeholder="Origem" />
        <textarea name="angle" placeholder="Ângulo editorial"></textarea>
        <input name="tags" placeholder="tags separadas por vírgula" />
        ${renderDropdown({
          name: "priority",
          label: "Prioridade",
          value: "alta",
          options: [
            { value: "alta", label: "alta" },
            { value: "média", label: "média" },
            { value: "baixa", label: "baixa" }
          ]
        })}
        <button class="primary-action" type="submit">Guardar ideia</button>
      </form>

      <div class="stack">
        ${ideas.map(idea => `
          <article class="item-card">
            <div class="item-topline">
              <span>${idea.source || "ideia"}</span>
              <strong>${idea.priority}</strong>
            </div>
            <h3>${idea.title}</h3>
            <p>${idea.angle}</p>
            <div class="tag-row">${idea.tags.map(tag => `<span>${tag}</span>`).join("")}</div>
            <button class="ghost-action compact" type="button" data-promote-idea="${idea.id}">Virar peça</button>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function renderPieces(query) {
  const pieces = state.pieces.filter(piece => matchesQuery([piece.title, piece.format, piece.moment, piece.owner], query));
  if (!pieces.length) return emptyState();

  return `
    <div class="table-surface">
      <div class="table-row table-head">
        <span>Peça</span><span>Formato</span><span>Momento</span><span>Prazo</span><span>Material</span>
      </div>
      ${pieces.map(piece => `
        <article class="table-row">
          <span><strong>${piece.title}</strong><small>${piece.owner}</small></span>
          <span>${piece.format}</span>
          <span><mark>${piece.moment}</mark></span>
          <span>${piece.due || "sem data"}</span>
          <span>${piece.materials.length} arquivos</span>
        </article>
      `).join("")}
    </div>
  `;
}

function renderTexts(query) {
  const texts = state.texts.filter(text => matchesQuery([
    text.title,
    text.body,
    text.platform,
    text.seoTerms.join(" "),
    text.hashtags.join(" ")
  ], query));

  return `
    <div class="platform-rules">
      ${Object.entries(platformRules).map(([key, rule]) => `
        <div class="rule-card">
          <strong>${rule.label}</strong>
          <span>${rule.note}</span>
          <small>${Number.isFinite(rule.characterLimit) ? `${rule.characterLimit} caracteres` : "limite amplo"}</small>
        </div>
      `).join("")}
    </div>

    <div class="grid two">
      <form class="panel form-panel" id="textForm">
        <h3>Novo texto</h3>
        ${renderDropdown({
          name: "platform",
          label: "Plataforma",
          value: "instagram",
          options: [
            { value: "instagram", label: "Instagram" },
            { value: "tiktok", label: "TikTok" },
            { value: "shorts", label: "YouTube Shorts" }
          ]
        })}
        <input name="title" placeholder="Título interno" required />
        <textarea name="body" placeholder="Legenda otimizada"></textarea>
        <input name="seoTerms" placeholder="SEO separado por vírgula" />
        <input name="hashtags" placeholder="hashtags separadas por espaço" />
        <button class="primary-action" type="submit">Salvar texto</button>
      </form>

      <div class="stack">
        ${texts.length ? texts.map(renderTextCard).join("") : emptyState()}
      </div>
    </div>
  `;
}

function renderTextCard(text) {
  const rule = platformRules[text.platform];
  const count = text.body.length;
  const hashtagCount = text.hashtags.length;
  const characterStatus = count <= rule.characterLimit ? "ok" : "alert";
  const hashtagStatus = !Number.isFinite(rule.hashtagLimit) || hashtagCount <= rule.hashtagLimit ? "ok" : "alert";

  return `
    <article class="item-card">
      <div class="item-topline">
        <span>${rule.label}</span>
        <strong class="${characterStatus}">${count}/${rule.characterLimit}</strong>
      </div>
      <h3>${text.title}</h3>
      <p>${text.body}</p>
      <div class="keyword-line">${text.seoTerms.map(term => `<span>${term}</span>`).join("")}</div>
      <div class="tag-row ${hashtagStatus}">${text.hashtags.map(tag => `<span>${tag}</span>`).join("")}</div>
    </article>
  `;
}

function renderFiles(query) {
  const files = state.files.filter(file => matchesQuery([file.name, file.kind, file.version, file.location], query));
  if (!files.length) return emptyState();

  return `
    <div class="file-grid">
      ${files.map(file => `
        <article class="file-tile">
          <span>${file.kind}</span>
          <h3>${file.name}</h3>
          <p>${file.version}</p>
          <small>${file.location} · ${file.updatedAt}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function renderPublications(query) {
  const publications = state.publications.filter(publication => matchesQuery([
    publication.platform,
    publication.url,
    publication.date,
    publication.pieceTitle
  ], query));
  if (!publications.length) return emptyState();

  return `<div class="stack">${publications.map(publication => `
    <article class="item-card">
      <div class="item-topline"><span>${publication.platform}</span><strong>${publication.date}</strong></div>
      <h3>${publication.pieceTitle}</h3>
      <p>${publication.url}</p>
    </article>
  `).join("")}</div>`;
}

function renderLibrary(query) {
  const items = state.library.filter(item => matchesQuery([item.name, item.type, item.reuseFor, item.notes], query));
  if (!items.length) return emptyState();

  return `<div class="grid three">${items.map(item => `
    <article class="item-card">
      <div class="item-topline"><span>${item.type}</span><strong>${item.reuseFor}</strong></div>
      <h3>${item.name}</h3>
      <p>${item.notes}</p>
    </article>
  `).join("")}</div>`;
}

function renderAssistant() {
  const enabled = assistantGateway.isEnabled(state);
  return `
    <div class="assistant-page">
      <section class="panel">
        <h3>Status</h3>
        <p>${enabled ? "Ativa" : "Desativada"}</p>
      </section>
      <section class="panel">
        <h3>Pontos de entrada</h3>
        <div class="stack mini">
          ${state.ai.plannedHooks.map(hook => `<span class="hook">${hook}</span>`).join("")}
        </div>
      </section>
      <section class="panel">
        <h3>Princípio</h3>
        <p>A IA sugere, revisa e organiza. O controle editorial continua nas seções do ContentOS.</p>
      </section>
    </div>
  `;
}

function emptyState() {
  return document.querySelector("#emptyStateTemplate").innerHTML;
}

function attachSectionEvents() {
  attachDropdownEvents();

  const ideaForm = document.querySelector("#ideaForm");
  if (ideaForm) {
    ideaForm.addEventListener("submit", event => {
      event.preventDefault();
      const formData = new FormData(ideaForm);
      state.ideas.unshift({
        id: createId("idea"),
        title: formData.get("title"),
        source: formData.get("source"),
        angle: formData.get("angle"),
        tags: splitList(formData.get("tags")),
        priority: formData.get("priority"),
        createdAt: new Date().toISOString().slice(0, 10)
      });
      persistAndRender();
    });
  }

  const textForm = document.querySelector("#textForm");
  if (textForm) {
    textForm.addEventListener("submit", event => {
      event.preventDefault();
      const formData = new FormData(textForm);
      state.texts.unshift({
        id: createId("text"),
        pieceId: null,
        platform: formData.get("platform"),
        title: formData.get("title"),
        body: formData.get("body"),
        seoTerms: splitList(formData.get("seoTerms")),
        hashtags: splitHashtags(formData.get("hashtags"))
      });
      persistAndRender();
    });
  }

  document.querySelectorAll("[data-promote-idea]").forEach(button => {
    button.addEventListener("click", () => {
      const idea = state.ideas.find(item => item.id === button.dataset.promoteIdea);
      state.pieces.unshift({
        id: createId("piece"),
        title: idea.title,
        format: "short vertical",
        moment: "roteiro",
        owner: "Você",
        due: "",
        ideaId: idea.id,
        materials: [],
        textIds: [],
        publicationIds: []
      });
      setSection("pieces");
      saveState(state);
    });
  });
}

function attachDropdownEvents() {
  document.querySelectorAll("[data-dropdown]").forEach(dropdown => {
    const trigger = dropdown.querySelector(".dropdown-trigger");
    const input = dropdown.querySelector("input");
    const label = dropdown.querySelector("[data-dropdown-label]");
    const options = dropdown.querySelectorAll(".dropdown-option");

    trigger.addEventListener("click", event => {
      event.stopPropagation();
      document.querySelectorAll("[data-dropdown].open").forEach(openDropdown => {
        if (openDropdown !== dropdown) closeDropdown(openDropdown);
      });
      dropdown.classList.toggle("open");
      trigger.setAttribute("aria-expanded", dropdown.classList.contains("open"));
    });

    options.forEach(option => {
      option.addEventListener("click", event => {
        event.stopPropagation();
        input.value = option.dataset.value;
        label.textContent = option.textContent.trim();
        options.forEach(item => {
          const isSelected = item === option;
          item.classList.toggle("selected", isSelected);
          item.setAttribute("aria-selected", isSelected);
        });
        closeDropdown(dropdown);
      });
    });
  });
}

function closeDropdown(dropdown) {
  dropdown.classList.remove("open");
  dropdown.querySelector(".dropdown-trigger")?.setAttribute("aria-expanded", "false");
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function splitHashtags(value) {
  return String(value || "")
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item.startsWith("#") ? item : `#${item}`);
}

globalSearch.addEventListener("input", render);
newIdeaBtn.addEventListener("click", () => setSection("ideas"));
newPieceBtn.addEventListener("click", () => setSection("pieces"));
document.addEventListener("click", () => {
  document.querySelectorAll("[data-dropdown].open").forEach(closeDropdown);
});
window.addEventListener("hashchange", () => {
  currentSection = window.location.hash.replace("#", "") || "ideas";
  render();
});

render();
