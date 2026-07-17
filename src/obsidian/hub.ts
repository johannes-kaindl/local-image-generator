// Vendored aus vault-rag/src/hub_view.ts (Hub-Muster, REGISTRY Z.82). Kit-Extraktion via /drift-audit.
import { setIcon } from "obsidian";

export type TabId = "generate" | "history";

/** Ein Panel im Hub. Kein ItemView — bekommt seinen Container injiziert,
 *  bleibt gemountet (State-Persistenz), wird nur per display:none aus-/eingeblendet. */
export interface HubPanel {
  readonly id: TabId;
  readonly label: string;
  readonly icon: string;
  /** Einmaliger Aufbau in den übergebenen Container. Synchron; async-Init intern via void. */
  mount(container: HTMLElement): void;
  /** Tab wird sichtbar — kontextsensitive Panels holen hier ausstehende Updates nach. */
  onShow?(): void;
  /** Tab wird versteckt. */
  onHide?(): void;
  /** Cleanup: Timer/Intervalle/Streams abbrechen. */
  destroy(): void;
}

export interface HubController {
  setTab(id: TabId): void;
  currentTab(): TabId;
  destroy(): void;
}

// ── Reine Aufbau-/Navigationslogik (node-testbar, ohne Obsidian) ──────────
export function buildInto(root: HTMLElement, panels: HubPanel[], defaultTab: TabId): HubController {
  root.empty();
  root.addClass("lig-hub-root");
  const tabsEl = root.createDiv({ cls: "lig-hub-tabs" });
  const contentEl = root.createDiv({ cls: "lig-hub-content" });
  const panelDivs = new Map<TabId, HTMLElement>();
  const tabBtns = new Map<TabId, HTMLElement>();
  // Persistierter Layout-State kann einen Tab referenzieren, dessen Panel nicht gebaut wurde
  // (z.B. "smart-apply" bei deaktiviertem Feature) — ohne Fallback bliebe der Hub leer/blank.
  let navState = panels.some((p) => p.id === defaultTab) ? defaultTab : (panels[0]?.id ?? defaultTab);

  const applyVisibility = (): void => {
    for (const [id, div] of panelDivs) div.toggleClass("is-hidden", id !== navState);
    for (const [id, btn] of tabBtns) btn.toggleClass("is-active", id === navState);
  };

  for (const panel of panels) {
    const btn = tabsEl.createEl("button", { cls: "lig-hub-tab", attr: { "data-tab": panel.id } });
    const ic = btn.createSpan({ cls: "lig-hub-tab-icon" }); setIcon(ic, panel.icon);
    btn.createSpan({ cls: "lig-hub-tab-label", text: panel.label });
    btn.addEventListener("click", () => ctrl.setTab(panel.id));
    tabBtns.set(panel.id, btn);
    const div = contentEl.createDiv({ cls: "lig-hub-panel", attr: { "data-tab": panel.id } });
    panelDivs.set(panel.id, div);
    panel.mount(div);
  }

  const ctrl: HubController = {
    currentTab: () => navState,
    setTab(id: TabId): void {
      if (id === navState) return;
      panels.find(p => p.id === navState)?.onHide?.();
      navState = id;
      applyVisibility();
      panels.find(p => p.id === navState)?.onShow?.();
    },
    destroy(): void { for (const p of panels) p.destroy(); },
  };

  applyVisibility();
  panels.find(p => p.id === navState)?.onShow?.();   // Default-Panel initial onShow
  return ctrl;
}
