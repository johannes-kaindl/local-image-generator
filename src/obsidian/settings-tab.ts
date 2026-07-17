// Settings (UI-STANDARD §5): Modell zuerst, Ausgabe, Presets, Gefährliches ans Ende.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { totalApproxBytes, MODEL_FILES } from "../core/model-manifest";
import { STRINGS } from "../core/strings";
import { collapsibleSection, type CollapsibleStorage } from "./collapsible";
import { ConfirmModal } from "./confirm-modal";
import { FolderSuggest } from "./folder-suggest";
import { renderPresetEditor } from "./preset-editor";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
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

    this.renderModel(collapsibleSection(containerEl, {
      title: STRINGS.settingsModelHeading,
      key: "model",
      defaultCollapsed: false,
      storage: this.storage,
    }));

    this.renderOutput(collapsibleSection(containerEl, {
      title: STRINGS.settingsOutputHeading,
      key: "output",
      defaultCollapsed: false,
      storage: this.storage,
    }));

    const presets = collapsibleSection(containerEl, {
      title: STRINGS.settingsPresetsHeading,
      key: "presets",
      defaultCollapsed: true,
      storage: this.storage,
    });
    presets.createEl("p", { text: STRINGS.settingsPresetsDesc, cls: "setting-item-description" });
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
      title: STRINGS.settingsDangerHeading,
      key: "danger",
      defaultCollapsed: true,
      storage: this.storage,
    }));
  }

  private renderModel(el: HTMLElement): void {
    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const modelSetting = new Setting(el)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(STRINGS.settingsModelDesc);
    void this.plugin.modelStore.isComplete().then((complete) => {
      if (complete) {
        modelSetting.addExtraButton((b) => b.setIcon("circle-check").setTooltip("Downloaded"));
      } else {
        modelSetting.addButton((b) =>
          b
            .setButtonText(`${STRINGS.settingsDownload} (~${gb} GB)`)
            .setCta()
            .onClick(async () => {
              b.setDisabled(true);
              try {
                await this.plugin.downloadModel((pct) => b.setButtonText(`${pct}%`));
                new Notice("Model downloaded");
              } catch (e) {
                new Notice(String(e instanceof Error ? e.message : e));
              }
              this.display();
            }),
        );
      }
    });
  }

  private renderOutput(el: HTMLElement): void {
    new Setting(el)
      .setName(STRINGS.settingsOutputFolder)
      .setDesc(STRINGS.settingsOutputFolderDesc)
      .addText((t) => {
        new FolderSuggest(this.app, t.inputEl);
        t.setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
          this.plugin.settings.outputFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(STRINGS.settingsNoteFolder)
      .setDesc(STRINGS.settingsNoteFolderDesc)
      .addText((t) => {
        new FolderSuggest(this.app, t.inputEl);
        t.setValue(this.plugin.settings.noteFolder).onChange(async (v) => {
          this.plugin.settings.noteFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(STRINGS.settingsCreateMode)
      .setDesc(STRINGS.settingsCreateModeDesc)
      .addDropdown((d) => {
        d.addOption("image", STRINGS.settingsCreateModeImage);
        d.addOption("note", STRINGS.settingsCreateModeNote);
        d.setValue(this.plugin.settings.createMode).onChange(async (v) => {
          this.plugin.settings.createMode = v === "note" ? "note" : "image";
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(STRINGS.settingsDefaultSteps)
      .setDesc(STRINGS.settingsDefaultStepsDesc)
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
    new Setting(el).setName(STRINGS.settingsDelete).addButton((b) =>
      b
        .setButtonText(STRINGS.settingsDelete)
        .setWarning()
        .onClick(() => {
          new ConfirmModal(this.app, STRINGS.settingsDeleteConfirm, STRINGS.confirm, async () => {
            await this.plugin.modelStore.deleteAll();
            this.plugin.onModelDeleted();
            this.display();
          }).open();
        }),
    );
  }
}
