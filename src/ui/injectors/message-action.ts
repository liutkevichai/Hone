// DOM-injection for per-message refine/undo buttons. Temporary
// until Lumiverse exposes a registerMessageAction contribution API.
// Swap seam: keep the MessageActionInjector interface stable.
//
// Stable selectors (verified in vendor/Lumiverse/frontend/src/
// components/chat/):
//   [data-component="MessageList"]    : scroll root (observer target)
//   [data-message-id]                 : per-message wrapper
//   [data-part]                       : "user" | "character" | "streaming"
//   [data-component="BubbleActions"]  : bubble-mode action bar
//
// These attributes are written by React directly (not CSS modules)
// so they survive build hashes. If any change upstream, this
// injector silently no-ops; it MUST never throw into the host's
// render cycle. The drawer and float widget stay functional without it.

import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { FrontendToBackend, PresetSummary } from "../../types";
import { REFINE_ICON_SVG, UNDO_ICON_SVG, SPINNER_ICON_SVG } from "../icons";
import { observeRoot } from "./observe-root";

/** Press-and-hold duration on a refined button before a re-hone fires
 *  (lock the current refinement as the new base and refine again). When
 *  the user has custom output presets, the hold opens a menu to pick
 *  which one to re-hone with. */
const HOLD_TO_RERUN_MS = 600;

/* Matches the native `.pill button` shape (26×26, transparent, 6px
 * radius) so the Hone button sits flush next to Copy/Edit/Fork. Same
 * display-toggle icon pattern as input-area-injector.ts. */
const INJECTOR_STYLES = `
button[data-hone-btn] {
  width: 26px;
  height: 26px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--lumiverse-text-dim, rgba(230, 230, 240, 0.55));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background 120ms ease, color 120ms ease, opacity 120ms ease;
}
button[data-hone-btn]:hover:not(:disabled) {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text, inherit);
}
button[data-hone-btn]:disabled {
  opacity: 0.4;
  cursor: default;
}
button[data-hone-btn].hone-msg-btn--refined {
  color: var(--lumiverse-primary, #4a90e2);
}
/* Press-and-hold charge feedback on refined buttons: grows toward the
 * hold threshold, then snaps back when the re-hone fires or the press
 * is released early. */
button[data-hone-btn].hone-msg-btn--holding {
  transform: scale(1.25);
  transition: transform ${HOLD_TO_RERUN_MS}ms ease-in;
}
button[data-hone-btn] .hone-icon {
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
button[data-hone-btn]:not(.hone-msg-btn--refined):not(.hone-msg-btn--busy) .hone-icon--refine {
  display: inline-flex;
}
button[data-hone-btn].hone-msg-btn--refined:not(.hone-msg-btn--busy) .hone-icon--undo {
  display: inline-flex;
}
button[data-hone-btn].hone-msg-btn--busy .hone-icon--spinner {
  display: inline-flex;
  animation: hone-msg-spin 1s linear infinite;
  transform-origin: 50% 50%;
}
@keyframes hone-msg-spin {
  to { transform: rotate(360deg); }
}
`;

/** Stable seam. Pure mirror of backend state: per-message state is
 *  never derived locally; only the `active-chat` snapshot from the
 *  backend drives `setRefinedMessages`. */
export interface MessageActionInjector {
  setRefinedMessages(ids: Iterable<string>): void;
  /** Optimistic busy on click; reconciled by refine-started /
   *  refine-complete. */
  setBusy(messageId: string, busy: boolean): void;
  /** Mirror of the backend `presets` push; feeds the re-hone menu. */
  setPresets(presets: PresetSummary[], activeId: string): void;
  rescan(): void;
  destroy(): void;
}

export function createMessageActionInjector(
  ctx: SpindleFrontendContext,
  sendToBackend: (msg: FrontendToBackend) => void,
  getActiveChatId: () => string | null,
  isReady: () => boolean
): MessageActionInjector {
  const refinedIds = new Set<string>();
  const busyIds = new Set<string>();
  /** User-created output presets, offered by the re-hone menu. */
  let customPresets: PresetSummary[] = [];
  let activePresetId = "";

  const removeStyle = ctx.dom.addStyle(INJECTOR_STYLES);

  const observation = observeRoot({
    findRoot: () => document.querySelector('[data-component="MessageList"]'),
    onMount: (root) => scanAndInject(root),
    // Watch attribute mutations on `data-part` in addition to childList:
    // Lumiverse stages the real message in the DB before streaming, so the
    // same React element flips `data-part="streaming"` -> `"character"` in
    // place when streaming ends. No childList mutation fires for that
    // transition; we'd otherwise miss the latest message until chat reopen.
    observerInit: {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-part"],
    },
    onMutation: (_root, mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes") {
          const target = m.target;
          if (!(target instanceof HTMLElement)) continue;
          const messageEl = target.closest("[data-message-id]");
          if (messageEl instanceof HTMLElement) injectInto(messageEl);
          continue;
        }
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof Element) scanAndInject(node);
        }
      }
    },
  });

  function scanAndInject(root: Element) {
    // Downward: message wrappers at or below root (initial mount,
    // streaming, chat switch, whole-row remount under virtualization).
    if (root instanceof HTMLElement && root.hasAttribute("data-message-id")) {
      injectInto(root);
    }
    const messages = root.querySelectorAll("[data-message-id]");
    messages.forEach((el) => injectInto(el as HTMLElement));

    // Upward: root was added INSIDE an existing message wrapper — React
    // remounted part of the bubble (e.g. the action bar coming back when
    // the user leaves edit mode) without the wrapper appearing in
    // addedNodes. Walking up instead of matching a specific action-bar
    // component covers every chat style (bubble's BubbleActions pill,
    // minimal's MessageActions row, and future layouts); injectInto is
    // idempotent so over-firing is harmless.
    const container = root.closest("[data-message-id]");
    if (container instanceof HTMLElement && container !== root) {
      injectInto(container);
    }
  }

  function findActionBar(messageEl: Element): Element | null {
    // Bubble mode: stable data-component attribute.
    const bubble = messageEl.querySelector('[data-component="BubbleActions"]');
    if (bubble) return bubble;
    // Minimal mode: walk up from the Edit button (stable across
    // modes, no CSS module dependency). If the shape changes
    // upstream the fallback quietly no-ops.
    const editBtn = messageEl.querySelector('button[title="Edit"]');
    if (editBtn && editBtn.parentElement) return editBtn.parentElement;
    return null;
  }

  function injectInto(messageEl: HTMLElement) {
    const part = messageEl.getAttribute("data-part");
    // Streaming messages: action bar isn't rendered yet; a follow-up
    // observer fire will catch the message once actions mount.
    if (part === "streaming") return;
    // User messages route through the input-bar enhance flow.
    if (part !== "character") return;

    const messageId = messageEl.getAttribute("data-message-id");
    if (!messageId) return;

    const bar = findActionBar(messageEl);
    if (!bar) return;

    // Guard against duplicate injection when React brings a fresh
    // bar for the same messageId.
    if (bar.querySelector('[data-hone-btn]')) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-hone-btn", messageId);
    btn.setAttribute("aria-label", "Hone this message");
    btn.title = "Hone this message";

    const refineIcon = document.createElement("span");
    refineIcon.className = "hone-icon hone-icon--refine";
    refineIcon.innerHTML = REFINE_ICON_SVG;
    const undoIcon = document.createElement("span");
    undoIcon.className = "hone-icon hone-icon--undo";
    undoIcon.innerHTML = UNDO_ICON_SVG;
    const spinnerIcon = document.createElement("span");
    spinnerIcon.className = "hone-icon hone-icon--spinner";
    spinnerIcon.innerHTML = SPINNER_ICON_SVG;
    btn.appendChild(refineIcon);
    btn.appendChild(undoIcon);
    btn.appendChild(spinnerIcon);

    // Press-and-hold on a refined button re-runs Hone on the current
    // (already-refined) text instead of undoing: the backend's saveUndo
    // overwrites the entry, so the held-down version becomes the new
    // undo base ("lock"). Plain click keeps its undo meaning.
    let holdTimer: number | null = null;
    let holdFired = false;
    const cancelHold = () => {
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
      btn.classList.remove("hone-msg-btn--holding");
    };
    btn.addEventListener("pointerdown", (e) => {
      // A completed hold whose pointer slid off the button never gets a
      // click; don't let the stale flag swallow the next press's click.
      holdFired = false;
      if (e.button !== 0) return;
      if (!isReady()) return;
      if (!refinedIds.has(messageId) || busyIds.has(messageId)) return;
      const menuPosition = { x: e.clientX, y: e.clientY };
      btn.classList.add("hone-msg-btn--holding");
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        holdFired = true;
        btn.classList.remove("hone-msg-btn--holding");
        void handleRerun(messageId, menuPosition);
      }, HOLD_TO_RERUN_MS);
    });
    btn.addEventListener("pointerup", cancelHold);
    btn.addEventListener("pointerleave", cancelHold);
    btn.addEventListener("pointercancel", cancelHold);
    // Touch long-press synthesizes a contextmenu event; the hold
    // gesture owns that press, so keep the host's menu out of it.
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (holdFired) {
        // The pointerup that ends a completed hold still dispatches a
        // click; swallow it so the re-hone isn't followed by an undo.
        holdFired = false;
        return;
      }
      handleClick(messageId);
    });
    try {
      bar.appendChild(btn);
    } catch {
      // Bar may have been unmounted between query and append.
      return;
    }
    updateButtonState(messageId);
  }

  function buttonsForMessage(messageId: string): NodeListOf<HTMLButtonElement> {
    return document.querySelectorAll(
      `[data-hone-btn="${CSS.escape(messageId)}"]`
    );
  }

  function updateButtonState(messageId: string) {
    const refined = refinedIds.has(messageId);
    const busy = busyIds.has(messageId);
    const disabled = !isReady();
    const title = busy
      ? "Honing... (click to cancel)"
      : refined
      ? customPresets.length > 0
        ? "Undo Hone refinement (hold to re-hone from current text with a chosen preset)"
        : "Undo Hone refinement (hold to re-hone from current text)"
      : "Hone this message";
    buttonsForMessage(messageId).forEach((btn) => {
      btn.disabled = disabled;
      btn.title = title;
      btn.classList.toggle("hone-msg-btn--refined", refined);
      btn.classList.toggle("hone-msg-btn--busy", busy);
    });
  }

  function updateAllButtonStates() {
    const buttons = document.querySelectorAll("[data-hone-btn]");
    const seen = new Set<string>();
    buttons.forEach((btn) => {
      const id = btn.getAttribute("data-hone-btn");
      if (id) seen.add(id);
    });
    seen.forEach(updateButtonState);
  }

  function handleClick(messageId: string) {
    if (!isReady()) return;

    const chatId = getActiveChatId();
    if (!chatId) return;

    if (busyIds.has(messageId)) {
      sendToBackend({ type: "cancel-refine", chatId, messageId });
      return;
    }

    const wantUndo = refinedIds.has(messageId);
    busyIds.add(messageId);
    updateButtonState(messageId);
    if (wantUndo) {
      sendToBackend({ type: "undo", chatId, messageId });
    } else {
      sendToBackend({ type: "refine", chatId, messageId });
    }
  }

  /** Hold-to-rerun on an already-refined message: refine the current
   *  content as the new base. The undo entry is overwritten backend-side,
   *  so a later click-undo returns to the version that was held, not the
   *  pristine original. With custom output presets available, the user
   *  first picks which one to re-hone with (a one-off override; the active
   *  preset is unchanged). Without any, re-hone uses the active preset. */
  async function handleRerun(messageId: string, position: { x: number; y: number }) {
    if (!isReady()) return;
    if (!getActiveChatId()) return;
    if (busyIds.has(messageId)) return;

    let presetId: string | undefined;
    if (customPresets.length > 0) {
      let selectedKey: string | null;
      try {
        ({ selectedKey } = await ctx.ui.showContextMenu({
          position,
          items: customPresets.map((p) => ({
            key: p.id,
            label: p.name,
            active: p.id === activePresetId,
          })),
        }));
      } catch {
        return;
      }
      if (!selectedKey) return;
      presetId = selectedKey;
    }

    // State may have moved while the menu was open.
    if (!isReady()) return;
    const chatId = getActiveChatId();
    if (!chatId) return;
    if (busyIds.has(messageId)) return;

    busyIds.add(messageId);
    updateButtonState(messageId);
    sendToBackend({ type: "refine", chatId, messageId, presetId });
  }

  return {
    setRefinedMessages(ids) {
      refinedIds.clear();
      for (const id of ids) refinedIds.add(id);
      updateAllButtonStates();
    },
    setBusy(messageId, busy) {
      if (busy) busyIds.add(messageId);
      else busyIds.delete(messageId);
      updateButtonState(messageId);
    },
    setPresets(presets, activeId) {
      customPresets = presets.filter((p) => !p.builtIn && p.slot === "output");
      activePresetId = activeId;
      updateAllButtonStates();
    },
    rescan() {
      observation.rescan();
    },
    destroy() {
      observation.destroy();
      document.querySelectorAll("[data-hone-btn]").forEach((btn) => btn.remove());
      removeStyle();
      refinedIds.clear();
      busyIds.clear();
    },
  };
}
