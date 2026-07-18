// Das Generate-Panel des Hubs (UI-STANDARD §1/§4, Mount-once: Prompt/Preview überleben
// Refreshes). Kennt weder Plugin noch Engine — nur den schmalen ViewHost.
import { setIcon, setTooltip } from "obsidian";
import { presetActive, togglePresetInPrompt } from "../core/presets";
import { t } from "../vendor/kit/i18n";
import { buildViewModel } from "../core/viewmodel";
import { getModel, MODELS, type ModelSpec, type SizeOption } from "../core/models";
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

  private modelEl!: HTMLSelectElement;
  private sizeRowEl!: HTMLElement; // Container in der controls-Zeile
  private sizeEl: HTMLSelectElement | null = null;
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
  private chipsEl!: HTMLElement;
  private chipEls: { suffix: string; el: HTMLElement }[] = [];
  private presetSig = "";

  constructor(private readonly host: ViewHost) {}

  mount(container: HTMLElement): void {
    const root = container.createDiv({ cls: "lig-panel" });

    const modelRow = root.createDiv({ cls: "lig-row lig-model-row" });
    modelRow.createSpan({ text: t("generate.model"), cls: "lig-label" });
    this.modelEl = modelRow.createEl("select", { cls: "dropdown lig-model" });
    for (const m of MODELS) this.modelEl.createEl("option", { text: m.label, attr: { value: m.id } });
    this.modelEl.value = this.host.getSettings().selectedModel;
    this.modelEl.addEventListener("change", () => {
      this.applyModel(this.modelEl.value);
      this.host.setSelectedModel(this.modelEl.value);
    });

    const promptRow = root.createDiv({ cls: "lig-prompt-row" });
    this.promptEl = promptRow.createEl("textarea", {
      cls: "lig-prompt",
      attr: { placeholder: t("generate.promptPlaceholder"), rows: "3" },
    });
    this.promptEl.addEventListener("input", () => {
      this.host.setPrompt(this.promptEl.value);
      this.refresh();
    });
    this.chipsEl = root.createDiv({ cls: "lig-row lig-chips" });

    const controls = root.createDiv({ cls: "lig-row" });
    this.sizeRowEl = controls.createSpan({ cls: "lig-size-slot" });
    controls.createSpan({ text: t("generate.steps"), cls: "lig-label" });
    // Startwert: SD-Turbo behält den Settings-Startwert (Nutzer-Regler, kein Zwang),
    // andere Modelle starten am Katalog-Default (Task 9 Brief).
    const startSpec = getModel(this.host.getSettings().selectedModel);
    const startSteps = String(
      startSpec.id === "sd-turbo" ? this.host.getSettings().defaultSteps : startSpec.steps.default,
    );
    this.stepsEl = controls.createEl("input", {
      cls: "lig-steps",
      attr: {
        type: "range",
        min: String(startSpec.steps.min),
        max: String(startSpec.steps.max),
        step: "1",
        value: startSteps,
      },
    });
    this.stepsValueEl = controls.createSpan({ text: startSteps, cls: "lig-steps-value" });
    this.stepsEl.addEventListener("input", () => {
      this.stepsValueEl.setText(this.stepsEl.value);
    });
    controls.createSpan({ text: t("generate.seed"), cls: "lig-label" });
    this.seedEl = controls.createEl("input", {
      cls: "lig-seed",
      attr: { type: "number", value: String(randomSeed()) },
    });
    const dice = controls.createEl("button", { cls: "clickable-icon" });
    setIcon(dice, "dices");
    setTooltip(dice, t("generate.randomSeed"));
    dice.setAttribute("aria-label", t("generate.randomSeed"));
    dice.addEventListener("click", () => {
      this.seedEl.value = String(randomSeed());
    });

    this.generateBtn = root.createEl("button", { text: t("generate.button.generate"), cls: "mod-cta lig-generate" });
    this.generateBtn.addEventListener("click", () => {
      const { width, height } = this.currentSize();
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value), width, height);
    });

    this.emptyEl = root.createDiv({ cls: "lig-empty" });
    this.emptyTextEl = this.emptyEl.createDiv();
    this.emptyCtaEl = this.emptyEl.createEl("button", { cls: "mod-cta" });
    this.emptyCtaEl.addEventListener("click", () => this.host.openSettings());

    this.imageCard = root.createDiv({ cls: "lig-card" });
    this.imgEl = this.imageCard.createEl("img", { cls: "lig-image" });
    const actions = this.imageCard.createDiv({ cls: "lig-row lig-actions" });
    this.regenBtn = actions.createEl("button", { text: t("generate.button.reroll") });
    this.regenBtn.addEventListener("click", () => {
      // Reroll = neuer Zufalls-Seed + generieren. Der obere "Generate"-Knopf nimmt den
      // Seed aus dem Feld und würfelt nie — so sagt jeder Knopf, was er tut.
      this.seedEl.value = String(randomSeed());
      const { width, height } = this.currentSize();
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value), width, height);
    });
    this.createBtn = actions.createEl("button", { text: t("generate.button.create"), cls: "mod-cta" });
    this.createBtn.addEventListener("click", () => this.host.saveImage("create"));
    this.insertBtn = actions.createEl("button", { text: t("generate.button.insert"), cls: "mod-cta" });
    this.insertBtn.addEventListener("click", () => this.host.saveImage("insert"));

    const status = root.createDiv({ cls: "lig-row lig-status" });
    this.statusIconEl = status.createSpan({ cls: "lig-status-icon" });
    this.statusTextEl = status.createSpan({ cls: "lig-status-text" });

    this.rebuildSizeDropdown(startSpec, null);
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

  /** Größen-Dropdown zum Modell aufbauen; preferred (aus applyRecipe) wird vorausgewählt,
   *  wenn das Modell die Größe kennt. Bei nur einer Größe: kein Dropdown (Spec §5). */
  private rebuildSizeDropdown(spec: ModelSpec, preferred: SizeOption | null): void {
    this.sizeRowEl.empty();
    this.sizeEl = null;
    if (spec.sizes.length <= 1) return;
    this.sizeRowEl.createSpan({ text: t("generate.size"), cls: "lig-label" });
    this.sizeEl = this.sizeRowEl.createEl("select", { cls: "dropdown lig-size" });
    for (const s of spec.sizes)
      this.sizeEl.createEl("option", { text: `${s.width} × ${s.height}`, attr: { value: `${s.width}x${s.height}` } });
    if (preferred && spec.sizes.some((s) => s.width === preferred.width && s.height === preferred.height))
      this.sizeEl.value = `${preferred.width}x${preferred.height}`;
  }

  /** Aktive Größe: Dropdown-Wert oder die einzige Katalog-Größe. */
  private currentSize(): SizeOption {
    const spec = getModel(this.modelEl.value);
    if (this.sizeEl) {
      const [w, h] = this.sizeEl.value.split("x").map(Number);
      return { width: w!, height: h! };
    }
    return spec.sizes[0]!;
  }

  /** Regler an ein Modell anpassen (Modellwechsel + applyRecipe). */
  private applyModel(id: string, preferredSize: SizeOption | null = null): void {
    const spec = getModel(id);
    this.stepsEl.min = String(spec.steps.min);
    this.stepsEl.max = String(spec.steps.max);
    this.stepsEl.value = String(spec.steps.default);
    this.stepsValueEl.setText(this.stepsEl.value);
    this.rebuildSizeDropdown(spec, preferredSize);
    this.refresh();
  }

  /** Ein Rezept aus der Historie in die DOM-Felder schreiben. Der Host wechselt danach
   *  auf den Generate-Tab; refresh() zieht Chips/Aktiv-Zustand nach. */
  applyRecipe(entry: HistoryEntry): void {
    this.modelEl.value = getModel(entry.model).id; // getModel-Fallback fängt Alt-/Fremd-IDs
    this.applyModel(this.modelEl.value, { width: entry.width, height: entry.height });
    this.host.setSelectedModel(this.modelEl.value);
    this.promptEl.value = entry.prompt;
    this.host.setPrompt(entry.prompt);
    this.seedEl.value = String(entry.seed);
    // Steps NACH applyModel setzen (applyModel hat sie auf den Default gestellt), geclampt:
    const spec = getModel(this.modelEl.value);
    const steps = Math.min(spec.steps.max, Math.max(spec.steps.min, entry.steps));
    this.stepsEl.value = String(steps);
    this.stepsValueEl.setText(String(steps));
    this.refresh();
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
    setTooltip(this.insertBtn, vm.insertEnabled ? "" : t("generate.insertNeedsEditor"));

    this.statusIconEl.className = `lig-status-icon ${vm.status.cls}`;
    setIcon(this.statusIconEl, vm.status.icon);
    this.statusIconEl.setAttribute("aria-label", vm.status.text);
    this.statusTextEl.setText(vm.status.text);
  }

  destroy(): void {}
}
