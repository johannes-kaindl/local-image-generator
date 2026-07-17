// Die EINE View des Plugins (UI-STANDARD §1/§4): ein Tab-Hub. Der View selbst ist nur
// die Hülle — Aufbau + Navigation liegen im vendored Hub, der Inhalt in den Panels.
// Kennt weder Plugin noch Engine — nur den schmalen ViewHost.
import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import type { HistoryEntry, LigSettings } from "../core/settings";
import { STRINGS } from "../core/strings";
import type { PanelState } from "../core/viewmodel";
import { GeneratePanel } from "./generate-panel";
import { HistoryPanel } from "./history-panel";
import { buildInto, type HubController, type HubPanel, type TabId } from "./hub";

export const VIEW_TYPE = "local-image-generator";

export interface ViewHost {
  getPanelState(): PanelState;
  getSettings(): LigSettings;
  setPrompt(p: string): void;
  generate(steps: number, seed: number): void;
  saveImage(mode: "create" | "insert"): void;
  openSettings(): void;
  restoreRecipe(entry: HistoryEntry): void;
  deleteHistoryEntry(entry: HistoryEntry): void;
  clearHistory(): void;
  setHistoryView(v: "recent" | "grouped"): void;
  showTab(id: TabId): void;
}

export class GeneratorView extends ItemView {
  private ctrl: HubController | null = null;
  private panels: HubPanel[] = [];
  private restoreTab: TabId = "generate";
  private generatePanel: GeneratePanel | null = null;
  private historyPanel: HistoryPanel | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: ViewHost,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return STRINGS.viewTitle;
  }

  getIcon(): string {
    return "image-plus";
  }

  async onOpen(): Promise<void> {
    const generate = new GeneratePanel(this.host);
    const history = new HistoryPanel(this.host);
    this.generatePanel = generate;
    this.historyPanel = history;
    this.panels = [generate, history];
    this.ctrl = buildInto(this.contentEl, this.panels, this.restoreTab);
  }

  refresh(): void {
    this.generatePanel?.refresh();
    // Authoritative Re-Render nach jeder Host-Mutation (Löschen/Reset/Ansicht-Wechsel):
    // das History-Panel MUSS hier mitrendern, damit der Umschlag nicht am Modal vorbeirennt.
    this.historyPanel?.render();
  }

  /** Rezept aus der Historie ins Generate-Panel füllen (kein neuer globaler Zustand). */
  applyRecipe(prompt: string, seed: number, steps: number): void {
    this.generatePanel?.applyRecipe(prompt, seed, steps);
  }

  showTab(id: TabId): void {
    this.ctrl?.setTab(id);
    this.restoreTab = id;
  }

  getState(): Record<string, unknown> {
    return { tab: this.ctrl?.currentTab() ?? this.restoreTab };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const tab = (state as { tab?: TabId } | null)?.tab;
    if (tab) {
      this.restoreTab = tab;
      this.ctrl?.setTab(tab);
    }
    return super.setState(state, result);
  }

  async onClose(): Promise<void> {
    this.ctrl?.destroy();
    this.contentEl.empty();
  }
}
