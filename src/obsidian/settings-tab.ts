// Settings (UI-STANDARD §5): Ausgabe, Presets. Die Server-Sektion kommt in Task 7.
import { App, PluginSettingTab, Setting } from "obsidian";
import { t } from "../vendor/kit/i18n";
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

  // Imperatives Rendering (klassische Setting-API): state-getriebene Download-Zeilen mit
  // partiellem refreshModel() sind nicht auf das deklarative getSettingDefinitions()-Schema
  // (Obsidian ≥ 1.13) abbildbar. Der prefer-setting-definitions-Hinweis ist darum in
  // eslint.config.mjs file-scoped begründet abgeschaltet. display() bleibt der einzige
  // Render-Einstieg und delegiert an render().
  //
  // Bis 2026-07-20 waren die Sektionen zusätzlich einklappbar (collapsibleSection,
  // Kit-vendored). Aufgegeben: einklappbare Sektionen und die deklarative API schließen
  // einander aus (SettingDefinitionGroup kennt kein Collapse), und ohne Migration
  // erscheinen die Einstellungen ab 1.13 nicht in Obsidians Settings-Suche.
  display(): void {
    this.render();
  }

  /** Sektions-Überschrift + eigener Body-Container. Der Body ist funktional, nicht
   *  kosmetisch: refreshModel() ruft el.empty() auf und darf dabei nur seine eigene
   *  Sektion treffen, nicht die ganze Settings-Seite. */
  private section(title: string): HTMLElement {
    new Setting(this.containerEl).setName(title).setHeading();
    return this.containerEl.createDiv();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderOutput(this.section(t("settings.output.heading")));

    const presets = this.section(t("settings.presets.heading"));
    presets.createEl("p", { text: t("settings.presets.desc"), cls: "setting-item-description" });
    renderPresetEditor(presets, {
      getPresets: () => this.plugin.settings.presets,
      setPresets: async (next) => {
        this.plugin.settings.presets = next;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      },
      rerender: () => this.render(),
    });
  }

  /** No-op seit Task 5: die state-getriebene Modell-Download-Sektion ist mit dem
   *  Thin-Client-Umbau entfallen (Spec §4/§5). main.ts.refreshViews() ruft die Methode
   *  weiter auf — Task 7 entscheidet über den Wegfall des Aufrufs. */
  refreshModel(): void {}

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
          .setDynamicTooltip() // deprecated ab 1.13 (Wert dann immer inline), aber auf minAppVersion 1.8.7–1.12 nötig, damit der Slider-Wert überhaupt sichtbar ist
          .onChange(async (v) => {
            this.plugin.settings.defaultSteps = v;
            await this.plugin.saveSettings();
          }),
      );
  }
}
