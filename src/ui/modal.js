let activeModal = null;
/** @type {HTMLElement | null} */
let previousFocus = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ensureModalRoot() {
  let root = document.getElementById("modalRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "modalRoot";
    root.className = "modal-root";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    document.body.appendChild(root);
  }
  return root;
}

function closeActiveModal(value) {
  if (!activeModal) return;
  const { root, onKeyDown } = activeModal;
  document.removeEventListener("keydown", onKeyDown);
  root.innerHTML = "";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  if (previousFocus instanceof HTMLElement) {
    previousFocus.focus();
  }
  const resolve = activeModal.resolve;
  activeModal = null;
  previousFocus = null;
  resolve(value);
}

function mountModal({ title, bodyHtml, actionsHtml, onReady }) {
  return new Promise(resolve => {
    const root = ensureModalRoot();
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    const onKeyDown = event => {
      if (event.key === "Escape") closeActiveModal(null);
    };

    root.innerHTML = `
      <div class="modal-backdrop" data-modal-dismiss></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-panel">
          <h3 id="modalTitle" class="modal-title">${escapeHtml(title)}</h3>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-actions">${actionsHtml}</div>
        </div>
      </div>
    `;

    activeModal = { resolve, root, onKeyDown };
    document.addEventListener("keydown", onKeyDown);

    root.querySelector("[data-modal-dismiss]")?.addEventListener("click", () => closeActiveModal(null));
    onReady?.(root, closeActiveModal);

    const dialog = root.querySelector(".modal-dialog");
    dialog?.addEventListener("click", event => event.stopPropagation());
  });
}

export function openConfirm({
  title = "Confirmar",
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false
} = {}) {
  return mountModal({
    title,
    bodyHtml: `<p class="modal-message">${escapeHtml(message)}</p>`,
    actionsHtml: `
      <button class="ghost-action" type="button" data-modal-cancel>${escapeHtml(cancelLabel)}</button>
      <button class="primary-action ${danger ? "danger-action" : ""}" type="button" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
    `,
    onReady(root, close) {
      root.querySelector("[data-modal-cancel]")?.addEventListener("click", () => close(false));
      root.querySelector("[data-modal-confirm]")?.addEventListener("click", () => close(true));
      root.querySelector("[data-modal-confirm]")?.focus();
    }
  });
}

export function openPrompt({
  title,
  message = "",
  label = "Nome",
  placeholder = "",
  defaultValue = "",
  confirmLabel = "Salvar",
  cancelLabel = "Cancelar"
} = {}) {
  return mountModal({
    title,
    bodyHtml: `
      ${message ? `<p class="modal-message">${escapeHtml(message)}</p>` : ""}
      <label class="modal-field">
        <span class="field-label">${escapeHtml(label)}</span>
        <input type="text" data-modal-input value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" />
      </label>
    `,
    actionsHtml: `
      <button class="ghost-action" type="button" data-modal-cancel>${escapeHtml(cancelLabel)}</button>
      <button class="primary-action" type="button" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
    `,
    onReady(root, close) {
      const input = /** @type {HTMLInputElement | null} */ (root.querySelector("[data-modal-input]"));
      const submit = () => {
        const value = input?.value.trim() || "";
        close(value || null);
      };

      root.querySelector("[data-modal-cancel]")?.addEventListener("click", () => close(null));
      root.querySelector("[data-modal-confirm]")?.addEventListener("click", submit);
      input?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });
      input?.focus();
      input?.select();
    }
  });
}
