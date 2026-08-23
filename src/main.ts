// Wiring (Spec §4): EIN registerView, Command + Ribbon, Host-Implementierung für die
// View. Thin Client — keine In-Process-Engine mehr: generate() spricht über HTTP mit
// einem lokal laufenden A1111-kompatiblen Server (/sdapi/v1/txt2img).
// i18n (docs/superpowers/specs/2026-07-17-i18n-design.md §2): registerI18n() + setLang()
// laufen ZUERST im onload, vor addSettingTab/registerView/addRibbonIcon/addCommand — sonst
// rendern die ersten t()-Aufrufe rohe Keys.
import { getLanguage, MarkdownView, normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { buildImageFilename, buildNoteFilename, dedupeFilename, dirOf } from "./core/filename";
import { deleteEntry, pushHistory } from "./core/history";
import { registerI18n } from "./i18n/strings";
import { buildImageNote } from "./core/note";
import { BUILTIN_MODEL, allAssets } from "./core/model-manifest";
import { DEFAULT_SETTINGS, migrateSettings, SETTINGS_SCHEMA, type EngineChoice, type LigSettings } from "./core/settings";
import { hardenParams, type HardenContext } from "./core/params";
import {
  createImageGenerationApi,
  type ApiFailure,
  type ApiImage,
  type ApiRequest,
  type ApiSaveResult,
  type ImageGenerationApi,
} from "./core/plugin-api";
import { parseOptionsModel, ProgressPoller, A1111Client, type ImageBackend } from "./core/txt2img";
import type { EngineState, GenParams, PanelState, ServerState } from "./core/viewmodel";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { httpGetJson, httpPostJson } from "./obsidian/http";
import { hasLegacyCache } from "./obsidian/legacy-cache";
import { LocalEngineBackend } from "./obsidian/local-engine";
import { DownloadAborted, IntegrityError, ModelStore } from "./obsidian/model-store";
import { checkGpu, createOrtSession, initOrt } from "./obsidian/ort-host";
import { dataUrlToBytes, rgbaToDataUrl } from "./obsidian/png";
import { LigSettingTab } from "./obsidian/settings-tab";
import { GeneratorView, VIEW_TYPE, type ViewHost } from "./obsidian/view";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { mergeSettings } from "./vendor/kit/settings";
import { validateSettings } from "./vendor/kit/settings_schema";
import { pickLang, setLang, t } from "./vendor/kit/i18n";

export default class LocalImageGeneratorPlugin extends Plugin {
  settings: LigSettings = DEFAULT_SETTINGS;
  private settingTab!: LigSettingTab;
  // Wird in onunload gesetzt. Die runGeneration()-Polling-Callbacks und der Post-await-Block
  // prüfen es, damit ein spät eintreffendes HTTP-Ergebnis nach dem Entladen des Plugins
  // nicht mehr this.state mutiert, refreshViews() ruft oder History schreibt. Der Remote-
  // Call selbst ist nicht abbrechbar (Obsidians requestUrl kennt kein Abort) — wir
  // verhindern nur die späte Nebenwirkung.
  private unloaded = false;
  /** Oeffentlicher Vertrag fuer andere Plugins:
   *  app.plugins.plugins["local-image-generator"].api */
  api!: ImageGenerationApi;
  /** Laeuft gerade ein Lauf ueber die Provider-API? Getrennt von state.run, weil isBusy()
   *  auch dann sperren muss, wenn der Fremdlauf noch in der Anlaufphase steht. */
  private apiRunning = false;
  // Eingebaute Engine (Spec 0.6): Store (Cache API), Backend (lazy, lebt bis dispose), laufender
  // Download. Der Settings-Tab beobachtet den Engine-Zustand über onEngineStateChanged.
  private readonly modelStore = new ModelStore();
  private localEngine: LocalEngineBackend | null = null;
  private downloadAbort: AbortController | null = null;
  onEngineStateChanged: (() => void) | null = null;
  // `mode` fehlt hier bewusst: es IST settings.engine und wird in getPanelState() abgeleitet
  // (Omit macht ein zweites Spiegeln typseitig unmoeglich). Zwei von Hand synchron gehaltene
  // Wahrheiten hatten schon eine: das ViewModel las state.mode, alles Neuere settings.engine.
  private state: Omit<PanelState, "mode"> = {
    engine: { kind: "not-downloaded" },
    server: { kind: "checking" }, // in onload nach settings-load auf "unconfigured"/"checking" gesetzt
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "",
    negativePrompt: "",
    seed: 0,
    steps: 20,
    cfg: 7,
    width: 512,
    height: 512,
  };

  async onload(): Promise<void> {
    registerI18n();
    setLang(pickLang(getLanguage()));

    // Obsidian traegt diese Instanz schon in app.plugins.plugins ein, bevor onload() zu Ende
    // ist — ein parallel ladendes Fremdplugin kann `.api` also in genau diesem Fenster lesen.
    // Deshalb VOR dem await auf loadData() konstruiert: jede Abhaengigkeit unten ist eine
    // Closure ueber `this`, keine braucht die geladenen Settings zum Bauzeitpunkt.
    this.api = createImageGenerationApi({
      getMode: () => this.settings.engine,
      readiness: () => this.apiReadiness(),
      isBusy: () => this.isBusy(),
      harden: (input) => hardenParams(input, this.hardenContext()),
      run: async (params, onProgress) => {
        // Ein Konsument haelt seine api-Referenz ueber unser Entladen hinaus. Ohne diesen
        // Guard baut ensureLocalEngine() eine neue GPU-Session fuer eine Plugin-Instanz,
        // die es nicht mehr gibt — und niemand disposed sie je.
        if (this.unloaded) return { ok: false, message: "plugin unloaded" };
        this.apiRunning = true;
        try {
          return await this.runGeneration(params, onProgress, { external: true });
        } finally {
          this.apiRunning = false;
        }
      },
      save: (image, createNote) => this.saveApiImage(image, createNote),
      defaultCreateNote: () => this.settings.createMode === "note",
    });

    // migrateSettings VOR mergeSettings: das neue Feld `engine` entscheidet sich am alten
    // Endpunkt (0.5-Nutzer bleiben im Server-Modus), nicht am Default.
    this.settings = validateSettings(
      DEFAULT_SETTINGS,
      mergeSettings(DEFAULT_SETTINGS, migrateSettings(await this.loadData())),
      SETTINGS_SCHEMA,
    );
    this.state.server = { kind: this.settings.endpoint.trim() === "" ? "unconfigured" : "checking" };
    this.state.engine = { kind: this.settings.engine === "builtin" ? "gpu-checking" : "not-downloaded" };

    this.settingTab = new LigSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    const host: ViewHost = {
      getPanelState: () => {
        this.state.editorActive = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor !== undefined;
        // Die einzige Stelle, an der `mode` entsteht — abgeleitet, nicht gespiegelt.
        return { ...this.state, mode: this.settings.engine };
      },
      getSettings: () => this.settings,
      setPrompt: (p) => {
        this.state.prompt = p;
      },
      setNegativePrompt: (p) => {
        this.state.negativePrompt = p;
      },
      setRecipe: (steps, seed, cfg, width, height) => {
        this.state.steps = steps;
        this.state.seed = seed;
        this.state.cfg = cfg;
        this.state.width = width;
        this.state.height = height;
      },
      generate: (steps, seed, cfg, width, height) => void this.generate(steps, seed, cfg, width, height),
      recheckServer: () => void this.checkServer(),
      downloadModel: () => void this.startDownload(),
      cancelDownload: () => this.cancelDownload(),
      saveImage: (mode) => void this.saveImage(mode),
      openSettings: () => {
        const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
        setting.open();
        setting.openTabById("local-image-generator");
      },
      restoreRecipe: (entry) => {
        // Rezept direkt in die DOM-Felder des Generate-Panels füllen und dorthin wechseln —
        // ohne neuen globalen Zustand (die Panels halten ihre eigenen Felder).
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          const view = leaf.view;
          if (view instanceof GeneratorView) {
            view.applyRecipe(entry);
            view.showTab("generate");
          }
        }
      },
      deleteHistoryEntry: (entry) => {
        this.settings.history = deleteEntry(this.settings.history, entry);
        void this.saveSettings();
        this.refreshViews();
      },
      clearHistory: () => {
        void confirmAction(this.app, {
          message: t("history.clearConfirm"),
          confirmLabel: t("history.clear"),
          cancelLabel: t("modal.cancel"),
        }).then((ok) => {
          if (!ok) return;
          this.settings.history = [];
          void this.saveSettings();
          this.refreshViews();
        });
      },
      setHistoryView: (v) => {
        this.settings.historyView = v;
        void this.saveSettings();
        this.refreshViews();
      },
      showTab: (id) => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          const view = leaf.view;
          if (view instanceof GeneratorView) view.showTab(id);
        }
      },
    };

    this.registerView(VIEW_TYPE, (leaf) => new GeneratorView(leaf, host));
    this.addRibbonIcon("image-plus", t("view.title"), () => void this.activateView());
    this.addCommand({ id: "open", name: t("cmd.open"), callback: () => void this.activateView() });

    if (this.settings.engine === "builtin") void this.refreshEngineState();
    else void this.checkServer();
    // Einmalig pro Session (onload läuft genau einmal pro Plugin-Ladevorgang, nicht pro
    // Settings-Tab-Öffnung): Bestandsinstallationen können noch ~2,5 GB alte SD-Turbo-
    // Gewichte im Cache-API-Speicher haben (0.x, In-Process-Engine). Hinweis statt
    // automatischem Löschen — der Aufräumer selbst sitzt in den Settings (Task 7).
    void hasLegacyCache().then((found) => {
      if (found) new Notice(t("notice.legacyHint"));
    });
  }

  onunload(): void {
    // Eine laufende runGeneration() pollt per setInterval und wartet auf einen nicht abbrechbaren
    // HTTP-Call. Das Flag sorgt dafür, dass deren Callbacks nach dem Entladen zu No-ops werden
    // (kein State-Mutieren, kein refreshViews, kein History-Schreiben). Die eingebaute Engine
    // hält GPU-Sessions und evtl. einen Download — beides abräumen (0.1-Leak-Befund).
    this.unloaded = true;
    this.downloadAbort?.abort();
    void this.localEngine?.dispose();
    this.localEngine = null;
  }

  // ── Eingebaute Engine (Spec 0.6 §2/§4/§5) ─────────────────────────────────

  getEngineState(): EngineState {
    return this.state.engine;
  }

  /** Läuft gerade eine Generierung (oder das Laden davor)? Modus-Wechsel und Entfernen warten
   *  darauf — die GPU-Sessions dürfen nicht unter einem aktiven UNet-Schritt weggezogen werden
   *  (Review 2026-08-19). `apiRunning` deckt die Anlaufphase eines Fremdlaufs ab, bevor
   *  runGeneration() state.run überhaupt auf "external" gesetzt hat. */
  isBusy(): boolean {
    const k = this.state.run.kind;
    return this.apiRunning || k === "contacting" || k === "loading-model"
      || k === "generating" || k === "external";
  }

  /** Netzfreie Bereitschaft fuer status(). Spiegelt den zuletzt ermittelten Zustand —
   *  ein Netzaufruf gehoert hier nicht hin (der Vertrag sagt das zu). */
  private apiReadiness(): { ready: true } | { ready: false; reason: ApiFailure } {
    if (this.settings.engine === "builtin") {
      const e = this.state.engine;
      if (e.kind === "ready") return { ready: true };
      if (e.kind === "gpu-missing") return { ready: false, reason: "no-gpu" };
      return { ready: false, reason: "model-not-downloaded" };
    }
    const s = this.state.server;
    if (s.kind === "ok") return { ready: true };
    if (s.kind === "unconfigured") return { ready: false, reason: "not-configured" };
    return { ready: false, reason: "unreachable" };
  }

  private currentModelName(): string {
    return this.settings.engine === "builtin"
      ? BUILTIN_MODEL.id
      : (this.state.server.kind === "ok" ? this.state.server.modelName : null) ?? "unknown";
  }

  /** Der EINE Kontext, unter dem gehaertet wird — Panel wie Provider-API. Zwei Kontexte
   *  waeren zwei Wahrheiten: die API meldete dann andere Parameter, als das Panel in seine
   *  Notiz schreibt. Genau dafuer liegt die Haertung in core/params.ts an einer Stelle. */
  private hardenContext(): HardenContext {
    return {
      mode: this.settings.engine,
      defaultSteps: this.settings.defaultSteps,
      model: this.currentModelName(),
      now: new Date(),
      randomSeed: () => Math.floor(Math.random() * 2 ** 31),
    };
  }

  /** Der einzige Vault-Write der Provider-API. Nutzt dieselbe Ablage wie der Create-Knopf
   *  (Ausgabeziel, Dedup, optional Ergebnis-Notiz) — ein Fremdplugin soll nicht an der
   *  Einstellung des Nutzers vorbei schreiben. */
  private async saveApiImage(image: ApiImage, createNote: boolean): Promise<ApiSaveResult> {
    // Derselbe Grund wie beim `run`-Guard oben: ein Konsument haelt seine api-Referenz ueber
    // unser Entladen hinaus. Der Vertrag ist generate() → Mensch schaut sich das Bild an →
    // save() — genau in dieser Pause kann der Nutzer das Plugin deaktivieren. this.app bleibt
    // nach onunload gueltig, also wuerde createBinary anstandslos in den Vault schreiben; ein
    // entladenes Plugin darf den Vault aber nicht mehr anfassen.
    if (this.unloaded) return { ok: false, reason: "write-failed", message: "plugin unloaded" };
    const { created, ...rest } = image.params;
    const params: GenParams = { ...rest, date: created, initImage: null, denoising: null };
    let file: TFile;
    try {
      const path = await this.resolveImagePath(buildImageFilename(new Date(params.date), params.seed));
      file = await this.app.vault.createBinary(path, dataUrlToBytes(`data:image/png;base64,${image.base64}`));
    } catch (e) {
      return { ok: false, reason: "write-failed", message: e instanceof Error ? e.message : String(e) };
    }
    if (!createNote) return { ok: true, imagePath: file.path, notePath: null };
    // Ab hier ist das Bild bereits geschrieben. Ein Fehler in der Notiz darf es NICHT
    // entwerten (dieselbe Lehre wie saveImage() unten) — deshalb eigener try, und der
    // Rueckgabewert bleibt ok mit notePath: null statt eines write-failed, das den Aufrufer
    // die bereits gespeicherte Datei nicht mehr finden liesse.
    try {
      const note = await this.createNote(params, file.path);
      return { ok: true, imagePath: file.path, notePath: note.path };
    } catch {
      return { ok: true, imagePath: file.path, notePath: null };
    }
  }

  private setEngineState(e: EngineState): void {
    this.state.engine = e;
    this.refreshViews();
    this.onEngineStateChanged?.();
  }

  /** Modus wechseln (Settings): das andere Backend wird verlassen — GPU-Sessions frei, Server
   *  neu geprüft bzw. Engine-Zustand neu ermittelt. */
  async setEngine(mode: EngineChoice): Promise<boolean> {
    if (mode === this.settings.engine) return true;
    if (this.isBusy()) {
      new Notice(t("notice.busy"));
      return false;
    }
    this.settings.engine = mode;
    await this.saveSettings();
    if (mode === "server") {
      // Ein laufender Download gehört zum verlassenen Modus — abbrechen, nicht im Verborgenen
      // weiterlaufen lassen (fertige Dateien bleiben im Cache).
      this.cancelDownload();
      const e = this.localEngine;
      this.localEngine = null;
      void e?.dispose();
      await this.checkServer();
    } else {
      await this.refreshEngineState();
    }
    this.refreshViews();
    this.onEngineStateChanged?.();
    return true;
  }

  /** GPU prüfen, dann nachsehen, ob alle Assets im Cache liegen. Läuft beim Aktivieren des
   *  builtin-Modus und nach jedem Download/Entfernen. Ein laufender Download bleibt unberührt. */
  async refreshEngineState(): Promise<void> {
    if (this.downloadAbort) return;
    this.setEngineState({ kind: "gpu-checking" });
    const gpu = await checkGpu();
    if (this.unloaded) return;
    if (gpu !== "ok") {
      this.setEngineState({ kind: "gpu-missing", reason: gpu });
      return;
    }
    const complete = await this.modelStore.isComplete(allAssets()).catch(() => false);
    if (this.unloaded) return;
    this.setEngineState({ kind: complete ? "ready" : "not-downloaded" });
  }

  /** Opt-in-Download aller fehlenden Assets (Spec 0.6 §4: ohne Klick fließt kein Byte). */
  async startDownload(): Promise<void> {
    if (this.downloadAbort) return;
    const ac = new AbortController();
    this.downloadAbort = ac;
    const files = allAssets();
    try {
      await this.modelStore.download(
        files,
        this.settings.assetBaseUrl,
        (p) => {
          if (this.unloaded) return;
          const file = p.file.path.split("/").pop() ?? p.file.path;
          this.setEngineState(
            p.phase === "verifying"
              ? { kind: "verifying", file }
              : { kind: "downloading", file, received: p.received, total: p.total, fileIndex: p.fileIndex, fileCount: p.fileCount },
          );
        },
        ac.signal,
      );
      if (this.unloaded) return;
      new Notice(t("notice.modelReady"));
    } catch (e) {
      if (this.unloaded) return;
      this.downloadAbort = null;
      if (e instanceof DownloadAborted) {
        await this.refreshEngineState();
      } else if (e instanceof IntegrityError) {
        this.setEngineState({ kind: "error", message: t("engine.integrityError", e.file.path) });
      } else {
        this.setEngineState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
      return;
    } finally {
      this.downloadAbort = null;
    }
    await this.refreshEngineState();
  }

  cancelDownload(): void {
    this.downloadAbort?.abort();
  }

  /** Alle Assets aus dem Cache entfernen (Settings, nach Bestätigung); GPU-Sessions dazu frei. */
  async removeModel(): Promise<boolean> {
    if (this.isBusy()) {
      new Notice(t("notice.busy"));
      return false;
    }
    this.cancelDownload();
    const e = this.localEngine;
    this.localEngine = null;
    await e?.dispose();
    await this.modelStore.deleteAll(allAssets());
    await this.refreshEngineState();
    return true;
  }

  private ensureLocalEngine(): LocalEngineBackend {
    if (this.localEngine) return this.localEngine;
    const be = new LocalEngineBackend({
      store: this.modelStore,
      createSession: createOrtSession,
      initRuntime: initOrt,
      checkGpu,
      encodePng: rgbaToDataUrl,
    });
    this.localEngine = be;
    return be;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Erreichbarkeit + aktives Modell in den State spiegeln (Spec §3: GET /sdapi/v1/options,
   *  200 ohne Modellfeld gilt als OK — Draw Things liefert die Options-Form nur teilweise).
   *  Gibt den resultierenden ServerState zurück, damit der Settings-Tab-Test-Button (Task 7)
   *  das Ergebnis direkt für seine Notice auswerten kann, ohne einen eigenen Zugriff auf
   *  den (privaten) Plugin-State zu brauchen. */
  async checkServer(): Promise<ServerState> {
    const ep = this.settings.endpoint.trim();
    if (ep === "") {
      this.state.server = { kind: "unconfigured" };
      this.refreshViews();
      return this.state.server;
    }
    this.state.server = { kind: "checking" };
    this.refreshViews();
    try {
      const r = await httpGetJson(`${normalizeEndpoint(ep)}/sdapi/v1/options`);
      if (this.unloaded) return this.state.server; // Plugin entladen → keine späten State-Mutationen mehr
      this.state.server = r.status === 200 ? { kind: "ok", modelName: parseOptionsModel(r.json) } : { kind: "unreachable" };
    } catch {
      if (this.unloaded) return this.state.server;
      this.state.server = { kind: "unreachable" };
    }
    this.refreshViews();
    return this.state.server;
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof GeneratorView) view.refresh();
    }
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
    }
  }

  /** Rechnet ein Bild — bereits gehärtete Parameter, Backend-Wahl, Sekundentakt und
   *  ProgressPoller. Fasst NICHT an: state.image, settings.history, state.prompt — das ist
   *  Sache des Aufrufers (Panel: generate() unten; Provider-API: plugin.api.generate() ->
   *  ApiDeps.run() oben). Setzt aber state.run und ruft refreshViews(), weil die
   *  Fortschrittsanzeige zum Lauf gehört, nicht zum Aufrufer. Hat KEINE eigene Busy-Sperre —
   *  die sitzt beim jeweiligen Aufrufer (Panel: generate() unten; API: plugin-api.ts +
   *  apiRunning), der garantiert, dass hier nie zwei Läufe gleichzeitig starten.
   *  `opts.external`: der Lauf kommt über die Provider-API, nicht vom eigenen Klick — die
   *  Statuszeile zeigt dafür durchgehend "external" (mit dem zuletzt bekannten Prozentsatz)
   *  statt der Phasen-Zustände contacting/loading-model/generating. */
  private async runGeneration(
    params: GenParams,
    onProgress?: ApiRequest["onProgress"],
    opts?: { external?: boolean },
  ): Promise<{ ok: true; base64: string } | { ok: false; message: string }> {
    const builtin = this.settings.engine === "builtin";
    const backend: ImageBackend = builtin ? this.ensureLocalEngine() : new A1111Client(this.settings.endpoint, httpPostJson);
    const external = opts?.external === true;
    // `phase` ist die WAHRE Phase und steuert den Kontrollfluss unten (Poller/Timer); im
    // Fremdlauf faellt state.run (die ANGEZEIGTE Phase) fuer die gesamte Laufzeit auf
    // "external" — ohne die Trennung wuerden die r.kind-Checks unten staendig an "external"
    // vorbeilaufen, weil sie dort contacting/loading-model/generating erwarten. "done" markiert
    // den Abschluss (Erfolg oder Fehler), damit ein spät eintreffender Poll keinen bereits
    // beendeten Lauf mehr ueberschreibt.
    let phase: "contacting" | "loading-model" | "generating" | "done" = "contacting";
    let genPct: number | null = null;
    const setRun = (
      r: { kind: "contacting" } | { kind: "loading-model"; elapsedSec: number } | { kind: "generating"; pct: number | null; elapsedSec: number },
    ): void => {
      phase = r.kind;
      if (r.kind === "generating") genPct = r.pct;
      this.state.run = external ? { kind: "external", pct: r.kind === "generating" ? r.pct : null } : r;
    };
    setRun({ kind: "contacting" });
    this.refreshViews();
    // Fortschritt. Server: 1-s-Polling auf /sdapi/v1/progress; liefert der Server keins (404,
    // Timeout, fremde Form), bleibt pct null und die Statuszeile zählt Sekunden. Nach dem ersten
    // 404 fragt der Poller nicht mehr (Draw Things) — der Zähler läuft trotzdem.
    // Eingebaut: die Engine meldet Phasen selbst (loading-model einmal je Sitzung, dann Schritte);
    // der Timer trägt nur den Sekundenzähler der Ladephase.
    let elapsed = 0;
    const poller = builtin ? null : new ProgressPoller(this.settings.endpoint, (u) => httpGetJson(u, 1000));
    if (builtin) {
      this.ensureLocalEngine().onPhase = (ph, step, total) => {
        if (this.unloaded) return;
        if (ph === "loading-model") {
          setRun({ kind: "loading-model", elapsedSec: elapsed });
          onProgress?.(null, "loading-model");
        } else if (step !== undefined && total !== undefined && total > 0) {
          const pct = Math.round((step / total) * 100);
          setRun({ kind: "generating", pct, elapsedSec: elapsed });
          onProgress?.(pct, "generating");
        }
        this.refreshViews();
      };
    }
    const tick = window.setInterval(() => {
      if (this.unloaded) return; // Plugin entladen → keine späten State-Mutationen mehr
      elapsed += 1;
      if (phase === "loading-model") {
        setRun({ kind: "loading-model", elapsedSec: elapsed });
        onProgress?.(null, "loading-model");
        this.refreshViews();
        return;
      }
      if (phase !== "generating" && phase !== "contacting") return;
      if (!poller) {
        if (phase === "generating") {
          setRun({ kind: "generating", pct: genPct, elapsedSec: elapsed });
          onProgress?.(genPct, "generating");
          this.refreshViews();
        }
        return;
      }
      void poller.poll().then((pct) => {
        if (this.unloaded) return;
        if (phase === "generating" || phase === "contacting") {
          setRun({ kind: "generating", pct, elapsedSec: elapsed });
          onProgress?.(pct, "generating");
        }
        this.refreshViews();
      });
    }, 1000);
    try {
      const png = await backend.generate({ ...params, initImageData: null });
      phase = "done";
      // Ergebnis kann nach onunload eintreffen (Remote-Call ist nicht abbrechbar). Dann
      // keine State-Mutation, kein refreshViews — nur das finally räumt den Timer ab.
      if (this.unloaded) return { ok: true, base64: png };
      this.state.run = { kind: "idle" };
      return { ok: true, base64: png };
    } catch (e) {
      phase = "done";
      const msg = e instanceof Error ? e.message : String(e);
      if (this.unloaded) return { ok: false, message: msg };
      // Ein Fremdlauf hinterlaesst im Panel KEINE Spur — weder bei Erfolg (idle, oben) noch
      // bei Fehler. Ohne diese Unterscheidung zeigte die Statuszeile die rohe Backend-Meldung
      // eines fremden Laufs, als waere der EIGENE gescheitert. Der Aufrufer bekommt den
      // Fehler ohnehin als Rueckgabewert und meldet ihn seinem Nutzer selbst; unsere
      // Statuszeile gehoert dem eigenen Klick. (Ruling 2026-08-23, Task „Folgearbeit aus dem
      // Provider-API-Abschlussreview" — Alternative war ein dritter i18n-Key.)
      this.state.run = external ? { kind: "idle" } : { kind: "error", message: msg };
      // Fehlschlag kann Erreichbarkeits-Ursache haben → Serverstatus neu prüfen (fire-and-forget).
      if (!builtin) void this.checkServer();
      return { ok: false, message: msg };
    } finally {
      // Timer immer abräumen (auch wenn onunload zwischen zwei Polls fiel) — verhindert
      // weiteres Feuern; refreshViews aber nur, solange das Plugin noch aktiv ist.
      window.clearInterval(tick);
      // `onPhase` wird nur fuer diesen einen Lauf gesetzt (Zeile oben), aber nie zurueckgesetzt —
      // ohne das haelt this.localEngine nach dem Aufloesen des Laufs weiter eine Closure ueber
      // ein fremdes onProgress fest (bei einem API-Lauf), die niemand mehr braucht. Der naechste
      // Lauf ueberschreibt onPhase ohnehin selbst; das hier schliesst nur die Luecke dazwischen.
      if (builtin && this.localEngine) this.localEngine.onPhase = undefined;
      if (!this.unloaded) this.refreshViews();
    }
  }

  private async generate(steps: number, seed: number, cfg: number, width: number, height: number): Promise<void> {
    // ViewModel deaktiviert den Generate-Knopf schon bei jedem busy-Zustand (inkl. "external") —
    // dieser Check ist die Defensive dahinter und muss deshalb dieselbe Menge sperren wie
    // isBusy(), sonst koennte ein Klick waehrend eines Fremdlaufs zwei runGeneration()-Aufrufe
    // gleichzeitig lostreten.
    if (this.isBusy()) return;
    const builtin = this.settings.engine === "builtin";
    // ViewModel gated das bereits — Defensive: server ok bzw. Engine bereit.
    if (builtin ? this.state.engine.kind !== "ready" : this.state.server.kind !== "ok") return;
    // Rezept-Ehrlichkeit (Spec 0.6 §7): die eingebaute Engine kennt weder Negativ-Prompt noch CFG
    // noch andere Größen — die Notiz trägt genau das, was gerechnet wurde. hardenParams
    // neutralisiert das still statt es abzulehnen (Keine-Attrappen-Linie).
    const params = hardenParams(
      { prompt: this.state.prompt, negativePrompt: this.state.negativePrompt, width, height, steps, seed, cfg },
      this.hardenContext(),
    );
    const result = await this.runGeneration(params);
    // Ergebnis kann nach onunload eintreffen — runGeneration hat dann selbst schon keine
    // späte State-Mutation vorgenommen; hier zusätzlich kein Bild, keine Historie schreiben.
    if (this.unloaded) return;
    if (result.ok) {
      this.state.image = { dataUrl: `data:image/png;base64,${result.base64}`, params };
      this.settings.history = pushHistory(this.settings.history, {
        prompt: params.prompt, negativePrompt: params.negativePrompt, seed: params.seed, steps: params.steps,
        cfg: params.cfg, model: params.model, width: params.width, height: params.height, created: params.date,
        denoising: params.denoising, initImage: params.initImage,
      });
      this.refreshViews();
      void this.saveSettings();
    }
  }

  private async resolveImagePath(filename: string): Promise<string> {
    if (this.settings.outputFolder === "") {
      const fm = this.app.fileManager as unknown as {
        getAvailablePathForAttachment(name: string): Promise<string>;
      };
      return fm.getAvailablePathForAttachment(filename);
    }
    const folder = normalizePath(this.settings.outputFolder);
    if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    // Kollisions-Dedup: getAvailablePathForAttachment übernimmt das im leeren-Ordner-
    // Fall; für einen expliziten outputFolder müssen wir selbst -2, -3, … anhängen.
    return dedupeFilename(
      normalizePath(`${folder}/${filename}`),
      (p) => this.app.vault.getAbstractFileByPath(p) !== null,
    );
  }

  // Ergebnis-Notiz neben/statt dem Bild anlegen. Spiegelt resolveImagePath: fehlender
  // Zielordner wird angelegt, Kollisionen bekommen -2, -3, … angehängt.
  private async createNote(params: GenParams, imagePath: string): Promise<TFile> {
    const configured = this.settings.noteFolder.trim();
    const folder = configured === "" ? dirOf(imagePath) : normalizePath(configured);
    if (folder !== "" && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    const name = buildNoteFilename(params.prompt, params.seed);
    const path = dedupeFilename(
      folder === "" ? name : normalizePath(`${folder}/${name}`),
      (p) => this.app.vault.getAbstractFileByPath(p) !== null,
    );
    return this.app.vault.create(path, buildImageNote(params, imagePath));
  }

  // Das Öffnen ist Komfort, kein Ergebnis: schlägt es fehl, liegt die Datei trotzdem im
  // Vault. Der Fehler wird deshalb geschluckt — die "Saved: <Pfad>"-Meldung des Aufrufers
  // sagt, wo sie ist. Ein Öffnen-Fehler darf weder das Ergebnis entwerten (Nur-Bild-Pfad:
  // gar keine Meldung) noch es falsch benennen (Notiz-Pfad: "note failed", obwohl die
  // Notiz existiert).
  private async revealFile(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(true).openFile(file).catch(() => undefined);
  }

  private async saveImage(mode: "create" | "insert"): Promise<void> {
    const img = this.state.image;
    if (!img) return;
    let file: TFile;
    try {
      // Aus dem beim Generieren eingefrorenen Zeitstempel ableiten, nicht aus "jetzt":
      // sonst laufen Dateiname und Notiz-`created` (params.date) auseinander, wenn
      // zwischen Generieren und Create Zeit vergeht (Spec §7.4, Finding 4). isoStamp
      // liefert lokale Zeit ohne Offset — new Date() parst das als lokale Zeit zurück,
      // der Round-Trip ist verlustfrei.
      const path = await this.resolveImagePath(buildImageFilename(new Date(img.params.date), img.params.seed));
      file = await this.app.vault.createBinary(path, dataUrlToBytes(img.dataUrl));
    } catch (e) {
      new Notice(t("notice.saveFailed", e instanceof Error ? e.message : String(e)));
      return;
    }

    if (mode === "insert") {
      const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
      if (editor) editor.replaceSelection(`![[${file.path}]]`);
      else new Notice(t("generate.insertNeedsEditor"));
      new Notice(t("notice.saved", file.path));
      return;
    }

    if (this.settings.createMode !== "note") {
      await this.revealFile(file);
      new Notice(t("notice.saved", file.path));
      return;
    }

    // Ab hier ist das Bild bereits geschrieben. Ein Fehler in der Notiz darf es NICHT
    // entwerten — deshalb eigener try und eine Meldung, die beides benennt.
    let note: TFile;
    try {
      note = await this.createNote(img.params, file.path);
    } catch (e) {
      new Notice(t("notice.noteFailed", file.path, e instanceof Error ? e.message : String(e)));
      return;
    }
    // Öffnen erst NACH dem try: scheitert nur das Öffnen, ist die Notiz trotzdem da —
    // sie hier mit "note failed" zu melden wäre schlicht gelogen.
    await this.revealFile(note);
    new Notice(t("notice.saved", note.path));
  }
}
