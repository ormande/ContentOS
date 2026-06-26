import { assistantGateway } from "./ai/assistantGateway.js";
import { loadInstagramDashboard, syncInstagramInsights } from "./data/instagramInsights.js";
import {
  createEmptyState,
  createId,
  ideaStatuses,
  loadState,
  pieceComponentSlots,
  platformRules,
  saveState
} from "./data/store.js";

const sections = [
  { id: "dashboard", label: "Dashboard", icon: "chart", kicker: "instagram", title: "Insights do Instagram", metric: () => dashboardMetric() },
  { id: "ideas", label: "Ideias", icon: "lightbulb", kicker: "captura", title: "Banco de ideias", metric: currentState => `${currentState.ideas.length} ideias` },
  { id: "pieces", label: "Montador", icon: "layers", kicker: "produção", title: "Montador de vídeo", metric: currentState => `${currentState.pieces.length} peças` },
  { id: "texts", label: "Legendas", icon: "text", kicker: "distribuição", title: "Legendas por plataforma", metric: currentState => `${currentState.texts.length} legendas` },
  { id: "files", label: "Arquivos", icon: "folder", kicker: "materiais", title: "Arquivos da produção", metric: currentState => `${currentState.files.length} arquivos` },
  { id: "publications", label: "Publicações", icon: "send", kicker: "histórico", title: "Saídas registradas", metric: currentState => `${currentState.publications.length} registros` },
  { id: "library", label: "Biblioteca", icon: "bookmark", kicker: "componentes", title: "Biblioteca criativa", metric: currentState => `${currentState.library.length} itens` },
  { id: "assistant", label: "IA", icon: "spark", kicker: "análise", title: "IA para insights", metric: () => "mês atual" }
];

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

const scriptTemplates = {
  storytelling: [
    { key: "oQueAconteceu", label: "O que aconteceu" },
    { key: "onde", label: "Onde" },
    { key: "quando", label: "Quando" },
    { key: "quemEstava", label: "Quem estava" },
    { key: "comoFoi", label: "Como foi" },
    { key: "desfecho", label: "Qual desfecho" },
    { key: "aprendizado", label: "O que aprendeu" }
  ],
  educacional: [
    { key: "problema", label: "Problema" },
    { key: "solucao", label: "Solução" },
    { key: "prova", label: "Prova" },
    { key: "cta", label: "CTA" }
  ],
  tutorial: [
    { key: "steps", label: "Passos numerados", multiline: true }
  ]
};

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
let instagramError = new URLSearchParams(window.location.search).get("instagram_error") || "";
let captionDrafts = [];
let editingIdeaId = null;
let editingLibraryItemId = null;

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
    selectedPieceId ||= state.pieces[0]?.id || null;
  } catch (error) {
    console.error(error);
    contentArea.innerHTML = `<div class="empty-state"><strong>Não foi possível carregar o Supabase.</strong><span>Confira o schema e as variáveis do ambiente.</span></div>`;
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
  sectionKicker.textContent = section.kicker;
  sectionTitle.textContent = section.title;
  renderNav();
  updateMetric(section);

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
    <div class="grid two">
      <form class="panel form-panel" id="ideaForm">
        <h3>${editingIdea ? "Editar ideia" : "Nova ideia"}</h3>
        <input type="hidden" name="ideaId" value="${escapeHtml(editingIdea?.id || "")}" />
        <input name="title" value="${escapeHtml(editingIdea?.title || "")}" placeholder="Título da ideia" required />
        <input name="source" value="${escapeHtml(editingIdea?.source || "")}" placeholder="Origem" />
        <textarea name="description" placeholder="Descrição da ideia">${escapeHtml(editingIdea?.description || "")}</textarea>
        <textarea name="angle" placeholder="Ângulo editorial">${escapeHtml(editingIdea?.angle || "")}</textarea>
        <input name="tags" value="${escapeHtml((editingIdea?.tags || []).join(", "))}" placeholder="hashtags ou tags separadas por vírgula" />
        <select name="priority">
          <option value="alta" ${(editingIdea?.priority || "média") === "alta" ? "selected" : ""}>Prioridade alta</option>
          <option value="média" ${(editingIdea?.priority || "média") === "média" ? "selected" : ""}>Prioridade média</option>
          <option value="baixa" ${(editingIdea?.priority || "média") === "baixa" ? "selected" : ""}>Prioridade baixa</option>
        </select>
        <select name="status">
          <option value="disponivel" ${(editingIdea?.status || "disponivel") === "disponivel" ? "selected" : ""}>Disponível</option>
          <option value="em_producao" ${(editingIdea?.status || "disponivel") === "em_producao" ? "selected" : ""}>Em produção</option>
          <option value="reaproveitavel" ${(editingIdea?.status || "disponivel") === "reaproveitavel" ? "selected" : ""}>Reaproveitável</option>
        </select>
        <div class="inline-actions">
          <button class="primary-action" type="submit">${editingIdea ? "Salvar alterações" : "Salvar ideia"}</button>
          ${editingIdea ? `<button class="ghost-action compact" type="button" id="cancelIdeaEdit">Cancelar</button>` : ""}
        </div>
      </form>

      <div class="stack">
        ${ideas.length ? ideas.map(idea => `
          <article class="item-card">
            <div class="item-topline">
              <span>${idea.source || "ideia"}</span>
              <strong>${formatIdeaStatus(idea.status)}</strong>
            </div>
            <h3>${escapeHtml(idea.title)}</h3>
            <p>${escapeHtml(idea.description || idea.angle || "Sem descrição ainda.")}</p>
            <div class="tag-row">${idea.tags.map(tag => `<span>${escapeHtml(withHash(tag))}</span>`).join("")}</div>
            <small class="linked-video">Prioridade: ${escapeHtml(idea.priority || "média")}</small>
            <div class="inline-actions">
              <button class="ghost-action compact" type="button" data-promote-idea="${idea.id}">Criar peça</button>
              <button class="ghost-action compact" type="button" data-edit-idea="${idea.id}">Editar</button>
              <button class="ghost-action compact" type="button" data-delete-idea="${idea.id}">Excluir</button>
              <button class="ghost-action compact" type="button" data-toggle-idea-status="${idea.id}">Marcar reaproveitável</button>
            </div>
          </article>
        `).join("") : emptyState()}
      </div>
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
      <aside class="panel piece-sidebar">
        <div class="item-topline">
          <span>Projetos</span>
          <strong>${pieces.length}</strong>
        </div>
        <button class="primary-action" type="button" id="createPieceBtn">Nova peça</button>
        <div class="stack mini">
          ${pieces.length ? pieces.map(piece => {
            const metrics = getPieceInstagramMetrics(piece.id);
            const missing = getMissingRequiredSlots(piece.id);
            const progress = getPieceProgress(piece);
            return `
              <button class="piece-list-item ${piece.id === selectedPiece?.id ? "active" : ""}" type="button" data-piece-select="${piece.id}">
                <strong>${escapeHtml(piece.title)}</strong>
                <span>${findIdeaTitle(piece.ideaId)}</span>
                <small>${piece.platforms.length ? piece.platforms.map(formatPlatform).join(", ") : "sem plataformas"}</small>
                <small>${progress.completed}/${progress.total} fases | ${formatNumber(metrics.views)} views | ${missing.length} pendências</small>
              </button>
            `;
          }).join("") : emptyState("Nenhuma peça criada ainda.", "Crie a primeira peça para começar o montador.")}
        </div>
      </aside>

      <div class="stack">
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
    <section class="panel">
      <div class="item-topline">
        <span>${idea ? `Ideia: ${escapeHtml(idea.title)}` : "Sem ideia vinculada"}</span>
        <strong>${progress.completed}/${progress.total} fases encaminhadas</strong>
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
      <div class="inline-actions">
        <button class="ghost-action compact" type="button" data-delete-piece="${piece.id}">Excluir peça</button>
      </div>
    </section>

    <section class="panel">
      <h3>Progresso do vídeo</h3>
      <div class="phase-progress-grid">
        ${buildPiecePhaseStatus(piece).map(step => `
          <div class="phase-progress-card ${step.complete ? "complete" : step.warning ? "warning" : ""}">
            <strong>${step.label}</strong>
            <span>${step.description}</span>
          </div>
        `).join("")}
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
    <form class="panel stack" data-piece-form="brief" data-piece-id="${piece.id}">
      <h3>Brief</h3>
      <input name="title" value="${escapeHtml(piece.title)}" placeholder="Título da peça" required />
      <select name="ideaId">
        <option value="">Sem ideia vinculada</option>
        ${state.ideas.map(item => `<option value="${item.id}" ${item.id === piece.ideaId ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}
      </select>
      <select name="objective">
        <option value="">Selecione o objetivo do vídeo</option>
        ${objectiveOptions.map(option => `<option value="${option}" ${piece.brief.objective === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
      <textarea name="promise" placeholder="Promessa">${escapeHtml(piece.brief.promise)}</textarea>
      <input name="due" type="date" value="${escapeHtml(piece.due || "")}" />
      <div class="checkbox-grid">
        ${renderPlatformCheckbox("platforms", piece.platforms)}
      </div>
      <button class="primary-action" type="submit">Salvar brief</button>
      ${idea ? `<small class="linked-video">Descrição da ideia: ${escapeHtml(idea.description || idea.angle || "sem descrição")}</small>` : ""}
    </form>
  `;
}

function renderScriptPhase(piece, script, idea) {
  const currentScript = script || createLocalScript(piece.id);
  const fields = scriptTemplates[currentScript.template] || scriptTemplates.storytelling;
  const structureComponent = getPrimaryComponent(piece.id, "script_structure");
  const structureItems = getLibraryOptionsForSlot("script_structure");
  const ctaItems = getLibraryOptionsForSlot("cta");
  const selectedCtas = getPieceComponents(piece.id, "cta").map(component => component.libraryItemId).filter(Boolean);
  const canImproveScript = hasScriptContent(currentScript);

  return `
    <div class="stack">
      <form class="panel stack" data-piece-form="script" data-piece-id="${piece.id}">
        <h3>Roteiro</h3>
        ${renderLibrarySingleSelect({
          fieldName: "structureItemId",
          category: "estrutura_roteiro",
          value: structureComponent?.libraryItemId || "",
          options: structureItems,
          placeholder: "Escolha a estrutura de roteiro",
          addLabel: "+ Adicionar nova estrutura",
          dataset: `data-script-structure-select="${piece.id}"`
        })}
        ${fields.map(field => renderScriptField(currentScript, field)).join("")}
        <div class="stack mini">
          <strong>CTA da peça</strong>
          <div class="checkbox-grid">
            ${ctaItems.map(item => `
              <label class="checkbox-pill">
                <input type="checkbox" name="ctaIds" value="${item.id}" ${selectedCtas.includes(item.id) ? "checked" : ""} />
                <span>${escapeHtml(item.name)}</span>
              </label>
            `).join("")}
          </div>
          <button class="ghost-action compact align-start" type="button" data-quick-add-library="cta">+ Adicionar novo CTA</button>
          <small class="linked-video">A IA sugere os CTAs mais adequados com base no objetivo do brief.</small>
        </div>
        <div class="inline-actions">
          <button class="ghost-action compact" type="button" data-script-generate="${piece.id}">Gerar pela IA</button>
          <button class="ghost-action compact" type="button" data-script-improve="${piece.id}" ${canImproveScript ? "" : "disabled"}>Melhorar com IA</button>
        </div>
        <button class="primary-action" type="submit">Salvar roteiro</button>
        <small class="linked-video">${idea ? `A IA usa o título e a descrição da ideia "${escapeHtml(idea.title)}".` : "Vincule uma ideia para enriquecer a geração do roteiro."}</small>
      </form>
      ${renderComponentManager(piece.id, ["hook", "format"])}
    </div>
  `;
}

function renderCapturePhase(piece) {
  const angleItems = getLibraryOptionsForSlot("camera_angle");
  const selectedAngles = getPieceComponents(piece.id, "camera_angle").map(component => component.libraryItemId).filter(Boolean);
  return `
    <div class="stack">
      <form class="panel stack" data-piece-form="capture" data-piece-id="${piece.id}">
        <h3>Captação</h3>
        <label class="field-stack">
          <span>Ângulos de câmera</span>
          <select name="cameraAngleIds" multiple size="${Math.max(4, Math.min(8, angleItems.length || 4))}">
            ${angleItems.map(item => `<option value="${item.id}" ${selectedAngles.includes(item.id) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </label>
        <button class="ghost-action compact align-start" type="button" data-quick-add-library="angulo_camera">+ Adicionar novo ângulo</button>
        <input name="driveUrl" value="${escapeHtml(piece.capture.driveUrl)}" placeholder="Link do Google Drive" />
        ${piece.capture.driveUrl ? `<a class="ghost-action compact dashboard-connect" href="${escapeHtml(piece.capture.driveUrl)}" target="_blank" rel="noreferrer">Abrir Drive</a>` : ""}
        <button class="primary-action" type="submit">Salvar captação</button>
      </form>
    </div>
  `;
}

function renderEditPhase(piece) {
  const musicComponent = getPrimaryComponent(piece.id, "music");
  const soundComponent = getPrimaryComponent(piece.id, "sound_effect");
  const musicItems = getLibraryOptionsForSlot("music");
  const soundItems = getLibraryOptionsForSlot("sound_effect");
  const headerComponents = getHeaderComponents(piece.id);
  return `
    <div class="stack">
      <form class="panel stack" data-piece-form="edit" data-piece-id="${piece.id}">
        <h3>Edição</h3>
        ${renderLibrarySingleSelect({
          fieldName: "musicItemId",
          category: "musica",
          value: musicComponent?.libraryItemId || "",
          options: musicItems,
          placeholder: "Selecione a música",
          addLabel: "+ Adicionar nova música"
        })}
        ${renderLibrarySingleSelect({
          fieldName: "soundEffectItemId",
          category: "efeito_sonoro",
          value: soundComponent?.libraryItemId || "",
          options: soundItems,
          placeholder: "Selecione o efeito sonoro",
          addLabel: "+ Adicionar novo efeito"
        })}
        <div class="notice">
          <strong>Recomendação de header</strong>
          <span>${escapeHtml(piece.edit.headerRecommendation || "Sem recomendação ainda. Gere o roteiro com IA para receber a sugestão.")}</span>
        </div>
        <div class="stack mini">
          <strong>Headers sugeridos</strong>
          ${headerComponents.length ? headerComponents.map(component => `
            <label class="line-card">
              <strong>${escapeHtml(component.notes || "Header sugerido")}</strong>
              <span>Conta no geral como uso de headers, sem separar métricas por header individual.</span>
              <span><input type="checkbox" name="usedHeaderIds" value="${component.id}" ${component.used ? "checked" : ""} /> marcar como usado</span>
            </label>
          `).join("") : `<p>Nenhum header sugerido ainda.</p>`}
        </div>
        <button class="primary-action" type="submit">Salvar edição</button>
      </form>
    </div>
  `;
}

function renderDistributionPhase(piece) {
  const texts = state.texts.filter(text => text.pieceId === piece.id);
  const linkedItems = getPieceInstagramItems(piece.id);
  const metrics = getPieceInstagramMetrics(piece.id);

  return `
    <div class="stack">
      <form class="panel stack" data-piece-form="distribution" data-piece-id="${piece.id}">
        <h3>Distribuição</h3>
        <div class="notice">
          <strong>Insights via Instagram</strong>
          <span>Esta peça só lê métricas reais do Instagram, usando a Meta Graph API. Não há integração com TikTok Analytics nem YouTube Studio por enquanto.</span>
        </div>
        <input name="igMediaId" value="${escapeHtml(piece.distribution.igMediaId)}" placeholder="ig_media_id da publicação real" />
        <input name="permalink" value="${escapeHtml(piece.distribution.permalink)}" placeholder="Permalink do Instagram" />
        <button class="primary-action" type="submit">Salvar vínculo real</button>
      </form>

      <section class="panel">
        <h3>Legendas vinculadas</h3>
        ${texts.length ? `<div class="stack mini">${texts.map(text => `<div class="line-card"><strong>${formatPlatform(text.platform)}</strong><span>${escapeHtml(text.title)}</span></div>`).join("")}</div>` : `<p>Nenhuma legenda salva para esta peça ainda.</p>`}
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
              <select name="libraryItemId">
                <option value="">${options.length ? "Selecione da biblioteca" : "Sem itens na biblioteca"}</option>
                ${options.map(option => `<option value="${option.id}">${escapeHtml(option.name)}</option>`).join("")}
              </select>
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
  const texts = state.texts.filter(text => matchesQuery([
    text.title,
    text.body,
    text.platform,
    text.seoTerms.join(" "),
    text.hashtags.join(" ")
  ], query));

  const selectedCaptionPiece = state.pieces.find(piece => piece.id === (captionDrafts[0]?.pieceId || selectedPieceId)) || state.pieces[0] || null;
  const defaultPlatforms = captionDrafts.length
    ? captionDrafts.map(item => item.platform)
    : (selectedCaptionPiece?.platforms?.length ? selectedCaptionPiece.platforms : ["instagram", "tiktok", "shorts"]);
  const captionTheme = selectedCaptionPiece ? getPieceTheme(selectedCaptionPiece) : "";
  const captionScript = selectedCaptionPiece ? getScriptSummary(selectedCaptionPiece.id) : "";

  return `
    <div class="stack">
      <section class="platform-rules">
        ${Object.entries(platformRules).map(([platform, rule]) => `
          <div class="rule-card">
            <strong>${rule.label}</strong>
            <span>${rule.note}</span>
            <small>${Number.isFinite(rule.characterLimit) ? `${rule.characterLimit} caracteres` : "limite amplo"}</small>
            ${platform === "shorts" ? `<small>Campos extras: título, descrição e tags.</small>` : ""}
          </div>
        `).join("")}
      </section>

      <form class="panel stack" id="captionGeneratorForm">
        <h3>Gerar legendas com IA</h3>
        <div class="notice">
          <strong>Fluxo padrão</strong>
          <span>A IA lê o título da peça, o objetivo do brief, o roteiro gerado, hashtags e termos SEO já usados no banco para montar a legenda de cada plataforma.</span>
        </div>
        <select name="pieceId">
          ${state.pieces.map(piece => `<option value="${piece.id}" ${piece.id === selectedCaptionPiece?.id ? "selected" : ""}>${escapeHtml(piece.title)}</option>`).join("")}
        </select>
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
        <button class="primary-action" type="submit" ${selectedCaptionPiece ? "" : "disabled"}>Gerar com IA</button>
      </form>

      ${captionDrafts.length ? `
        <section class="caption-preview-grid">
          ${captionDrafts.map(draft => renderCaptionDraft(draft)).join("")}
        </section>
      ` : ""}

      <section class="stack">
        ${texts.length ? texts.map(renderTextCard).join("") : emptyState("Nenhuma legenda salva ainda.", "Gere as primeiras legendas da peça para começar a distribuição.")}
      </section>
    </div>
  `;
}

function renderCaptionDraft(draft) {
  const rule = platformRules[draft.platform];
  return `
    <form class="panel stack caption-card" data-caption-draft="${draft.id}">
      <div class="item-topline">
        <span>${rule.label}</span>
        <strong>${draft.body.length}/${rule.characterLimit}</strong>
      </div>
      <input name="title" value="${escapeHtml(draft.title)}" />
      <textarea name="body">${escapeHtml(draft.body)}</textarea>
      <input name="seoTerms" value="${escapeHtml(draft.seoTerms.join(", "))}" placeholder="SEO separado por vírgula" />
      <input name="hashtags" value="${escapeHtml(draft.hashtags.join(" "))}" placeholder="hashtags separadas por espaço" />
      ${draft.platform === "shorts" ? `
        <div class="stack shorts-fields">
          <input name="ytTitle" value="${escapeHtml(draft.ytTitle)}" maxlength="100" placeholder="Título do Shorts (até 100 caracteres)" />
          <textarea name="ytDescription" maxlength="5000" placeholder="Descrição do Shorts">${escapeHtml(draft.ytDescription)}</textarea>
          <input name="ytTags" value="${escapeHtml(draft.ytTags)}" maxlength="500" placeholder="Tags do Shorts separadas por vírgula" />
        </div>
      ` : ""}
      <div class="inline-actions">
        <button class="primary-action" type="submit">Aceitar legenda</button>
        <button class="ghost-action compact" type="button" data-discard-caption="${draft.id}">Descartar</button>
      </div>
    </form>
  `;
}

function renderTextCard(text) {
  const rule = platformRules[text.platform];
  const characterCount = text.body.length;
  const hashtagCount = text.hashtags.length;
  const characterStatus = characterCount <= rule.characterLimit ? "ok" : "alert";
  const hashtagStatus = !Number.isFinite(rule.hashtagLimit) || hashtagCount <= rule.hashtagLimit ? "ok" : "alert";

  return `
    <article class="item-card">
      <div class="item-topline">
        <span>${rule.label}</span>
        <strong class="${characterStatus}">${characterCount}/${rule.characterLimit}</strong>
      </div>
      <h3>${escapeHtml(text.title)}</h3>
      <small class="linked-video">Peça: ${escapeHtml(findPieceTitle(text.pieceId))}</small>
      <p>${escapeHtml(text.body || "Sem corpo de legenda.")}</p>
      <div class="keyword-line">${text.seoTerms.map(term => `<span>${escapeHtml(term)}</span>`).join("")}</div>
      <div class="tag-row ${hashtagStatus}">${text.hashtags.map(tag => `<span>${escapeHtml(withHash(tag))}</span>`).join("")}</div>
      ${text.platform === "shorts" ? `
        <div class="stack mini">
          <small><strong>Título:</strong> ${escapeHtml(text.ytTitle || "não preenchido")}</small>
          <small><strong>Tags:</strong> ${escapeHtml(text.ytTags || "não preenchidas")}</small>
        </div>
      ` : ""}
    </article>
  `;
}

function renderFiles(query) {
  const files = state.files.filter(file => matchesQuery([file.name, file.kind, file.version, file.location], query));
  return files.length ? `
    <div class="file-grid">
      ${files.map(file => `
        <article class="file-tile">
          <span>${escapeHtml(file.kind || "arquivo")}</span>
          <h3>${escapeHtml(file.name)}</h3>
          <p>${escapeHtml(file.version || "sem versão")}</p>
          <small>${escapeHtml(file.location || "sem local")} • ${escapeHtml(file.updatedAt || "sem data")}</small>
        </article>
      `).join("")}
    </div>
  ` : emptyState();
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
        <form class="panel stack" id="libraryForm">
          <h3>${editingLibraryItem ? "Editar item da biblioteca" : "Novo item da biblioteca"}</h3>
          <input type="hidden" name="libraryItemId" value="${escapeHtml(editingLibraryItem?.id || "")}" />
          <input name="name" value="${escapeHtml(editingLibraryItem?.name || "")}" placeholder="Nome do item" required />
          <input type="hidden" name="category" value="${escapeHtml(currentLibraryCategory)}" />
          <input name="notes" value="${escapeHtml(editingLibraryItem?.notes || "")}" placeholder="Notas" />
          <input name="example" value="${escapeHtml(editingLibraryItem?.example || "")}" placeholder="Exemplo" />
          <input name="context" value="${escapeHtml((editingLibraryItem?.context || []).join(", "))}" placeholder="Contextos separados por vírgula" />
          <div class="checkbox-grid">
            ${renderPlatformCheckbox("platforms", editingLibraryItem?.platforms || ["instagram", "tiktok", "shorts"])}
          </div>
          <div class="inline-actions">
            <button class="primary-action" type="submit">${editingLibraryItem ? "Salvar alterações" : "Salvar item"}</button>
            ${editingLibraryItem ? `<button class="ghost-action compact" type="button" id="cancelLibraryEdit">Cancelar</button>` : ""}
          </div>
        </form>

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

  return `
    <div class="assistant-page">
      <section class="panel">
        <h3>Visão geral diária</h3>
        <p>${insightsReport.rangeLabel}</p>
        <small>Janela fixa do dia 1 até hoje, usando só os insights do Instagram.</small>
      </section>
      <section class="panel">
        <h3>Resumo de desempenho</h3>
        <p>${escapeHtml(insightsReport.summary)}</p>
      </section>
      <section class="panel">
        <h3>Melhor conteúdo do período</h3>
        ${insightsReport.bestContent ? `
          <p>${escapeHtml(insightsReport.bestContent.item.caption || "Conteúdo sem legenda")}</p>
          <small>Engajamento relativo: ${formatPercent(insightsReport.bestContent.score)}.</small>
        ` : `<p>Nenhum conteúdo com métricas no período.</p>`}
      </section>
      <section class="panel">
        <h3>Alerta de queda ou pico</h3>
        <p>${escapeHtml(insightsReport.alert)}</p>
      </section>
      <section class="panel">
        <h3>Sugestão de próximo conteúdo</h3>
        <p>${escapeHtml(insightsReport.nextSuggestion)}</p>
      </section>
      <section class="panel">
        <h3>Escopo atual</h3>
        <p>Esta área analisa apenas Instagram via Meta Graph API. O gerador de legendas foi movido para a aba de Legendas.</p>
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
      <section class="panel">
        <h3>Escopo da integração</h3>
        <p>Este dashboard mostra somente métricas do Instagram, lidas pela Meta Graph API. Não há dados de TikTok Analytics ou YouTube Studio aqui.</p>
      </section>

      <div class="dashboard-toolbar">
        <div class="segmented-control" aria-label="Visão dos insights">
          <button class="${instagramView === "overview" ? "active" : ""}" type="button" data-instagram-view="overview">Geral</button>
          <button class="${instagramView === "content" ? "active" : ""}" type="button" data-instagram-view="content">Por conteúdo</button>
        </div>
        <div class="dashboard-actions">
          ${instagramDashboard.account ? "" : `<a class="ghost-action dashboard-connect" href="/api/instagram/connect">Conectar Instagram</a>`}
          <button class="primary-action" type="button" data-sync-instagram>${isInstagramSyncing ? "Sincronizando..." : "Atualizar insights"}</button>
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
  attachIdeaEvents();
  attachPieceEvents();
  attachTextEvents();
  attachLibraryEvents();
  attachDashboardEvents();
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
      if (!ideaId || !window.confirm("Excluir esta ideia?")) return;
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
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-piece-form='script']").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const pieceId = currentForm.dataset.pieceId;
      const structureItemId = String(new FormData(currentForm).get("structureItemId") || "").trim();
      const template = inferTemplateFromStructureId(structureItemId);
      upsertScriptFromForm(pieceId, template, currentForm);
      syncSingleLibraryComponent(pieceId, "script_structure", structureItemId, { required: true, used: true });
      syncMultiLibraryComponents(pieceId, "cta", getCheckedValues(currentForm, "ctaIds"), { required: true, used: true });
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-script-structure-select]").forEach(select => {
    const structureSelect = /** @type {HTMLSelectElement} */ (select);
    structureSelect.addEventListener("change", async () => {
      const pieceId = structureSelect.dataset.scriptStructureSelect;
      if (!pieceId) return;
      const template = inferTemplateFromStructureId(structureSelect.value);
      const script = getOrCreateScript(pieceId);
      script.template = template;
      script.fields = getTemplateDefaults(template);
      syncSingleLibraryComponent(pieceId, "script_structure", structureSelect.value, { required: true, used: true });
      await persistAndRender();
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
      const selectedOptions = Array.from(currentForm.querySelectorAll('select[name="cameraAngleIds"] option:checked')).map(option => /** @type {HTMLOptionElement} */ (option).value);
      syncMultiLibraryComponents(piece.id, "camera_angle", selectedOptions, { required: true, used: true });
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
      piece.distribution.igMediaId = String(formData.get("igMediaId") || "").trim();
      piece.distribution.permalink = String(formData.get("permalink") || "").trim();
      await persistAndRender({ reloadInstagram: true });
    });
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
      state.pieceComponents = state.pieceComponents.filter(item => item.id !== removeButton.dataset.removeComponent);
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-script-generate]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", async () => {
      const piece = state.pieces.find(item => item.id === actionButton.dataset.scriptGenerate);
      if (!piece) return;
      const idea = state.ideas.find(item => item.id === piece.ideaId) || null;
      const script = getOrCreateScript(piece.id);
      script.fields = buildScriptFromIdea(script.template, piece, idea, script.fields);
      syncSuggestedCtas(piece.id, suggestCtasForObjective(piece.brief.objective));
      syncSuggestedHeaders(piece.id, buildHeaderSuggestions(script.template, script.fields, piece));
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-script-improve]").forEach(button => {
    const actionButton = /** @type {HTMLButtonElement} */ (button);
    actionButton.addEventListener("click", async () => {
      const piece = state.pieces.find(item => item.id === actionButton.dataset.scriptImprove);
      if (!piece) return;
      const script = getOrCreateScript(piece.id);
      script.fields = improveScriptFields(script.template, script.fields, piece);
      syncSuggestedCtas(piece.id, suggestCtasForObjective(piece.brief.objective));
      syncSuggestedHeaders(piece.id, buildHeaderSuggestions(script.template, script.fields, piece));
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-delete-piece]").forEach(button => {
    const deleteButton = /** @type {HTMLButtonElement} */ (button);
    deleteButton.addEventListener("click", async () => {
      const pieceId = deleteButton.dataset.deletePiece;
      if (!pieceId || !window.confirm("Excluir esta peça e os vínculos relacionados?")) return;
      state.pieces = state.pieces.filter(item => item.id !== pieceId);
      state.scripts = state.scripts.filter(item => item.pieceId !== pieceId);
      state.pieceComponents = state.pieceComponents.filter(item => item.pieceId !== pieceId);
      state.texts = state.texts.filter(item => item.pieceId !== pieceId);
      state.files = state.files.filter(item => item.pieceId !== pieceId);
      state.publications = state.publications.filter(item => item.pieceId !== pieceId);
      if (selectedPieceId === pieceId) {
        selectedPieceId = state.pieces[0]?.id || null;
      }
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-quick-add-library]").forEach(button => {
    const addButton = /** @type {HTMLButtonElement} */ (button);
    addButton.addEventListener("click", async () => {
      const category = addButton.dataset.quickAddLibrary;
      if (!category) return;
      await quickAddLibraryItem(category);
      await persistAndRender();
    });
  });
}

function attachTextEvents() {
  const generatorForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#captionGeneratorForm"));
  generatorForm?.addEventListener("submit", event => {
    event.preventDefault();
    const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
    const formData = new FormData(currentForm);
    const pieceId = String(formData.get("pieceId") || "").trim() || null;
    const platforms = getCheckedValues(currentForm, "platforms");
    const piece = state.pieces.find(item => item.id === pieceId) || null;
    captionDrafts = buildCaptionDrafts({ piece, pieceId, platforms });
    render();
  });

  generatorForm?.querySelector('select[name="pieceId"]')?.addEventListener("change", event => {
    const select = /** @type {HTMLSelectElement} */ (event.currentTarget);
    selectedPieceId = select.value || null;
    captionDrafts = [];
    render();
  });

  document.querySelectorAll("[data-caption-draft]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
      const draft = captionDrafts.find(item => item.id === currentForm.dataset.captionDraft);
      if (!draft) return;
      const formData = new FormData(currentForm);
      state.texts.unshift({
        id: createId("text"),
        pieceId: draft.pieceId || null,
        platform: draft.platform,
        title: String(formData.get("title") || "").trim(),
        body: String(formData.get("body") || "").trim(),
        seoTerms: splitCommaList(formData.get("seoTerms")),
        hashtags: splitHashList(formData.get("hashtags")),
        ytTitle: String(formData.get("ytTitle") || "").trim(),
        ytDescription: String(formData.get("ytDescription") || "").trim(),
        ytTags: String(formData.get("ytTags") || "").trim(),
        updatedAt: new Date().toISOString()
      });
      captionDrafts = captionDrafts.filter(item => item.id !== draft.id);
      await persistAndRender();
    });
  });

  document.querySelectorAll("[data-discard-caption]").forEach(button => {
    const discardButton = /** @type {HTMLButtonElement} */ (button);
    discardButton.addEventListener("click", () => {
      captionDrafts = captionDrafts.filter(item => item.id !== discardButton.dataset.discardCaption);
      render();
    });
  });
}

function attachLibraryEvents() {
  const libraryForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#libraryForm"));
  libraryForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const currentForm = /** @type {HTMLFormElement} */ (event.currentTarget);
    const formData = new FormData(currentForm);
    const existing = state.library.find(item => item.id === String(formData.get("libraryItemId") || "").trim());
    const nextItem = existing || {
      id: createUuid(),
      createdAt: new Date().toISOString()
    };
    Object.assign(nextItem, {
      name: String(formData.get("name") || "").trim(),
      category: String(formData.get("category") || currentLibraryCategory),
      notes: String(formData.get("notes") || "").trim(),
      example: String(formData.get("example") || "").trim(),
      context: splitCommaList(formData.get("context")),
      platforms: getCheckedValues(currentForm, "platforms")
    });
    if (!existing) {
      state.library.unshift(nextItem);
    }
    editingLibraryItemId = null;
    await persistAndRender();
  });

  document.querySelector("#cancelLibraryEdit")?.addEventListener("click", () => {
    editingLibraryItemId = null;
    render();
  });

  document.querySelectorAll("[data-library-category]").forEach(button => {
    const categoryButton = /** @type {HTMLButtonElement} */ (button);
    categoryButton.addEventListener("click", () => {
      currentLibraryCategory = categoryButton.dataset.libraryCategory || currentLibraryCategory;
      render();
    });
  });

  document.querySelectorAll("[data-edit-library]").forEach(button => {
    const editButton = /** @type {HTMLButtonElement} */ (button);
    editButton.addEventListener("click", () => {
      editingLibraryItemId = editButton.dataset.editLibrary || null;
      render();
    });
  });

  document.querySelectorAll("[data-delete-library]").forEach(button => {
    const deleteButton = /** @type {HTMLButtonElement} */ (button);
    deleteButton.addEventListener("click", async () => {
      const itemId = deleteButton.dataset.deleteLibrary;
      if (!itemId || !window.confirm("Excluir este item da biblioteca?")) return;
      state.library = state.library.filter(item => item.id !== itemId);
      state.pieceComponents = state.pieceComponents.map(component => component.libraryItemId === itemId ? { ...component, libraryItemId: null } : component);
      if (editingLibraryItemId === itemId) editingLibraryItemId = null;
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
      instagramDashboard = await loadInstagramDashboard();
    } catch (error) {
      console.error(error);
    } finally {
      isInstagramSyncing = false;
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

function buildCaptionDrafts({ piece, pieceId, platforms }) {
  const selectedPlatforms = platforms.length ? platforms : ["instagram", "tiktok", "shorts"];
  const context = assistantGateway.collectCaptionContext(state);
  const title = piece?.title || "";
  const theme = getPieceTheme(piece);
  const scriptSummary = piece ? getScriptSummary(piece.id) : "";
  return selectedPlatforms.map(platform => {
    const rule = platformRules[platform];
    const pieceTitle = piece?.title || "";
    const draft = assistantGateway.improveCaption({
      title,
      theme: [theme, scriptSummary, piece?.brief.objective].filter(Boolean).join(". "),
      platform,
      pieceTitle,
      rules: rule,
      context
    });
    const hashtags = limitHashtags(draft.hashtags, rule.hashtagLimit);
    const body = finalizeCaptionBody(draft.body, hashtags, rule.characterLimit);
    const ytTitle = platform === "shorts" ? fitToLength(`${title} ${hashtags.slice(0, 3).join(" ")}`.trim(), 100) : "";
    const ytDescription = platform === "shorts" ? `${body}\n\nPalavras-chave: ${draft.seoTerms.join(", ")}`.trim() : "";
    const ytTags = platform === "shorts" ? draft.seoTerms.concat(hashtags.map(stripHash)).join(", ").slice(0, 500) : "";

    return {
      id: createId("draft"),
      pieceId: pieceId || null,
      platform,
      title: draft.title || title,
      body,
      seoTerms: draft.seoTerms,
      hashtags,
      ytTitle,
      ytDescription,
      ytTags
    };
  });
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
    if (piece.distribution.permalink && item.permalink === piece.distribution.permalink) return true;
    return false;
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
      description: isLegendasComplete(piece) ? "Legendas já geradas." : "Gere as legendas por plataforma."
    }
  ];
}

function hasScriptContent(script) {
  if (script.template === "tutorial") return Boolean((script.fields.steps || []).length);
  return Object.values(script.fields || {}).some(value => String(value || "").trim());
}

function readScriptFields(template, form) {
  if (template === "tutorial") {
    return {
      steps: String(new FormData(form).get("steps") || "")
        .split("\n")
        .map(item => item.trim())
        .filter(Boolean)
    };
  }

  const fields = {};
  for (const field of scriptTemplates[template] || []) {
    fields[field.key] = String(new FormData(form).get(field.key) || "").trim();
  }
  return fields;
}

function renderScriptField(script, field) {
  if (field.multiline) {
    return `<textarea name="${field.key}" placeholder="${field.label}">${escapeHtml((script.fields?.[field.key] || []).join("\n"))}</textarea>`;
  }
  return `<textarea name="${field.key}" placeholder="${field.label}">${escapeHtml(script.fields?.[field.key] || "")}</textarea>`;
}

function getTemplateDefaults(template) {
  if (template === "educacional") {
    return { problema: "", solucao: "", prova: "", cta: "" };
  }
  if (template === "tutorial") {
    return { steps: [] };
  }
  return {
    oQueAconteceu: "",
    onde: "",
    quando: "",
    quemEstava: "",
    comoFoi: "",
    desfecho: "",
    aprendizado: ""
  };
}

function inferTemplateFromStructureId(structureItemId) {
  const structure = state.library.find(item => item.id === structureItemId);
  const token = normalizeToken(`${structure?.name || ""} ${structure?.notes || ""}`);
  if (token.includes("tutorial")) return "tutorial";
  if (token.includes("educa")) return "educacional";
  return "storytelling";
}

async function quickAddLibraryItem(category) {
  const name = window.prompt(`Novo item para ${getCategoryLabel(category)}:`);
  if (!name?.trim()) return null;
  const item = {
    id: createUuid(),
    name: name.trim(),
    category,
    context: [],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "",
    example: "",
    createdAt: new Date().toISOString()
  };
  state.library.unshift(item);
  return item;
}

function renderLibrarySingleSelect({ fieldName, category, value, options, placeholder, addLabel, dataset = "" }) {
  return `
    <div class="stack mini">
      <select name="${fieldName}" ${dataset}>
        <option value="">${escapeHtml(placeholder)}</option>
        ${options.map(option => `<option value="${option.id}" ${option.id === value ? "selected" : ""}>${escapeHtml(option.name)}</option>`).join("")}
      </select>
      <button class="ghost-action compact align-start" type="button" data-quick-add-library="${category}">${escapeHtml(addLabel)}</button>
    </div>
  `;
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

function syncSuggestedHeaders(pieceId, suggestions) {
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
    piece.edit.headerRecommendation = suggestions.length
      ? "A peça pode usar headers para reforçar pontos-chave e CTA visual."
      : "Esta peça pode funcionar bem sem header textual em tela.";
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
  if (script.template === "tutorial") {
    return (script.fields.steps || []).join(" ");
  }
  return Object.values(script.fields || {}).filter(Boolean).join(" ");
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
    camera: `<svg viewBox="0 0 24 24" class="icon"><path d="M4 7h4l2-2h4l2 2h4v12H4V7Z"/><circle cx="12" cy="13" r="4"/></svg>`,
    list: `<svg viewBox="0 0 24 24" class="icon"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`
  };
  return icons[name] || icons.chart;
}

init();
