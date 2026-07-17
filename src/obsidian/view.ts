// Die EINE View des Plugins (UI-STANDARD §1/§4, Mount-once: Prompt/Preview überleben
// Refreshes). Kennt weder Plugin noch Engine — nur den schmalen ViewHost.
import { ItemView, Menu, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import { historyLabel } from "../core/history";
import { presetActive, togglePresetInPrompt } from "../core/presets";
import type { LigSettings } from "../core/settings";
import { STRINGS } from "../core/strings";
import { buildViewModel, type PanelState } from "../core/viewmodel";

export const VIEW_TYPE = "local-image-generator";

export interface ViewHost {
  getPanelState(): PanelState;
  getSettings(): LigSettings;
  setPrompt(p: string): void;
  generate(steps: number, seed: number): void;
  saveImage(mode: "create" | "insert"): void;
  openSettings(): void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export class GeneratorView extends ItemView {
  private promptEl!: HTMLTextAreaElement;
  private stepsEl!: HTMLInputElement;
  private stepsValueEl!: HTMLElement;
  private seedEl!: HTMLInputElement;
  private generateBtn!: HTMLButtonElement;
  private emptyEl!: HTMLElement;
  private emptyTextEl!: HTMLElement;
  private emptyCtaEl!: HTMLButtonElement;
  private imageCard!: HTMLElement;
  private imgEl!: HTMLImageElement;
  private regenBtn!: HTMLButtonElement;
  private createBtn!: HTMLButtonElement;
  private insertBtn!: HTMLButtonElement;
  private statusIconEl!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private seedLocked = false;
  private chipsEl!: HTMLElement;
  private chipEls: { suffix: string; el: HTMLElement }[] = [];
  private presetSig = "";

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
    const root = this.contentEl.createDiv({ cls: "lig-panel" });

    const promptRow = root.createDiv({ cls: "lig-prompt-row" });
    this.promptEl = promptRow.createEl("textarea", {
      cls: "lig-prompt",
      attr: { placeholder: STRINGS.promptPlaceholder, rows: "3" },
    });
    const histBtn = promptRow.createEl("button", { cls: "clickable-icon lig-history" });
    histBtn.setAttribute("type", "button");
    setIcon(histBtn, "history");
    setTooltip(histBtn, STRINGS.history);
    histBtn.setAttribute("aria-label", STRINGS.history);
    histBtn.addEventListener("click", (evt) => {
      const menu = new Menu();
      const items = this.host.getSettings().promptHistory;
      if (items.length === 0) {
        menu.addItem((i) => i.setTitle(STRINGS.historyEmpty).setDisabled(true));
      } else {
        for (const p of items) {
          menu.addItem((i) =>
            i.setTitle(historyLabel(p)).onClick(() => {
              this.promptEl.value = p;
              this.host.setPrompt(p);
              this.refresh();
            }),
          );
        }
      }
      menu.showAtMouseEvent(evt);
    });
    this.promptEl.addEventListener("input", () => {
      this.host.setPrompt(this.promptEl.value);
      this.refresh();
    });
    this.chipsEl = root.createDiv({ cls: "lig-row lig-chips" });

    const controls = root.createDiv({ cls: "lig-row" });
    controls.createSpan({ text: STRINGS.steps, cls: "lig-label" });
    // Startwert aus den Settings — danach gehört der Slider dem Nutzer, wir schreiben
    // nichts zurück (die Einstellung ist ein Startwert, kein Zwang).
    const startSteps = String(this.host.getSettings().defaultSteps);
    this.stepsEl = controls.createEl("input", {
      cls: "lig-steps",
      attr: { type: "range", min: "1", max: "4", step: "1", value: startSteps },
    });
    this.stepsValueEl = controls.createSpan({ text: startSteps, cls: "lig-steps-value" });
    this.stepsEl.addEventListener("input", () => {
      this.stepsValueEl.setText(this.stepsEl.value);
    });
    controls.createSpan({ text: STRINGS.seed, cls: "lig-label" });
    this.seedEl = controls.createEl("input", {
      cls: "lig-seed",
      attr: { type: "number", value: String(randomSeed()) },
    });
    const dice = controls.createEl("button", { cls: "clickable-icon" });
    setIcon(dice, "dices");
    setTooltip(dice, STRINGS.randomSeed);
    dice.setAttribute("aria-label", STRINGS.randomSeed);
    dice.addEventListener("click", () => {
      this.seedEl.value = String(randomSeed());
    });
    const lock = controls.createEl("button", { cls: "clickable-icon lig-lock" });
    const applyLock = (): void => {
      setIcon(lock, this.seedLocked ? "lock" : "unlock");
      const label = this.seedLocked ? STRINGS.seedUnlock : STRINGS.seedLock;
      setTooltip(lock, this.seedLocked ? STRINGS.seedLockedTooltip : label);
      lock.setAttribute("aria-label", label);
      lock.setAttribute("aria-pressed", String(this.seedLocked));
      lock.toggleClass("is-active", this.seedLocked);
    };
    applyLock();
    lock.addEventListener("click", () => {
      this.seedLocked = !this.seedLocked;
      applyLock();
    });

    this.generateBtn = root.createEl("button", { text: STRINGS.generate, cls: "mod-cta lig-generate" });
    this.generateBtn.addEventListener("click", () => {
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value));
    });

    this.emptyEl = root.createDiv({ cls: "lig-empty" });
    this.emptyTextEl = this.emptyEl.createDiv();
    this.emptyCtaEl = this.emptyEl.createEl("button", { cls: "mod-cta" });
    this.emptyCtaEl.addEventListener("click", () => this.host.openSettings());

    this.imageCard = root.createDiv({ cls: "lig-card" });
    this.imgEl = this.imageCard.createEl("img", { cls: "lig-image" });
    const actions = this.imageCard.createDiv({ cls: "lig-row lig-actions" });
    this.regenBtn = actions.createEl("button", { text: STRINGS.regenerate });
    this.regenBtn.addEventListener("click", () => {
      // Gesperrt = denselben Seed behalten, damit man den Prompt variieren und die
      // Wirkung der Worte sehen kann. Der Würfel bleibt davon unberührt.
      if (!this.seedLocked) this.seedEl.value = String(randomSeed());
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value));
    });
    this.createBtn = actions.createEl("button", { text: STRINGS.create, cls: "mod-cta" });
    this.createBtn.addEventListener("click", () => this.host.saveImage("create"));
    this.insertBtn = actions.createEl("button", { text: STRINGS.insert, cls: "mod-cta" });
    this.insertBtn.addEventListener("click", () => this.host.saveImage("insert"));

    const status = root.createDiv({ cls: "lig-row lig-status" });
    this.statusIconEl = status.createSpan({ cls: "lig-status-icon" });
    this.statusTextEl = status.createSpan({ cls: "lig-status-text" });

    this.refresh();
  }

  private renderChips(): void {
    const presets = this.host.getSettings().presets;
    // Signatur deckt id, label und suffix ab: der Klick-Handler und die Aktiv-Prüfung
    // schließen jeweils über p.suffix, daher muss jede Änderung an Label ODER Suffix
    // (nicht nur an der Anzahl/Reihenfolge der Presets) einen Rebuild auslösen.
    const sig = presets.map((p) => `${p.id}:${p.label}:${p.suffix}`).join("|");
    if (sig !== this.presetSig) {
      // Nur neu bauen, wenn sich die Liste wirklich geändert hat — refresh() läuft
      // bei jedem Tastendruck, ein Rebuild pro Zeichen wäre unnötiger DOM-Churn.
      this.presetSig = sig;
      this.chipsEl.empty();
      this.chipEls = [];
      if (presets.length > 0) this.chipsEl.createSpan({ text: STRINGS.presetsLabel, cls: "lig-label" });
      for (const p of presets) {
        const el = this.chipsEl.createEl("button", { text: p.label, cls: "lig-chip" });
        el.setAttribute("type", "button");
        el.addEventListener("click", () => {
          const next = togglePresetInPrompt(this.promptEl.value, p.suffix);
          this.promptEl.value = next;
          this.host.setPrompt(next);
          this.refresh();
        });
        this.chipEls.push({ suffix: p.suffix, el });
      }
    }
    // Aktiv-Zustand IMMER aus dem Textfeld ableiten — es ist die einzige Wahrheit.
    for (const chip of this.chipEls) {
      const active = presetActive(this.promptEl.value, chip.suffix);
      chip.el.toggleClass("is-active", active);
      chip.el.setAttribute("aria-pressed", String(active));
    }
  }

  refresh(): void {
    const state = this.host.getPanelState();
    this.renderChips();
    const vm = buildViewModel(state);

    this.generateBtn.disabled = !vm.generateEnabled;
    this.emptyEl.toggleClass("is-hidden", vm.empty === null);
    if (vm.empty) {
      this.emptyTextEl.setText(vm.empty.text);
      this.emptyCtaEl.toggleClass("is-hidden", vm.empty.ctaLabel === undefined);
      if (vm.empty.ctaLabel) this.emptyCtaEl.setText(vm.empty.ctaLabel);
    }
    this.imageCard.toggleClass("is-hidden", !vm.showImage);
    if (state.image) this.imgEl.src = state.image.dataUrl;
    this.insertBtn.disabled = !vm.insertEnabled;
    setTooltip(this.insertBtn, vm.insertEnabled ? "" : STRINGS.insertNeedsEditor);

    this.statusIconEl.className = `lig-status-icon ${vm.status.cls}`;
    setIcon(this.statusIconEl, vm.status.icon);
    this.statusIconEl.setAttribute("aria-label", vm.status.text);
    this.statusTextEl.setText(vm.status.text);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
