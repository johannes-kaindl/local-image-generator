// Settings (UI-STANDARD §5): Server, Ausgabe, Presets, plus ein einmaliger Legacy-Cache-
// Aufräumer für Bestandsinstallationen (Spec §4).
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { STEPS } from "../core/generation";
import { t } from "../vendor/kit/i18n";
import { applyDestructive } from "../vendor/kit-obsidian/confirm";
import { FolderSuggest } from "../vendor/kit-obsidian/folder-suggest";
import { deleteLegacyCache, hasLegacyCache } from "./legacy-cache";
import { renderPresetEditor } from "./preset-editor";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
  }

  // Imperatives Rendering (klassische Setting-API) statt des deklarativen
  // getSettingDefinitions()-Schemas (Obsidian ≥ 1.13): die Legacy-Cache-Zeile ist
  // state-getrieben und wird NACH einem asynchronen hasLegacyCache()-Check bedingt
  // angehängt bzw. nach dem Löschen wieder aus dem DOM entfernt (siehe display()). Das
  // deklarative Schema böte mit SettingDefinitionRender (obsidian.d.ts:6265-6283) eine
  // render-Escape-Hatch für genau dieses Muster — die Zeile ist also nicht technisch
  // unabbildbar, aber die Migration der ganzen Datei aufs deklarative Schema liegt
  // außerhalb des Scopes von Task 7 (zurückgestellt, nicht unmöglich). Der
  // prefer-setting-definitions-Hinweis ist darum in eslint.config.mjs file-scoped
  // begründet abgeschaltet. display() bleibt der einzige Render-Einstieg.
  //
  // Bis 2026-07-20 waren die Sektionen zusätzlich einklappbar (collapsibleSection,
  // Kit-vendored). Aufgegeben: einklappbare Sektionen und die deklarative API schließen
  // einander aus (SettingDefinitionGroup kennt kein Collapse), und ohne Migration
  // erscheinen die Einstellungen ab 1.13 nicht in Obsidians Settings-Suche.
  //
  // Bis 2026-07-23 (Task 7) trug diese Datei zusätzlich eine state-getriebene Modell-
  // Download-Sektion (refreshModel(), partielles el.empty()) — das war der ursprüngliche
  // Grund für den Override. Diese Sektion ist mit dem Thin-Client-Umbau entfallen; die
  // Begründung wurde durch die jetzige Legacy-Cache-Zeile ersetzt (siehe oben), nicht
  // ersatzlos gestrichen.
  display(): void {
    this.render();

    // Legacy-Cache-Hinweis (Spec §4): Bestandsinstallationen können noch ~2,5 GB alte
    // SD-Turbo-Gewichte (0.x, In-Process-Engine) im Cache-API-Speicher haben. Async, weil
    // caches.has() ein Promise liefert — die Zeile erscheint darum NACH dem synchronen
    // render() als eigener, kleiner Anhang. isConnected schützt gegen ein spätes Ergebnis
    // nach einem zwischenzeitlichen erneuten display()-Aufruf (z. B. durch Preset-Add).
    const containerEl = this.containerEl;
    void hasLegacyCache().then((found) => {
      if (!found || !containerEl.isConnected) return;
      const setting = new Setting(containerEl).setName(t("settings.legacy.delete")).addButton((b) => {
        b.setButtonText(t("settings.legacy.delete"));
        // Nicht setWarning(): ab Obsidian 1.13 deprecated und im Store-Review angemahnt.
        // setDestructive() gibt es erst ab 1.13 — applyDestructive prüft zur Laufzeit und
        // fällt darunter auf die native mod-warning-Klasse zurück.
        applyDestructive(b);
        b.onClick(async () => {
          b.setDisabled(true);
          await deleteLegacyCache();
          new Notice(t("settings.legacy.done"));
          setting.settingEl.remove();
        });
      });
    });
  }

  /** Sektions-Überschrift + eigener Body-Container. */
  private section(title: string): HTMLElement {
    new Setting(this.containerEl).setName(title).setHeading();
    return this.containerEl.createDiv();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderServer(this.section(t("settings.server.name")));
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

  private renderServer(el: HTMLElement): void {
    new Setting(el)
      .setName(t("settings.server.name"))
      .setDesc(t("settings.server.desc"))
      .addText((tf) => {
        tf.setPlaceholder("http://127.0.0.1:7860");
        tf.setValue(this.plugin.settings.endpoint).onChange(async (v) => {
          this.plugin.settings.endpoint = v.trim();
          await this.plugin.saveSettings();
          void this.plugin.checkServer();
        });
      })
      .addButton((b) =>
        b.setButtonText(t("settings.server.test")).onClick(async () => {
          const result = await this.plugin.checkServer();
          if (result.kind === "ok") new Notice(t("notice.serverOk", result.modelName ?? "–"));
          else new Notice(t("notice.serverFail"));
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
          .setLimits(STEPS.min, STEPS.max, 1)
          .setValue(this.plugin.settings.defaultSteps)
          .setDynamicTooltip() // deprecated ab 1.13 (Wert dann immer inline), aber auf minAppVersion 1.8.7–1.12 nötig, damit der Slider-Wert überhaupt sichtbar ist
          .onChange(async (v) => {
            this.plugin.settings.defaultSteps = v;
            await this.plugin.saveSettings();
          }),
      );
  }
}
