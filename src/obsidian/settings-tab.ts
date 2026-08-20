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
import { allAssets, BUILTIN_MODEL, DEFAULT_ASSET_BASE_URL, totalBytes } from "../core/model-manifest";
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA, type LigSettings } from "../core/settings";
import { formatBytes, type EngineState } from "../core/viewmodel";
import { t } from "../vendor/kit/i18n";
import { validateSettings } from "../vendor/kit/settings_schema";
import { applyDestructive, confirmAction } from "../vendor/kit-obsidian/confirm";
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
  /** Statuszeile der Modell-Zeile — wird bei Fortschritts-Ticks in place aktualisiert; ein
   *  Wechsel der Zustandsart (downloading → ready) zeichnet den Tab neu (andere Knöpfe). */
  private modelStatusEl: HTMLElement | null = null;
  private renderedEngineKind: EngineState["kind"] | null = null;
  private renderedMode: LigSettings["engine"] | null = null;

  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
    plugin.onEngineStateChanged = () => {
      if (this.renderedMode === null) return; // Tab nicht offen
      const st = plugin.getEngineState();
      const sameShape = st.kind === this.renderedEngineKind && plugin.settings.engine === this.renderedMode;
      if (sameShape && this.modelStatusEl) this.modelStatusEl.setText(engineStatusText(st));
      else this.refreshUi();
    };
  }

  // ── Die eine Wahrheit ────────────────────────────────────────────────────
  // Der Generic-Parameter bindet jeden `key` an ein echtes Settings-Feld: ein Tippfehler
  // bricht den Build, statt zur Laufzeit stumm ins Leere zu greifen (der Host liest den
  // Wert ausschließlich über getControlValue).
  getSettingDefinitions(): SettingDefinitionItem<keyof LigSettings>[] {
    const builtin = this.plugin.settings.engine === "builtin";
    this.renderedMode = this.plugin.settings.engine;
    // Bedingte Zeilen WEGLASSEN statt `visible: false`: Obsidian 1.13 cacht die Definitionen und
    // wertet Prädikate nicht neu aus — nach einem Moduswechsel zeichnet refreshUi() (update())
    // den Tab mit den dann passenden Zeilen neu.
    const modelRow: SettingDefinitionItem<keyof LigSettings> = {
      // Modell-Zeile der eingebauten Engine (Spec 0.6 §6): Status + Herunterladen/Abbrechen/
      // Entfernen je nach Zustand — mehrere Controls, deshalb ein render-Hatch.
      name: t("settings.model.name", BUILTIN_MODEL.label, formatBytes(totalBytes(allAssets()))),
      desc: t("settings.model.desc", BUILTIN_MODEL.attribution, BUILTIN_MODEL.license.name),
      render: (setting) => this.renderModel(setting),
    };
    const serverRow: SettingDefinitionItem<keyof LigSettings> = {
      name: t("settings.server.name"),
      desc: t("settings.server.desc"),
      render: (setting) => this.renderServer(setting),
    };
    return [
      {
        type: "group",
        heading: t("settings.engine.heading"),
        items: [
          {
            name: t("settings.engine.name"),
            desc: t("settings.engine.desc", formatBytes(totalBytes(allAssets()))),
            control: {
              type: "dropdown",
              key: "engine",
              options: { builtin: t("settings.engine.builtin"), server: t("settings.engine.server") },
            },
          },
          builtin ? modelRow : serverRow,
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
        type: "group",
        heading: t("settings.advanced.heading"),
        items: [
          {
            name: t("settings.assetBaseUrl.name"),
            desc: t("settings.assetBaseUrl.desc"),
            control: { type: "text", key: "assetBaseUrl", placeholder: DEFAULT_ASSET_BASE_URL },
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
    // Immer durch validateSettings: das ist die einzige Stelle, die Müllwerte abfängt. Der
    // deklarative Host validiert nur den Typ, nicht unsere Grenzen (Steps 1..50, createMode).
    // Der trim() davor war früher pro Feld in den onChange-Handlern verstreut — ohne ihn
    // landet ein versehentliches Leerzeichen im Endpunkt oder im Ordnerpfad.
    const clean = typeof value === "string" ? value.trim() : value;
    if (key === "engine") {
      // Moduswechsel hat Seiteneffekte (GPU-Sessions frei, Server prüfen) — über das Plugin.
      // Während einer Generierung lehnt es ab (Notice); refreshUi stellt den Dropdown zurück.
      await this.plugin.setEngine(clean === "server" ? "server" : "builtin");
      this.refreshUi();
      return;
    }
    this.plugin.settings = validateSettings(DEFAULT_SETTINGS, { ...this.plugin.settings, [key]: clean }, SETTINGS_SCHEMA);
    await this.plugin.saveSettings();
  }

  // ── render-Hatches ───────────────────────────────────────────────────────

  /** Modell-Zeile: Lizenz-Link in der Beschreibung, Status-Text und Knöpfe je Zustand. */
  private renderModel(setting: Setting): void {
    this.ensureLegacyChecked();
    const st = this.plugin.getEngineState();
    this.renderedEngineKind = st.kind;
    setting.descEl.createEl("br");
    setting.descEl.createEl("a", { text: BUILTIN_MODEL.license.name, href: BUILTIN_MODEL.license.url });
    this.modelStatusEl = setting.controlEl.createSpan({ text: engineStatusText(st), cls: "lig-model-status" });
    const busy = st.kind === "downloading" || st.kind === "verifying";
    if (busy) {
      setting.addButton((b) => b.setButtonText(t("settings.model.cancel")).onClick(() => this.plugin.cancelDownload()));
      return;
    }
    if (st.kind === "not-downloaded" || st.kind === "error") {
      setting.addButton((b) =>
        b.setButtonText(t("settings.model.download")).setCta().onClick(() => void this.plugin.startDownload()),
      );
    }
    if (st.kind === "ready" || st.kind === "error") {
      setting.addButton((b) => {
        b.setButtonText(t("settings.model.remove"));
        applyDestructive(b);
        // Während einer Generierung gesperrt: die GPU-Sessions sind in Gebrauch.
        if (this.plugin.isBusy()) {
          b.setDisabled(true);
          b.setTooltip(t("notice.busy"));
        }
        b.onClick(async () => {
          const ok = await confirmAction(this.app, {
            message: t("settings.model.removeConfirm", formatBytes(totalBytes(allAssets()))),
            confirmLabel: t("settings.model.remove"),
            cancelLabel: t("modal.cancel"),
          });
          if (!ok) return;
          if (await this.plugin.removeModel()) new Notice(t("settings.model.removed"));
        });
      });
    }
  }

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
    this.modelStatusEl = null;
    this.renderedEngineKind = null;
    this.renderedMode = null;
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

/** Kurzer Zustandstext für die Modell-Zeile (dieselben Keys wie die Panel-Statuszeile). */
function engineStatusText(st: EngineState): string {
  switch (st.kind) {
    case "gpu-checking": return t("status.gpuChecking");
    case "gpu-missing": return st.reason === "no-webgpu" ? t("status.gpuMissing.noWebgpu") : t("status.gpuMissing.noF16");
    case "not-downloaded": return t("status.notDownloaded");
    case "downloading": return t("status.downloading", st.file, formatBytes(st.received), formatBytes(st.total), String(st.fileIndex), String(st.fileCount));
    case "verifying": return t("status.verifying", st.file);
    case "ready": return t("settings.model.ready");
    case "error": return t("status.error", st.message);
  }
}
