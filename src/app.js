import { assistantGateway } from "./ai/assistantGateway.js";
import { streamGenerate } from "./ai/geminiClient.js";
import { loadInstagramDashboard, syncInstagramInsights } from "./data/instagramInsights.js";
import {
  createEmptyState,
  createId,
  getTemplateDefaults,
  ideaStatuses,
  loadState,
  reloadStateFromSupabase,
  pieceComponentSlots,
  platformRules,
  deleteIdeaRemote,
  deleteLibraryItemRemote,
  deletePieceComponentRemote,
  deletePieceRemote,
  deleteTextsByPieceRemote,
  refreshInstagramMediaLinks,
  saveState
} from "./data/store.js";
import { findInstagramMediaIdForPermalink } from "./data/instagramMediaLinks.js";
import { normalizePermalinkValue, permalinksMatch } from "./data/permalinkUtils.js";
import {
  formatScriptFieldValue,
  getStructureFieldDefs,
  getStructureLabel,
  normalizeScriptFieldsForTemplate,
  readScriptFieldsFromForm,
  resolveTemplateKeyFromLibraryItem
} from "./data/scriptStructures.js";
import { openConfirm, openPrompt } from "./ui/modal.js";

const sections = [
  { id: "dashboard", label: "Dashboard", icon: "chart", kicker: "instagram", title: "Insights do Instagram", metric: () => dashboardMetric() },
  { id: "ideas", label: "Ideias", icon: "lightbulb", kicker: "captura", title: "Banco de ideias", metric: currentState => `${currentState.ideas.length} ideias` },
  { id: "pieces", label: "Montador", icon: "layers", kicker: "produção", title: "Montador de vídeo", metric: currentState => `${currentState.pieces.length} peças` },
  { id: "texts", label: "Legendas", icon: "text", kicker: "distribuição", title: "Legendas por conteúdo", metric: currentState => `${countCaptionPieces(currentState)} conteúdos` },
  { id: "publications", label: "Publicações", icon: "send", kicker: "histórico", title: "Saídas registradas", metric: currentState => `${currentState.publications.length} registros` },
  { id: "library", label: "Biblioteca", icon: "bookmark", kicker: "componentes", title: "Biblioteca criativa", metric: currentState => `${currentState.library.length} itens` },
  { id: "assistant", label: "IA", icon: "spark", kicker: "análise", title: "IA para insights", metric: () => "mês atual" },
  { id: "settings", label: "Configurações", icon: "settings", kicker: "sistema", title: "Configurações", metric: () => themeMetricLabel() }
];

const THEME_STORAGE_KEY = "contentos-theme";
let themePreference = readThemePreference();

function readThemePreference() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function resolveTheme(preference = themePreference) {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

function applyTheme(preference = themePreference) {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

function setThemePreference(preference) {
  if (preference !== "light" && preference !== "dark" && preference !== "system") return;
  themePreference = preference;
  localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyTheme(preference);
}

function themeMetricLabel() {
  const labels = { light: "tema claro", dark: "tema escuro", system: "automático" };
  return labels[themePreference] || "automático";
}

applyTheme();

const libraryCategories = [
  { id: "gancho", label: "Gancho", slot: "hook", icon: "zap" },
  { id: "formato", label: "Formato", slot: "format", icon: "layout" },
  { id: "estrutura_roteiro", label: "Estrutura de roteiro", slot: "script_structure", icon: "list" },
  { id: "angulo_camera", label: "Ângulo de câmera", slot: "camera_angle", icon: "camera" },
  { id: "musica", label: "Música", slot: "music", icon: "music" },
  { id: "efeito_sonoro", label: "Efeito sonoro", slot: "sound_effect", icon: "wave" },
  { id: "cta", label: "CTA", slot: "cta", icon: "target" },
  { id: "text_header", label: "Header de texto", slot: "text_header", icon: "text" }
];

const phaseOrder = ["brief", "roteiro", "captacao", "edicao", "distribuicao"];
const phaseLabels = {
  brief: "Brief",
  roteiro: "Roteiro",
  captacao: "Captação",
  edicao: "Edição",
  distribuicao: "Distribuição"
};

const slotLabels = {
  hook: "Gancho",
  format: "Formato",
  script_structure: "Estrutura de roteiro",
  camera_angle: "Ângulo de câmera",
  music: "Música",
  sound_effect: "Efeito sonoro",
  cta: "CTA",
  text_header: "Header de texto"
};

const requiredSlots = ["hook", "format", "script_structure", "cta", "camera_angle"];
const objectiveOptions = [
  "aumentar conexão com público",
  "gerar views",
  "gerar seguidores",
  "educar para venda"
];

let hookTypeFilter = "all";

let state = createEmptyState();
let currentSection = sanitizeSection(window.location.hash.replace("#", "") || "dashboard");
let selectedPieceId = null;
let currentLibraryCategory = libraryCategories[0].id;
let activePiecePhase = "brief";
let isSaving = false;
let isSidebarCollapsed = false;
let instagramDashboard = createEmptyInstagramDashboard();
let instagramView = "overview";
let instagramContentType = "all";
let instagramDatePreset = "30d";
let instagramCustomStart = "";
let instagramCustomEnd = "";
let isInstagramSyncing = false;
let isReloadingState = false;
let instagramError = new URLSearchParams(window.location.search).get("instagram_error") || "";
let captionDraft = null;
let manualCaptionDraft = null;
let captionGeneratorOpen = false;
let manualCaptionOpen = false;
let expandedCaptionPieceId = null;
/** @type {Record<string, string>} */
let captionPlatformTabs = {};
let pendingSavedCaptionRestore = null;
let editingIdeaId = null;
let editingLibraryItemId = null;
let libraryFormOpen = false;
let pendingLibrarySelection = null;
let skipPieceFormPhases = new Set();
let aiDrafts = {
  script: {
    pieceId: null,
    mode: "script",
    loading: false,
    text: "",
    error: ""
  },
  caption: {
    pieceId: null,
    loading: false,
    text: "",
    error: ""
  }
};

const shell = /** @type {HTMLElement} */ (document.querySelector("#app"));
const nav = /** @type {HTMLElement} */ (document.querySelector("#sectionNav"));
const sidebarToggle = /** @type {HTMLButtonElement} */ (document.querySelector("#sidebarToggle"));
const contentArea = /** @type {HTMLElement} */ (document.querySelector("#contentArea"));
const sectionKicker = /** @type {HTMLElement} */ (document.querySelector("#sectionKicker"));
const sectionTitle = /** @type {HTMLElement} */ (document.querySelector("#sectionTitle"));
const sectionMetric = /** @type {HTMLElement} */ (document.querySelector("#sectionMetric"));
const globalSearch = /** @type {HTMLInputElement} */ (document.querySelector("#globalSearch"));
const newIdeaBtn = /** @type {HTMLButtonElement} */ (document.querySelector("#newIdeaBtn"));
const newPieceBtn = /** @type {HTMLButtonElement} */ (document.querySelector("#newPieceBtn"));

async function init() {
  contentArea.innerHTML = `<div class="empty-state"><strong>Carregando ContentOS...</strong><span>Buscando dados no Supabase.</span></div>`;

  try {
    state = await loadState();
    if (state.__librarySeeded) {
      delete state.__librarySeeded;
      await saveState(state);
    }
    selectedPieceId ||= state.pieces[0]?.id || null;
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    contentArea.innerHTML = `<div class="empty-state"><strong>Não foi possível carregar os dados.</strong><span>${escapeHtml(message)} Verifique as variáveis SUPABASE_URL e SUPABASE_ANON_KEY (local: .env · produção: Vercel).</span></div>`;
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

function showTransientNotice(title, message) {
  contentArea.insertAdjacentHTML("afterbegin", `<div class="empty-state compact"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`);
}

async function runRemoteDelete(action) {
  try {
    await action();
    return true;
  } catch (error) {
    console.error(error);
    showTransientNotice(
      "Não foi possível excluir no Supabase.",
      error instanceof Error ? error.message : "Verifique a conexão e tente novamente."
    );
    return false;
  }
}

async function persistAndRender(options = {}) {
  render();
  isSaving = true;
  updateMetric();

  try {
    await saveState(state);
    if (options.reloadInstagram) {
      try {
        instagramDashboard = await loadInstagramDashboard();
      } catch (error) {
        console.warn(error);
      }
    }
  } catch (error) {
    console.error(error);
    contentArea.insertAdjacentHTML("afterbegin", `<div class="empty-state compact"><strong>Erro ao salvar.</strong><span>Confira a conexão com o Supabase e se o schema novo já foi aplicado.</span></div>`);
  } finally {
    isSaving = false;
    render();
  }
}

function setSection(sectionId) {
  currentSection = sanitizeSection(sectionId);
  window.location.hash = currentSection;
  render();
}

function render() {
  const section = sections.find(item => item.id === currentSection) || sections[0];
  const pieceFormSnapshots = currentSection === "pieces" ? snapshotPieceForms() : null;
  const captionFormSnapshots = currentSection === "texts" ? snapshotCaptionForms() : null;
  sectionKicker.textContent = section.kicker;
  renderSectionTitle(section);
  renderNav();
  updateMetric(section);

  const query = globalSearch.value.trim().toLowerCase();
  const renderers = {
    dashboard: renderDashboard,
    ideas: renderIdeas,
    pieces: renderPieces,
    texts: renderTexts,
    publications: renderPublications,
    library: renderLibrary,
    assistant: renderAssistant,
    settings: renderSettings
  };

  contentArea.innerHTML = renderers[section.id](query);
  if (pieceFormSnapshots?.size) {
    restorePieceForms(pieceFormSnapshots, skipPieceFormPhases);
    skipPieceFormPhases = new Set();
  }
  if (captionFormSnapshots?.size) {
    restoreCaptionForms(captionFormSnapshots);
  }
  if (pendingSavedCaptionRestore) {
    restorePendingSavedCaptionForm(pendingSavedCaptionRestore);
    pendingSavedCaptionRestore = null;
  }
  applyPendingLibrarySelection();
  attachSectionEvents();
}

function renderSectionTitle(section) {
  if (section.id === "dashboard") {
    sectionTitle.innerHTML = `
      <span class="section-title-text">${escapeHtml(section.title)}</span>
      <span class="info-tip">
        <button class="info-tip-trigger" type="button" aria-label="Escopo da integração">i</button>
        <span class="info-tip-popover" role="tooltip">Este dashboard mostra somente métricas do Instagram, lidas pela Meta Graph API. Não há dados de TikTok Analytics ou YouTube Studio aqui.</span>
      </span>
    `;
    return;
  }

  sectionTitle.textContent = section.title;
}

function renderNav() {
  nav.innerHTML = sections.map(section => `
    <button class="nav-item ${section.id === currentSection ? "active" : ""}" type="button" data-section="${section.id}">
      <span class="nav-label">
        <span class="nav-icon-wrap">${icon(section.icon)}</span>
        <span class="nav-text">${section.label}</span>
      </span>
      <small>${section.metric(state)}</small>
    </button>
  `).join("");
}

function updateMetric(activeSection) {
  const section = activeSection || sections.find(item => item.id === currentSection) || sections[0];
  sectionMetric.textContent = isSaving ? "salvando..." : section.metric(state);
}

function renderIdeas(query) {
  const ideas = state.ideas.filter(idea => matchesQuery([
    idea.title,
    idea.source,
    idea.description,
    idea.angle,
    idea.tags.join(" ")
  ], query));
  const editingIdea = state.ideas.find(idea => idea.id === editingIdeaId) || null;

  return `
    <div class="ideas-layout">
      <form class="panel ideas-form" id="ideaForm">
        <h3>${editingIdea ? "Editar ideia" : "Nova ideia"}</h3>
        <input type="hidden" name="ideaId" value="${escapeHtml(editingIdea?.id || "")}" />
        <div class="ideas-form-grid">
          <div class="field-span-6">${renderField("Título", `<input name="title" value="${escapeHtml(editingIdea?.title || "")}" required />`, { required: true })}</div>
          <div class="field-span-6">${renderField("Origem", `<input name="source" value="${escapeHtml(editingIdea?.source || "")}" placeholder="Ex.: conversa, tendência…" />`, { hint: "De onde veio a ideia", inlineHint: true })}</div>
          <div class="field-span-6">${renderField("Descrição", `<textarea name="description" placeholder="Resumo da ideia">${escapeHtml(editingIdea?.description || "")}</textarea>`)}</div>
          <div class="field-span-6">${renderField("Ângulo editorial", `<textarea name="angle" placeholder="Perspectiva ou abordagem">${escapeHtml(editingIdea?.angle || "")}</textarea>`)}</div>
          <div class="field-span-4">${renderField("Tags", renderTagChipInput("tags", editingIdea?.tags || []), { hint: "Vírgula para adicionar", inlineHint: true })}</div>
          <div class="field-span-4">${renderField("Prioridade", renderCustomSelect({
            name: "priority",
            value: editingIdea?.priority || "média",
            placeholder: "Selecione a prioridade",
            options: [
              { value: "alta", label: "Alta" },
              { value: "média", label: "Média" },
              { value: "baixa", label: "Baixa" }
            ]
          }))}</div>
          <div class="field-span-4">${renderField("Status", renderCustomSelect({
            name: "status",
            value: editingIdea?.status || "disponivel",
            placeholder: "Selecione o status",
            options: [
              { value: "disponivel", label: "Disponível" },
              { value: "em_producao", label: "Em produção" },
              { value: "reaproveitavel", label: "Reaproveitável" }
            ]
          }))}</div>
        </div>
        <div class="inline-actions">
          <button class="primary-action" type="submit">${editingIdea ? "Salvar alterações" : "Salvar ideia"}</button>
          ${editingIdea ? `<button class="ghost-action compact" type="button" id="cancelIdeaEdit">Cancelar</button>` : ""}
        </div>
      </form>

      ${ideas.length ? `
        <div class="table-surface ideas-table">
          <div class="table-row table-head">
            <span>Título</span>
            <span>Descrição</span>
            <span>Status</span>
            <span>Prioridade</span>
            <span>Tags</span>
            <span>Ações</span>
          </div>
          ${ideas.map(idea => `
            <div class="table-row ideas-row">
              <span>
                <strong>${escapeHtml(idea.title)}</strong>
                <small>${escapeHtml(idea.source || "sem origem")}</small>
              </span>
              <span>${escapeHtml(idea.description || idea.angle || "—")}</span>
              <span>${formatIdeaStatus(idea.status)}</span>
              <span>${escapeHtml(idea.priority || "média")}</span>
              <span class="tag-row">${idea.tags.length ? idea.tags.map(tag => `<span>${escapeHtml(withHash(tag))}</span>`).join("") : "—"}</span>
              <span class="table-actions">
                <button class="ghost-action compact" type="button" data-promote-idea="${idea.id}">Criar peça</button>
                <button class="ghost-action compact" type="button" data-edit-idea="${idea.id}">Editar</button>
                <button class="ghost-action compact" type="button" data-delete-idea="${idea.id}">Excluir</button>
              </span>
            </div>
          `).join("")}
        </div>
      ` : emptyState()}
    </div>
  `;
}

function renderPieces(query) {
  const pieces = state.pieces.filter(piece => matchesQuery([
    piece.title,
    piece.owner,
    findIdeaTitle(piece.ideaId),
    piece.platforms.join(" ")
  ], query));

  if (!selectedPieceId && pieces[0]) {
    selectedPieceId = pieces[0].id;
  }

  const selectedPiece = state.pieces.find(piece => piece.id === selectedPieceId) || pieces[0] || null;
  if (selectedPiece) {
    selectedPieceId = selectedPiece.id;
    activePiecePhase = selectedPiece.currentPhase || activePiecePhase;
  }

  return `
    <div class="piece-layout">
      <aside class="piece-sidebar">
        <div class="piece-sidebar-head">
          <div class="item-topline">
            <span>Projetos</span>
            <strong>${pieces.length}</strong>
          </div>
          <button class="primary-action piece-new-btn" type="button" id="createPieceBtn">Nova peça</button>
        </div>
        <div class="piece-list-scroll">
          ${pieces.length ? pieces.map(piece => {
            const metrics = getPieceInstagramMetrics(piece.id);
            const missing = getMissingRequiredSlots(piece.id);
            const progress = getPieceProgress(piece);
            return `
              <button class="piece-list-item ${piece.id === selectedPiece?.id ? "active" : ""}" type="button" data-piece-select="${piece.id}">
                <span class="piece-list-item-main">
                  <strong>${escapeHtml(piece.title)}</strong>
                  <span class="piece-list-item-meta">${findIdeaTitle(piece.ideaId)}</span>
                </span>
                <span class="piece-list-item-badge ${missing.length > 0 ? "has-pending" : ""}">${progress.completed}/${progress.total} · ${missing.length} pend.</span>
              </button>
            `;
          }).join("") : `<div class="empty-state compact"><strong>Nenhuma peça</strong><span>Crie a primeira peça.</span></div>`}
        </div>
      </aside>

      <div class="piece-workspace stack">
        ${selectedPiece ? renderPieceWorkspace(selectedPiece) : emptyState("Nenhuma peça selecionada.", "Crie uma peça ou promova uma ideia para montar o vídeo.")}
      </div>
    </div>
  `;
}

function renderPieceWorkspace(piece) {
  const script = getScriptByPiece(piece.id);
  const idea = state.ideas.find(item => item.id === piece.ideaId) || null;
  const linkedMetrics = getPieceInstagramMetrics(piece.id);
  const missingSlots = getMissingRequiredSlots(piece.id);
  const progress = getPieceProgress(piece);

  return `
    <section class="panel piece-summary-panel">
      <div class="item-topline piece-summary-topline">
        <span>${idea ? `Ideia: ${escapeHtml(idea.title)}` : "Sem ideia vinculada"}</span>
        <div class="piece-summary-status">
          <strong>${progress.completed}/${progress.total} fases encaminhadas</strong>
          <button class="icon-action danger" type="button" data-delete-piece="${piece.id}" aria-label="Excluir peça" title="Excluir peça">${icon("trash")}</button>
        </div>
      </div>
      <h3>${escapeHtml(piece.title)}</h3>
      <p>${escapeHtml(piece.brief.promise || idea?.description || "Defina a promessa do conteúdo para orientar o vídeo.")}</p>
      <div class="mini-metrics">
        ${renderMiniMetric("Views", linkedMetrics.views)}
        ${renderMiniMetric("Alcance", linkedMetrics.reach)}
        ${renderMiniMetric("Curtidas", linkedMetrics.likes)}
        ${renderMiniMetric("Salvos", linkedMetrics.saves)}
      </div>
      ${missingSlots.length ? `<div class="notice warning"><strong>Slots obrigatórios faltando:</strong><span>${missingSlots.map(formatSlotLabel).join(", ")}</span></div>` : `<div class="notice success"><strong>Base obrigatória preenchida.</strong><span>Os slots essenciais da peça já estão vinculados.</span></div>`}
    </section>

    <section class="panel piece-progress-panel">
      <h3>Progresso do vídeo</h3>
      <div class="phase-progress-grid">
        ${buildPiecePhaseStatus(piece).map(step => {
          const cardClass = step.complete ? "complete" : step.warning ? "warning" : "pending";
          return `
          <div class="phase-progress-card ${cardClass}">
            <div class="phase-progress-card-top">
              <span class="phase-progress-icon" aria-hidden="true">${icon(step.complete ? "check" : "alert")}</span>
              <strong>${step.label}</strong>
            </div>
            <span>${step.description}</span>
          </div>
        `;
        }).join("")}
      </div>
    </section>

    <div class="phase-tabs" role="tablist" aria-label="Fases do vídeo">
      ${phaseOrder.map(phase => `
        <button class="${phase === activePiecePhase ? "active" : ""}" type="button" data-piece-phase="${phase}">
          ${phaseLabels[phase]}
        </button>
      `).join("")}
    </div>

    ${renderPiecePhase(piece, script, idea)}
  `;
}

function renderPiecePhase(piece, script, idea) {
  if (activePiecePhase === "roteiro") return renderScriptPhase(piece, script, idea);
  if (activePiecePhase === "captacao") return renderCapturePhase(piece);
  if (activePiecePhase === "edicao") return renderEditPhase(piece);
  if (activePiecePhase === "distribuicao") return renderDistributionPhase(piece);
  return renderBriefPhase(piece, idea);
}

function renderBriefPhase(piece, idea) {
  return `
    <form class="panel phase-form" data-piece-form="brief" data-piece-id="${piece.id}">
      <div class="phase-form-header">
        <h3>Brief</h3>
      </div>
      <div class="phase-form-body stack">
        ${renderField("Título da peça", `<input name="title" value="${escapeHtml(piece.title)}" required />`, { required: true })}
        ${renderField("Ideia vinculada", renderCustomSelect({
          name: "ideaId",
          value: piece.ideaId || "",
          placeholder: "Sem ideia vinculada",
          options: state.ideas.map(item => ({ value: item.id, label: item.title }))
        }))}
        ${renderField("Objetivo do vídeo", renderCustomSelect({
          name: "objective",
          value: piece.brief.objective || "",
          placeholder: "Selecione o objetivo",
          options: objectiveOptions.map(option => ({ value: option, label: option }))
        }))}
        ${renderField("Promessa", `<textarea name="promise">${escapeHtml(piece.brief.promise)}</textarea>`, { hint: "O que o espectador ganha ao assistir." })}
        ${renderField("Prazo", `<input class="native-date-input" name="due" type="date" value="${escapeHtml(piece.due || "")}" />`)}
        ${renderField("Plataformas", `<div class="checkbox-grid">${renderPlatformCheckbox("platforms", piece.platforms)}</div>`)}
        ${idea ? `<small class="linked-video">Descrição da ideia: ${escapeHtml(idea.description || idea.angle || "sem descrição")}</small>` : ""}
      </div>
      <div class="phase-form-footer">
        <button class="primary-action" type="submit">Salvar brief</button>
      </div>
    </form>
  `;
}

function renderScriptPhase(piece, script, idea) {
  const savedScript = getScriptByPiece(piece.id);
  const currentScript = savedScript || createLocalScript(piece.id);
  const structureComponent = getPrimaryComponent(piece.id, "script_structure");
  const structureItem = state.library.find(item => item.id === structureComponent?.libraryItemId);
  const templateKey = structureItem
    ? resolveTemplateKeyFromLibraryItem(structureItem)
    : currentScript.template;
  const fields = getStructureFieldDefs(templateKey);
  const hookItems = filterHookLibraryItems(getLibraryOptionsForSlot("hook"));
  const formatItems = getLibraryOptionsForSlot("format");
  const ctaItems = getLibraryOptionsForSlot("cta");
  const structureItems = getLibraryOptionsForSlot("script_structure");
  const hookComponent = getPrimaryComponent(piece.id, "hook");
  const formatComponent = getPrimaryComponent(piece.id, "format");
  const selectedCtas = getPieceComponents(piece.id, "cta").map(component => component.libraryItemId).filter(Boolean);
  const scriptAiState = aiDrafts.script;
  const isGeneratingScript = scriptAiState.loading && scriptAiState.pieceId === piece.id;

  return `
    <div class="stack">
      <form class="panel phase-form" data-piece-form="script" data-piece-id="${piece.id}">
        <div class="phase-form-header">
          <h3>Roteiro</h3>
        </div>
        <div class="phase-form-body stack">
          ${renderFieldGroup("Estrutura", "Define o modelo narrativo do roteiro. As estruturas são fixas neste piloto.", `
            ${renderLibrarySingleSelect({
              label: "Estrutura de roteiro",
              fieldName: "structureItemId",
              category: "estrutura_roteiro",
              value: structureComponent?.libraryItemId || "",
              options: structureItems,
              placeholder: "Selecione a estrutura",
              dataset: `data-script-structure-select="${piece.id}"`,
              required: true,
              allowQuickAdd: false
            })}
          `)}
          ${renderFieldGroup("Conteúdo", `Preencha cada bloco conforme ${escapeHtml(getStructureLabel(templateKey))}.`, fields.map(field => renderScriptField(currentScript, field)).join(""))}
          ${renderFieldGroup("Gancho e formato", "Componentes criativos que definem como o vídeo começa e se apresenta.", `
            <div class="stack mini">
              <span class="field-label">Tipo de gancho</span>
              <div class="segmented-control" data-hook-type-filter="${piece.id}" aria-label="Filtrar ganchos">
                <button type="button" class="${hookTypeFilter === "all" ? "active" : ""}" data-hook-filter="all">Todos</button>
                <button type="button" class="${hookTypeFilter === "visual" ? "active" : ""}" data-hook-filter="visual">Visual</button>
                <button type="button" class="${hookTypeFilter === "textual" ? "active" : ""}" data-hook-filter="textual">Textual</button>
              </div>
            </div>
            ${renderLibrarySingleSelect({
              label: "Gancho",
              fieldName: "hookItemId",
              category: "gancho",
              value: hookComponent?.libraryItemId || "",
              options: hookItems,
              placeholder: "Selecione o gancho",
              addLabel: "+ Adicionar novo gancho",
              required: true
            })}
            ${renderLibrarySingleSelect({
              label: "Formato",
              fieldName: "formatItemId",
              category: "formato",
              value: formatComponent?.libraryItemId || "",
              options: formatItems,
              placeholder: "Selecione o formato",
              addLabel: "+ Adicionar novo formato",
              required: true
            })}
          `)}
          ${renderFieldGroup("CTA", "Chamadas para ação que serão vinculadas à peça.", `
            <div class="checkbox-grid">
              ${ctaItems.length ? ctaItems.map(item => `
                <label class="checkbox-pill">
                  <input type="checkbox" name="ctaIds" value="${item.id}" ${selectedCtas.includes(item.id) ? "checked" : ""} />
                  <span>${escapeHtml(item.name)}</span>
                </label>
              `).join("") : `<p class="field-hint">Nenhum CTA cadastrado na biblioteca.</p>`}
            </div>
            <button class="ghost-action compact align-start" type="button" data-quick-add-library="cta">+ Adicionar novo CTA</button>
          `)}
          ${renderFieldGroup("Geração com IA", "Tom e formato de cenas são usados apenas ao clicar em Gerar ou Melhorar.", `
            ${renderField("Tom do roteiro", renderCustomSelect({
              name: "scriptAiTone",
              value: "normal",
              placeholder: "Selecione o tom",
              options: [
                { value: "serio", label: "Sério" },
                { value: "normal", label: "Normal" },
                { value: "humor", label: "Bem-humorado" }
              ]
            }))}
            ${renderField("Formato de cenas", renderCustomSelect({
              name: "scriptAiSceneFormat",
              value: "numeradas",
              placeholder: "Selecione o formato",
              options: [
                { value: "numeradas", label: "Cenas numeradas" },
                { value: "continuo", label: "Fluxo contínuo" }
              ]
            }))}
          `)}
          <div class="inline-actions">
            <button class="ghost-action compact" type="button" data-script-generate="${piece.id}" ${isGeneratingScript ? "disabled" : ""}>${isGeneratingScript ? "Gerando..." : "Gerar pela IA"}</button>
            <button class="ghost-action compact" type="button" data-script-improve="${piece.id}" ${isGeneratingScript ? "disabled" : ""}>${isGeneratingScript ? "Gerando..." : "Melhorar com IA"}</button>
          </div>
        </div>
        <div class="phase-form-footer">
          <small class="linked-video">${idea ? `A IA usa o título e a descrição da ideia "${escapeHtml(idea.title)}".` : "Vincule uma ideia para enriquecer a geração do roteiro."}</small>
          <button class="primary-action" type="submit">Salvar roteiro</button>
        </div>
      </form>
      ${renderAiPreview({
        title: "Prévia do roteiro",
        state: scriptAiState,
        visible: scriptAiState.pieceId === piece.id && (scriptAiState.loading || scriptAiState.text || scriptAiState.error)
      })}
    </div>
  `;
}

function renderCapturePhase(piece) {
  const angleItems = getLibraryOptionsForSlot("camera_angle");
  const selectedAngles = getPieceComponents(piece.id, "camera_angle").map(component => component.libraryItemId).filter(Boolean);
  return `
    <form class="panel phase-form" data-piece-form="capture" data-piece-id="${piece.id}">
      <div class="phase-form-header">
        <h3>Captação</h3>
      </div>
      <div class="phase-form-body stack">
        ${renderFieldGroup("Ângulos de câmera", "Selecione os ângulos que serão gravados nesta peça.", `
          <div class="checkbox-grid">
            ${angleItems.length ? angleItems.map(item => `
              <label class="checkbox-pill">
                <input type="checkbox" name="cameraAngleIds" value="${item.id}" ${selectedAngles.includes(item.id) ? "checked" : ""} />
                <span>${escapeHtml(item.name)}</span>
              </label>
            `).join("") : `<p class="field-hint">Nenhum ângulo cadastrado na biblioteca.</p>`}
          </div>
          <button class="ghost-action compact align-start" type="button" data-quick-add-library="angulo_camera">+ Adicionar novo ângulo</button>
        `)}
        ${renderField("Link do Google Drive", `<input name="driveUrl" value="${escapeHtml(piece.capture.driveUrl)}" placeholder="https://drive.google.com/..." />`, { hint: "Pasta ou arquivo com o material bruto gravado." })}
        ${piece.capture.driveUrl ? `<a class="ghost-action compact dashboard-connect" href="${escapeHtml(piece.capture.driveUrl)}" target="_blank" rel="noreferrer">Abrir Drive</a>` : ""}
      </div>
      <div class="phase-form-footer">
        <button class="primary-action" type="submit">Salvar captação</button>
      </div>
    </form>
  `;
}

function renderEditPhase(piece) {
  const musicComponent = getPrimaryComponent(piece.id, "music");
  const soundComponent = getPrimaryComponent(piece.id, "sound_effect");
  const musicItems = getLibraryOptionsForSlot("music");
  const soundItems = getLibraryOptionsForSlot("sound_effect");
  const headerComponents = getHeaderComponents(piece.id);
  return `
    <form class="panel phase-form" data-piece-form="edit" data-piece-id="${piece.id}">
      <div class="phase-form-header">
        <h3>Edição</h3>
      </div>
      <div class="phase-form-body stack">
        ${renderFieldGroup("Áudio", "Música e efeitos sonoros da peça.", `
          ${renderLibrarySingleSelect({
            label: "Música",
            fieldName: "musicItemId",
            category: "musica",
            value: musicComponent?.libraryItemId || "",
            options: musicItems,
            placeholder: "Selecione a música",
            addLabel: "+ Adicionar nova música"
          })}
          ${renderLibrarySingleSelect({
            label: "Efeito sonoro",
            fieldName: "soundEffectItemId",
            category: "efeito_sonoro",
            value: soundComponent?.libraryItemId || "",
            options: soundItems,
            placeholder: "Selecione o efeito sonoro",
            addLabel: "+ Adicionar novo efeito"
          })}
        `)}
        <div class="notice">
          <strong>Recomendação de header</strong>
          <span>${escapeHtml(piece.edit.headerRecommendation || "Sem recomendação ainda. Gere o roteiro com IA para receber a sugestão.")}</span>
        </div>
        ${renderFieldGroup("Headers sugeridos", "Marque os headers que foram usados na edição final.", headerComponents.length ? headerComponents.map(component => `
          <label class="line-card">
            <strong>${escapeHtml(component.notes || "Header sugerido")}</strong>
            <span>Conta no geral como uso de headers, sem separar métricas por header individual.</span>
            <span><input type="checkbox" name="usedHeaderIds" value="${component.id}" ${component.used ? "checked" : ""} /> marcar como usado</span>
          </label>
        `).join("") : `<p class="field-hint">Nenhum header sugerido ainda.</p>`)}
      </div>
      <div class="phase-form-footer">
        <button class="primary-action" type="submit">Salvar edição</button>
      </div>
    </form>
  `;
}

function renderDistributionPhase(piece) {
  const linkedItems = getPieceInstagramItems(piece.id);
  const metrics = getPieceInstagramMetrics(piece.id);

  return `
    <div class="stack">
      <form class="panel phase-form" data-piece-form="distribution" data-piece-id="${piece.id}">
        <div class="phase-form-header">
          <h3>Distribuição</h3>
        </div>
        <div class="phase-form-body stack">
          <div class="notice">
            <strong>Insights via Instagram</strong>
            <span>Esta peça só lê métricas reais do Instagram, usando a Meta Graph API. Não há integração com TikTok Analytics nem YouTube Studio por enquanto.</span>
          </div>
          ${renderField("ID da mídia no Instagram", `<input name="igMediaId" value="${escapeHtml(piece.distribution.igMediaId)}" placeholder="ig_media_id" />`, { hint: "Identificador da publicação real no Instagram." })}
          ${(() => {
            const permalinkMeta = getPermalinkFieldMeta(piece);
            return renderField("Permalink", `<input name="permalink" data-permalink-input="${piece.id}" value="${escapeHtml(piece.distribution.permalink)}" placeholder="https://www.instagram.com/p/..." />`, permalinkMeta);
          })()}
        </div>
        <div class="phase-form-footer">
          <button class="primary-action" type="submit">Salvar vínculo real</button>
        </div>
      </form>

      <section class="panel">
        <h3>Legendas do conteúdo</h3>
        ${(() => {
          const caption = getPieceCaption(piece.id);
          if (!caption) return `<p>Nenhuma legenda salva para esta peça ainda.</p>`;
          return `
            <div class="stack mini caption-summary">
              ${caption.instagramCaption ? `<div class="line-card"><strong>Instagram</strong><pre class="caption-block-preview">${escapeHtml(caption.instagramCaption)}</pre></div>` : ""}
              ${caption.tiktokCaption ? `<div class="line-card"><strong>TikTok</strong><pre class="caption-block-preview">${escapeHtml(caption.tiktokCaption)}</pre></div>` : ""}
              ${caption.ytTitle || caption.ytDescription || caption.ytTags ? `
                <div class="line-card">
                  <strong>YouTube Shorts</strong>
                  ${caption.ytTitle ? `<span><strong>Título:</strong> ${escapeHtml(caption.ytTitle)}</span>` : ""}
                  ${caption.ytDescription ? `<pre class="caption-block-preview">${escapeHtml(caption.ytDescription)}</pre>` : ""}
                  ${caption.ytTags ? `<span><strong>Tags:</strong> ${escapeHtml(caption.ytTags)}</span>` : ""}
                </div>
              ` : ""}
            </div>
          `;
        })()}
      </section>

      <section class="panel">
        <h3>Insights da peça</h3>
        ${linkedItems.length ? `
          <div class="mini-metrics">
            ${renderMiniMetric("Views", metrics.views)}
            ${renderMiniMetric("Alcance", metrics.reach)}
            ${renderMiniMetric("Curtidas", metrics.likes)}
            ${renderMiniMetric("Salvos", metrics.saves)}
            ${renderMiniMetric("Compart.", metrics.shares)}
          </div>
        ` : `<p>Sem mídia do Instagram conectada ainda. Cole o ` + "`ig_media_id`" + ` ou o permalink para associar a peça à publicação real.</p>`}
      </section>

      <section class="panel">
        <h3>Distribuição dos insights por componente</h3>
        <p>Somente componentes marcados como usados recebem as métricas dessa peça.</p>
        ${renderUsedComponentPerformance(piece.id)}
      </section>
    </div>
  `;
}

function renderComponentManager(pieceId, slots) {
  return `
    <section class="panel stack">
      <h3>Componentes vinculados</h3>
      ${slots.map(slot => {
        const components = getPieceComponents(pieceId, slot);
        const options = getLibraryOptionsForSlot(slot);
        return `
          <div class="component-block">
            <div class="item-topline">
              <span>${formatSlotLabel(slot)}</span>
              <strong>${components.length}</strong>
            </div>
            ${components.length ? components.map(component => renderComponentRow(component)).join("") : `<p>Nenhum componente nesse slot.</p>`}
            <form class="inline-form" data-add-component="${pieceId}">
              <input type="hidden" name="slot" value="${slot}" />
              ${renderCustomSelect({
                name: "libraryItemId",
                value: "",
                placeholder: options.length ? "Selecione da biblioteca" : "Sem itens na biblioteca",
                options: options.map(option => ({ value: option.id, label: option.name }))
              })}
              <button class="ghost-action compact" type="button" data-quick-add-library="${getLibraryCategoryForSlot(slot)}">+ Adicionar novo</button>
              <input name="notes" placeholder="Notas rápidas" />
              <button class="ghost-action compact" type="submit">Adicionar</button>
            </form>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function renderComponentRow(component) {
  const item = state.library.find(entry => entry.id === component.libraryItemId);
  return `
    <form class="component-row" data-component-form="${component.id}">
      <div>
        <strong>${escapeHtml(item?.name || "Componente sem item da biblioteca")}</strong>
        <span>${formatSlotLabel(component.slot)}</span>
      </div>
      <label><input type="checkbox" name="required" ${component.required ? "checked" : ""} /> obrigatório</label>
      <label><input type="checkbox" name="used" ${component.used ? "checked" : ""} /> usado</label>
      <input name="notes" value="${escapeHtml(component.notes)}" placeholder="Notas" />
      <button class="ghost-action compact" type="submit">Atualizar</button>
      <button class="ghost-action compact" type="button" data-remove-component="${component.id}">Remover</button>
    </form>
  `;
}

function renderTexts(query) {
  const captions = getUnifiedCaptions().filter(caption => matchesQuery([
    findPieceTitle(caption.pieceId),
    caption.instagramCaption,
    caption.tiktokCaption,
    caption.ytTitle,
    caption.ytDescription,
    caption.ytTags
  ], query));

  const selectedCaptionPiece = state.pieces.find(piece => piece.id === (captionDraft?.pieceId || selectedPieceId)) || state.pieces[0] || null;
  const defaultPlatforms = selectedCaptionPiece?.platforms?.length ? selectedCaptionPiece.platforms : ["instagram", "tiktok", "shorts"];
  const captionTheme = selectedCaptionPiece ? getPieceTheme(selectedCaptionPiece) : "";
  const captionScript = selectedCaptionPiece ? getScriptSummary(selectedCaptionPiece.id) : "";
  const captionAiState = aiDrafts.caption;
  const isGeneratingCaption = captionAiState.loading && captionAiState.pieceId === selectedCaptionPiece?.id;

  return `
    <div class="stack">
      <section class="platform-rules">
        ${Object.entries(platformRules).map(([platform, rule]) => `
          <div class="rule-card">
            <strong>${rule.label}</strong>
            <span>${rule.note}</span>
          </div>
        `).join("")}
      </section>

      <div class="panel caption-actions">
        <button class="primary-action" type="button" data-open-manual-caption>Adicionar legenda</button>
        <button class="ghost-action" type="button" data-open-caption-generator>Gerar com IA</button>
      </div>

      ${manualCaptionOpen ? `
        <form class="panel stack caption-overlay-panel" id="manualCaptionForm">
          <h3>Nova legenda manual</h3>
          <p>Escolha a peça e preencha as legendas por rede social.</p>
          ${renderField("Peça", renderCustomSelect({
            name: "pieceId",
            value: selectedCaptionPiece?.id || "",
            placeholder: "Selecione uma peça",
            options: state.pieces.map(piece => ({ value: piece.id, label: piece.title }))
          }))}
          <div class="inline-actions">
            <button class="primary-action" type="submit">Continuar</button>
            <button class="ghost-action compact" type="button" data-cancel-manual-caption>Cancelar</button>
          </div>
        </form>
      ` : ""}

      ${captionGeneratorOpen ? `
      <form class="panel stack caption-overlay-panel" id="captionGeneratorForm">
        <h3>Gerar legendas com IA</h3>
        <div class="notice">
          <strong>Fluxo unificado</strong>
          <span>A IA gera um pacote de legendas por peça. Instagram e TikTok vêm em um único bloco com quebras de linha; YouTube Shorts em título, descrição e tags.</span>
        </div>
        ${renderField("Peça", renderCustomSelect({
          name: "pieceId",
          value: selectedCaptionPiece?.id || "",
          placeholder: "Selecione uma peça",
          options: state.pieces.map(piece => ({ value: piece.id, label: piece.title }))
        }))}
        ${selectedCaptionPiece ? `
          <div class="line-card">
            <strong>${escapeHtml(selectedCaptionPiece.title)}</strong>
            <span>Objetivo: ${escapeHtml(selectedCaptionPiece.brief.objective || "não definido")}</span>
            <span>Tema: ${escapeHtml(captionTheme || "sem tema definido")}</span>
            <span>Roteiro: ${escapeHtml(captionScript || "sem roteiro salvo ainda")}</span>
          </div>
        ` : `<p>Selecione uma peça para gerar as legendas.</p>`}
        <div class="checkbox-grid">
          ${renderPlatformCheckbox("platforms", defaultPlatforms)}
        </div>
        ${renderFieldGroup("Tom da IA", "Define como a legenda deve soar.", `
          <div class="caption-tone-grid">
            ${renderField("Emojis", renderCustomSelect({
              name: "emojiTone",
              value: "normal",
              placeholder: "Emojis",
              options: [
                { value: "sem", label: "Sem emojis" },
                { value: "pouco", label: "Poucos emojis" },
                { value: "normal", label: "Emojis normais" },
                { value: "muito", label: "Muitos emojis" }
              ]
            }))}
            ${renderField("Entusiasmo", renderCustomSelect({
              name: "enthusiasmTone",
              value: "moderado",
              placeholder: "Entusiasmo",
              options: [
                { value: "baixo", label: "Baixo" },
                { value: "moderado", label: "Moderado" },
                { value: "alto", label: "Alto" }
              ]
            }))}
            ${renderField("Tom de voz", renderCustomSelect({
              name: "voiceTone",
              value: "casual",
              placeholder: "Tom",
              options: [
                { value: "casual", label: "Casual" },
                { value: "neutro", label: "Neutro" },
                { value: "direto", label: "Direto ao ponto" }
              ]
            }))}
          </div>
        `)}
        ${captionAiState.error && captionAiState.pieceId === selectedCaptionPiece?.id ? `
          <div class="notice warning"><strong>Erro na geração</strong><span>${escapeHtml(captionAiState.error)}</span></div>
        ` : ""}
        <div class="inline-actions">
          <button class="primary-action" type="submit" ${selectedCaptionPiece && !isGeneratingCaption ? "" : "disabled"}>${isGeneratingCaption ? "Gerando..." : "Gerar com IA"}</button>
          <button class="ghost-action compact" type="button" data-cancel-caption-generator>Cancelar</button>
        </div>
      </form>
      ` : ""}

      ${captionDraft ? renderCaptionListItem(captionDraft, { mode: "draft", forceExpanded: true }) : ""}
      ${manualCaptionDraft ? renderCaptionListItem(manualCaptionDraft, { mode: "manual", forceExpanded: true }) : ""}

      <section class="panel caption-list-panel">
        <div class="caption-list-head">
          <h3>Legendas salvas</h3>
          <span>${captions.length} conteúdo(s)</span>
        </div>
        ${captions.length ? `
          <div class="caption-list">
            ${captions.map(caption => renderCaptionListItem(caption, { mode: "saved" })).join("")}
          </div>
        ` : emptyState("Nenhuma legenda salva ainda.", "Adicione manualmente ou gere com IA para uma peça.")}
      </section>
    </div>
  `;
}

function renderCaptionListItem(caption, { mode, forceExpanded = false }) {
  const pieceId = caption.pieceId || "";
  const pieceTitle = findPieceTitle(pieceId);
  const isExpanded = forceExpanded || expandedCaptionPieceId === pieceId;
  const platforms = getCaptionPlatforms(caption);
  const platformLabels = platforms.map(platform => platformRules[platform].label).join(" · ");

  return `
    <article class="caption-list-item ${isExpanded ? "expanded" : ""} ${mode === "draft" ? "is-draft" : ""} ${mode === "manual" ? "is-manual" : ""}">
      ${mode === "draft" || mode === "manual" ? `
        <div class="caption-list-row is-static">
          <span class="caption-list-title">${escapeHtml(pieceTitle)}</span>
          <span class="caption-list-meta">${mode === "draft" ? "Rascunho da IA" : "Nova legenda manual"}</span>
          <span class="caption-list-meta">${escapeHtml(platformLabels)}</span>
        </div>
      ` : `
        <button class="caption-list-row" type="button" data-caption-toggle="${escapeHtml(pieceId)}" aria-expanded="${isExpanded ? "true" : "false"}">
          <span class="caption-list-title">${escapeHtml(pieceTitle)}</span>
          <span class="caption-list-meta">${escapeHtml(platformLabels || "Sem redes")}</span>
          <span class="caption-list-meta">${formatDateTime(caption.updatedAt)}</span>
          <span class="caption-list-chevron" aria-hidden="true">${isExpanded ? "▾" : "▸"}</span>
        </button>
      `}
      ${isExpanded ? renderCaptionForm(caption, { mode, embedded: true }) : ""}
    </article>
  `;
}

function getCaptionPlatforms(caption) {
  const platforms = [];
  if (String(caption.instagramCaption || "").trim()) platforms.push("instagram");
  if (String(caption.tiktokCaption || "").trim()) platforms.push("tiktok");
  if (String(caption.ytTitle || caption.ytDescription || caption.ytTags || "").trim()) platforms.push("shorts");

  if (platforms.length) return platforms;

  const piece = state.pieces.find(item => item.id === caption.pieceId);
  if (piece?.platforms?.length) return [...piece.platforms];
  return ["instagram", "tiktok", "shorts"];
}

function getActiveCaptionPlatformTab(pieceId, platforms) {
  const current = captionPlatformTabs[pieceId];
  if (current && platforms.includes(current)) return current;
  return platforms[0] || "instagram";
}

function renderCaptionForm(caption, { mode, embedded = false }) {
  const pieceId = caption.pieceId || "";
  const pieceTitle = findPieceTitle(pieceId);
  const instagramRule = platformRules.instagram;
  const tiktokRule = platformRules.tiktok;
  const shortsRule = platformRules.shorts;
  const platforms = getCaptionPlatforms(caption);
  const activePlatform = getActiveCaptionPlatformTab(pieceId, platforms);
  const instagramCount = caption.instagramCaption?.length || 0;
  const tiktokCount = caption.tiktokCaption?.length || 0;
  const instagramTags = countCaptionHashtags(caption.instagramCaption);
  const tiktokTags = countCaptionHashtags(caption.tiktokCaption);
  const saveLabel = mode === "draft" || mode === "manual"
    ? `Salvar ${platformRules[activePlatform].label}`
    : `Atualizar ${platformRules[activePlatform].label}`;

  return `
    <form class="${embedded ? "caption-bundle-body" : "panel stack caption-bundle-card"}" data-caption-form="${mode}" data-caption-id="${escapeHtml(caption.id || "")}" data-caption-piece="${escapeHtml(pieceId)}">
      ${!embedded ? `
        <div class="item-topline">
          <span>${escapeHtml(pieceTitle)}</span>
          <strong>${mode === "draft" ? "Rascunho da IA" : formatDateTime(caption.updatedAt)}</strong>
        </div>
      ` : ""}

      <div class="caption-platform-tabs" role="tablist" aria-label="Redes sociais">
        ${platforms.map(platform => `
          <button
            type="button"
            class="${activePlatform === platform ? "active" : ""}"
            role="tab"
            aria-selected="${activePlatform === platform ? "true" : "false"}"
            data-caption-platform-tab="${platform}"
            data-caption-piece-tab="${escapeHtml(pieceId)}"
          >${platformRules[platform].label}</button>
        `).join("")}
      </div>

      <div class="caption-platform-panels">
        <div class="caption-platform-panel ${activePlatform === "instagram" ? "active" : ""}" data-caption-platform-panel="instagram">
          ${renderFieldGroup("Instagram", platformRules.instagram.note, `
            ${renderField("Legenda", `<textarea name="instagramCaption" class="caption-block-field" maxlength="${instagramRule.characterLimit}" placeholder="Título chamativo&#10;&#10;Corpo do texto&#10;&#10;#tag1 #tag2">${escapeHtml(caption.instagramCaption || "")}</textarea>`, {
              hint: `${instagramCount}/${instagramRule.characterLimit} caracteres • ${instagramTags}/${instagramRule.hashtagLimit} hashtags`
            })}
          `)}
        </div>

        <div class="caption-platform-panel ${activePlatform === "tiktok" ? "active" : ""}" data-caption-platform-panel="tiktok">
          ${renderFieldGroup("TikTok", platformRules.tiktok.note, `
            ${renderField("Legenda", `<textarea name="tiktokCaption" class="caption-block-field" maxlength="${tiktokRule.characterLimit}" placeholder="Título chamativo&#10;&#10;Corpo do texto&#10;&#10;#tag1 #tag2">${escapeHtml(caption.tiktokCaption || "")}</textarea>`, {
              hint: `${tiktokCount}/${tiktokRule.characterLimit} caracteres • ${tiktokTags}/${tiktokRule.hashtagLimit} hashtags`
            })}
          `)}
        </div>

        <div class="caption-platform-panel ${activePlatform === "shorts" ? "active" : ""}" data-caption-platform-panel="shorts">
          ${renderFieldGroup("YouTube Shorts", platformRules.shorts.note, `
            ${renderField("Título", `<input name="ytTitle" maxlength="${shortsRule.titleLimit}" value="${escapeHtml(caption.ytTitle || "")}" placeholder="Título SEO com hashtags (até 100 caracteres)" />`, {
              hint: `${(caption.ytTitle || "").length}/${shortsRule.titleLimit} caracteres`
            })}
            ${renderField("Descrição", `<textarea name="ytDescription" class="caption-block-field" maxlength="${shortsRule.characterLimit}" placeholder="Descrição completa sobre o vídeo">${escapeHtml(caption.ytDescription || "")}</textarea>`, {
              hint: `${(caption.ytDescription || "").length}/${shortsRule.characterLimit} caracteres`
            })}
            ${renderField("Tags", `<input name="ytTags" maxlength="${shortsRule.tagsLimit}" value="${escapeHtml(caption.ytTags || "")}" placeholder="palavra-chave, outra palavra, tema do vídeo" />`, {
              hint: `${(caption.ytTags || "").length}/${shortsRule.tagsLimit} caracteres`
            })}
          `)}
        </div>
      </div>

      <div class="inline-actions caption-form-actions">
        <button class="primary-action" type="submit">${escapeHtml(saveLabel)}</button>
        ${mode === "draft" ? `<button class="ghost-action compact" type="button" data-discard-caption-draft>Descartar rascunho</button>` : ""}
        ${mode === "manual" ? `<button class="ghost-action compact" type="button" data-discard-manual-caption>Cancelar</button>` : ""}
        ${mode === "saved" ? `
          <button class="ghost-action compact danger-text" type="button" data-delete-caption="${escapeHtml(caption.id)}">Excluir</button>
        ` : ""}
      </div>
    </form>
  `;
}

function renderAiPreview({ title, state: previewState, visible }) {
  if (!visible) return "";

  return `
    <section class="panel stack">
      <h3>${title}</h3>
      ${previewState.error ? `<div class="notice warning"><strong>Erro na geração</strong><span>${escapeHtml(previewState.error)}</span></div>` : ""}
      ${previewState.loading || previewState.text ? `
        <textarea
          class="ai-preview"
          data-ai-preview-textarea="script"
          rows="16"
          ${previewState.loading ? "readonly" : ""}
        >${escapeHtml(previewState.text)}</textarea>
        ${previewState.loading ? `<span class="stream-cursor" aria-hidden="true"></span>` : ""}
      ` : ""}
    </section>
  `;
}

function renderPublications(query) {
  const publications = state.publications.filter(publication => matchesQuery([
    publication.platform,
    publication.url,
    publication.publishedAt,
    findPieceTitle(publication.pieceId)
  ], query));

  return publications.length ? `
    <div class="stack">
      ${publications.map(publication => `
        <article class="item-card">
          <div class="item-topline">
            <span>${formatPlatform(publication.platform)}</span>
            <strong>${publication.publishedAt ? formatDateTime(publication.publishedAt) : "sem data"}</strong>
          </div>
          <h3>${escapeHtml(findPieceTitle(publication.pieceId))}</h3>
          <p>${escapeHtml(publication.url || "Sem URL registrada")}</p>
          <div class="mini-metrics">
            ${renderMiniMetric("Views", publication.metrics?.views)}
            ${renderMiniMetric("Likes", publication.metrics?.likes)}
            ${renderMiniMetric("Salvos", publication.metrics?.saves)}
            ${renderMiniMetric("Shares", publication.metrics?.shares)}
            ${renderMiniMetric("Coment.", publication.metrics?.comments)}
          </div>
        </article>
      `).join("")}
    </div>
  ` : emptyState();
}

function renderLibrary(query) {
  const items = state.library.filter(item => item.category === currentLibraryCategory && matchesQuery([
    item.name,
    item.notes,
    item.example,
    item.context.join(" "),
    item.platforms.join(" ")
  ], query));
  const performanceRows = buildLibraryPerformanceRows(currentLibraryCategory);
  const editingLibraryItem = state.library.find(item => item.id === editingLibraryItemId) || null;

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

      <div class="stack library-content">
        ${currentLibraryCategory === "estrutura_roteiro" ? `
          <section class="panel">
            <h3>Estruturas fixas do piloto</h3>
            <p>As estruturas de roteiro são pré-definidas. Escolha uma delas no Montador; não é possível criar novas nesta fase.</p>
          </section>
        ` : (libraryFormOpen || editingLibraryItem ? `
        <form class="panel stack" id="libraryForm">
          <h3>${editingLibraryItem ? "Editar item da biblioteca" : `Novo ${escapeHtml(getCategoryLabel(currentLibraryCategory))}`}</h3>
          <input type="hidden" name="libraryItemId" value="${escapeHtml(editingLibraryItem?.id || "")}" />
          <input type="hidden" name="category" value="${escapeHtml(currentLibraryCategory)}" />
          ${renderField("Nome", `<input name="name" value="${escapeHtml(editingLibraryItem?.name || "")}" required />`, { required: true })}
          ${renderField("Notas", `<input name="notes" value="${escapeHtml(editingLibraryItem?.notes || "")}" />`)}
          ${renderField("Exemplo", `<input name="example" value="${escapeHtml(editingLibraryItem?.example || "")}" />`)}
          ${renderField("Contextos", `<input name="context" value="${escapeHtml((editingLibraryItem?.context || []).join(", "))}" />`, { hint: "Separados por vírgula" })}
          ${renderField("Plataformas", `<div class="checkbox-grid">${renderPlatformCheckbox("platforms", editingLibraryItem?.platforms || ["instagram", "tiktok", "shorts"])}</div>`)}
          <div class="inline-actions">
            <button class="primary-action" type="submit">${editingLibraryItem ? "Salvar alterações" : "Salvar item"}</button>
            <button class="ghost-action compact" type="button" id="cancelLibraryEdit">Cancelar</button>
          </div>
        </form>
        ` : `
        <div class="panel library-add-trigger">
          <button class="primary-action" type="button" data-open-library-form>Adicionar ${escapeHtml(getCategoryLabel(currentLibraryCategory))}</button>
        </div>
        `)}

        <section class="panel">
          <h3>${escapeHtml(getCategoryLabel(currentLibraryCategory))}</h3>
          <p>Os componentes marcados como usados nas peças recebem as métricas das publicações reais ligadas ao Instagram.</p>
        </section>

        ${items.length ? `<div class="grid three">${items.map(item => `
          <article class="item-card">
            <div class="item-topline">
              <span>${escapeHtml(getCategoryLabel(item.category))}</span>
              <strong>${item.platforms.length ? item.platforms.map(formatPlatform).join(", ") : "multi"}</strong>
            </div>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.notes || "Sem notas ainda.")}</p>
            ${item.category === "gancho" ? `<small>Tipo: ${item.metadata?.hookType === "textual" ? "Textual" : "Visual"}</small>` : ""}
            ${item.category === "estrutura_roteiro" && item.metadata?.templateKey ? `<small>Template: ${escapeHtml(getStructureLabel(item.metadata.templateKey))}</small>` : ""}
            ${item.example ? `<small>${escapeHtml(item.example)}</small>` : ""}
            <div class="tag-row">${item.context.map(context => `<span>${escapeHtml(context)}</span>`).join("")}</div>
            <div class="inline-actions">
              <button class="ghost-action compact" type="button" data-edit-library="${item.id}">Editar</button>
              <button class="ghost-action compact" type="button" data-delete-library="${item.id}">Excluir</button>
            </div>
          </article>
        `).join("")}</div>` : emptyState("Sem itens nessa categoria.", "Cadastre ou sincronize componentes para começar a vincular às peças.")}

        <section class="panel">
          <h3>Performance da categoria</h3>
          ${performanceRows.length ? renderPerformanceTable(performanceRows) : `<p>Sem métricas distribuídas para essa categoria ainda.</p>`}
        </section>
      </div>
    </div>
  `;
}

function renderAssistant() {
  const overviewRange = getCurrentMonthRange();
  const previousRange = getPreviousRange(overviewRange);
  const insightsReport = assistantGateway.buildInsightsReport({
    dashboard: instagramDashboard,
    state,
    range: overviewRange,
    previousRange
  });
  const { totals, rangeLabel, summary, bestContent, alert, nextSuggestion, comparison } = insightsReport;
  const alertBadge = comparison.direction === "up"
    ? { type: "up", text: `+${Math.abs(comparison.deltaPercent)}%` }
    : comparison.direction === "down"
      ? { type: "down", text: `-${Math.abs(comparison.deltaPercent)}%` }
      : { type: "flat", text: "Estável" };

  return `
    <div class="assistant-page">
      <section class="panel assistant-hero">
        <div class="assistant-hero-top">
          <div>
            <span class="kicker">Visão geral</span>
            <h3>Insights do período</h3>
            <p class="assistant-range">${escapeHtml(rangeLabel)} · dados do Instagram</p>
          </div>
        </div>
        <div class="assistant-insights-grid assistant-insights-grid--metrics">
          ${renderAssistantInsightCard({ title: "Alcance", iconName: "target", tone: "blue", value: totals.reach })}
          ${renderAssistantInsightCard({ title: "Views", iconName: "eye", tone: "green", value: totals.views })}
          ${renderAssistantInsightCard({ title: "Curtidas", iconName: "heart", tone: "rose", value: totals.likes })}
          ${renderAssistantInsightCard({ title: "Salvos", iconName: "bookmark", tone: "olive", value: totals.saves })}
          ${renderAssistantInsightCard({ title: "Shares", iconName: "send", tone: "orange", value: totals.shares })}
        </div>
      </section>

      <div class="assistant-insights-grid">
        ${renderAssistantInsightCard({
          title: "Resumo de desempenho",
          iconName: "chart",
          tone: "teal",
          body: summary
        })}
        ${renderAssistantInsightCard({
          title: "Melhor conteúdo",
          iconName: "spark",
          tone: "violet",
          body: bestContent
            ? bestContent.item.caption || "Conteúdo sem legenda"
            : "Nenhum conteúdo com métricas no período.",
          meta: bestContent ? `Engajamento relativo: ${formatPercent(bestContent.score)}` : ""
        })}
        ${renderAssistantInsightCard({
          title: "Alerta de variação",
          iconName: comparison.direction === "down" ? "wave" : "zap",
          tone: comparison.direction === "down" ? "rose" : comparison.direction === "up" ? "green" : "amber",
          body: alert,
          badge: alertBadge
        })}
        ${renderAssistantInsightCard({
          title: "Próximo conteúdo sugerido",
          iconName: "lightbulb",
          tone: "blue",
          body: nextSuggestion
        })}
        ${renderAssistantInsightCard({
          title: "Escopo atual",
          iconName: "target",
          tone: "amber",
          body: "Esta área analisa apenas Instagram via Meta Graph API. O gerador de legendas foi movido para a aba de Legendas.",
          meta: "Janela fixa do dia 1 até hoje."
        })}
      </div>
    </div>
  `;
}

function renderAssistantInsightCard({ title, iconName, tone, body = "", meta = "", badge = null, value = null }) {
  const hasBadge = Boolean(badge);
  const isMetric = value !== null && value !== undefined;
  const bodyContent = isMetric
    ? `<p class="assistant-insight-metric">${formatNumber(value)}</p>`
    : `<p>${escapeHtml(body)}</p>`;

  return `
    <article class="assistant-insight-card tone-${tone}${isMetric ? " is-metric" : ""}">
      <div class="assistant-insight-top${hasBadge ? " has-badge" : ""}">
        <span class="insight-icon">${icon(iconName)}</span>
        <div class="assistant-insight-heading">
          <strong>${escapeHtml(title)}</strong>
          ${badge ? `<span class="assistant-badge ${badge.type}">${escapeHtml(badge.text)}</span>` : ""}
        </div>
      </div>
      ${bodyContent}
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
    </article>
  `;
}

function renderSettings() {
  const resolved = resolveTheme();
  const resolvedLabel = resolved === "dark" ? "escuro" : "claro";
  const options = [
    { id: "light", label: "Claro", desc: "Fundo claro com alto contraste para ambientes iluminados." },
    { id: "dark", label: "Escuro", desc: "Reduz o brilho da área de trabalho; a sidebar permanece escura." },
    { id: "system", label: "Sistema", desc: "Segue a preferência de tema do seu dispositivo." }
  ];

  return `
    <div class="settings-page">
      <section class="panel">
        <h3>Aparência</h3>
        <p>Tema aplicado agora: <strong>${resolvedLabel}</strong>${themePreference === "system" ? " (automático)" : ""}.</p>
        <div class="settings-theme-grid" role="radiogroup" aria-label="Tema do ContentOS">
          ${options.map(option => `
            <label class="settings-theme-option ${themePreference === option.id ? "active" : ""}">
              <input type="radio" name="appTheme" value="${option.id}" ${themePreference === option.id ? "checked" : ""} />
              <span class="settings-theme-swatch settings-theme-swatch--${option.id}" aria-hidden="true"></span>
              <span class="settings-theme-copy">
                <strong>${option.label}</strong>
                <span>${option.desc}</span>
              </span>
            </label>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderDashboard(query) {
  const dateRange = getInstagramDateRange();
  const filteredItems = filterInstagramItemsByDate(instagramDashboard.contentItems, dateRange);
  const contentItems = filteredItems.filter(item => {
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
          ${instagramDashboard.account ? "" : `<a class="ghost-action dashboard-connect" href="/api/instagram/connect">Conectar Instagram</a>`}
          <button
            class="icon-action dashboard-reload-action ${isReloadingState ? "is-spinning" : ""}"
            type="button"
            data-reload-state
            aria-label="Recarregar dados do Supabase"
            title="Recarrega ideias, peças, biblioteca e demais dados do banco."
            ${isReloadingState ? "disabled" : ""}
          >${icon("refresh")}</button>
          <button class="primary-action" type="button" data-sync-instagram ${isInstagramSyncing || isReloadingState ? "disabled" : ""}>${isInstagramSyncing ? "Sincronizando..." : "Atualizar insights"}</button>
        </div>
      </div>

      ${renderInstagramDateFilter(dateRange)}

      ${instagramDashboard.isConfigured ? "" : `
        <div class="empty-state compact">
          <strong>Integração pronta para configurar.</strong>
          <span>Preencha as chaves da Meta no ambiente e conecte uma conta Instagram Business ou Creator.</span>
        </div>
      `}

      ${instagramError ? `
        <div class="empty-state compact">
          <strong>Não foi possível concluir a conexão com o Instagram.</strong>
          <span>${escapeHtml(instagramError)}</span>
        </div>
      ` : ""}

      ${instagramView === "overview" ? renderInstagramOverview(filteredItems) : renderInstagramContent(contentItems)}
    </div>
  `;
}

function renderInstagramOverview(items) {
  const mediaTotals = items.length
    ? items.reduce((sum, item) => addInstagramMetrics(sum, item.metrics), createEmptyMetrics())
    : instagramDashboard.totals;
  const accountMetrics = instagramDashboard.accountMetrics || createEmptyMetrics();
  const totals = {
    ...mediaTotals,
    profileViews: accountMetrics.profileViews || mediaTotals.profileViews
  };
  const byContentType = groupInstagramItemsByType(items);
  const maxContentCount = Math.max(...byContentType.map(type => type.count), 1);

  return `
    <div class="insight-grid polished">
      ${renderInsightCard("Alcance", totals.reach, "target", "blue")}
      ${renderInsightCard("Visualizações", totals.views, "eye", "green")}
      ${renderInsightCard("Visitas ao perfil", totals.profileViews, "user", "amber")}
      ${renderInsightCard("Curtidas", totals.likes, "heart", "rose")}
      ${renderInsightCard("Comentários", totals.comments, "message", "cyan")}
      ${renderInsightCard("Salvamentos", totals.saves, "bookmark", "olive")}
      ${renderInsightCard("Compartilhamentos", totals.shares, "send", "orange")}
    </div>

    <div class="grid two dashboard-split">
      <section class="panel insight-panel">
        <h3>Distribuição por formato</h3>
        <div class="insight-bars">
          ${byContentType.length ? byContentType.map(item => `
            <div class="insight-bar">
              <div><strong>${formatInstagramContentType(item.contentType)}</strong><span>${item.count} conteúdos</span></div>
              <meter min="0" max="${maxContentCount}" value="${item.count}"></meter>
            </div>
          `).join("") : `<p>Nenhum conteúdo sincronizado nesse período.</p>`}
        </div>
      </section>

      <section class="panel insight-panel account-panel">
        <h3>Conta conectada</h3>
        <p>${instagramDashboard.account?.username ? `@${escapeHtml(instagramDashboard.account.username)}` : "Nenhuma conta conectada."}</p>
        <small>Última sincronização: ${instagramDashboard.lastSyncAt ? formatDateTime(instagramDashboard.lastSyncAt) : "ainda não sincronizado"}</small>
      </section>
    </div>
  `;
}

function renderInstagramContent(items) {
  const typeTabs = [
    ["all", "Todos"],
    ["reel", "Reels"],
    ["post", "Posts"],
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
          <h3>${escapeHtml(item.caption || "Conteúdo sem legenda")}</h3>
          <small class="linked-video">Peça no ContentOS: ${escapeHtml(item.linkedVideoTitle || "sem vínculo")}</small>
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

function renderInstagramDateFilter(dateRange) {
  const presets = [
    ["today", "Hoje"],
    ["yesterday", "Ontem"],
    ["7d", "7d"],
    ["15d", "15d"],
    ["30d", "30d"],
    ["all", "Tudo"],
    ["custom", "Personalizado"]
  ];

  return `
    <div class="date-filter">
      <div class="date-presets" aria-label="Filtro de data dos insights">
        ${presets.map(([value, label]) => `
          <button class="${instagramDatePreset === value ? "active" : ""}" type="button" data-date-preset="${value}">${label}</button>
        `).join("")}
      </div>
      <div class="date-summary">
        <span>${formatDateRangeLabel(dateRange)}</span>
        ${instagramDatePreset === "custom" ? `
          <input type="date" id="instagramStartDate" value="${escapeHtml(instagramCustomStart)}" />
          <input type="date" id="instagramEndDate" value="${escapeHtml(instagramCustomEnd)}" />
        ` : ""}
      </div>
    </div>
  `;
}

function renderInsightCard(label, value, iconName = "chart", tone = "teal") {
  return `
    <article class="insight-card tone-${tone}">
      <div class="insight-card-top">
        <span class="insight-icon">${icon(iconName)}</span>
        <span>${label}</span>
      </div>
      <strong>${formatNumber(value)}</strong>
    </article>
  `;
}

function renderMiniMetric(label, value) {
  return `<span><strong>${formatNumber(value)}</strong>${label}</span>`;
}

function renderPerformanceTable(rows) {
  return `
    <div class="table-surface performance-table">
      <div class="table-row table-head">
        <span>Componente</span>
        <span>Views</span>
        <span>Alcance</span>
        <span>Curtidas</span>
        <span>Salvos</span>
        <span>Shares</span>
      </div>
      ${rows.map(row => `
        <div class="table-row">
          <span><strong>${escapeHtml(row.label)}</strong><small>${row.count} usos</small></span>
          <span>${formatNumber(row.metrics.views)}</span>
          <span>${formatNumber(row.metrics.reach)}</span>
          <span>${formatNumber(row.metrics.likes)}</span>
          <span>${formatNumber(row.metrics.saves)}</span>
          <span>${formatNumber(row.metrics.shares)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderUsedComponentPerformance(pieceId) {
  const components = state.pieceComponents.filter(component => component.pieceId === pieceId && component.used);
  if (!components.length) return `<p>Nenhum componente marcado como usado ainda.</p>`;

  const metrics = getPieceInstagramMetrics(pieceId);
  const hasHeaders = components.some(component => component.slot === "text_header");
  const rows = components
    .filter(component => component.slot !== "text_header")
    .map(component => {
      const item = state.library.find(entry => entry.id === component.libraryItemId);
      return `
        <div class="line-card">
          <strong>${escapeHtml(item?.name || formatSlotLabel(component.slot))}</strong>
          <span>${formatSlotLabel(component.slot)} • ${formatNumber(metrics.views)} views • ${formatNumber(metrics.saves)} salvos</span>
        </div>
      `;
    });

  if (hasHeaders) {
    rows.push(`
      <div class="line-card">
        <strong>Headers de texto</strong>
        <span>Uso geral de headers • ${formatNumber(metrics.views)} views • ${formatNumber(metrics.saves)} salvos</span>
      </div>
    `);
  }

  return `
    <div class="stack mini">
      ${rows.join("")}
    </div>
  `;
}

function attachSectionEvents() {
  attachNavEvents();
  attachCustomSelects();
  attachTagChipFields();
  attachIdeaEvents();
  attachPieceEvents();
  attachTextEvents();
  attachLibraryEvents();
  attachDashboardEvents();
  attachSettingsEvents();
  attachAiPreviewEvents();
}

function attachAiPreviewEvents() {
  document.querySelectorAll("[data-ai-preview-textarea]").forEach(element => {
    const textarea = /** @type {HTMLTextAreaElement} */ (element);
    textarea.addEventListener("input", () => {
      if (textarea.dataset.aiPreviewTextarea === "script") {
        aiDrafts.script.text = textarea.value;
      }
    });
  });
}

function attachSettingsEvents() {
  document.querySelectorAll('input[name="appTheme"]').forEach(input => {
    const themeInput = /** @type {HTMLInputElement} */ (input);
    themeInput.addEventListener("change", () => {
      if (!themeInput.checked) return;
      setThemePreference(themeInput.value);
      updateMetric();
      render();
    });
  });
}

function attachNavEvents() {
  nav.querySelectorAll("[data-section]").forEach(button => {
    const navButton = /** @type {HTMLButtonElement} */ (button);
    navButton.addEventListener("click", () => setSection(navButton.dataset.section || "dashboard"));
  });
}

function attachIdeaEvents() {
  const ideaForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#ideaForm"));
  ideaForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
    const formData = new FormData(currentForm);
    const existingIdea = state.ideas.find(item => item.id === String(formData.get("ideaId") || "").trim());
    const target = existingIdea || {
      id: createId("idea"),
      createdAt: new Date().toISOString().slice(0, 10)
    };
    Object.assign(target, {
      title: String(formData.get("title") || "").trim(),
      source: String(formData.get("source") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      angle: String(formData.get("angle") || "").trim(),
      tags: splitCommaList(formData.get("tags")),
      priority: String(formData.get("priority") || "média"),
      status: String(formData.get("status") || "disponivel")
    });
    if (!existingIdea) {
      state.ideas.unshift(target);
    }
    editingIdeaId = null;
    await persistAndRender();
  });

  document.querySelector("#cancelIdeaEdit")?.addEventListener("click", () => {
    editingIdeaId = null;
    render();
  });

  document.querySelectorAll("[data-promote-idea]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", async () => {
      const idea = state.ideas.find(item => item.id === actionButton.dataset.promoteIdea);
      if (!idea) return;
      createPieceFromIdea(idea);
      setSection("pieces");
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-toggle-idea-status]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", async () => {
      const idea = state.ideas.find(item => item.id === actionButton.dataset.toggleIdeaStatus);
      if (!idea) return;
      idea.status = idea.status === "reaproveitavel" ? "disponivel" : "reaproveitavel";
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-edit-idea]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", () => {
      editingIdeaId = actionButton.dataset.editIdea || null;
      render();
    });
  });

  document.querySelectorAll("[data-delete-idea]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", async () => {
      const ideaId = actionButton.dataset.deleteIdea;
      if (!ideaId) return;
      const confirmed = await openConfirm({
        title: "Excluir ideia",
        message: "Excluir esta ideia?",
        confirmLabel: "Excluir",
        danger: true
      });
      if (!confirmed) return;
      if (!(await runRemoteDelete(() => deleteIdeaRemote(ideaId)))) return;
      state.ideas = state.ideas.filter(item => item.id !== ideaId);
      state.pieces = state.pieces.map(piece => piece.ideaId === ideaId ? { ...piece, ideaId: null } : piece);
      if (editingIdeaId === ideaId) editingIdeaId = null;
      await persistAndRender();
    });
  });
}

function attachPieceEvents() {
  const createPieceBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector("#createPieceBtn"));
  createPieceBtn?.addEventListener("click", async () => {
    const piece = createBlankPiece();
    state.pieces.unshift(piece);
    state.scripts.unshift(createScriptForPiece(piece.id, "storytelling"));
    selectedPieceId = piece.id;
    activePiecePhase = "brief";
    await persistAndRender();
  });

  document.querySelectorAll("[data-piece-select]").forEach(button => {
    const pieceButton = /** @type {HTMLButtonElement} */ (button);
    pieceButton.addEventListener("click", () => {
      selectedPieceId = pieceButton.dataset.pieceSelect || null;
      activePiecePhase = getSelectedPiece()?.currentPhase || "brief";
      render();
    });
  });

  document.querySelectorAll("[data-piece-phase]").forEach(button => {
    const phaseButton = /** @type {HTMLButtonElement} */ (button);
    phaseButton.addEventListener("click", async () => {
      activePiecePhase = phaseButton.dataset.piecePhase || "brief";
      const piece = getSelectedPiece();
      if (piece) {
        piece.currentPhase = activePiecePhase;
        await persistAndRender();
      }
    });
  });

  document.querySelectorAll("[data-piece-form='brief']").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const piece = state.pieces.find(item => item.id === currentForm.dataset.pieceId);
      if (!piece) return;
      const formData = new FormData(currentForm);
      const previousIdeaId = piece.ideaId;
      piece.title = String(formData.get("title") || "").trim();
      piece.ideaId = String(formData.get("ideaId") || "").trim() || null;
      piece.brief.objective = String(formData.get("objective") || "").trim();
      piece.brief.promise = String(formData.get("promise") || "").trim();
      piece.due = String(formData.get("due") || "").trim();
      piece.platforms = getCheckedValues(currentForm, "platforms");
      piece.brief.platforms = [...piece.platforms];
      if (piece.ideaId && piece.ideaId !== previousIdeaId) {
        setIdeaStatus(piece.ideaId, "em_producao");
      }
      releaseIdeaIfUnused(previousIdeaId !== piece.ideaId ? previousIdeaId : null);
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-piece-form='script']").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const pieceId = currentForm.dataset.pieceId;
      const formData = new FormData(currentForm);
      const structureItemId = String(formData.get("structureItemId") || "").trim();
      const hookItemId = String(formData.get("hookItemId") || "").trim();
      const formatItemId = String(formData.get("formatItemId") || "").trim();
      const template = resolveTemplateKeyFromStructureId(structureItemId);
      upsertScriptFromForm(pieceId, template, currentForm);
      syncSingleLibraryComponent(pieceId, "script_structure", structureItemId, { required: true, used: true });
      syncSingleLibraryComponent(pieceId, "hook", hookItemId, { required: true, used: true });
      syncSingleLibraryComponent(pieceId, "format", formatItemId, { required: true, used: true });
      syncMultiLibraryComponents(pieceId, "cta", getCheckedValues(currentForm, "ctaIds"), { required: true, used: true });
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-script-structure-select]").forEach(input => {
    const structureInput = /** @type {HTMLInputElement} */ (input);
    structureInput.addEventListener("change", async () => {
      const pieceId = structureInput.dataset.scriptStructureSelect;
      if (!pieceId) return;
      const form = /** @type {HTMLFormElement | null} */ (structureInput.closest("form"));
      const script = getOrCreateScript(pieceId);
      const previousTemplate = script.template;
      if (form) {
        upsertScriptFromForm(pieceId, previousTemplate, form);
      }
      const structureItemId = structureInput.value;
      const template = resolveTemplateKeyFromStructureId(structureItemId);
      if (template !== previousTemplate) {
        script.template = template;
        script.fields = getTemplateDefaults(template);
      }
      syncSingleLibraryComponent(pieceId, "script_structure", structureItemId, { required: true, used: true });
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-piece-form='script']").forEach(form => {
    const scriptForm = /** @type {HTMLFormElement} */ (form);
    const pieceId = scriptForm.dataset.pieceId;
    if (!pieceId) return;

    scriptForm.querySelector('[name="hookItemId"]')?.addEventListener("change", () => {
      const hookInput = /** @type {HTMLInputElement} */ (scriptForm.querySelector('[name="hookItemId"]'));
      syncSingleLibraryComponent(pieceId, "hook", hookInput.value.trim(), { required: true, used: true });
    });

    scriptForm.querySelector('[name="formatItemId"]')?.addEventListener("change", () => {
      const formatInput = /** @type {HTMLInputElement} */ (scriptForm.querySelector('[name="formatItemId"]'));
      syncSingleLibraryComponent(pieceId, "format", formatInput.value.trim(), { required: true, used: true });
    });

    scriptForm.addEventListener("change", event => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target instanceof HTMLInputElement && target.name === "ctaIds") {
        syncMultiLibraryComponents(pieceId, "cta", getCheckedValues(scriptForm, "ctaIds"), { required: true, used: true });
      }
    });
  });

  document.querySelectorAll("[data-piece-form='capture']").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const piece = state.pieces.find(item => item.id === currentForm.dataset.pieceId);
      if (!piece) return;
      const formData = new FormData(currentForm);
      piece.capture.driveUrl = String(formData.get("driveUrl") || "").trim();
      syncMultiLibraryComponents(piece.id, "camera_angle", getCheckedValues(currentForm, "cameraAngleIds"), { required: true, used: true });
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-piece-form='edit']").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const piece = state.pieces.find(item => item.id === currentForm.dataset.pieceId);
      if (!piece) return;
      const formData = new FormData(currentForm);
      syncSingleLibraryComponent(piece.id, "music", String(formData.get("musicItemId") || "").trim(), { used: Boolean(formData.get("musicItemId")) });
      syncSingleLibraryComponent(piece.id, "sound_effect", String(formData.get("soundEffectItemId") || "").trim(), { used: Boolean(formData.get("soundEffectItemId")) });
      const usedHeaderIds = getCheckedValues(currentForm, "usedHeaderIds");
      getHeaderComponents(piece.id).forEach(component => {
        component.used = usedHeaderIds.includes(component.id);
      });
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-piece-form='distribution']").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const piece = state.pieces.find(item => item.id === currentForm.dataset.pieceId);
      if (!piece) return;
      const formData = new FormData(currentForm);
      const igMediaId = String(formData.get("igMediaId") || "").trim();
      const permalink = normalizePermalinkValue(String(formData.get("permalink") || ""));

      if (permalink) {
        const duplicatePiece = findPieceWithDuplicatePermalink(permalink, piece.id);
        if (duplicatePiece) {
          const confirmed = await openConfirm({
            title: "Permalink duplicado",
            message: `Este permalink já está vinculado à peça "${duplicatePiece.title}". Deseja continuar mesmo assim?`,
            confirmLabel: "Continuar",
            cancelLabel: "Cancelar"
          });
          if (!confirmed) return;
        }

        if (isPermalinkSyncedInInstagram(permalink)) {
          await openConfirm({
            title: "Permalink sincronizado",
            message: "Este permalink já foi sincronizado com os insights. Os dados aparecerão nos cards abaixo.",
            confirmLabel: "Entendi",
            cancelLabel: "Fechar"
          });
        }
      }

      if (!igMediaId && permalink) {
        const detectedMediaId = findInstagramMediaIdForPermalink(instagramDashboard.contentItems, permalink);
        if (detectedMediaId) {
          piece.distribution.igMediaId = detectedMediaId;
        }
      }

      piece.distribution.igMediaId = igMediaId || piece.distribution.igMediaId || "";
      piece.distribution.permalink = permalink;
      upsertPublicationForPiece(piece, permalink);
      await persistAndRender({ reloadInstagram: true });

      const linkedItems = getPieceInstagramItems(piece.id);
      if (permalink && !linkedItems.length) {
        showTransientNotice(
          "Vínculo não encontrado",
          "Salvamos o permalink, mas nenhuma mídia do Instagram bateu com essa URL. Confira se o link é do reel/post correto e clique em Atualizar insights."
        );
      } else if (linkedItems.length) {
        showTransientNotice(
          "Vínculo confirmado",
          "Peça associada à mídia do Instagram. Métricas e componentes usados passam a refletir os insights."
        );
      }
    });
  });

  document.querySelectorAll("[data-permalink-input]").forEach(inputElement => {
    const input = /** @type {HTMLInputElement} */ (inputElement);
    const pieceId = input.dataset.permalinkInput || "";
    const refreshHint = () => updatePermalinkDuplicateHint(input, pieceId);
    input.addEventListener("input", refreshHint);
    input.addEventListener("change", refreshHint);
  });

  document.querySelectorAll("[data-add-component]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const pieceId = currentForm.dataset.addComponent;
      const formData = new FormData(currentForm);
      const slot = String(formData.get("slot") || "");
      if (!pieceId || !pieceComponentSlots.includes(slot)) return;
      state.pieceComponents.push({
        id: createId("component"),
        pieceId,
        libraryItemId: String(formData.get("libraryItemId") || "").trim() || null,
        slot,
        required: requiredSlots.includes(slot),
        used: false,
        notes: String(formData.get("notes") || "").trim(),
        orderIndex: getPieceComponents(pieceId, slot).length
      });
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-component-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const component = state.pieceComponents.find(item => item.id === currentForm.dataset.componentForm);
      if (!component) return;
      const formData = new FormData(currentForm);
      component.required = formData.get("required") === "on";
      component.used = formData.get("used") === "on";
      component.notes = String(formData.get("notes") || "").trim();
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-remove-component]").forEach(button => {
    const removeButton = /** @type {HTMLButtonElement} */ (button);
    removeButton.addEventListener("click", async () => {
      const componentId = removeButton.dataset.removeComponent;
      if (!componentId) return;
      if (!(await runRemoteDelete(() => deletePieceComponentRemote(componentId)))) return;
      state.pieceComponents = state.pieceComponents.filter(item => item.id !== componentId);
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-script-generate]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", async () => {
      const piece = state.pieces.find(item => item.id === actionButton.dataset.scriptGenerate);
      if (!piece) return;
      if (!(await confirmScriptAiGeneration(piece, "script"))) return;
      await generateScriptWithAi(piece.id, "script");
    });
  });

  document.querySelectorAll("[data-script-improve]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", async () => {
      const piece = state.pieces.find(item => item.id === actionButton.dataset.scriptImprove);
      if (!piece) return;
      syncScriptDraftFromForm(piece.id);
      if (!(await confirmScriptAiGeneration(piece, "improve"))) return;
      await generateScriptWithAi(piece.id, "improve");
    });
  });

  document.querySelectorAll("[data-delete-piece]").forEach(button => {
    const deleteButton = /** @type {HTMLButtonElement} */ (button);
    deleteButton.addEventListener("click", async () => {
      const pieceId = deleteButton.dataset.deletePiece;
      if (!pieceId) return;
      const confirmed = await openConfirm({
        title: "Excluir peça",
        message: "Excluir esta peça e os vínculos relacionados?",
        confirmLabel: "Excluir",
        danger: true
      });
      if (!confirmed) return;
      if (!(await runRemoteDelete(() => deletePieceRemote(pieceId)))) return;
      const removedPiece = state.pieces.find(item => item.id === pieceId);
      state.pieces = state.pieces.filter(item => item.id !== pieceId);
      state.scripts = state.scripts.filter(item => item.pieceId !== pieceId);
      state.pieceComponents = state.pieceComponents.filter(item => item.pieceId !== pieceId);
      state.texts = state.texts.filter(item => item.pieceId !== pieceId);
      state.files = state.files.filter(item => item.pieceId !== pieceId);
      state.publications = state.publications.filter(item => item.pieceId !== pieceId);
      releaseIdeaIfUnused(removedPiece?.ideaId);
      if (selectedPieceId === pieceId) {
        selectedPieceId = state.pieces[0]?.id || null;
      }
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-hook-type-filter]").forEach(control => {
    control.querySelectorAll("[data-hook-filter]").forEach(buttonElement => {
      const button = /** @type {HTMLButtonElement} */ (buttonElement);
      button.addEventListener("click", () => {
        hookTypeFilter = button.dataset.hookFilter || "all";
        render();
      });
    });
  });

  document.querySelectorAll("[data-quick-add-library]").forEach(button => {
    const addButton = /** @type {HTMLButtonElement} */ (button);
    addButton.addEventListener("click", async () => {
      const category = addButton.dataset.quickAddLibrary;
      if (!category) return;
      const item = await quickAddLibraryItem(category);
      if (item) {
        pendingLibrarySelection = { category, itemId: item.id };
      }
      await persistAndRender();
    });
  });
}

function attachTextEvents() {
  document.querySelector("[data-open-manual-caption]")?.addEventListener("click", () => {
    manualCaptionOpen = true;
    captionGeneratorOpen = false;
    render();
  });

  document.querySelector("[data-open-caption-generator]")?.addEventListener("click", () => {
    captionGeneratorOpen = true;
    manualCaptionOpen = false;
    render();
  });

  document.querySelector("[data-cancel-manual-caption]")?.addEventListener("click", () => {
    manualCaptionOpen = false;
    render();
  });

  document.querySelector("[data-cancel-caption-generator]")?.addEventListener("click", () => {
    captionGeneratorOpen = false;
    render();
  });

  const manualCaptionForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#manualCaptionForm"));
  manualCaptionForm?.addEventListener("submit", event => {
    event.preventDefault();
    const formData = new FormData(manualCaptionForm);
    const pieceId = String(formData.get("pieceId") || "").trim();
    if (!pieceId) return;

    const existing = getPieceCaption(pieceId);
    if (existing) {
      manualCaptionOpen = false;
      manualCaptionDraft = null;
      expandedCaptionPieceId = pieceId;
      render();
      return;
    }

    manualCaptionDraft = createEmptyCaptionForPiece(pieceId);
    manualCaptionOpen = false;
    expandedCaptionPieceId = pieceId;
    captionPlatformTabs[pieceId] = getCaptionPlatforms(manualCaptionDraft)[0] || "instagram";
    render();
  });

  const generatorForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#captionGeneratorForm"));
  generatorForm?.addEventListener("submit", event => {
    event.preventDefault();
    const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
    void generateCaptionsWithAi(currentForm);
  });

  generatorForm?.querySelector('input[name="pieceId"]')?.addEventListener("change", event => {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget);
    selectedPieceId = input.value || null;
    captionDraft = null;
    expandedCaptionPieceId = null;
    render();
  });

  document.querySelectorAll("[data-caption-toggle]").forEach(button => {
    const toggleButton = /** @type {HTMLButtonElement} */ (button);
    toggleButton.addEventListener("click", () => {
      const pieceId = toggleButton.dataset.captionToggle || "";
      expandedCaptionPieceId = expandedCaptionPieceId === pieceId ? null : pieceId;
      render();
    });
  });

  document.querySelectorAll("[data-caption-platform-tab]").forEach(button => {
    const tabButton = /** @type {HTMLButtonElement} */ (button);
    tabButton.addEventListener("click", () => {
      const pieceId = tabButton.dataset.captionPieceTab || "";
      const platform = tabButton.dataset.captionPlatformTab || "";
      if (!pieceId || !platform) return;
      captionPlatformTabs[pieceId] = platform;
      render();
    });
  });

  document.querySelectorAll("[data-caption-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const pieceId = currentForm.dataset.captionPiece || null;
      if (!pieceId) return;
      const mode = currentForm.dataset.captionForm || "saved";
      const formData = new FormData(currentForm);
      const activePlatform = getActiveCaptionPlatformFromForm(currentForm);
      const formSnapshot = snapshotSingleCaptionForm(currentForm);
      upsertPieceCaption(pieceId, buildCaptionPayloadForPlatform(activePlatform, formData), currentForm.dataset.captionId || null);
      if (mode === "draft" || mode === "manual") {
        pendingSavedCaptionRestore = {
          pieceId,
          fields: formSnapshot
        };
      }
      captionDraft = null;
      manualCaptionDraft = null;
      expandedCaptionPieceId = pieceId;
      await persistAndRender();
    });
  });

  document.querySelector("[data-discard-caption-draft]")?.addEventListener("click", () => {
    captionDraft = null;
    expandedCaptionPieceId = null;
    render();
  });

  document.querySelector("[data-discard-manual-caption]")?.addEventListener("click", () => {
    manualCaptionDraft = null;
    expandedCaptionPieceId = null;
    render();
  });

  document.querySelectorAll("[data-delete-caption]").forEach(button => {
    const deleteButton = /** @type {HTMLButtonElement} */ (button);
    deleteButton.addEventListener("click", async () => {
      const captionId = deleteButton.dataset.deleteCaption;
      const caption = state.texts.find(item => item.id === captionId);
      if (!caption?.pieceId) return;
      const confirmed = await openConfirm({
        title: "Excluir legendas",
        message: "Excluir este pacote de legendas do conteúdo?",
        confirmLabel: "Excluir",
        danger: true
      });
      if (!confirmed) return;
      if (!(await runRemoteDelete(() => deleteTextsByPieceRemote(caption.pieceId)))) return;
      state.texts = state.texts.filter(item => item.pieceId !== caption.pieceId);
      if (expandedCaptionPieceId === caption.pieceId) {
        expandedCaptionPieceId = null;
      }
      delete captionPlatformTabs[caption.pieceId];
      if (captionDraft?.pieceId === caption.pieceId) {
        captionDraft = null;
      }
      if (manualCaptionDraft?.pieceId === caption.pieceId) {
        manualCaptionDraft = null;
      }
      await persistAndRender();
    });
  });
}

function attachLibraryEvents() {
  const libraryForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#libraryForm"));
  libraryForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
    const formData = new FormData(currentForm);
    const category = String(formData.get("category") || currentLibraryCategory);
    const existing = state.library.find(item => item.id === String(formData.get("libraryItemId") || "").trim());
    if (category === "estrutura_roteiro" && !existing) {
      return;
    }
    const nextItem = existing || {
      id: createUuid(),
      createdAt: new Date().toISOString(),
      metadata: {}
    };
    Object.assign(nextItem, {
      name: String(formData.get("name") || "").trim(),
      category,
      notes: String(formData.get("notes") || "").trim(),
      example: String(formData.get("example") || "").trim(),
      context: splitCommaList(formData.get("context")),
      platforms: getCheckedValues(currentForm, "platforms"),
      metadata: existing?.metadata || nextItem.metadata || {}
    });
    if (!existing) {
      state.library.unshift(nextItem);
    }
    editingLibraryItemId = null;
    libraryFormOpen = false;
    await persistAndRender();
  });

  document.querySelector("#cancelLibraryEdit")?.addEventListener("click", () => {
    editingLibraryItemId = null;
    libraryFormOpen = false;
    render();
  });

  document.querySelector("[data-open-library-form]")?.addEventListener("click", () => {
    libraryFormOpen = true;
    editingLibraryItemId = null;
    render();
  });

  document.querySelectorAll("[data-library-category]").forEach(button => {
    const categoryButton = /** @type {HTMLButtonElement} */ (button);
    categoryButton.addEventListener("click", () => {
      currentLibraryCategory = categoryButton.dataset.libraryCategory || currentLibraryCategory;
      libraryFormOpen = false;
      editingLibraryItemId = null;
      render();
    });
  });

  document.querySelectorAll("[data-edit-library]").forEach(button => {
    const editButton = /** @type {HTMLButtonElement} */ (button);
    editButton.addEventListener("click", () => {
      editingLibraryItemId = editButton.dataset.editLibrary || null;
      libraryFormOpen = true;
      render();
    });
  });

  document.querySelectorAll("[data-delete-library]").forEach(button => {
    const deleteButton = /** @type {HTMLButtonElement} */ (button);
    deleteButton.addEventListener("click", async () => {
      const itemId = deleteButton.dataset.deleteLibrary;
      if (!itemId) return;
      const confirmed = await openConfirm({
        title: "Excluir item",
        message: "Excluir este item da biblioteca?",
        confirmLabel: "Excluir",
        danger: true
      });
      if (!confirmed) return;
      if (!(await runRemoteDelete(() => deleteLibraryItemRemote(itemId)))) return;
      state.library = state.library.filter(item => item.id !== itemId);
      state.pieceComponents = state.pieceComponents.map(component => component.libraryItemId === itemId ? { ...component, libraryItemId: null } : component);
      if (editingLibraryItemId === itemId) {
        editingLibraryItemId = null;
        libraryFormOpen = false;
      }
      await persistAndRender();
    });
  });
}

function attachDashboardEvents() {
  document.querySelectorAll("[data-instagram-view]").forEach(button => {
    const viewButton = /** @type {HTMLButtonElement} */ (button);
    viewButton.addEventListener("click", () => {
      instagramView = viewButton.dataset.instagramView || "overview";
      render();
    });
  });

  document.querySelectorAll("[data-content-type]").forEach(button => {
    const typeButton = /** @type {HTMLButtonElement} */ (button);
    typeButton.addEventListener("click", () => {
      instagramContentType = typeButton.dataset.contentType || "all";
      render();
    });
  });

  document.querySelectorAll("[data-date-preset]").forEach(button => {
    const presetButton = /** @type {HTMLButtonElement} */ (button);
    presetButton.addEventListener("click", () => {
      instagramDatePreset = presetButton.dataset.datePreset || "30d";
      render();
    });
  });

  const startDateInput = /** @type {HTMLInputElement | null} */ (document.querySelector("#instagramStartDate"));
  const endDateInput = /** @type {HTMLInputElement | null} */ (document.querySelector("#instagramEndDate"));
  startDateInput?.addEventListener("change", () => {
    instagramCustomStart = startDateInput.value;
    render();
  });
  endDateInput?.addEventListener("change", () => {
    instagramCustomEnd = endDateInput.value;
    render();
  });

  const syncButton = /** @type {HTMLButtonElement | null} */ (document.querySelector("[data-sync-instagram]"));
  syncButton?.addEventListener("click", async () => {
    isInstagramSyncing = true;
    render();
    try {
      await syncInstagramInsights();
      await refreshInstagramMediaLinks(state.pieces, state.publications);
      instagramDashboard = await loadInstagramDashboard();
    } catch (error) {
      console.error(error);
    } finally {
      isInstagramSyncing = false;
      render();
    }
  });

  const reloadButton = /** @type {HTMLButtonElement | null} */ (document.querySelector("[data-reload-state]"));
  reloadButton?.addEventListener("click", async () => {
    isReloadingState = true;
    render();
    try {
      const previousPieceId = selectedPieceId;
      state = await reloadStateFromSupabase();
      selectedPieceId = state.pieces.some(piece => piece.id === previousPieceId)
        ? previousPieceId
        : state.pieces[0]?.id || null;
      instagramDashboard = await loadInstagramDashboard();
      contentArea.insertAdjacentHTML("afterbegin", `<div class="empty-state compact"><strong>Dados recarregados.</strong><span>Estado atualizado a partir do Supabase.</span></div>`);
    } catch (error) {
      console.error(error);
      contentArea.insertAdjacentHTML("afterbegin", `<div class="empty-state compact"><strong>Não foi possível recarregar os dados.</strong><span>${escapeHtml(error instanceof Error ? error.message : "Verifique a conexão e tente novamente.")}</span></div>`);
    } finally {
      isReloadingState = false;
      render();
    }
  });
}

function bindGlobalEvents() {
  sidebarToggle?.addEventListener("click", () => {
    isSidebarCollapsed = !isSidebarCollapsed;
    shell.classList.toggle("sidebar-collapsed", isSidebarCollapsed);
    sidebarToggle.setAttribute("aria-expanded", String(!isSidebarCollapsed));
  });

  globalSearch.addEventListener("input", () => render());

  newIdeaBtn.addEventListener("click", () => setSection("ideas"));
  newPieceBtn.addEventListener("click", async () => {
    const piece = createBlankPiece();
    state.pieces.unshift(piece);
    state.scripts.unshift(createScriptForPiece(piece.id, "storytelling"));
    selectedPieceId = piece.id;
    activePiecePhase = "brief";
    setSection("pieces");
    await persistAndRender();
  });

  window.addEventListener("hashchange", () => {
    currentSection = sanitizeSection(window.location.hash.replace("#", "") || "dashboard");
    render();
  });

  document.addEventListener("click", event => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.closest("[data-custom-select]")) {
      closeAllCustomSelects();
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themePreference === "system") {
      applyTheme();
    }
  });
}

function createPieceFromIdea(idea) {
  const piece = {
    id: createId("piece"),
    title: idea.title,
    ideaId: idea.id,
    platforms: ["instagram", "tiktok", "shorts"],
    currentPhase: "brief",
    brief: {
      objective: "",
      promise: idea.description || idea.angle || "",
      platforms: ["instagram", "tiktok", "shorts"]
    },
    capture: {
      driveUrl: ""
    },
    edit: {
      headerRecommendation: "",
      headerSuggestions: []
    },
    distribution: {
      igMediaId: "",
      permalink: ""
    },
    due: "",
    owner: "",
    textIds: [],
    publicationIds: [],
    scriptId: null,
    componentIds: []
  };

  idea.status = "em_producao";
  state.pieces.unshift(piece);
  state.scripts.unshift(createScriptForPiece(piece.id, "storytelling"));
  selectedPieceId = piece.id;
  activePiecePhase = "brief";
}

function createBlankPiece() {
  return {
    id: createId("piece"),
    title: "Nova peça",
    ideaId: null,
    platforms: ["instagram", "tiktok", "shorts"],
    currentPhase: "brief",
    brief: {
      objective: "",
      promise: "",
      platforms: ["instagram", "tiktok", "shorts"]
    },
    capture: {
      driveUrl: ""
    },
    edit: {
      headerRecommendation: "",
      headerSuggestions: []
    },
    distribution: {
      igMediaId: "",
      permalink: ""
    },
    due: "",
    owner: "",
    textIds: [],
    publicationIds: [],
    scriptId: null,
    componentIds: []
  };
}

function createScriptForPiece(pieceId, template) {
  return {
    id: createId("script"),
    pieceId,
    template,
    fields: getTemplateDefaults(template),
    updatedAt: new Date().toISOString()
  };
}

function createLocalScript(pieceId) {
  return {
    id: `local-${pieceId}`,
    pieceId,
    template: "storytelling",
    fields: getTemplateDefaults("storytelling")
  };
}

function getOrCreateScript(pieceId) {
  let script = state.scripts.find(item => item.pieceId === pieceId);
  if (!script) {
    script = createScriptForPiece(pieceId, "storytelling");
    state.scripts.unshift(script);
  }
  return script;
}

function getScriptByPiece(pieceId) {
  return state.scripts.find(item => item.pieceId === pieceId) || null;
}

function upsertScriptFromForm(pieceId, template, form) {
  const script = getOrCreateScript(pieceId);
  script.template = template;
  script.fields = readScriptFields(template, form);
  script.updatedAt = new Date().toISOString();
}

function buildScriptFromIdea(template, piece, idea, existingFields = {}) {
  const baseText = [
    piece.title,
    piece.brief.objective,
    piece.brief.promise,
    idea?.description,
    idea?.angle,
    ...Object.values(existingFields || {})
  ].filter(Boolean).join(" ");
  if (template === "educacional") {
    return {
      problema: summarizeText(String(existingFields.problema || baseText), 110),
      solucao: existingFields.solucao || `Mostre uma solução prática ligada a ${piece.title.toLowerCase()}.`,
      prova: "Inclua prova visual, bastidores ou resultado concreto.",
      cta: "Salve para aplicar depois."
    };
  }

  if (template === "tutorial") {
    return {
      steps: (existingFields.steps || []).length ? existingFields.steps : [
        `1. Abra com ${piece.title.toLowerCase()}.`,
        "2. Explique o passo principal com exemplo real.",
        "3. Feche com CTA objetivo."
      ]
    };
  }

  if (template === "b_roll_video_humor") {
    return {
      textHook: existingFields.textHook || summarizeText(piece.title || piece.brief.promise || "Texto de abertura com humor observacional", 90),
      situacaoCotidiana: existingFields.situacaoCotidiana || summarizeText(baseText, 140),
      viradaOuContraste: existingFields.viradaOuContraste || "Mostre o contraste entre expectativa e realidade em um detalhe visual.",
      cenaPrincipalBroll: existingFields.cenaPrincipalBroll || "B-roll principal mostrando a situação cotidiana em ação.",
      cenaDeReforco: existingFields.cenaDeReforco || "Insira um segundo b-roll que amplifique a identificação ou o desconforto engraçado.",
      fechamentoVisual: existingFields.fechamentoVisual || "Feche com a imagem mais reconhecível ou absurda da situação."
    };
  }

  if (template === "voiceover_b_roll_humor") {
    return {
      textHook: existingFields.textHook || summarizeText(piece.title || piece.brief.promise || "Abertura curta na tela", 90),
      contexto: existingFields.contexto || "Apresente rapidamente a situação antes da narração avançar.",
      oQueAconteceu: existingFields.oQueAconteceu || summarizeText(baseText, 150),
      detalheObservacional: existingFields.detalheObservacional || "Destaque o detalhe cotidiano que faz o público pensar 'isso acontece comigo'.",
      virada: existingFields.virada || "Conte o momento em que a situação muda e fica engraçada.",
      fechamento: existingFields.fechamento || "Feche com uma conclusão curta, seca e reconhecível."
    };
  }

  return {
    oQueAconteceu: summarizeText(baseText, 120),
    onde: "Contexto principal da cena.",
    quando: "Momento que deu origem ao vídeo.",
    quemEstava: "Pessoas envolvidas ou personagem principal.",
    comoFoi: "Sequência principal do acontecimento.",
    desfecho: "Resultado ou virada final.",
    aprendizado: "Lição prática para quem assiste."
  };
}

function improveScriptFields(template, fields, piece) {
  const next = structuredClone(fields);
  if (template === "tutorial") {
    next.steps = (fields.steps || []).map((step, index) => `${index + 1}. ${String(step || "").replace(/^\d+\.\s*/, "").trim() || `Passo ${index + 1} de ${piece.title.toLowerCase()}`}`);
    return next;
  }

  Object.keys(next).forEach(key => {
    const value = String(next[key] || "").trim();
    next[key] = value ? `${value} Feche esse bloco com clareza visual e ritmo curto.` : `Preencha este ponto com um detalhe concreto de ${piece.title.toLowerCase()}.`;
  });
  return next;
}

async function confirmScriptAiGeneration(piece, mode) {
  syncScriptDraftFromForm(piece.id);
  const script = getScriptByPiece(piece.id);
  const title = String(piece.title || "").trim();
  const objective = String(piece.brief?.objective || "").trim();
  const promise = String(piece.brief?.promise || "").trim();
  const hasScript = Boolean(script && hasScriptContent(script));
  const insufficientMessage = "O Brief e o Roteiro ainda não têm informações salvas. Preencha ao menos o título, a promessa do conteúdo e os campos do roteiro antes de gerar.";

  if ((!title && !promise && !hasScript) || !title || !promise || !hasScript) {
    await openConfirm({
      title: "Informações insuficientes",
      message: insufficientMessage,
      confirmLabel: "Entendi",
      singleAction: true
    });
    return false;
  }

  const templateLabel = getStructureLabel(script?.template || "storytelling");
  const confirmTitle = mode === "improve" ? "Melhorar roteiro com IA" : "Gerar roteiro com IA";
  const confirmLabel = mode === "improve" ? "Melhorar agora" : "Gerar agora";

  return openConfirm({
    title: confirmTitle,
    message: `A IA vai usar:\n• Título: ${title}\n• Objetivo: ${objective || "Não informado"}\n• Promessa: ${promise}\n• Template: ${templateLabel}\n\nDeseja prosseguir ou prefere ajustar algo antes?`,
    confirmLabel,
    cancelLabel: "Ajustar antes"
  });
}

async function generateScriptWithAi(pieceId, mode) {
  const piece = state.pieces.find(item => item.id === pieceId);
  if (!piece) return;
  syncScriptDraftFromForm(pieceId);
  const idea = state.ideas.find(item => item.id === piece.ideaId) || null;
  const script = getOrCreateScript(piece.id);
  const scriptSummary = getScriptSummary(piece.id);
  const scriptForm = /** @type {HTMLFormElement | null} */ (
    document.querySelector(`form[data-piece-form="script"][data-piece-id="${pieceId}"]`)
  );
  const aiOptions = readScriptAiOptions(scriptForm);
  const structure = buildScriptStructurePayload(script.template);

  aiDrafts.script = {
    pieceId,
    mode,
    loading: true,
    text: "",
    error: ""
  };
  render();

  const type = mode === "improve" ? "improve" : "script";
  const libraryPayload = {
    hooks: buildLibraryAiOptions("hook"),
    formats: buildLibraryAiOptions("format"),
    ctas: buildLibraryAiOptions("cta")
  };
  const data = mode === "improve"
    ? {
      type: "script",
      content: {
        template: script.template,
        structure,
        fields: script.fields,
        script_text: scriptSummary || buildScriptSummaryFromFields(script.fields)
      },
      context: {
        title: piece.title,
        objective: piece.brief.objective,
        platform: piece.platforms,
        idea: idea ? { title: idea.title, angle: idea.angle, description: idea.description } : null,
        tone: aiOptions.tone,
        scene_format: aiOptions.sceneFormat,
        library: libraryPayload
      }
    }
    : {
      template: script.template,
      structure,
      fields: script.fields,
      title: piece.title,
      objective: piece.brief.objective,
      idea: idea ? { title: idea.title, angle: idea.angle, description: idea.description } : null,
      tone: aiOptions.tone,
      scene_format: aiOptions.sceneFormat,
      library: libraryPayload
    };

  try {
    await streamGenerate({
      type,
      data,
      onChunk: (_chunk, fullText) => {
        aiDrafts.script = {
          ...aiDrafts.script,
          loading: true,
          text: fullText
        };
        render();
      },
      onDone: fullText => {
        const parsed = parseAiJson(fullText);
        applyScriptAiResult(piece.id, parsed);
        skipPieceFormPhases.add(`${piece.id}:script`);
        aiDrafts.script = {
          ...aiDrafts.script,
          loading: false,
          text: parsed?.script_text || fullText,
          error: ""
        };
      },
      onError: error => {
        aiDrafts.script = {
          ...aiDrafts.script,
          loading: false,
          error: error.message
        };
        render();
      }
    });
    await persistAndRender();
  } catch {
    render();
  }
}

async function generateCaptionsWithAi(form) {
  const formData = new FormData(form);
  const pieceId = String(formData.get("pieceId") || "").trim() || null;
  const platforms = getCheckedValues(form, "platforms");
  const piece = state.pieces.find(item => item.id === pieceId) || null;
  if (!piece) return;

  aiDrafts.caption = {
    pieceId,
    loading: true,
    text: "",
    error: ""
  };
  captionDraft = null;
  render();

  try {
    await streamGenerate({
      type: "caption",
      data: {
        title: piece.title,
        script: getScriptSummary(piece.id),
        objective: piece.brief.objective,
        platforms,
        tone: {
          emojis: String(formData.get("emojiTone") || "normal"),
          enthusiasm: String(formData.get("enthusiasmTone") || "moderado"),
          voice: String(formData.get("voiceTone") || "casual")
        },
        hashtags: assistantGateway.collectCaptionContext(state).hashtags.map(item => item.label),
        seo_terms: assistantGateway.collectCaptionContext(state).seoTerms.map(item => item.label)
      },
      onChunk: () => {},
      onDone: fullText => {
        const parsed = parseAiJson(fullText);
        captionDraft = buildCaptionDraftFromAi(parsed, pieceId, platforms);
        captionGeneratorOpen = false;
        expandedCaptionPieceId = pieceId;
        captionPlatformTabs[pieceId] = platforms[0] || "instagram";
        aiDrafts.caption = {
          ...aiDrafts.caption,
          loading: false,
          text: fullText,
          error: ""
        };
      },
      onError: error => {
        aiDrafts.caption = {
          ...aiDrafts.caption,
          loading: false,
          error: error.message
        };
        render();
      }
    });
    render();
  } catch {
    render();
  }
}

function applyScriptAiResult(pieceId, parsed) {
  const piece = state.pieces.find(item => item.id === pieceId);
  const script = getOrCreateScript(pieceId);
  if (!piece || !parsed) return;

  if (parsed.fields && typeof parsed.fields === "object") {
    script.fields = normalizeAiScriptFields(script.template, parsed.fields);
  }

  const hookId = resolveSuggestedLibraryIdList("gancho", parsed.suggested_hook, parsed.suggested_hooks)[0];
  if (hookId) {
    syncSingleLibraryComponent(pieceId, "hook", hookId, { required: true, used: true });
  }

  const formatId = resolveSuggestedLibraryIdList("formato", parsed.suggested_format, parsed.suggested_formats)[0];
  if (formatId) {
    syncSingleLibraryComponent(pieceId, "format", formatId, { required: true, used: true });
  }

  if (Array.isArray(parsed.suggested_ctas)) {
    const ctaIds = resolveSuggestedLibraryIdList("cta", null, parsed.suggested_ctas);
    if (ctaIds.length) {
      syncSuggestedCtas(pieceId, ctaIds);
    }
  }

  if (Array.isArray(parsed.text_headers) || parsed.header_recommendation) {
    const headers = Array.isArray(parsed.text_headers)
      ? parsed.text_headers.map(item => ({ label: item.label || item.text || "", moment: item.moment || "" })).filter(item => item.label)
      : [];
    syncSuggestedHeaders(pieceId, headers, parsed.header_recommendation || "");
  }

  script.updatedAt = new Date().toISOString();
}

function buildCaptionDraftFromAi(parsed, pieceId, platforms) {
  const selectedPlatforms = platforms.length ? platforms : ["instagram", "tiktok", "shorts"];
  const youtube = parsed?.youtube || parsed?.platforms?.shorts || {};
  const legacyInstagram = parsed?.platforms?.instagram;
  const legacyTiktok = parsed?.platforms?.tiktok;

  return {
    pieceId,
    instagramCaption: selectedPlatforms.includes("instagram")
      ? String(parsed?.instagram || formatLegacyPlatformCaption(legacyInstagram) || "")
      : "",
    tiktokCaption: selectedPlatforms.includes("tiktok")
      ? String(parsed?.tiktok || formatLegacyPlatformCaption(legacyTiktok) || "")
      : "",
    ytTitle: selectedPlatforms.includes("shorts") ? String(youtube.title || youtube.yt_title || "") : "",
    ytDescription: selectedPlatforms.includes("shorts") ? String(youtube.description || youtube.yt_description || "") : "",
    ytTags: selectedPlatforms.includes("shorts") ? String(youtube.tags || youtube.yt_tags || "") : ""
  };
}

function formatLegacyPlatformCaption(data) {
  if (!data || typeof data !== "object") return "";
  const parts = [data.title, data.body].map(item => String(item || "").trim()).filter(Boolean);
  const tags = (Array.isArray(data.hashtags) ? data.hashtags : [])
    .map(tag => (String(tag).startsWith("#") ? tag : `#${tag}`))
    .join(" ");
  if (tags) parts.push(tags);
  return parts.join("\n\n");
}

function parseAiJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("A IA respondeu em um formato inesperado.");
  }
}

function normalizeAiScriptFields(template, fields) {
  return normalizeScriptFieldsForTemplate(template, fields);
}

function readScriptAiOptions(form) {
  const formData = form ? new FormData(form) : new FormData();
  return {
    tone: String(formData.get("scriptAiTone") || "normal"),
    sceneFormat: String(formData.get("scriptAiSceneFormat") || "numeradas")
  };
}

function buildScriptStructurePayload(templateKey) {
  return {
    key: templateKey,
    label: getStructureLabel(templateKey),
    fields: getStructureFieldDefs(templateKey).map(field => ({
      key: field.key,
      label: field.label,
      hint: field.hint || ""
    }))
  };
}

function filterHookLibraryItems(items) {
  if (hookTypeFilter === "all") return items;
  return items.filter(item => (item.metadata?.hookType || "visual") === hookTypeFilter);
}

function resolveTemplateKeyFromStructureId(structureItemId) {
  const structure = state.library.find(item => item.id === structureItemId);
  return resolveTemplateKeyFromLibraryItem(structure);
}

function normalizeHashtags(hashtags) {
  return (Array.isArray(hashtags) ? hashtags : [])
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .map(stripHash);
}

function countCaptionPieces(currentState = state) {
  return new Set((currentState.texts || []).map(text => text.pieceId).filter(Boolean)).size;
}

function getUnifiedCaptions() {
  const seen = new Set();
  return state.texts
    .filter(text => text.pieceId && !seen.has(text.pieceId) && seen.add(text.pieceId))
    .map(normalizeCaptionRecordApp)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function getPieceCaption(pieceId) {
  return getUnifiedCaptions().find(caption => caption.pieceId === pieceId) || null;
}

function normalizeCaptionRecordApp(text) {
  return {
    id: text.id,
    pieceId: text.pieceId,
    instagramCaption: text.instagramCaption || legacyInstagramCaptionApp(text),
    tiktokCaption: text.tiktokCaption || legacyTiktokCaptionApp(text),
    ytTitle: text.ytTitle || "",
    ytDescription: text.ytDescription || "",
    ytTags: text.ytTags || "",
    updatedAt: text.updatedAt || ""
  };
}

function legacyInstagramCaptionApp(text) {
  if (text.platform !== "instagram") return "";
  const parts = [text.title, text.body].map(item => String(item || "").trim()).filter(Boolean);
  const tags = (text.hashtags || []).map(tag => (String(tag).startsWith("#") ? tag : `#${tag}`)).join(" ");
  if (tags) parts.push(tags);
  return parts.join("\n\n");
}

function legacyTiktokCaptionApp(text) {
  if (text.platform !== "tiktok") return "";
  const parts = [text.title, text.body].map(item => String(item || "").trim()).filter(Boolean);
  const tags = (text.hashtags || []).map(tag => (String(tag).startsWith("#") ? tag : `#${tag}`)).join(" ");
  if (tags) parts.push(tags);
  return parts.join("\n\n");
}

function createEmptyCaptionForPiece(pieceId) {
  return {
    id: createId("text"),
    pieceId,
    instagramCaption: "",
    tiktokCaption: "",
    ytTitle: "",
    ytDescription: "",
    ytTags: "",
    updatedAt: ""
  };
}

function upsertPieceCaption(pieceId, data, captionId = null) {
  const existing = state.texts.find(text => text.pieceId === pieceId) || null;
  const next = {
    ...(existing ? normalizeCaptionRecordApp(existing) : createEmptyCaptionForPiece(pieceId)),
    ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    updatedAt: new Date().toISOString()
  };

  if (existing) {
    Object.assign(existing, next);
    state.texts = state.texts.filter(item => item.pieceId !== pieceId || item.id === existing.id);
    return existing;
  }

  const created = {
    id: captionId || createId("text"),
    pieceId,
    platform: "instagram",
    title: findPieceTitle(pieceId),
    body: "",
    seoTerms: [],
    hashtags: [],
    ...next
  };
  state.texts.unshift(created);
  return created;
}

function buildCaptionPayloadForPlatform(platform, formData) {
  if (platform === "shorts") {
    return {
      ytTitle: String(formData.get("ytTitle") || "").trim(),
      ytDescription: String(formData.get("ytDescription") || "").trim(),
      ytTags: String(formData.get("ytTags") || "").trim()
    };
  }

  if (platform === "tiktok") {
    return {
      tiktokCaption: String(formData.get("tiktokCaption") || "").trim()
    };
  }

  return {
    instagramCaption: String(formData.get("instagramCaption") || "").trim()
  };
}

function getActiveCaptionPlatformFromForm(form) {
  const activeTab = form.querySelector(".caption-platform-tabs [data-caption-platform-tab].active");
  const activePlatform = /** @type {HTMLButtonElement | null} */ (activeTab);
  return activePlatform?.dataset.captionPlatformTab || "instagram";
}

function countCaptionHashtags(value) {
  return (String(value || "").match(/#[\w\u00C0-\u024f]+/gu) || []).length;
}

function findLibraryIdByName(category, name) {
  const token = normalizeToken(name);
  return state.library.find(item => item.category === category && normalizeToken(item.name) === token)?.id || null;
}

function resolveSuggestedLibraryId(category, candidate) {
  if (!candidate) return null;
  const id = typeof candidate === "string" ? candidate : candidate.id;
  const name = typeof candidate === "string" ? candidate : candidate.name;
  if (id && state.library.some(item => item.id === id && item.category === category)) return id;
  if (name) return findLibraryIdByName(category, name);
  return null;
}

function resolveSuggestedLibraryIdList(category, single, list) {
  const candidates = [];
  if (single) candidates.push(single);
  if (Array.isArray(list)) candidates.push(...list);
  return [...new Set(candidates.map(item => resolveSuggestedLibraryId(category, item)).filter(Boolean))];
}

function buildLibraryAiOptions(slot) {
  const category = libraryCategories.find(item => item.slot === slot)?.id;
  if (!category) return [];

  return getLibraryOptionsForSlot(slot)
    .map(item => ({
      id: item.id,
      name: item.name,
      notes: item.notes || "",
      example: item.example || "",
      hookType: item.metadata?.hookType || null,
      metrics: getLibraryItemMetrics(item.id, slot)
    }))
    .sort((left, right) => scoreLibraryMetrics(right.metrics) - scoreLibraryMetrics(left.metrics));
}

function getLibraryItemMetrics(libraryItemId, slot) {
  let count = 0;
  const metrics = createEmptyMetrics();
  for (const component of state.pieceComponents.filter(item => item.slot === slot && item.used && item.libraryItemId === libraryItemId)) {
    count += 1;
    addInstagramMetrics(metrics, getPieceInstagramMetrics(component.pieceId));
  }
  return { uses: count, ...metrics };
}

function scoreLibraryMetrics(metrics) {
  return (metrics.views || 0) * 1.2 + (metrics.reach || 0) + (metrics.saves || 0) * 2 + (metrics.shares || 0) * 1.5 + (metrics.likes || 0) * 0.4;
}

function snapshotPieceForms() {
  const snapshots = new Map();
  document.querySelectorAll("form[data-piece-form]").forEach(formElement => {
    const form = /** @type {HTMLFormElement} */ (formElement);
    const pieceId = form.dataset.pieceId || "";
    const phase = form.dataset.pieceForm || "";
    if (!pieceId || !phase) return;

    const fields = {};
    form.querySelectorAll("input, textarea, select").forEach(element => {
      if (element instanceof HTMLInputElement) {
        if (!element.name || element.type === "submit" || element.type === "button") return;

        if (element.type === "checkbox") {
          if (!fields[element.name]) fields[element.name] = [];
          if (element.checked) fields[element.name].push(element.value);
          return;
        }

        if (element.type === "radio") {
          if (element.checked) fields[element.name] = element.value;
          return;
        }

        fields[element.name] = element.value;
        return;
      }

      if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (!element.name) return;
        fields[element.name] = element.value;
      }
    });

    snapshots.set(`${pieceId}:${phase}`, fields);
  });
  return snapshots;
}

function restorePieceForms(snapshots, skipKeys = new Set()) {
  snapshots.forEach((fields, key) => {
    if (skipKeys.has(key)) return;
    const [pieceId, phase] = key.split(":");
    const form = document.querySelector(`form[data-piece-form="${phase}"][data-piece-id="${pieceId}"]`);
    if (!form) return;

    Object.entries(fields).forEach(([name, value]) => {
      if (Array.isArray(value)) {
        form.querySelectorAll(`input[type="checkbox"][name="${name}"]`).forEach(checkbox => {
          const input = /** @type {HTMLInputElement} */ (checkbox);
          input.checked = value.includes(input.value);
        });
        return;
      }

      const element = form.querySelector(`[name="${name}"]`);
      if (!element) return;

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        element.value = String(value);
      }

      if (element instanceof HTMLInputElement && element.type === "hidden") {
        updateCustomSelectFromValue(element.closest("[data-custom-select]"), element.value);
      }
    });
  });
}

function snapshotCaptionForms() {
  const snapshots = new Map();
  document.querySelectorAll("form[data-caption-form]").forEach(formElement => {
    const form = /** @type {HTMLFormElement} */ (formElement);
    const pieceId = form.dataset.captionPiece || "";
    const mode = form.dataset.captionForm || "";
    if (!pieceId || !mode) return;

    snapshots.set(`${pieceId}:${mode}`, snapshotSingleCaptionForm(form));
  });
  return snapshots;
}

function snapshotSingleCaptionForm(form) {
  return {
    activePlatform: getActiveCaptionPlatformFromForm(form),
    instagramCaption: /** @type {HTMLTextAreaElement | null} */ (form.querySelector('[name="instagramCaption"]'))?.value || "",
    tiktokCaption: /** @type {HTMLTextAreaElement | null} */ (form.querySelector('[name="tiktokCaption"]'))?.value || "",
    ytTitle: /** @type {HTMLInputElement | null} */ (form.querySelector('[name="ytTitle"]'))?.value || "",
    ytDescription: /** @type {HTMLTextAreaElement | null} */ (form.querySelector('[name="ytDescription"]'))?.value || "",
    ytTags: /** @type {HTMLInputElement | null} */ (form.querySelector('[name="ytTags"]'))?.value || ""
  };
}

function restoreCaptionForms(snapshots) {
  snapshots.forEach((fields, key) => {
    const [pieceId, mode] = key.split(":");
    const form = /** @type {HTMLFormElement | null} */ (document.querySelector(`form[data-caption-form="${mode}"][data-caption-piece="${pieceId}"]`));
    if (!form) return;

    setCaptionFieldValue(form, "instagramCaption", fields.instagramCaption);
    setCaptionFieldValue(form, "tiktokCaption", fields.tiktokCaption);
    setCaptionFieldValue(form, "ytTitle", fields.ytTitle);
    setCaptionFieldValue(form, "ytDescription", fields.ytDescription);
    setCaptionFieldValue(form, "ytTags", fields.ytTags);

    if (fields.activePlatform) {
      captionPlatformTabs[pieceId] = fields.activePlatform;
    }
  });
}

function restorePendingSavedCaptionForm(snapshot) {
  const form = /** @type {HTMLFormElement | null} */ (document.querySelector(`form[data-caption-form="saved"][data-caption-piece="${snapshot.pieceId}"]`));
  if (!form) return;
  restoreCaptionForms(new Map([[`${snapshot.pieceId}:saved`, snapshot.fields]]));
}

function setCaptionFieldValue(form, name, value) {
  const element = form.querySelector(`[name="${name}"]`);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value || "";
  }
}

function updateCustomSelectFromValue(field, value) {
  if (!(field instanceof HTMLElement)) return;
  const hiddenInput = field.querySelector('input[type="hidden"]');
  const trigger = field.querySelector(".dropdown-trigger strong");
  const options = field.querySelectorAll(".dropdown-option");
  let label = "";
  options.forEach(option => {
    const optionButton = /** @type {HTMLButtonElement} */ (option);
    const isSelected = (optionButton.dataset.value || "") === value;
    optionButton.classList.toggle("selected", isSelected);
    if (isSelected) label = optionButton.dataset.label || "";
  });
  if (hiddenInput instanceof HTMLInputElement) hiddenInput.value = value;
  if (trigger instanceof HTMLElement) {
    trigger.textContent = label || trigger.textContent || "";
    trigger.classList.toggle("is-placeholder", !value);
  }
}

function applyPendingLibrarySelection() {
  if (!pendingLibrarySelection) return;
  const { category, itemId } = pendingLibrarySelection;
  pendingLibrarySelection = null;

  const targets = {
    gancho: { phase: "script", field: "hookItemId" },
    formato: { phase: "script", field: "formatItemId" },
    estrutura_roteiro: { phase: "script", field: "structureItemId" },
    cta: { phase: "script", field: "ctaIds", multiple: true },
    angulo_camera: { phase: "capture", field: "cameraAngleIds", multiple: true },
    musica: { phase: "edit", field: "musicItemId" },
    efeito_sonoro: { phase: "edit", field: "soundEffectItemId" }
  };
  const target = targets[category];
  if (!target) return;

  const pieceId = selectedPieceId;
  if (!pieceId) return;

  const form = document.querySelector(`form[data-piece-form="${target.phase}"][data-piece-id="${pieceId}"]`);
  if (!form) return;

  if (target.multiple) {
    const checkbox = form.querySelector(`input[type="checkbox"][name="${target.field}"][value="${itemId}"]`);
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  const input = form.querySelector(`[name="${target.field}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = itemId;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  updateCustomSelectFromValue(input.closest("[data-custom-select]"), itemId);
}

function buildLibraryPerformanceRows(category) {
  if (category === "text_header") {
    const usedHeaders = state.pieceComponents.filter(item => item.slot === "text_header" && item.used);
    if (!usedHeaders.length) return [];
    const metrics = usedHeaders.reduce((acc, component) => addInstagramMetrics(acc, getPieceInstagramMetrics(component.pieceId)), createEmptyMetrics());
    return [{
      label: "Headers de texto",
      count: usedHeaders.length,
      metrics
    }];
  }

  const rows = new Map();
  const slot = libraryCategories.find(item => item.id === category)?.slot;
  if (!slot) return [];

  for (const component of state.pieceComponents.filter(item => item.slot === slot && item.used && item.libraryItemId)) {
    const libraryItem = state.library.find(item => item.id === component.libraryItemId);
    if (!libraryItem) continue;
    const pieceMetrics = getPieceInstagramMetrics(component.pieceId);
    const entry = rows.get(libraryItem.id) || {
      label: libraryItem.name,
      count: 0,
      metrics: createEmptyMetrics()
    };
    entry.count += 1;
    entry.metrics = addInstagramMetrics(entry.metrics, pieceMetrics);
    rows.set(libraryItem.id, entry);
  }

  return [...rows.values()].sort((left, right) => right.metrics.views - left.metrics.views);
}

function getPrimaryComponent(pieceId, slot) {
  return getPieceComponents(pieceId, slot)[0] || null;
}

function getHeaderComponents(pieceId) {
  return getPieceComponents(pieceId, "text_header");
}

function getPieceComponents(pieceId, slot) {
  return state.pieceComponents
    .filter(component => component.pieceId === pieceId && (!slot || component.slot === slot))
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

function getPieceInstagramItems(pieceId) {
  const piece = state.pieces.find(item => item.id === pieceId);
  if (!piece) return [];
  return (instagramDashboard.contentItems || []).filter(item => {
    if (item.pieceId && item.pieceId === pieceId) return true;
    if (piece.distribution.igMediaId && item.instagramMediaId === piece.distribution.igMediaId) return true;
    if (piece.distribution.permalink && permalinksMatch(item.permalink, piece.distribution.permalink)) return true;
    return false;
  });
}

function findPieceWithDuplicatePermalink(permalink, excludePieceId) {
  const normalized = normalizePermalinkValue(permalink);
  if (!normalized) return null;
  return state.pieces.find(piece => (
    piece.id !== excludePieceId
    && permalinksMatch(piece.distribution?.permalink, normalized)
  )) || null;
}

function isPermalinkSyncedInInstagram(permalink) {
  const normalized = normalizePermalinkValue(permalink);
  if (!normalized) return false;
  return (instagramDashboard.contentItems || []).some(item => permalinksMatch(item.permalink, normalized));
}

function getPermalinkFieldMeta(piece, permalink = piece.distribution?.permalink) {
  const duplicatePiece = findPieceWithDuplicatePermalink(permalink, piece.id);
  if (!duplicatePiece) {
    return {
      hint: "URL completa da publicação no Instagram.",
      className: ""
    };
  }
  return {
    hint: `Este permalink já está vinculado à peça "${duplicatePiece.title}".`,
    className: "field-has-duplicate"
  };
}

function updatePermalinkDuplicateHint(input, pieceId) {
  const field = input.closest(".field");
  const hint = field?.querySelector(".field-hint");
  if (!field || !hint) return;

  const meta = getPermalinkFieldMeta({ id: pieceId, distribution: { permalink: input.value } }, input.value);
  field.classList.toggle("field-has-duplicate", Boolean(meta.className));
  hint.textContent = meta.hint;
}

function createDefaultPublicationMetrics() {
  return {
    views: 0,
    likes: 0,
    saves: 0,
    shares: 0,
    comments: 0,
    reach: 0,
    profileViews: 0,
    followers: 0,
    impressions: 0
  };
}

function upsertPublicationForPiece(piece, permalink) {
  const existing = state.publications.find(item => item.pieceId === piece.id);
  if (existing) {
    existing.url = permalink;
    return;
  }

  if (!permalink) return;

  state.publications.unshift({
    id: createId("publication"),
    pieceId: piece.id,
    platform: piece.platforms[0] || "instagram",
    publishedAt: new Date().toISOString(),
    url: permalink,
    metrics: createDefaultPublicationMetrics()
  });
}

function getPieceInstagramMetrics(pieceId) {
  return getPieceInstagramItems(pieceId).reduce((acc, item) => addInstagramMetrics(acc, item.metrics), createEmptyMetrics());
}

function getMissingRequiredSlots(pieceId) {
  const components = state.pieceComponents.filter(component => component.pieceId === pieceId);
  return requiredSlots.filter(slot => !components.some(component => component.slot === slot));
}

function getLibraryOptionsForSlot(slot) {
  const category = libraryCategories.find(item => item.slot === slot)?.id;
  return state.library.filter(item => item.category === category);
}

function getSelectedPiece() {
  return state.pieces.find(piece => piece.id === selectedPieceId) || null;
}

function isPhaseComplete(piece, phase) {
  if (phase === "brief") {
    return Boolean(piece.title && piece.brief.promise && piece.platforms.length);
  }
  if (phase === "roteiro") {
    const script = getScriptByPiece(piece.id);
    return Boolean(script && hasScriptContent(script) && getPrimaryComponent(piece.id, "script_structure") && getPieceComponents(piece.id, "cta").length);
  }
  if (phase === "captacao") {
    return Boolean(getPieceComponents(piece.id, "camera_angle").length || piece.capture.driveUrl);
  }
  if (phase === "edicao") {
    return Boolean(getPrimaryComponent(piece.id, "music") || getPrimaryComponent(piece.id, "sound_effect") || getHeaderComponents(piece.id).some(component => component.used));
  }
  if (phase === "distribuicao") {
    return Boolean(piece.distribution.igMediaId || piece.distribution.permalink || state.texts.some(text => text.pieceId === piece.id));
  }
  return false;
}

function isLegendasComplete(piece) {
  return state.texts.some(text => text.pieceId === piece.id);
}

function getPieceProgress(piece) {
  const phaseStatus = buildPiecePhaseStatus(piece);
  return {
    completed: phaseStatus.filter(item => item.complete).length,
    total: phaseStatus.length
  };
}

function buildPiecePhaseStatus(piece) {
  return [
    {
      key: "brief",
      label: "Brief",
      complete: isPhaseComplete(piece, "brief"),
      warning: false,
      description: piece.brief.objective ? "Objetivo e promessa definidos." : "Defina objetivo, promessa e plataformas."
    },
    {
      key: "roteiro",
      label: "Roteiro",
      complete: isPhaseComplete(piece, "roteiro"),
      warning: !isPhaseComplete(piece, "roteiro"),
      description: getMissingRequiredSlots(piece.id).includes("script_structure") || getMissingRequiredSlots(piece.id).includes("cta")
        ? "Faltam estrutura de roteiro ou CTAs."
        : "Estrutura, campos e CTAs prontos."
    },
    {
      key: "captacao",
      label: "Captação",
      complete: isPhaseComplete(piece, "captacao"),
      warning: getMissingRequiredSlots(piece.id).includes("camera_angle"),
      description: getPieceComponents(piece.id, "camera_angle").length ? "Ângulos selecionados." : "Escolha ao menos um ângulo."
    },
    {
      key: "edicao",
      label: "Edição",
      complete: isPhaseComplete(piece, "edicao"),
      warning: false,
      description: getHeaderComponents(piece.id).some(component => component.used) ? "Headers e edição encaminhados." : "Revise músicas, efeitos e headers."
    },
    {
      key: "distribuicao",
      label: "Distribuição",
      complete: isPhaseComplete(piece, "distribuicao"),
      warning: false,
      description: piece.distribution.igMediaId || piece.distribution.permalink ? "Mídia real vinculada." : "Vincule `ig_media_id` ou permalink."
    },
    {
      key: "legendas",
      label: "Legendas",
      complete: isLegendasComplete(piece),
      warning: !isLegendasComplete(piece),
      description: isLegendasComplete(piece) ? "Legendas já geradas." : "Gere as legendas do conteúdo."
    }
  ];
}

function hasScriptContent(script) {
  if (!script) return false;
  return Object.values(script.fields || {}).some(value => {
    if (Array.isArray(value)) return value.length > 0;
    return String(value || "").trim();
  });
}

function syncScriptDraftFromForm(pieceId) {
  const form = /** @type {HTMLFormElement | null} */ (
    document.querySelector(`form[data-piece-form="script"][data-piece-id="${pieceId}"]`)
  );
  if (!form) return;

  const structureItemId = String(new FormData(form).get("structureItemId") || "").trim();
  if (!structureItemId) return;

  const template = resolveTemplateKeyFromStructureId(structureItemId);
  upsertScriptFromForm(pieceId, template, form);
}

function buildScriptSummaryFromFields(fields) {
  return Object.values(fields || {})
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function readScriptFields(template, form) {
  return readScriptFieldsFromForm(template, form);
}

function renderScriptField(script, field) {
  const value = escapeHtml(formatScriptFieldValue(field, script.fields?.[field.key]));
  const rows = field.multiline || field.list ? 4 : 2;
  const input = `<textarea name="${field.key}" rows="${rows}">${value}</textarea>`;
  return renderField(field.label, input, { hint: field.hint || "" });
}

function renderField(label, inputHtml, { hint = "", inlineHint = false, required = false, className = "" } = {}) {
  const labelMarkup = inlineHint && hint
    ? `
      <div class="field-label-row">
        <span class="field-label">${escapeHtml(label)}${required ? '<span class="field-required" aria-hidden="true"> *</span>' : ""}</span>
        <span class="field-hint inline">${escapeHtml(hint)}</span>
      </div>
    `
    : `<span class="field-label">${escapeHtml(label)}${required ? '<span class="field-required" aria-hidden="true"> *</span>' : ""}</span>`;

  return `
    <div class="field ${className}">
      ${labelMarkup}
      ${!inlineHint && hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : ""}
      ${inputHtml}
    </div>
  `;
}

function renderTagChip(tag) {
  const token = stripHash(tag);
  return `
    <span class="tag-chip" data-tag-value="${escapeHtml(token)}">
      <span>${escapeHtml(withHash(token))}</span>
      <button type="button" class="tag-chip-remove" aria-label="Remover ${escapeHtml(token)}">×</button>
    </span>
  `;
}

function renderTagChipInput(name, tags = []) {
  const normalizedTags = [...new Set((tags || []).map(stripHash).filter(Boolean))];
  return `
    <div class="tag-chip-field" data-tag-chip-field>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(normalizedTags.join(","))}" />
      <div class="tag-chip-input" data-tag-chip-input>
        <div class="tag-chip-list" data-tag-chip-list>
          ${normalizedTags.map(tag => renderTagChip(tag)).join("")}
        </div>
        <input class="tag-chip-text" type="text" placeholder="Nova tag…" autocomplete="off" aria-label="Nova tag" />
      </div>
    </div>
  `;
}

function attachTagChipFields() {
  document.querySelectorAll("[data-tag-chip-field]").forEach(field => {
    const hidden = /** @type {HTMLInputElement | null} */ (field.querySelector('input[type="hidden"]'));
    const list = field.querySelector("[data-tag-chip-list]");
    const textInput = /** @type {HTMLInputElement | null} */ (field.querySelector(".tag-chip-text"));
    const chipInput = field.querySelector("[data-tag-chip-input]");
    if (!hidden || !list || !textInput) return;

    const getTags = () => Array.from(list.querySelectorAll(".tag-chip"))
      .map(chip => /** @type {HTMLElement} */ (chip).dataset.tagValue || "")
      .filter(Boolean);

    const syncHidden = () => {
      hidden.value = getTags().join(",");
    };

    const bindRemoveButtons = () => {
      list.querySelectorAll(".tag-chip-remove").forEach(button => {
        const removeButton = /** @type {HTMLButtonElement} */ (button);
        if (removeButton.dataset.bound === "true") return;
        removeButton.dataset.bound = "true";
        removeButton.addEventListener("click", event => {
          event.preventDefault();
          removeButton.closest(".tag-chip")?.remove();
          syncHidden();
          textInput.focus();
        });
      });
    };

    const addTag = rawValue => {
      const token = stripHash(rawValue);
      if (!token) return;
      const exists = getTags().some(tag => normalizeToken(tag) === normalizeToken(token));
      if (exists) return;
      list.insertAdjacentHTML("beforeend", renderTagChip(token));
      syncHidden();
      bindRemoveButtons();
    };

    const commitInput = () => {
      const pending = textInput.value.trim();
      if (!pending) return;
      addTag(pending);
      textInput.value = "";
    };

    textInput.addEventListener("input", () => {
      const value = textInput.value;
      if (!value.includes(",")) return;
      const parts = value.split(",");
      parts.slice(0, -1).forEach(part => addTag(part));
      textInput.value = parts[parts.length - 1].replace(/^\s+/, "");
    });

    textInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitInput();
      }
      if (event.key === "Backspace" && !textInput.value) {
        const chips = list.querySelectorAll(".tag-chip");
        chips[chips.length - 1]?.remove();
        syncHidden();
      }
    });

    textInput.addEventListener("blur", () => {
      commitInput();
    });

    chipInput?.addEventListener("click", () => {
      textInput.focus();
    });

    bindRemoveButtons();
  });
}

function renderFieldGroup(title, description, content) {
  return `
    <fieldset class="field-group">
      <legend class="field-group-title">${escapeHtml(title)}</legend>
      ${description ? `<p class="field-group-desc">${escapeHtml(description)}</p>` : ""}
      <div class="field-group-body">
        ${content}
      </div>
    </fieldset>
  `;
}

function renderLibrarySingleSelect({ label, fieldName, category, value, options, placeholder, addLabel = "", dataset = "", hint = "", required = false, allowQuickAdd = true }) {
  const selectHtml = `
    ${renderCustomSelect({
      name: fieldName,
      value,
      placeholder,
      options: options.map(option => ({ value: option.id, label: option.name })),
      dataset
    })}
    ${allowQuickAdd && addLabel ? `<button class="ghost-action compact align-start" type="button" data-quick-add-library="${category}">${escapeHtml(addLabel)}</button>` : ""}
  `;
  return renderField(label, selectHtml, { hint, required });
}

function renderCustomSelect({ name, value = "", placeholder = "Selecione…", options = [], dataset = "" }) {
  const selected = options.find(option => option.value === value);
  const displayValue = selected?.label || placeholder;
  const datasetAttrs = dataset ? ` ${dataset}` : "";

  return `
    <div class="dropdown-field" data-custom-select>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${datasetAttrs} />
      <button type="button" class="dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="dropdown-trigger-copy">
          <strong class="${value ? "" : "is-placeholder"}">${escapeHtml(displayValue)}</strong>
        </span>
        <i aria-hidden="true"></i>
      </button>
      <div class="dropdown-menu" role="listbox">
        <button type="button" class="dropdown-option ${!value ? "selected" : ""}" role="option" data-value="" data-label="${escapeHtml(placeholder)}">
          ${escapeHtml(placeholder)}
        </button>
        ${options.map(option => `
          <button type="button" class="dropdown-option ${option.value === value ? "selected" : ""}" role="option" data-value="${escapeHtml(option.value)}" data-label="${escapeHtml(option.label)}">
            ${escapeHtml(option.label)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function attachCustomSelects() {
  document.querySelectorAll("[data-custom-select]").forEach(field => {
    const hiddenInput = /** @type {HTMLInputElement | null} */ (field.querySelector('input[type="hidden"]'));
    const trigger = /** @type {HTMLButtonElement | null} */ (field.querySelector(".dropdown-trigger"));
    const menu = field.querySelector(".dropdown-menu");
    if (!hiddenInput || !trigger || !menu) return;

    trigger.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = field.classList.contains("open");
      closeAllCustomSelects();
      if (!isOpen) {
        field.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });

    menu.querySelectorAll(".dropdown-option").forEach(optionButton => {
      const option = /** @type {HTMLButtonElement} */ (optionButton);
      option.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const nextValue = option.dataset.value || "";
        const nextLabel = option.dataset.label || "";
        hiddenInput.value = nextValue;
        const strong = trigger.querySelector("strong");
        if (strong) {
          strong.textContent = nextLabel;
          strong.classList.toggle("is-placeholder", !nextValue);
        }
        menu.querySelectorAll(".dropdown-option").forEach(item => {
          item.classList.toggle("selected", item === option);
        });
        field.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  });
}

function closeAllCustomSelects() {
  document.querySelectorAll(".dropdown-field.open").forEach(field => {
    field.classList.remove("open");
    field.querySelector(".dropdown-trigger")?.setAttribute("aria-expanded", "false");
  });
}

async function quickAddLibraryItem(category) {
  if (category === "estrutura_roteiro") {
    return null;
  }

  const categoryLabel = getCategoryLabel(category);
  const name = await openPrompt({
    title: `Novo ${categoryLabel}`,
    message: category === "gancho"
      ? `Informe o nome do gancho ${hookTypeFilter === "textual" ? "textual" : hookTypeFilter === "visual" ? "visual" : ""}.`.trim()
      : "Informe o nome do item para adicionar à biblioteca.",
    label: "Nome",
    placeholder: `Ex.: ${categoryLabel}`,
    confirmLabel: "Adicionar"
  });
  if (!name?.trim()) return null;

  const metadata = {};
  if (category === "gancho") {
    metadata.hookType = hookTypeFilter === "textual" ? "textual" : "visual";
  }

  const item = {
    id: createUuid(),
    name: name.trim(),
    category,
    context: [],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "",
    example: "",
    metadata,
    createdAt: new Date().toISOString()
  };
  state.library.unshift(item);
  return item;
}

function syncSingleLibraryComponent(pieceId, slot, libraryItemId, overrides = {}) {
  const current = getPrimaryComponent(pieceId, slot);
  const nextId = libraryItemId || null;
  if (!nextId) {
    state.pieceComponents = state.pieceComponents.filter(component => !(component.pieceId === pieceId && component.slot === slot && component.libraryItemId));
    return null;
  }

  if (current) {
    current.libraryItemId = nextId;
    current.required = overrides.required ?? current.required;
    current.used = overrides.used ?? current.used;
    return current;
  }

  const component = {
    id: createId("component"),
    pieceId,
    libraryItemId: nextId,
    slot,
    required: overrides.required ?? requiredSlots.includes(slot),
    used: overrides.used ?? false,
    notes: overrides.notes || "",
    orderIndex: getPieceComponents(pieceId, slot).length
  };
  state.pieceComponents.push(component);
  return component;
}

function syncMultiLibraryComponents(pieceId, slot, libraryItemIds, overrides = {}) {
  const selectedIds = new Set((libraryItemIds || []).filter(Boolean));
  const current = getPieceComponents(pieceId, slot).filter(component => component.libraryItemId);
  const keep = [];

  for (const component of current) {
    if (selectedIds.has(component.libraryItemId)) {
      component.required = overrides.required ?? component.required;
      component.used = overrides.used ?? component.used;
      keep.push(component.libraryItemId);
    }
  }

  state.pieceComponents = state.pieceComponents.filter(component => {
    if (component.pieceId !== pieceId || component.slot !== slot || !component.libraryItemId) return true;
    return selectedIds.has(component.libraryItemId);
  });

  [...selectedIds].forEach(libraryItemId => {
    if (!keep.includes(libraryItemId)) {
      state.pieceComponents.push({
        id: createId("component"),
        pieceId,
        libraryItemId,
        slot,
        required: overrides.required ?? requiredSlots.includes(slot),
        used: overrides.used ?? false,
        notes: overrides.notes || "",
        orderIndex: getPieceComponents(pieceId, slot).length
      });
    }
  });
}

function syncSuggestedCtas(pieceId, libraryItemIds) {
  if (!libraryItemIds.length) return;
  syncMultiLibraryComponents(pieceId, "cta", libraryItemIds, { required: true, used: true });
}

function syncSuggestedHeaders(pieceId, suggestions, recommendation = "") {
  const current = getHeaderComponents(pieceId);
  const nextByLabel = new Map(suggestions.map(item => [normalizeToken(item.label), item]));

  current.forEach(component => {
    const key = normalizeToken(component.notes);
    if (!nextByLabel.has(key)) {
      component.used = component.used || false;
    }
  });

  suggestions.forEach((suggestion, index) => {
    const key = normalizeToken(suggestion.label);
    const existing = current.find(component => normalizeToken(component.notes) === key);
    if (existing) {
      existing.notes = suggestion.label;
      existing.required = false;
      return;
    }
    state.pieceComponents.push({
      id: createId("component"),
      pieceId,
      libraryItemId: null,
      slot: "text_header",
      required: false,
      used: false,
      notes: suggestion.label,
      orderIndex: current.length + index
    });
  });

  const piece = state.pieces.find(item => item.id === pieceId);
  if (piece) {
    piece.edit.headerRecommendation = recommendation || (suggestions.length
      ? "A peça pode usar headers para reforçar pontos-chave e CTA visual."
      : "Esta peça pode funcionar bem sem header textual em tela.");
    piece.edit.headerSuggestions = suggestions.map(item => item.label);
  }
}

function suggestCtasForObjective(objective) {
  const ctaOptions = getLibraryOptionsForSlot("cta");
  const targets = {
    "aumentar conexão com público": ["comentar", "compartilhar"],
    "gerar views": ["curtir", "compartilhar"],
    "gerar seguidores": ["seguir", "compartilhar"],
    "educar para venda": ["salvar", "comentar"]
  }[objective] || ["salvar"];

  return ctaOptions
    .filter(item => targets.some(target => normalizeToken(item.name).includes(normalizeToken(target))))
    .map(item => item.id);
}

function buildHeaderSuggestions(template, fields, piece) {
  if (template === "storytelling") return [];
  const suggestions = [];
  if (template === "educacional") {
    suggestions.push({ label: `Problema: ${summarizeText(fields.problema || piece.title, 36)}` });
    suggestions.push({ label: `Solução: ${summarizeText(fields.solucao || piece.brief.promise, 36)}` });
    suggestions.push({ label: "CTA visual" });
    return suggestions;
  }

  const steps = fields.steps || [];
  steps.slice(0, 3).forEach((step, index) => {
    suggestions.push({ label: `Passo ${index + 1}` });
  });
  if (!suggestions.length) {
    suggestions.push({ label: "Título animado" });
  }
  return suggestions;
}

function getPieceTheme(piece) {
  if (!piece) return "";
  const idea = state.ideas.find(item => item.id === piece.ideaId);
  return piece.brief.promise || idea?.description || idea?.angle || "";
}

function getScriptSummary(pieceId) {
  const script = getScriptByPiece(pieceId);
  if (!script) return "";
  return buildScriptSummaryFromFields(script.fields);
}

function renderPlatformCheckbox(name, selectedPlatforms) {
  return Object.keys(platformRules).map(platform => `
    <label class="checkbox-pill">
      <input type="checkbox" name="${name}" value="${platform}" ${selectedPlatforms.includes(platform) ? "checked" : ""} />
      <span>${platformRules[platform].label}</span>
    </label>
  `).join("");
}

function renderEmptyInsightCopy() {
  return "Sem dados do Instagram vinculados ainda.";
}

function setIdeaStatus(ideaId, status) {
  const idea = state.ideas.find(item => item.id === ideaId);
  if (idea && ideaStatuses.includes(status)) {
    idea.status = status;
  }
}

function releaseIdeaIfUnused(ideaId) {
  if (!ideaId) return;
  const idea = state.ideas.find(item => item.id === ideaId);
  if (!idea) return;
  const stillLinked = state.pieces.some(piece => piece.ideaId === ideaId);
  if (!stillLinked && idea.status === "em_producao") {
    idea.status = "disponivel";
  }
}

function findPieceTitle(pieceId) {
  return state.pieces.find(piece => piece.id === pieceId)?.title || "Peça sem vínculo";
}

function findIdeaTitle(ideaId) {
  return state.ideas.find(idea => idea.id === ideaId)?.title || "Sem ideia";
}

function formatIdeaStatus(status) {
  return {
    disponivel: "Disponível",
    em_producao: "Em produção",
    reaproveitavel: "Reaproveitável"
  }[status] || "Disponível";
}

function formatPlatform(platform) {
  return platformRules[platform]?.label || platform;
}

function formatTemplateLabel(template) {
  return {
    storytelling: "Storytelling",
    educacional: "Educacional",
    tutorial: "Tutorial"
  }[template] || template;
}

function formatSlotLabel(slot) {
  return slotLabels[slot] || slot;
}

function getLibraryCategoryForSlot(slot) {
  return libraryCategories.find(category => category.slot === slot)?.id || "gancho";
}

function getCategoryLabel(categoryId) {
  return libraryCategories.find(category => category.id === categoryId)?.label || categoryId;
}

function sanitizeSection(sectionId) {
  return sections.some(section => section.id === sectionId) ? sectionId : "dashboard";
}

function createUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function normalizeToken(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^#/, "").trim().toLowerCase();
}

function splitCommaList(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function splitHashList(value) {
  return String(value || "")
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(stripHash);
}

function stripHash(value) {
  return String(value || "").replace(/^#/, "").trim();
}

function withHash(value) {
  const token = stripHash(value);
  return token ? `#${token}` : "";
}

function getCheckedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}

function emptyState(title = "Nada por aqui ainda.", description = "Comece por uma ideia solta ou por um vídeo em produção.") {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </div>
  `;
}

function createEmptyInstagramDashboard() {
  return {
    isConfigured: false,
    account: null,
    lastSyncAt: null,
    totals: createEmptyMetrics(),
    accountMetrics: createEmptyMetrics(),
    byContentType: [],
    contentItems: []
  };
}

function createEmptyMetrics() {
  return {
    impressions: 0,
    reach: 0,
    views: 0,
    likes: 0,
    saves: 0,
    shares: 0,
    comments: 0,
    profileViews: 0,
    followers: 0
  };
}

function addInstagramMetrics(left, right) {
  return {
    impressions: Number(left.impressions || 0) + Number(right.impressions || 0),
    reach: Number(left.reach || 0) + Number(right.reach || 0),
    views: Number(left.views || 0) + Number(right.views || 0),
    likes: Number(left.likes || 0) + Number(right.likes || 0),
    saves: Number(left.saves || 0) + Number(right.saves || 0),
    shares: Number(left.shares || 0) + Number(right.shares || 0),
    comments: Number(left.comments || 0) + Number(right.comments || 0),
    profileViews: Number(left.profileViews || 0) + Number(right.profileViews || 0),
    followers: Math.max(Number(left.followers || 0), Number(right.followers || 0))
  };
}

function groupInstagramItemsByType(items) {
  return Object.values((items || []).reduce((groups, item) => {
    const key = item.contentType || "unknown";
    groups[key] ||= { contentType: key, count: 0, metrics: createEmptyMetrics() };
    groups[key].count += 1;
    groups[key].metrics = addInstagramMetrics(groups[key].metrics, item.metrics);
    return groups;
  }, {}));
}

function formatInstagramContentType(type) {
  return {
    reel: "Reel",
    post: "Post",
    carousel: "Carrossel",
    video: "Vídeo",
    story: "Story",
    unknown: "Outro"
  }[type] || "Outro";
}

function filterInstagramItemsByDate(items, range) {
  return (items || []).filter(item => {
    if (!item.publishedAt) return false;
    const date = new Date(item.publishedAt);
    if (range.start && date < range.start) return false;
    if (range.end && date > range.end) return false;
    return true;
  });
}

function getInstagramDateRange() {
  const today = endOfDay(new Date());
  if (instagramDatePreset === "today") return { start: startOfDay(today), end: today };
  if (instagramDatePreset === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }
  if (instagramDatePreset === "7d") return { start: shiftDays(today, -6), end: today };
  if (instagramDatePreset === "15d") return { start: shiftDays(today, -14), end: today };
  if (instagramDatePreset === "30d") return { start: shiftDays(today, -29), end: today };
  if (instagramDatePreset === "custom") {
    return {
      start: instagramCustomStart ? startOfDay(new Date(`${instagramCustomStart}T00:00:00`)) : null,
      end: instagramCustomEnd ? endOfDay(new Date(`${instagramCustomEnd}T00:00:00`)) : null
    };
  }
  return { start: null, end: null };
}

function getCurrentMonthRange() {
  const now = new Date();
  return {
    start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: endOfDay(now)
  };
}

function getPreviousRange(range) {
  const diff = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000) + 1);
  const previousEnd = endOfDay(shiftDays(range.start, -1));
  return {
    start: startOfDay(shiftDays(previousEnd, -(diff - 1))),
    end: previousEnd
  };
}

function shiftDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return startOfDay(copy);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function formatDateRangeLabel(range) {
  if (!range.start && !range.end) return "Todo o histórico sincronizado";
  const start = range.start ? formatShortDate(range.start) : "início";
  const end = range.end ? formatShortDate(range.end) : "agora";
  return `${start} - ${end}`;
}

function dashboardMetric() {
  if (!instagramDashboard.account) return "não conectado";
  return instagramDashboard.lastSyncAt ? "sincronizado" : "pronto para sincronizar";
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function fitToLength(value, limit) {
  if (value.length <= limit) return value;
  return value.slice(0, Math.max(0, limit - 1)).trim();
}

function limitHashtags(hashtags, limit) {
  if (!Number.isFinite(limit)) return hashtags;
  return hashtags.slice(0, limit);
}

function finalizeCaptionBody(body, hashtags, limit) {
  const suffix = hashtags.length ? ` ${hashtags.join(" ")}` : "";
  return fitToLength(`${body}${suffix}`.trim(), limit);
}

function summarizeText(text, limit) {
  const clean = String(text || "").trim();
  if (!clean) return "";
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trim()}…`;
}

function matchesQuery(values, query) {
  if (!query) return true;
  return values.filter(Boolean).join(" ").toLowerCase().includes(query);
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function icon(name) {
  const icons = {
    chart: `<svg viewBox="0 0 24 24" class="icon"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M22 20H2"/></svg>`,
    lightbulb: `<svg viewBox="0 0 24 24" class="icon"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8 14a7 7 0 1 1 8 0c-1 1-1.5 2-1.5 3h-5C9.5 16 9 15 8 14Z"/></svg>`,
    layers: `<svg viewBox="0 0 24 24" class="icon"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></svg>`,
    text: `<svg viewBox="0 0 24 24" class="icon"><path d="M4 6h16"/><path d="M10 6v12"/><path d="M14 6v12"/><path d="M6 18h12"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" class="icon"><path d="M3 7h6l2 2h10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`,
    send: `<svg viewBox="0 0 24 24" class="icon"><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></svg>`,
    bookmark: `<svg viewBox="0 0 24 24" class="icon"><path d="M7 4h10v16l-5-3-5 3V4Z"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" class="icon"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/></svg>`,
    target: `<svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" class="icon"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    user: `<svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.8-3.3 4.5-5 8-5s6.2 1.7 8 5"/></svg>`,
    heart: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>`,
    message: `<svg viewBox="0 0 24 24" class="icon"><path d="M4 5h16v11H8l-4 3V5Z"/></svg>`,
    zap: `<svg viewBox="0 0 24 24" class="icon"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>`,
    wave: `<svg viewBox="0 0 24 24" class="icon"><path d="M2 12c2-4 4 4 6 0s4-4 6 0 4 4 8 0"/></svg>`,
    music: `<svg viewBox="0 0 24 24" class="icon"><path d="M9 18V5l10-2v13"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/></svg>`,
    layout: `<svg viewBox="0 0 24 24" class="icon"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 10v10"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" class="icon"><path d="M4 7h4l2-2h4l2 2h4v12H4V7Z"/><circle cx="12" cy="13" r="4"/></svg>`,
    list: `<svg viewBox="0 0 24 24" class="icon"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`,
    check: `<svg viewBox="0 0 24 24" class="icon"><path d="m5 12 4 4L19 6"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" class="icon"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 8v5"/><path d="M12 16h.01"/><path d="m10.3 4.3-.1.2-7 12.1A2 2 0 0 0 4.9 20h14.2a2 2 0 0 0 1.7-3.4l-7-12.1-.1-.2a2 2 0 0 0-3.4 0Z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" class="icon"><path d="M21 12a9 9 0 0 1-9 9"/><path d="M21 3v6h-6"/><path d="M3 12a9 9 0 0 1 9-9"/><path d="M3 21v-6h6"/></svg>`
  };
  return icons[name] || icons.chart;
}

init();
