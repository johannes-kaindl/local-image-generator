// Settings (UI-STANDARD §5): Server, Ausgabe, Presets, plus ein einmaliger Legacy-Cache-
// Aufräumer für Bestandsinstallationen (Spec §4).
//
// Zweigleisig — EINE Wahrheit für beide Renderpfade (REGISTRY „Zweigleisige deklarative
// Settings — eine-Wahrheit-Walker", Muster übernommen aus 3d-codeblocks/src/obsidian/settings.ts
// in der minimalen Form, Hatch-Behandlung aus vault-rag/src/settings.ts):
//
// Ab Obsidian 1.13 fragt der Host `getSettingDefinitions()` ab und ruft `display()` nie —
// nur so erscheinen die Einstellungen in der Settings-SUCHE. Unser `minAppVersion` ist 1.8.7,
// dort gibt es die deklarative API nicht, der Host ruft `display()`. Deshalb ist
// `getSettingDefinitions()` die einzige Definition, und `renderImperative()` zeichnet
// DIESELBE Struktur mit der klassischen `Setting`-API nach. Kein zweiter Definitionsbaum,
// der auseinanderlaufen kann, und der Versions-Floor bleibt, wo er ist (PROF-OBS-06).
//
// Drei Zeilen sind `render`-Hatches (SettingDefinitionRender), weil sie sich nicht als
// einzelnes Control ausdrücken lassen: der Server-Endpunkt (Textfeld UND Test-Knopf in
// derselben Zeile), der Preset-Editor (zeichnet je Preset eine eigene Zeile) und der
// Legacy-Cache-Aufräumer (erscheint erst nach einem asynchronen Check). Alles andere sind
// reine Controls — inklusive der beiden Ordner-Felder, für die 1.13 mit `type: "folder"`
// einen eigenen Suggester mitbringt; darunter setzt der Walker unseren vendorten
// FolderSuggest ein.
import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import { STEPS } from "../core/generation";
import { sanitizeSettings, type LigSettings } from "../core/settings";
import { t } from "../vendor/kit/i18n";
import { applyDestructive } from "../vendor/kit-obsidian/confirm";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "../vendor/kit-obsidian/settings_walker";
import { deleteLegacyCache, hasLegacyCache } from "./legacy-cache";
import { renderPresetEditor } from "./preset-editor";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
  /** Ergebnis des asynchronen hasLegacyCache()-Checks: `null` = noch nicht geprüft.
   *  Steuert das `visible`-Prädikat der Aufräum-Zeile in BEIDEN Renderpfaden. */
  private legacyCache: boolean | null = null;
  /** Cleanup-Funktion aus dem letzten renderSettingDefinitions()-Aufruf. */
  private cleanupPrevious: () => void = () => {};

  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
  }

  // ── Die eine Wahrheit ────────────────────────────────────────────────────
  // Der Generic-Parameter bindet jeden `key` an ein echtes Settings-Feld: ein Tippfehler
  // bricht den Build, statt zur Laufzeit stumm ins Leere zu greifen (der Host liest den
  // Wert ausschließlich über getControlValue).
  getSettingDefinitions(): SettingDefinitionItem<keyof LigSettings>[] {
    return [
      {
        type: "group",
        heading: t("settings.server.name"),
        items: [
          {
            name: t("settings.server.name"),
            desc: t("settings.server.desc"),
            render: (setting) => this.renderServer(setting),
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.output.heading"),
        items: [
          {
            name: t("settings.output.folder"),
            desc: t("settings.output.folderDesc"),
            control: { type: "folder", key: "outputFolder" },
          },
          {
            name: t("settings.noteFolder"),
            desc: t("settings.noteFolderDesc"),
            control: { type: "folder", key: "noteFolder" },
          },
          {
            name: t("settings.createMode"),
            desc: t("settings.createModeDesc"),
            control: {
              type: "dropdown",
              key: "createMode",
              options: { image: t("settings.createModeImage"), note: t("settings.createModeNote") },
            },
          },
          {
            name: t("settings.defaultSteps"),
            desc: t("settings.defaultStepsDesc"),
            // displayFormat ersetzt das ab 1.13 deprecated setDynamicTooltip(): ab 1.13 zeigt
            // der Host den Wert damit inline, der Fallback-Walker hängt ihn an den Namen.
            control: {
              type: "slider",
              key: "defaultSteps",
              min: STEPS.min,
              max: STEPS.max,
              step: 1,
              displayFormat: (v: number) => String(v),
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.presets.heading"),
        items: [
          {
            name: t("settings.presets.heading"),
            desc: t("settings.presets.desc"),
            render: (setting) => this.renderPresets(setting),
          },
        ],
      },
      {
        // Legacy-Cache-Hinweis (Spec §4): Bestandsinstallationen können noch ~2,5 GB alte
        // SD-Turbo-Gewichte (0.x, In-Process-Engine) im Cache-API-Speicher haben. Der Check
        // ist asynchron, deshalb entscheidet ein Prädikat über die Sichtbarkeit statt eines
        // nachträglichen Anhängens ans DOM — ausgewertet in beiden Renderpfaden.
        name: t("settings.legacy.delete"),
        visible: () => this.legacyCache === true,
        render: (setting) => this.renderLegacyCache(setting),
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // Immer durch sanitizeSettings: das ist die einzige Stelle, die Müllwerte abfängt. Der
    // deklarative Host validiert nur den Typ, nicht unsere Grenzen (Steps 1..50, createMode).
    // Der trim() davor war früher pro Feld in den onChange-Handlern verstreut — ohne ihn
    // landet ein versehentliches Leerzeichen im Endpunkt oder im Ordnerpfad.
    const clean = typeof value === "string" ? value.trim() : value;
    this.plugin.settings = sanitizeSettings({ ...this.plugin.settings, [key]: clean });
    await this.plugin.saveSettings();
  }

  // ── render-Hatches ───────────────────────────────────────────────────────

  /** Endpunkt-Textfeld und Test-Knopf teilen sich eine Zeile — als Control nicht abbildbar. */
  private renderServer(setting: Setting): void {
    // Echtes Render-Signal: den Legacy-Check hier anstoßen und nicht in
    // getSettingDefinitions(), das ab 1.13 auch für den bloßen Suchindex aufgerufen wird.
    this.ensureLegacyChecked();

    setting
      .addText((tf) => {
        tf.setPlaceholder("http://127.0.0.1:7860");
        tf.setValue(this.plugin.settings.endpoint).onChange(async (v) => {
          await this.setControlValue("endpoint", v);
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

  /** Der Preset-Editor zeichnet je Preset eine eigene Zeile plus einen Hinzufügen-Knopf —
   *  er braucht deshalb einen Block-Container statt der Zwei-Spalten-Zeile. */
  private renderPresets(setting: Setting): void {
    const host = settingBodyHost(setting);
    host.createEl("p", { text: t("settings.presets.desc"), cls: "setting-item-description" });
    renderPresetEditor(host, {
      getPresets: () => this.plugin.settings.presets,
      setPresets: async (next) => {
        this.plugin.settings.presets = next;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      },
      rerender: () => this.refreshUi(),
    });
  }

  private renderLegacyCache(setting: Setting): void {
    setting.addButton((b) => {
      b.setButtonText(t("settings.legacy.delete"));
      // Nicht setWarning(): ab Obsidian 1.13 deprecated und im Store-Review angemahnt.
      // setDestructive() gibt es erst ab 1.13 — applyDestructive prüft zur Laufzeit und
      // fällt darunter auf die native mod-warning-Klasse zurück.
      applyDestructive(b);
      b.onClick(async () => {
        b.setDisabled(true);
        await deleteLegacyCache();
        new Notice(t("settings.legacy.done"));
        // Nicht settingEl.remove(): der Zustand gehört ins Prädikat, sonst kommt die Zeile
        // beim nächsten Rebuild (Preset-Add, Settings-Suche) wieder.
        this.legacyCache = false;
        this.refreshUi();
      });
    });
  }

  /** Einmal pro Tab-Öffnen prüfen, ob alte Gewichte im Cache-API-Speicher liegen. hide()
   *  setzt das Ergebnis zurück, damit ein späteres Öffnen erneut misst. */
  private ensureLegacyChecked(): void {
    if (this.legacyCache !== null) return;
    this.legacyCache = false;
    void hasLegacyCache().then((found) => {
      if (!found) return;
      this.legacyCache = true;
      this.refreshUi();
    });
  }

  hide(): void {
    this.legacyCache = null;
    super.hide();
  }

  // ── Imperativer Fallback (Obsidian < 1.13) ───────────────────────────────
  // Ab 1.13 ruft der Host getSettingDefinitions() selbst auf und display() wird nie
  // aufgerufen; auf ≤1.12 fehlt der deklarative Renderpfad, dort ruft der Host display().
  display(): void {
    this.renderImperative();
  }

  private renderImperative(): void {
    this.cleanupPrevious();
    this.containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(
      this.containerEl,
      this.getSettingDefinitions(),
      this,
      this.app,
    );
  }

  /** Re-Render des Tabs. Ab 1.13 exponiert das deklarative Framework update(); auf dem
   *  <1.13-Fallback existiert die Methode nicht → renderImperative() erneut laufen. Der Cast
   *  auf einen anonymen Typ nimmt `obsidianmd/no-unsupported-api` die Sicht auf
   *  SettingTab.update (1.13-only). */
  private refreshUi(): void {
    refreshSettingsTab(this, () => this.renderImperative());
  }

}
