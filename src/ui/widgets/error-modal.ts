const ALERT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
const CLOSE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/** Error modal with an optional "View response" pane showing the
 *  provider response (pretty-printed JSON) that caused the failure.
 *
 *  Own overlay rather than a host modal: `showConfirm` can't tell its
 *  secondary button apart from the close button, and `showModal`'s
 *  chrome is inline-styled and plain. The markup and `.hone-error-*`
 *  styles mirror Lumiverse's ConfirmationModal (danger variant) so it
 *  follows the active theme the same way the host dialog does.
 *  Resolves once the modal is closed, however that happens. */
export function showErrorModal(message: string, raw?: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "hone-error-overlay";

    const modal = document.createElement("div");
    modal.className = "hone-error-modal";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    overlay.appendChild(modal);

    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const button = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = primary ? "hone-error-btn hone-error-btn--primary" : "hone-error-btn";
      btn.textContent = label;
      btn.addEventListener("click", onClick);
      return btn;
    };

    const renderFrame = (title: string, wide: boolean) => {
      modal.innerHTML = "";
      modal.classList.toggle("hone-error-modal--wide", wide);

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "hone-error-modal__close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.innerHTML = CLOSE_ICON;
      closeBtn.addEventListener("click", close);
      modal.appendChild(closeBtn);

      const content = document.createElement("div");
      content.className = "hone-error-modal__content";
      const icon = document.createElement("div");
      icon.className = "hone-error-modal__icon";
      icon.innerHTML = ALERT_ICON;
      content.appendChild(icon);
      const h = document.createElement("h3");
      h.className = "hone-error-modal__title";
      h.textContent = title;
      content.appendChild(h);
      modal.appendChild(content);

      const actions = document.createElement("div");
      actions.className = "hone-error-modal__actions";
      modal.appendChild(actions);
      return { content, actions };
    };

    const renderMessage = () => {
      const { content, actions } = renderFrame("Hone Error", false);
      const text = document.createElement("div");
      text.className = "hone-error-modal__message";
      text.textContent = message;
      content.appendChild(text);

      if (raw) actions.appendChild(button("View response", false, renderRaw));
      actions.appendChild(button("OK", true, close));
    };

    const renderRaw = () => {
      if (!raw) return;
      const { content, actions } = renderFrame("LLM Response", true);
      const pre = document.createElement("pre");
      pre.className = "hone-error-modal__raw";
      pre.textContent = raw;
      content.appendChild(pre);

      actions.appendChild(button("\u2039 Back", false, renderMessage));
      const copyBtn = button("Copy", false, () => {
        navigator.clipboard?.writeText(raw).then(
          () => { copyBtn.textContent = "Copied"; },
          () => { copyBtn.textContent = "Copy failed"; }
        );
      });
      actions.appendChild(copyBtn);
      actions.appendChild(button("OK", true, close));
    };

    renderMessage();
    document.body.appendChild(overlay);
  });
}
