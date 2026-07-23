// Das Generate-Panel des Hubs (UI-STANDARD §1/§4, Mount-once: Prompt/Preview überleben
// Refreshes). Kennt weder Plugin noch Engine — nur den schmalen ViewHost.
import { setIcon, setTooltip } from "obsidian";
import { presetActive, togglePresetInPrompt } from "../core/presets";
import { t } from "../vendor/kit/i18n";
import { buildViewModel } from "../core/viewmodel";
import { CFG, SIZES, STEPS, type SizeOption } from "../core/generation";
import type { HistoryEntry } from "../core/settings";
import type { HubPanel, TabId } from "./hub";
import type { ViewHost } from "./view";

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export class GeneratePanel implements HubPanel {
  readonly id: TabId = "generate";
  readonly label = t("view.tabGenerate");
  readonly icon = "image-plus";

  private modelInfoEl!: HTMLElement;
  private sizeRowEl!: HTMLElement; // Container in der controls-Zeile
  private sizeEl: HTMLSelectElement | null = null;
  private promptEl!: HTMLTextAreaElement;
  private negativePromptEl!: HTMLTextAreaElement;
  private stepsEl!: HTMLInputElement;
  private stepsValueEl!: HTMLElement;
  private cfgEl!: HTMLInputElement;
  private cfgValueEl!: HTMLElement;
  private seedEl!: HTMLInputElement;
  private generateBtn!: HTMLButtonElement;
  private emptyEl!: HTMLElement;
  private emptyTextEl!: HTMLElement;
  private emptyCtaEl!: HTMLButtonElement;
  private emptyCtaAction: "settings" | "recheck" | undefined;
  private imageCard!: HTMLElement;
  private imgEl!: HTMLImageElement;
  private regenBtn!: HTMLButtonElement;
  private createBtn!: HTMLButtonElement;
  private insertBtn!: HTMLButtonElement;
  private statusIconEl!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private chipEls: { suffix: string; el: HTMLElement }[] = [];
  private presetSig = "";

  constructor(private readonly host: ViewHost) {}

  mount(container: HTMLElement): void {
    const root = container.createDiv({ cls: "lig-panel" });

    const modelRow = root.createDiv({ cls: "lig-row lig-model-row" });
    this.modelInfoEl = modelRow.createSpan({ cls: "lig-model-info" });

    const promptRow = root.createDiv({ cls: "lig-prompt-row" });
    this.promptEl = promptRow.createEl("textarea", {
      cls: "lig-prompt",
      attr: { placeholder: t("generate.promptPlaceholder"), rows: "3" },
    });
    this.promptEl.addEventListener("input", () => {
      this.host.setPrompt(this.promptEl.value);
      this.refresh();
    });

    const negativePromptRow = root.createDiv({ cls: "lig-prompt-row" });
    this.negativePromptEl = negativePromptRow.createEl("textarea", {
      cls: "lig-prompt lig-negative",
      attr: { placeholder: t("generate.negativePromptPlaceholder"), rows: "2" },
    });
    this.negativePromptEl.addEventListener("input", () => {
      this.host.setNegativePrompt(this.negativePromptEl.value);
      this.refresh();
    });

    this.chipsEl = root.createDiv({ cls: "lig-row lig-chips" });

    const controls = root.createDiv({ cls: "lig-row" });
    this.sizeRowEl = controls.createSpan({ cls: "lig-size-slot" });
    controls.createSpan({ text: t("generate.steps"), cls: "lig-label" });
    const startSteps = String(this.host.getSettings().defaultSteps);
    this.stepsEl = controls.createEl("input", {
      cls: "lig-steps",
      attr: {
        type: "range",
        min: String(STEPS.min),
        max: String(STEPS.max),
        step: "1",
        value: startSteps,
      },
    });
    this.stepsValueEl = controls.createSpan({ text: startSteps, cls: "lig-steps-value" });
    this.stepsEl.addEventListener("input", () => {
      this.stepsValueEl.setText(this.stepsEl.value);
      this.refresh();
    });
    controls.createSpan({ text: t("generate.cfg"), cls: "lig-label" });
    const startCfg = String(CFG.default);
    this.cfgEl = controls.createEl("input", {
      cls: "lig-cfg",
      attr: {
        type: "range",
        min: String(CFG.min),
        max: String(CFG.max),
        step: String(CFG.step),
        value: startCfg,
      },
    });
    this.cfgValueEl = controls.createSpan({ text: startCfg, cls: "lig-cfg-value" });
    this.cfgEl.addEventListener("input", () => {
      this.cfgValueEl.setText(this.cfgEl.value);
      this.refresh();
    });
    controls.createSpan({ text: t("generate.seed"), cls: "lig-label" });
    this.seedEl = controls.createEl("input", {
      cls: "lig-seed",
      attr: { type: "number", value: String(randomSeed()) },
    });
    this.seedEl.addEventListener("input", () => {
      this.refresh();
    });
    const dice = controls.createEl("button", { cls: "clickable-icon" });
    setIcon(dice, "dices");
    setTooltip(dice, t("generate.randomSeed"));
    dice.setAttribute("aria-label", t("generate.randomSeed"));
    dice.addEventListener("click", () => {
      this.seedEl.value = String(randomSeed());
      this.refresh();
    });

    this.generateBtn = controls.createEl("button", { text: t("generate.button.generate"), cls: "mod-cta lig-generate" });
    this.generateBtn.addEventListener("click", () => {
      const { width, height } = this.currentSize();
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value), Number(this.cfgEl.value), width, height);
    });

    this.emptyEl = root.createDiv({ cls: "lig-empty" });
    this.emptyTextEl = this.emptyEl.createDiv();
    this.emptyCtaEl = this.emptyEl.createEl("button", { cls: "mod-cta" });
    this.emptyCtaEl.addEventListener("click", () => {
      if (this.emptyCtaAction === "recheck") this.host.recheckServer();
      else this.host.openSettings();
    });

    this.imageCard = root.createDiv({ cls: "lig-card" });
    this.imgEl = this.imageCard.createEl("img", { cls: "lig-image" });
    const actions = this.imageCard.createDiv({ cls: "lig-row lig-actions" });
    this.regenBtn = actions.createEl("button", { text: t("generate.button.reroll") });
    this.regenBtn.addEventListener("click", () => {
      // Reroll = neuer Zufalls-Seed + generieren. Der obere "Generate"-Knopf nimmt den
      // Seed aus dem Feld und würfelt nie — so sagt jeder Knopf, was er tut.
      this.seedEl.value = String(randomSeed());
      const { width, height } = this.currentSize();
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value), Number(this.cfgEl.value), width, height);
    });
    this.createBtn = actions.createEl("button", { text: t("generate.button.create"), cls: "mod-cta" });
    this.createBtn.addEventListener("click", () => this.host.saveImage("create"));
    this.insertBtn = actions.createEl("button", { text: t("generate.button.insert"), cls: "mod-cta" });
    this.insertBtn.addEventListener("click", () => this.host.saveImage("insert"));

    const status = root.createDiv({ cls: "lig-row lig-status" });
    this.statusIconEl = status.createSpan({ cls: "lig-status-icon" });
    this.statusTextEl = status.createSpan({ cls: "lig-status-text" });

    this.buildSizeDropdown();
    this.refresh();
  }

  private renderChips(): void {
    // Ein frisch angelegtes, noch nicht befülltes Preset ({label: "", suffix: ""},
    // preset-editor.ts) bleibt außen vor: ein leeres Label wäre ein unsichtbarer Chip,
    // ein leerer Suffix ein Chip, der togglePresetInPrompt zufolge nichts tut (Finding 5).
    const presets = this.host.getSettings().presets.filter((p) => p.label !== "" && p.suffix !== "");
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
      if (presets.length > 0) this.chipsEl.createSpan({ text: t("generate.presetsLabel"), cls: "lig-label" });
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

  /** Größen-Dropdown einmalig aus der generischen SIZES-Konstante aufbauen (kein
   *  Modellbezug mehr — der Server-App-seitige Modellwechsel kennt keine Katalog-Größen). */
  private buildSizeDropdown(): void {
    this.sizeRowEl.empty();
    this.sizeRowEl.createSpan({ text: t("generate.size"), cls: "lig-label" });
    this.sizeEl = this.sizeRowEl.createEl("select", { cls: "dropdown lig-size" });
    for (const s of SIZES)
      this.sizeEl.createEl("option", { text: `${s.width} × ${s.height}`, attr: { value: `${s.width}x${s.height}` } });
    this.sizeEl.addEventListener("change", () => this.refresh());
  }

  /** Aktive Größe: Dropdown-Wert (der Dropdown existiert nach mount() immer). */
  private currentSize(): SizeOption {
    const [w, h] = this.sizeEl!.value.split("x").map(Number);
    return { width: w!, height: h! };
  }

  /** Ein Rezept aus der Historie in die DOM-Felder schreiben. Der Host wechselt danach
   *  auf den Generate-Tab; refresh() zieht Chips/Aktiv-Zustand nach. */
  applyRecipe(entry: HistoryEntry): void {
    this.promptEl.value = entry.prompt;
    this.host.setPrompt(entry.prompt);
    this.negativePromptEl.value = entry.negativePrompt;
    this.host.setNegativePrompt(entry.negativePrompt);
    this.seedEl.value = String(entry.seed);
    const steps = Math.min(STEPS.max, Math.max(STEPS.min, entry.steps));
    this.stepsEl.value = String(steps);
    this.stepsValueEl.setText(String(steps));
    const cfg = Math.min(CFG.max, Math.max(CFG.min, entry.cfg));
    this.cfgEl.value = String(cfg);
    this.cfgValueEl.setText(String(cfg));
    const inCatalog = SIZES.some((s) => s.width === entry.width && s.height === entry.height);
    const size = inCatalog ? { width: entry.width, height: entry.height } : SIZES[0]!;
    this.sizeEl!.value = `${size.width}x${size.height}`;
    this.refresh();
  }

  refresh(): void {
    const { width, height } = this.currentSize();
    this.host.setRecipe(Number(this.stepsEl.value), Number(this.seedEl.value), Number(this.cfgEl.value), width, height);
    const state = this.host.getPanelState();
    this.renderChips();
    const vm = buildViewModel(state);

    this.modelInfoEl.setText(
      state.server.kind === "ok" && state.server.modelName !== null
        ? t("generate.modelInfo", state.server.modelName)
        : t("generate.modelInApp"),
    );

    this.generateBtn.disabled = !vm.generateEnabled;
    this.emptyEl.toggleClass("is-hidden", vm.empty === null);
    if (vm.empty) {
      this.emptyTextEl.setText(vm.empty.text);
      this.emptyCtaEl.toggleClass("is-hidden", vm.empty.ctaLabel === undefined);
      if (vm.empty.ctaLabel) this.emptyCtaEl.setText(vm.empty.ctaLabel);
      this.emptyCtaAction = vm.empty.ctaAction;
    }
    this.imageCard.toggleClass("is-hidden", !vm.showImage);
    if (state.image) this.imgEl.src = state.image.dataUrl;
    this.insertBtn.disabled = !vm.insertEnabled;
    setTooltip(this.insertBtn, vm.insertEnabled ? "" : t("generate.insertNeedsEditor"));

    this.statusIconEl.className = `lig-status-icon ${vm.status.cls}`;
    setIcon(this.statusIconEl, vm.status.icon);
    this.statusIconEl.setAttribute("aria-label", vm.status.text);
    this.statusTextEl.setText(vm.status.text);
  }

  destroy(): void {}
}
