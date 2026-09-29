import type { SpindleFrontendContext } from "lumiverse-spindle-types";

/** Error modal with an optional "View response" pane showing the
 *  provider response (pretty-printed JSON) that caused the failure.
 *  Built on `showModal` rather than `showConfirm` because the latter
 *  can't tell its secondary button apart from the close button.
 *  Resolves once the modal is closed, however that happens. */
export function showErrorModal(
  ctx: SpindleFrontendContext,
  message: string,
  raw?: string
): Promise<void> {
  let modal: ReturnType<SpindleFrontendContext["ui"]["showModal"]>;
  try {
    modal = ctx.ui.showModal({ title: "Hone: Error", width: 520, maxHeight: 600 });
  } catch {
    // Stacked-modal cap reached: fall back to the host confirm so the
    // error is still shown, just without the response viewer.
    return ctx.ui
      .showConfirm({ title: "Hone Error", message, confirmLabel: "OK", variant: "danger" })
      .then(() => {}, () => {});
  }

  const done = new Promise<void>((resolve) => {
    modal.onDismiss(() => resolve());
  });

  const button = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = primary ? "hone-error-btn hone-error-btn--primary" : "hone-error-btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  };

  const renderMessage = () => {
    modal.setTitle("Hone: Error");
    modal.root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "hone-error-modal";

    const text = document.createElement("p");
    text.className = "hone-error-modal__message";
    text.textContent = message;
    wrap.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "hone-error-modal__actions";
    actions.appendChild(button("OK", true, () => modal.dismiss()));
    if (raw) actions.appendChild(button("View response", false, renderRaw));
    wrap.appendChild(actions);

    modal.root.appendChild(wrap);
  };

  const renderRaw = () => {
    if (!raw) return;
    modal.setTitle("Hone: Response");
    modal.root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "hone-error-modal";

    const toolbar = document.createElement("div");
    toolbar.className = "hone-error-modal__toolbar";
    toolbar.appendChild(button("‹ Back", false, renderMessage));
    const copyBtn = button("Copy", false, () => {
      navigator.clipboard?.writeText(raw).then(
        () => { copyBtn.textContent = "Copied"; },
        () => { copyBtn.textContent = "Copy failed"; }
      );
    });
    toolbar.appendChild(copyBtn);
    wrap.appendChild(toolbar);

    const pre = document.createElement("pre");
    pre.className = "hone-error-modal__raw";
    pre.textContent = raw;
    wrap.appendChild(pre);

    const actions = document.createElement("div");
    actions.className = "hone-error-modal__actions";
    actions.appendChild(button("OK", true, () => modal.dismiss()));
    wrap.appendChild(actions);

    modal.root.appendChild(wrap);
  };

  renderMessage();
  return done;
}
