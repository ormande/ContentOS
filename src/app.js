import { assistantGateway } from "./ai/assistantGateway.js";
import { loadInstagramDashboard, syncInstagramInsights } from "./data/instagramInsights.js";
import { createEmptyState, createId, loadState, platformRules, saveState } from "./data/store.js";

const sections = [
  { id: "dashboard", label: "Dashboard", icon: "chart", kicker: "instagram", title: "Insights do Instagram", metric: () => dashboardMetric() },
  { id: "ideas", label: "Ideias", icon: "lightbulb", kicker: "captura", title: "Ideias", metric: state => `${state.ideas.length} ideias` },
  { id: "pieces", label: "Vídeos", icon: "layers", kicker: "produção", title: "Vídeos em movimento", metric: state => `${state.pieces.length} vídeos` },
  { id: "texts", label: "Legendas", icon: "text", kicker: "distribuição", title: "Legendas por plataforma", metric: state => `${state.texts.length} legendas` },
  { id: "files", label: "Arquivos", icon: "folder", kicker: "materiais", title: "Versões e arquivos", metric: state => `${state.files.length} arquivos` },
  { id: "publications", label: "Publicações", icon: "send", kicker: "histórico", title: "Saídas publicadas", metric: state => `${state.publications.length} registros` },
  { id: "library", label: "Biblioteca", icon: "bookmark", kicker: "reaproveitamento", title: "Biblioteca criativa", metric: state => `${state.library.length} itens` },
  { id: "assistant", label: "IA auxiliar", icon: "spark", kicker: "arquitetura", title: "Assistente auxiliar", metric: () => "desativada" }
];

const libraryCategories = [
  { id: "gancho", label: "Gancho", icon: "zap" },
  { id: "efeito_sonoro", label: "Efeito sonoro", icon: "wave" },
  { id: "musica", label: "Música", icon: "music" },
  { id: "formato", label: "Formato", icon: "layout" },
  { id: "angulo_camera", label: "Ângulo de câmera", icon: "camera" },
  { id: "cta", label: "CTA", icon: "target" },
  { id: "estrutura_roteiro", label: "Estrutura de roteiro", icon: "list" }
];

let state = createEmptyState();
let currentSection = window.location.hash.replace("#", "") || "ideas";
let currentLibraryCategory = libraryCategories[0].id;
let isSaving = false;
let isSidebarCollapsed = false;
let instagramDashboard = createEmptyInstagramDashboard();
let instagramView = "overview";
let instagramContentType = "all";
let isInstagramSyncing = false;

const shell = document.querySelector("#app");
const nav = document.querySelector("#sectionNav");
const sidebarToggle = document.querySelector("#sidebarToggle");
const contentArea = document.querySelector("#contentArea");
const sectionKicker = document.querySelector("#sectionKicker");
const sectionTitle = document.querySelector("#sectionTitle");
const sectionMetric = document.querySelector("#sectionMetric");
const globalSearch = document.querySelector("#globalSearch");
const newIdeaBtn = document.querySelector("#newIdeaBtn");
const newPieceBtn = document.querySelector("#newPieceBtn");

async function init() {
  contentArea.innerHTML = `<div class="empty-state"><strong>Carregando ContentOS...</strong><span>Buscando dados no Supabase.</span></div>`;

  try {
    state = await loadState();
  } catch (error) {
    console.error(error);
    contentArea.innerHTML = `<div class="empty-state"><strong>Não foi possível carregar o Supabase.</strong><span>Confira o schema e as variáveis do .env.</span></div>`;
    return;
  }

  try {
    instagramDashboard = await loadInstagramDashboard();
  } catch (error) {
    console.warn(error);
    instagramDashboard = createEmptyInstagramDashboard();
  }

  bindGlobalEvents();
  render();
}

async function persistAndRender() {
  render();
  isSaving = true;

  try {
    await saveState(state);
  } catch (error) {
    console.error(error);
    contentArea.insertAdjacentHTML("afterbegin", `<div class="empty-state"><strong>Erro ao salvar.</strong><span>Confira a conexão com o Supabase.</span></div>`);
  } finally {
    isSaving = false;
    updateMetric();
  }
}

function setSection(sectionId) {
  currentSection = sectionId;
  window.location.hash = sectionId;
  render();
}

function renderNav() {
  nav.innerHTML = sections.map(section => `
    <button class="nav-item ${section.id === currentSection ? "active" : ""}" type="button" data-section="${section.id}">
      <span class="nav-label">
        ${icon(section.icon)}
        <span class="nav-text">${section.label}</span>
      </span>
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
  updateMetric(section);
  renderNav();

  const query = globalSearch.value.trim().toLowerCase();
  const renderers = {
    dashboard: renderDashboard,
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

function updateMetric(activeSection) {
  const section = activeSection || sections.find(item => item.id === currentSection) || sections[0];
  sectionMetric.textContent = isSaving ? "salvando..." : section.metric(state);
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
        ${ideas.length ? ideas.map(idea => `
          <article class="item-card">
            <div class="item-topline">
              <span>${idea.source || "ideia"}</span>
              <strong>${idea.priority}</strong>
            </div>
            <h3>${idea.title}</h3>
            <p>${idea.angle}</p>
            <div class="tag-row">${idea.tags.map(tag => `<span>${tag}</span>`).join("")}</div>
            <button class="ghost-action compact" type="button" data-promote-idea="${idea.id}">Virar vídeo</button>
          </article>
        `).join("") : emptyState()}
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
        <span>Vídeo</span><span>Formato</span><span>Momento</span><span>Prazo</span><span>Legendas</span><span>Material</span>
      </div>
      ${pieces.map(piece => `
        <article class="table-row">
          <span><strong>${piece.title}</strong><small>${piece.owner}</small></span>
          <span>${piece.format}</span>
          <span><mark>${piece.moment}</mark></span>
          <span>${piece.due || "sem data"}</span>
          <span>${countLinkedTexts(piece.id)} legendas</span>
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
      ${Object.entries(platformRules).map(([, rule]) => `
        <div class="rule-card">
          <strong>${rule.label}</strong>
          <span>${rule.note}</span>
          <small>${Number.isFinite(rule.characterLimit) ? `${rule.characterLimit} caracteres` : "limite amplo"}</small>
        </div>
      `).join("")}
    </div>

    <div class="grid two">
      <form class="panel form-panel" id="textForm">
        <h3>Nova legenda</h3>
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
        ${renderDropdown({
          name: "pieceId",
          label: "Vídeo vinculado",
          value: "__none",
          options: [
            { value: "__none", label: "Sem vídeo vinculado" },
            ...state.pieces.map(piece => ({ value: piece.id, label: piece.title }))
          ]
        })}
        <input name="title" placeholder="Título interno" required />
        <textarea name="body" placeholder="Legenda otimizada"></textarea>
        <input name="seoTerms" placeholder="SEO separado por vírgula" />
        <input name="hashtags" placeholder="hashtags separadas por espaço" />
        <button class="primary-action" type="submit">Salvar legenda</button>
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
      <small class="linked-video">Vídeo: ${findPieceTitle(text.pieceId)}</small>
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
          <small>${file.location} - ${file.updatedAt}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function renderPublications(query) {
  const publications = state.publications.filter(publication => matchesQuery([
    publication.platform,
    publication.url,
    publication.publishedAt,
    findPieceTitle(publication.pieceId)
  ], query));
  if (!publications.length) return emptyState();

  return `<div class="stack">${publications.map(publication => `
    <article class="item-card">
      <div class="item-topline"><span>${publication.platform}</span><strong>${publication.publishedAt || "sem data"}</strong></div>
      <h3>${findPieceTitle(publication.pieceId)}</h3>
      <p>${publication.url}</p>
    </article>
  `).join("")}</div>`;
}

function renderDashboard(query) {
  const contentItems = instagramDashboard.contentItems.filter(item => {
    const matchesType = instagramContentType === "all" || item.contentType === instagramContentType;
    return matchesType && matchesQuery([
      item.caption,
      item.permalink,
      item.linkedVideoTitle,
      item.contentType
    ], query);
  });

  return `
    <div class="dashboard-page">
      <div class="dashboard-toolbar">
        <div class="segmented-control" aria-label="Visão dos insights">
          <button class="${instagramView === "overview" ? "active" : ""}" type="button" data-instagram-view="overview">Geral</button>
          <button class="${instagramView === "content" ? "active" : ""}" type="button" data-instagram-view="content">Por conteúdo</button>
        </div>
        <div class="dashboard-actions">
          <a class="ghost-action dashboard-connect" href="/api/instagram/connect">Conectar Instagram</a>
          <button class="primary-action" type="button" data-sync-instagram>${isInstagramSyncing ? "Sincronizando..." : "Atualizar insights"}</button>
        </div>
      </div>

      ${instagramDashboard.isConfigured ? "" : `
        <div class="empty-state compact">
          <strong>Integração pronta para configurar.</strong>
          <span>Preencha as chaves da Meta no .env e conecte uma conta Instagram Business ou Creator.</span>
        </div>
      `}

      ${instagramView === "overview" ? renderInstagramOverview() : renderInstagramContent(contentItems)}
    </div>
  `;
}

function renderInstagramOverview() {
  const totals = instagramDashboard.totals;
  const maxContentCount = Math.max(...instagramDashboard.byContentType.map(type => type.count), 1);

  return `
    <div class="insight-grid">
      ${renderInsightCard("Alcance", totals.reach)}
      ${renderInsightCard("Visualizações", totals.views)}
      ${renderInsightCard("Curtidas", totals.likes)}
      ${renderInsightCard("Comentários", totals.comments)}
      ${renderInsightCard("Salvamentos", totals.saves)}
      ${renderInsightCard("Compartilhamentos", totals.shares)}
    </div>

    <div class="grid two dashboard-split">
      <section class="panel">
        <h3>Distribuição por formato</h3>
        <div class="insight-bars">
          ${instagramDashboard.byContentType.length ? instagramDashboard.byContentType.map(item => `
            <div class="insight-bar">
              <div><strong>${formatInstagramContentType(item.contentType)}</strong><span>${item.count} conteúdos</span></div>
              <meter min="0" max="${maxContentCount}" value="${item.count}"></meter>
            </div>
          `).join("") : `<p>Nenhum conteúdo sincronizado ainda.</p>`}
        </div>
      </section>

      <section class="panel">
        <h3>Última sincronização</h3>
        <p>${instagramDashboard.lastSyncAt ? formatDateTime(instagramDashboard.lastSyncAt) : "Ainda não sincronizado."}</p>
        <p>${instagramDashboard.account?.username ? `Conta: @${instagramDashboard.account.username}` : "Nenhuma conta conectada."}</p>
      </section>
    </div>
  `;
}

function renderInstagramContent(items) {
  const typeTabs = [
    ["all", "Todos"],
    ["reel", "Reels"],
    ["post", "Posts"],
    ["story", "Stories"],
    ["carousel", "Carrosséis"],
    ["video", "Vídeos"],
    ["unknown", "Outros"]
  ];

  return `
    <div class="content-type-tabs" aria-label="Tipos de conteúdo">
      ${typeTabs.map(([value, label]) => `
        <button class="${instagramContentType === value ? "active" : ""}" type="button" data-content-type="${value}">${label}</button>
      `).join("")}
    </div>

    <div class="stack">
      ${items.length ? items.map(item => `
        <article class="item-card insight-content-card">
          <div class="item-topline">
            <span>${formatInstagramContentType(item.contentType)}</span>
            <strong>${formatDateTime(item.publishedAt)}</strong>
          </div>
          <h3>${item.caption || "Conteúdo sem legenda"}</h3>
          <small class="linked-video">Vídeo no ContentOS: ${item.linkedVideoTitle || "sem vínculo"}</small>
          <div class="mini-metrics">
            ${renderMiniMetric("Alcance", item.metrics.reach)}
            ${renderMiniMetric("Views", item.metrics.views)}
            ${renderMiniMetric("Likes", item.metrics.likes)}
            ${renderMiniMetric("Salvos", item.metrics.saves)}
            ${renderMiniMetric("Shares", item.metrics.shares)}
          </div>
        </article>
      `).join("") : emptyState()}
    </div>
  `;
}

function renderInsightCard(label, value) {
  return `
    <article class="insight-card">
      <span>${label}</span>
      <strong>${formatNumber(value)}</strong>
    </article>
  `;
}

function renderMiniMetric(label, value) {
  return `<span><strong>${formatNumber(value)}</strong>${label}</span>`;
}

function renderLibrary(query) {
  const items = state.library.filter(item => matchesQuery([
    item.name,
    item.category,
    item.context.join(" "),
    item.platforms.join(" "),
    item.notes,
    item.example
  ], query) && item.category === currentLibraryCategory);

  return `
    <div class="library-layout">
      <aside class="library-sidebar" aria-label="Categorias da biblioteca">
        ${libraryCategories.map(category => {
          const count = state.library.filter(item => item.category === category.id).length;
          return `
            <button class="library-category ${category.id === currentLibraryCategory ? "active" : ""}" type="button" data-library-category="${category.id}">
              <span class="library-category-main">
                ${icon(category.icon)}
                <span>${category.label}</span>
              </span>
              <small>${count}</small>
            </button>
          `;
        }).join("")}
      </aside>

      <div class="library-content">
        ${items.length ? `<div class="grid three">${items.map(item => `
          <article class="item-card">
            <div class="item-topline"><span>${formatLibraryCategory(item.category)}</span><strong>${item.platforms.join(", ")}</strong></div>
            <h3>${item.name}</h3>
            <p>${item.notes}</p>
            ${item.example ? `<small>${item.example}</small>` : ""}
            <div class="tag-row">${item.context.map(context => `<span>${context}</span>`).join("")}</div>
          </article>
        `).join("")}</div>` : emptyState()}
      </div>
    </div>
  `;
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
  attachLibraryEvents();
  attachDashboardEvents();

  const ideaForm = document.querySelector("#ideaForm");
  if (ideaForm) {
    ideaForm.addEventListener("submit", async event => {
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
      await persistAndRender();
    });
  }

  const textForm = document.querySelector("#textForm");
  if (textForm) {
    textForm.addEventListener("submit", async event => {
      event.preventDefault();
      const formData = new FormData(textForm);
      state.texts.unshift({
        id: createId("text"),
        pieceId: normalizePieceId(formData.get("pieceId")),
        platform: formData.get("platform"),
        title: formData.get("title"),
        body: formData.get("body"),
        seoTerms: splitList(formData.get("seoTerms")),
        hashtags: splitHashtags(formData.get("hashtags"))
      });
      await persistAndRender();
    });
  }

  document.querySelectorAll("[data-promote-idea]").forEach(button => {
    button.addEventListener("click", async () => {
      const idea = state.ideas.find(item => item.id === button.dataset.promoteIdea);
      if (!idea) return;

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
      currentSection = "pieces";
      window.location.hash = "pieces";
      await persistAndRender();
    });
  });
}

function attachDashboardEvents() {
  document.querySelectorAll("[data-instagram-view]").forEach(button => {
    button.addEventListener("click", () => {
      instagramView = button.dataset.instagramView;
      render();
    });
  });

  document.querySelectorAll("[data-content-type]").forEach(button => {
    button.addEventListener("click", () => {
      instagramContentType = button.dataset.contentType;
      render();
    });
  });

  const syncButton = document.querySelector("[data-sync-instagram]");
  if (syncButton) {
    syncButton.addEventListener("click", async () => {
      isInstagramSyncing = true;
      render();

      try {
        await syncInstagramInsights();
        instagramDashboard = await loadInstagramDashboard();
      } catch (error) {
        console.error(error);
      } finally {
        isInstagramSyncing = false;
        render();
      }
    });
  }
}

function attachLibraryEvents() {
  document.querySelectorAll("[data-library-category]").forEach(button => {
    button.addEventListener("click", () => {
      currentLibraryCategory = button.dataset.libraryCategory;
      render();
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

function findPieceTitle(pieceId) {
  return state.pieces.find(piece => piece.id === pieceId)?.title || "Vídeo sem vínculo";
}

function normalizePieceId(value) {
  return value && value !== "__none" ? value : null;
}

function countLinkedTexts(pieceId) {
  return state.texts.filter(text => text.pieceId === pieceId).length;
}

function dashboardMetric() {
  if (!instagramDashboard.account) return "não conectado";
  return instagramDashboard.lastSyncAt ? "sincronizado" : "aguardando sync";
}

function createEmptyInstagramDashboard() {
  return {
    isConfigured: false,
    account: null,
    lastSyncAt: null,
    totals: {
      reach: 0,
      views: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0
    },
    byContentType: [],
    contentItems: []
  };
}

function formatInstagramContentType(type) {
  const labels = {
    all: "Todos",
    post: "Post",
    reel: "Reel",
    story: "Story",
    carousel: "Carrossel",
    video: "Vídeo",
    unknown: "Outro"
  };

  return labels[type] || labels.unknown;
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "sem data";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatLibraryCategory(category) {
  const labels = {
    gancho: "gancho",
    formato: "formato",
    angulo_camera: "ângulo de câmera",
    musica: "música",
    efeito_sonoro: "efeito sonoro",
    cta: "CTA",
    estrutura_roteiro: "estrutura de roteiro"
  };

  return labels[category] || String(category || "").replaceAll("_", " ");
}

function icon(name) {
  const paths = {
    lightbulb: `<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.1 1 1.8V17h6v-.5c0-.7.3-1.3 1-1.8A7 7 0 0 0 12 2Z"/>`,
    layers: `<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 18 9 5 9-5"/>`,
    text: `<path d="M4 6h16"/><path d="M4 12h12"/><path d="M4 18h9"/>`,
    folder: `<path d="M3 6h6l2 2h10v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Z"/>`,
    send: `<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>`,
    bookmark: `<path d="M6 3h12a1 1 0 0 1 1 1v18l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>`,
    spark: `<path d="M12 2v5"/><path d="M12 17v5"/><path d="M4.2 4.2 7.8 7.8"/><path d="m16.2 16.2 3.6 3.6"/><path d="M2 12h5"/><path d="M17 12h5"/><path d="m4.2 19.8 3.6-3.6"/><path d="m16.2 7.8 3.6-3.6"/>`,
    chart: `<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5" rx="1"/><rect x="12" y="7" width="3" height="9" rx="1"/><rect x="17" y="3" width="3" height="13" rx="1"/>`,
    zap: `<path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z"/>`,
    wave: `<path d="M3 12c2 0 2-5 4-5s2 10 4 10 2-10 4-10 2 5 4 5h2"/>`,
    music: `<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>`,
    layout: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>`,
    camera: `<path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>`,
    target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>`,
    list: `<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>`
  };

  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.bookmark}</svg>`;
}

function bindGlobalEvents() {
  globalSearch.addEventListener("input", render);
  newIdeaBtn.addEventListener("click", () => setSection("ideas"));
  newPieceBtn.addEventListener("click", () => setSection("pieces"));
  sidebarToggle.addEventListener("click", () => {
    isSidebarCollapsed = !isSidebarCollapsed;
    shell.classList.toggle("sidebar-collapsed", isSidebarCollapsed);
    sidebarToggle.setAttribute("aria-expanded", String(!isSidebarCollapsed));
    sidebarToggle.setAttribute("aria-label", isSidebarCollapsed ? "Expandir menu" : "Recolher menu");
  });
  document.addEventListener("click", () => {
    document.querySelectorAll("[data-dropdown].open").forEach(closeDropdown);
  });
  window.addEventListener("hashchange", () => {
    currentSection = window.location.hash.replace("#", "") || "ideas";
    render();
  });
}

init();
