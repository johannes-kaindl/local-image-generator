// Settings (UI-STANDARD §5): Modell zuerst, Ausgabe, Gefährliches (Löschen) ans Ende.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { totalApproxBytes, MODEL_FILES } from "../core/model-manifest";
import { STRINGS } from "../core/strings";
import { ConfirmModal } from "./confirm-modal";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(STRINGS.settingsModelHeading).setHeading();

    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const modelSetting = new Setting(containerEl)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(STRINGS.settingsModelDesc);
    void this.plugin.modelStore.isComplete().then((complete) => {
      if (complete) {
        modelSetting.addExtraButton((b) =>
          b.setIcon("circle-check").setTooltip("Downloaded"),
        );
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

    new Setting(containerEl).setName(STRINGS.settingsOutputHeading).setHeading();
    new Setting(containerEl)
      .setName(STRINGS.settingsOutputFolder)
      .setDesc(STRINGS.settingsOutputFolderDesc)
      .addText((t) =>
        t.setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
          this.plugin.settings.outputFolder = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    // Gefährliches ans Ende (§5)
    new Setting(containerEl)
      .setName(STRINGS.settingsDelete)
      .addButton((b) =>
        b.setButtonText(STRINGS.settingsDelete).setWarning().onClick(() => {
          new ConfirmModal(this.app, STRINGS.settingsDeleteConfirm, STRINGS.confirm, async () => {
            await this.plugin.modelStore.deleteAll();
            this.plugin.onModelDeleted();
            this.display();
          }).open();
        }),
      );
  }
}
