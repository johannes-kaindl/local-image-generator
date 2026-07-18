// Settings (UI-STANDARD §5): Modell zuerst, Ausgabe, Presets, Gefährliches ans Ende.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { totalApproxBytes, MODEL_FILES } from "../core/model-manifest";
import { formatBytes } from "../core/viewmodel";
import { t } from "../vendor/kit/i18n";
import { collapsibleSection, type CollapsibleStorage } from "./collapsible";
import { ConfirmModal } from "./confirm-modal";
import { FolderSuggest } from "./folder-suggest";
import { renderPresetEditor } from "./preset-editor";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
  private modelSectionEl: HTMLElement | null = null;
  private fluxSectionEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
  }

  // Auf-/Zu-Zustand landet in data.json (der Kit-Baustein bleibt storage-agnostisch).
  private storage: CollapsibleStorage = {
    getCollapsed: (key) => this.plugin.settings.sectionsCollapsed[key],
    setCollapsed: (key, collapsed) => {
      this.plugin.settings.sectionsCollapsed[key] = collapsed;
      void this.plugin.saveSettings();
    },
  };

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.modelSectionEl = collapsibleSection(containerEl, {
      title: t("settings.model.heading"),
      key: "model",
      defaultCollapsed: false,
      storage: this.storage,
    });
    this.renderModel(this.modelSectionEl);

    this.fluxSectionEl = collapsibleSection(containerEl, {
      title: "FLUX.2 klein 4B (mflux)", // Eigenname + Toolname — unübersetzt
      key: "mflux",
      defaultCollapsed: false,
      storage: this.storage,
    });
    this.renderFlux(this.fluxSectionEl);

    this.renderOutput(collapsibleSection(containerEl, {
      title: t("settings.output.heading"),
      key: "output",
      defaultCollapsed: false,
      storage: this.storage,
    }));

    const presets = collapsibleSection(containerEl, {
      title: t("settings.presets.heading"),
      key: "presets",
      defaultCollapsed: true,
      storage: this.storage,
    });
    presets.createEl("p", { text: t("settings.presets.desc"), cls: "setting-item-description" });
    renderPresetEditor(presets, {
      getPresets: () => this.plugin.settings.presets,
      setPresets: async (next) => {
        this.plugin.settings.presets = next;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      },
      rerender: () => this.display(),
    });

    this.renderDanger(collapsibleSection(containerEl, {
      title: t("settings.danger.heading"),
      key: "danger",
      defaultCollapsed: true,
      storage: this.storage,
    }));
  }

  /** Zeichnet NUR die Modell-Sektion neu — state-getrieben (this.plugin.getState().model
   *  ist die einzige Wahrheit), überlebt Re-Renders anderer Sektionen strukturell, weil
   *  sie nie eigenen Zustand hält. Wird von main.ts.refreshViews() bei jeder
   *  Download-Fortschritts-Änderung aufgerufen — der isConnected-Check verhindert, dass
   *  ein Aufruf nach einem kompletten display()-Rebuild (z.B. presets.rerender()) einen
   *  bereits aus dem DOM entfernten Container beschreibt (Spec 2026-07-18-robustheits-
   *  block-design.md §2.2). */
  refreshModel(): void {
    const el = this.modelSectionEl;
    if (el?.isConnected) {
      el.empty();
      this.renderModel(el);
    }
    const fx = this.fluxSectionEl;
    if (fx?.isConnected) {
      fx.empty();
      this.renderFlux(fx);
    }
  }

  private renderModel(el: HTMLElement): void {
    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const model = this.plugin.getState().model;
    const modelSetting = new Setting(el)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(t("settings.model.desc"));

    if (model.kind === "ready") {
      modelSetting.addExtraButton((b) => b.setIcon("circle-check").setTooltip(t("settings.model.downloadedTooltip")));
      return;
    }

    if (model.kind === "downloading") {
      modelSetting.addButton((b) => b.setButtonText(`${model.overallPct}%`).setDisabled(true));
      el.createEl("p", {
        text: `${model.fileKey} (${model.fileIndex}/${model.totalFiles}) — ${formatBytes(model.receivedBytes)} / ${formatBytes(model.totalBytes)}`,
        cls: "setting-item-description",
      });
      return;
    }

    modelSetting.addButton((b) =>
      b
        .setButtonText(t("settings.model.download", gb))
        .setCta()
        .onClick(async () => {
          try {
            await this.plugin.downloadModel();
            new Notice(t("notice.modelDownloaded"));
          } catch (e) {
            new Notice(String(e instanceof Error ? e.message : e));
          }
        }),
    );
  }

  private renderFlux(el: HTMLElement): void {
    const mflux = this.plugin.getState().mflux;

    // 1) Binary-Status + Pfad-Feld
    const status = new Setting(el).setName(t("settings.mflux.binary"));
    status.setDesc(
      mflux.binary !== null ? t("settings.mflux.found", mflux.binary) : t("settings.mflux.notFound"),
    );
    status.addText((tf) => {
      tf.setPlaceholder(t("settings.mflux.binaryPlaceholder"))
        .setValue(this.plugin.settings.mfluxPath)
        .onChange(async (v) => {
          this.plugin.settings.mfluxPath = v.trim();
          await this.plugin.saveSettings();
          // Re-Detect NICHT hier (würde die Section pro Tastendruck neu rendern und
          // den Fokus killen) — läuft stattdessen einmalig beim Verlassen des Felds.
        });
      this.plugin.registerDomEvent(tf.inputEl, "blur", () => {
        this.plugin.refreshMfluxStatus(); // re-detect → refreshViews → refreshModel
      });
    });

    // 2) Speicherort (Systempfad — bewusst KEIN FolderSuggest, der kennt nur Vault-Ordner)
    new Setting(el)
      .setName(t("settings.mflux.modelsDir"))
      .setDesc(t("settings.mflux.modelsDirDesc"))
      .addText((tf) => {
        tf.setPlaceholder("~/.cache/huggingface")
          .setValue(this.plugin.settings.modelsDir)
          .onChange(async (v) => {
            this.plugin.settings.modelsDir = v.trim();
            await this.plugin.saveSettings();
            // Re-Detect NICHT hier (würde die Section pro Tastendruck neu rendern und
            // den Fokus killen) — läuft stattdessen einmalig beim Verlassen des Felds.
          });
        this.plugin.registerDomEvent(tf.inputEl, "blur", () => {
          this.plugin.refreshMfluxStatus(); // Gewichte-Check gegen neuen Ort
        });
      });

    // 3) Gewichte: ready → Häkchen · downloading → Prozent + Detail · missing → Download-Button
    const weights = new Setting(el).setName(t("settings.mflux.weights")).setDesc(t("settings.mflux.weightsDesc"));
    if (mflux.weights === "ready") {
      weights.addExtraButton((b) => b.setIcon("circle-check").setTooltip(t("settings.model.downloadedTooltip")));
      return;
    }
    if (mflux.weights === "downloading") {
      weights.addButton((b) => b.setButtonText(`${mflux.download?.pct ?? 0}%`).setDisabled(true));
      el.createEl("p", {
        text: `${mflux.download?.file ?? "…"} — ${mflux.download?.pct ?? 0}%`,
        cls: "setting-item-description",
      });
      return;
    }
    weights.addButton((b) =>
      b.setButtonText(t("settings.mflux.download"))
        .setCta()
        .setDisabled(mflux.binary === null) // ohne Binary kein Vorbereitungslauf
        .onClick(async () => {
          try {
            await this.plugin.downloadFluxModel();
            new Notice(t("notice.fluxDownloaded"));
          } catch (e) {
            new Notice(String(e instanceof Error ? e.message : e));
          }
        }),
    );
  }

  private renderOutput(el: HTMLElement): void {
    new Setting(el)
      .setName(t("settings.output.folder"))
      .setDesc(t("settings.output.folderDesc"))
      .addText((tf) => {
        new FolderSuggest(this.app, tf.inputEl);
        tf.setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
          this.plugin.settings.outputFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(t("settings.noteFolder"))
      .setDesc(t("settings.noteFolderDesc"))
      .addText((tf) => {
        new FolderSuggest(this.app, tf.inputEl);
        tf.setValue(this.plugin.settings.noteFolder).onChange(async (v) => {
          this.plugin.settings.noteFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(t("settings.createMode"))
      .setDesc(t("settings.createModeDesc"))
      .addDropdown((d) => {
        d.addOption("image", t("settings.createModeImage"));
        d.addOption("note", t("settings.createModeNote"));
        d.setValue(this.plugin.settings.createMode).onChange(async (v) => {
          this.plugin.settings.createMode = v === "note" ? "note" : "image";
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(t("settings.defaultSteps"))
      .setDesc(t("settings.defaultStepsDesc"))
      .addSlider((s) =>
        s
          .setLimits(1, 4, 1)
          .setValue(this.plugin.settings.defaultSteps)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.defaultSteps = v;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderDanger(el: HTMLElement): void {
    new Setting(el).setName(t("settings.model.delete")).addButton((b) =>
      b
        .setButtonText(t("settings.model.delete"))
        .setWarning()
        .onClick(() => {
          new ConfirmModal(this.app, t("settings.model.deleteConfirm"), t("modal.confirm"), async () => {
            await this.plugin.modelStore.deleteAll();
            this.plugin.onModelDeleted();
            this.display();
          }).open();
        }),
    );
  }
}
