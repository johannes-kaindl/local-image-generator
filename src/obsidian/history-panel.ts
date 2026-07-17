// Das History-Panel des Hubs (UI-STANDARD §1/§4). Zwei Ansichten (Recent/Gruppiert),
// Klick = Rezept laden + Tab-Wechsel, Papierkorb = einzeln löschen, "Clear all" = Reset.
// Kennt weder Plugin noch Engine — nur den schmalen ViewHost. Re-Render nach Host-Mutation
// läuft über den Host (refreshViews → view.refresh → panel.render); lokal wird nur der
// Auf-/Zu-Zustand der Gruppen gerendert.
import { setIcon, setTooltip } from "obsidian";
import { groupByPrompt, historyLabel } from "../core/history";
import type { HistoryEntry } from "../core/settings";
import { STRINGS } from "../core/strings";
import type { HubPanel, TabId } from "./hub";
import type { ViewHost } from "./view";

function formatTime(created: string): string {
  return new Date(created).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export class HistoryPanel implements HubPanel {
  readonly id: TabId = "history";
  readonly label = STRINGS.tabHistory;
  readonly icon = "history";

  private segRecentEl!: HTMLButtonElement;
  private segGroupedEl!: HTMLButtonElement;
  private listEl!: HTMLElement;
  /** Auf-/Zu-Zustand der Gruppen (nur lokale UI-State, keine Persistenz). */
  private collapsed = new Set<string>();

  constructor(private readonly host: ViewHost) {}

  mount(container: HTMLElement): void {
    const root = container.createDiv({ cls: "lig-panel" });

    const head = root.createDiv({ cls: "lig-hist-head" });
    const seg = head.createDiv({ cls: "lig-hist-seg" });
    this.segRecentEl = seg.createEl("button", { text: STRINGS.historyViewRecent });
    this.segRecentEl.addEventListener("click", () => this.host.setHistoryView("recent"));
    this.segGroupedEl = seg.createEl("button", { text: STRINGS.historyViewGrouped });
    this.segGroupedEl.addEventListener("click", () => this.host.setHistoryView("grouped"));

    const clear = head.createEl("button", { text: STRINGS.historyClear, cls: "lig-hist-clear" });
    clear.addEventListener("click", () => this.host.clearHistory());

    this.listEl = root.createDiv({ cls: "lig-hist-list" });

    this.render();
  }

  render(): void {
    const settings = this.host.getSettings();
    const view = settings.historyView;
    this.segRecentEl.toggleClass("is-active", view === "recent");
    this.segGroupedEl.toggleClass("is-active", view === "grouped");

    this.listEl.empty();
    const history = settings.history;
    if (history.length === 0) {
      this.listEl.createDiv({ cls: "lig-hist-empty", text: STRINGS.historyEmpty });
      return;
    }

    if (view === "grouped") this.renderGrouped(history);
    else this.renderRecent(history);
  }

  private renderRecent(history: readonly HistoryEntry[]): void {
    for (const entry of history) {
      const row = this.listEl.createDiv({ cls: "lig-hist-row" });
      row.addEventListener("click", () => this.host.restoreRecipe(entry));
      row.createDiv({ cls: "lig-hist-prompt", text: historyLabel(entry.prompt) });
      this.buildMeta(row, entry);
    }
  }

  private renderGrouped(history: readonly HistoryEntry[]): void {
    for (const group of groupByPrompt(history)) {
      const isCollapsed = this.collapsed.has(group.prompt);
      const header = this.listEl.createDiv({ cls: "lig-hist-group" });
      const chevron = header.createSpan({ cls: "lig-hist-chevron" });
      setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
      header.createSpan({ text: historyLabel(group.prompt) });
      header.createSpan({ cls: "lig-hist-count", text: STRINGS.historyVariations(group.entries.length) });
      header.addEventListener("click", () => {
        if (this.collapsed.has(group.prompt)) this.collapsed.delete(group.prompt);
        else this.collapsed.add(group.prompt);
        this.render();
      });
      if (isCollapsed) continue;
      for (const entry of group.entries) {
        const row = this.listEl.createDiv({ cls: "lig-hist-var" });
        row.addEventListener("click", () => this.host.restoreRecipe(entry));
        this.buildMeta(row, entry);
      }
    }
  }

  /** Metazeile (seed · steps · Zeit) + Papierkorb. stopPropagation, damit der Klick auf
   *  den Papierkorb nicht auch als Zeilen-Klick (Restore) gelesen wird. */
  private buildMeta(row: HTMLElement, entry: HistoryEntry): void {
    const meta = row.createDiv({ cls: "lig-hist-meta" });
    meta.createSpan({ text: STRINGS.historyRecipe(entry.seed, entry.steps, formatTime(entry.created)) });
    const del = meta.createEl("button", { cls: "clickable-icon" });
    setIcon(del, "trash-2");
    setTooltip(del, STRINGS.historyDelete);
    del.setAttribute("aria-label", STRINGS.historyDelete);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      this.host.deleteHistoryEntry(entry);
    });
  }

  onShow(): void {
    // Die Historie kann sich im Generate-Tab geändert haben, während dieses Panel
    // versteckt war — beim Sichtbarwerden nachziehen.
    this.render();
  }

  destroy(): void {}
}
