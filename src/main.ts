// Wiring (Spec §4): EIN registerView, Command + Ribbon, Host-Implementierung für die
// View, Lazy-Init der Engine (GPU-Check → Cache-Buffers → ORT-Sessions).
// i18n (docs/superpowers/specs/2026-07-17-i18n-design.md §2): registerI18n() + setLang()
// laufen ZUERST im onload, vor addSettingTab/registerView/addRibbonIcon/addCommand — sonst
// rendern die ersten t()-Aufrufe rohe Keys.
import { getLanguage, MarkdownView, normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { SdTurboEngine } from "./core/engine";
import { raceTimeout } from "./core/timeout";
import { buildImageFilename, buildNoteFilename, dedupeFilename, dirOf, isoStamp } from "./core/filename";
import { deleteEntry, pushHistory } from "./core/history";
import { registerI18n } from "./i18n/strings";
import { MODEL_FILES, MODEL_ID } from "./core/model-manifest";
import { DEFAULT_MODEL_ID, getModel, type ModelSpec } from "./core/models";
import { buildImageNote } from "./core/note";
import { DEFAULT_SETTINGS, sanitizeSettings, type LigSettings } from "./core/settings";
import type { GenParams, PanelState } from "./core/viewmodel";
import { ConfirmModal } from "./obsidian/confirm-modal";
import { detectMflux, fluxWeightsReady } from "./obsidian/mflux-host";
import { MfluxEngine } from "./obsidian/mflux-engine";
import { ModelStore } from "./obsidian/model-store";
import { checkGpu, createOrtSession } from "./obsidian/ort-host";
import { dataUrlToBytes, rgbaToDataUrl } from "./obsidian/png";
import { LigSettingTab } from "./obsidian/settings-tab";
import { GeneratorView, VIEW_TYPE, type ViewHost } from "./obsidian/view";
import { mergeSettings } from "./vendor/kit/settings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";

export default class LocalImageGeneratorPlugin extends Plugin {
  settings: LigSettings = DEFAULT_SETTINGS;
  modelStore = new ModelStore();
  private engine: SdTurboEngine | null = null;
  private mfluxEngine = new MfluxEngine();
  private settingTab!: LigSettingTab;
  private engineLoadGeneration = 0;
  private state: PanelState = {
    gpu: "checking",
    model: { kind: "missing" },
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "",
    selectedModel: DEFAULT_MODEL_ID,
    mflux: { binary: null, weights: "missing", download: null },
    // Platzhalter bis zum ersten GeneratePanel.refresh() (kein Bild vorhanden →
    // recipeUnchanged ist bis dahin ohnehin immer false, siehe viewmodel.ts).
    seed: 0,
    steps: 4,
    width: 512,
    height: 512,
  };

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, await this.loadData()));
    this.state.selectedModel = this.settings.selectedModel;

    registerI18n();
    setLang(pickLang(getLanguage()));

    this.settingTab = new LigSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    const host: ViewHost = {
      getPanelState: () => {
        this.state.editorActive = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor !== undefined;
        return this.state;
      },
      getSettings: () => this.settings,
      setPrompt: (p) => {
        this.state.prompt = p;
      },
      setRecipe: (steps, seed, width, height) => {
        this.state.steps = steps;
        this.state.seed = seed;
        this.state.width = width;
        this.state.height = height;
      },
      generate: (steps, seed, width, height) => void this.generate(steps, seed, width, height),
      setSelectedModel: (id) => {
        this.settings.selectedModel = id;
        this.state.selectedModel = id;
        void this.saveSettings();
        this.refreshViews();
      },
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
        new ConfirmModal(this.app, t("history.clearConfirm"), t("history.clear"), () => {
          this.settings.history = [];
          void this.saveSettings();
          this.refreshViews();
        }).open();
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

    // Fängt die verschluckte ORT-Init-Rejection ab, die den dokumentierten jsep/asyncify-
    // Hänger (Fix 7673961) verursacht hat: ORTs eigene interne Promise rejected, ohne dass
    // unser eigenes await in loadEngine()/ensureEngine() das je erreicht (Spec 2026-07-18-
    // robustheits-block-design.md §2.4). Bewusst kein event.reason-Auswerten (fragil) —
    // die Korrelation läuft rein über den State: nur während der Ladephase reagieren, um
    // fremde Rejections (andere Plugins, Obsidian selbst) nicht fälschlich zu kapern.
    // Kein preventDefault() — Standard-Konsolen-Logging bleibt erhalten.
    this.registerDomEvent(window, "unhandledrejection", () => {
      if (this.state.run.kind === "loading") {
        this.state.run = { kind: "error", message: t("status.engineLoadFailed") };
        this.refreshViews();
      }
    });

    this.refreshMfluxStatus();
    void this.initStatus();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** mflux-Erkennung + Gewichte-Check in den State spiegeln (onload, Settings-Änderungen). */
  refreshMfluxStatus(): void {
    this.state.mflux = {
      binary: detectMflux(this.settings),
      weights: fluxWeightsReady(this.settings) ? "ready" : "missing",
      download: null,
    };
    this.refreshViews();
  }

  /** Read-only-Zugriff für Consumer außerhalb der ViewHost-Fassade (aktuell nur
   *  LigSettingTab, siehe Spec 2026-07-18-robustheits-block-design.md §2.2). */
  getState(): Readonly<PanelState> {
    return this.state;
  }

  private async initStatus(): Promise<void> {
    this.state.gpu = await checkGpu();
    this.state.model = (await this.modelStore.isComplete()) ? { kind: "ready" } : { kind: "missing" };
    this.refreshViews();
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof GeneratorView) view.refresh();
    }
    this.settingTab.refreshModel();
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

  async downloadModel(): Promise<void> {
    // Optimistischer Platzhalter, bis der erste echte Fortschritts-Callback aus
    // modelStore.download() eintrifft (Netzwerk-Round-Trip, meist < 1s) — wird sofort
    // überschrieben. Ohne diesen Zwischenschritt bliebe state.model kurz auf "missing",
    // während der Button in Wahrheit schon lädt.
    this.state.model = {
      kind: "downloading",
      overallPct: 0,
      fileKey: MODEL_FILES[0]!.key,
      fileIndex: 1,
      totalFiles: MODEL_FILES.length,
      receivedBytes: 0,
      totalBytes: MODEL_FILES[0]!.approxBytes,
    };
    this.refreshViews();
    try {
      await this.modelStore.download((p) => {
        this.state.model = { kind: "downloading", ...p };
        this.refreshViews();
      });
      this.state.model = { kind: "ready" };
    } catch (e) {
      this.state.model = { kind: "missing" };
      throw e;
    } finally {
      this.refreshViews();
    }
  }

  onunload(): void {
    // Laufenden mflux-Kindprozess killen (SIGKILL, kein Server-Modus) — VOR dem ORT-
    // dispose, damit ein laufender generateMflux()-Aufruf sein "cancelled" bekommt, bevor
    // das Plugin selbst als entladen gilt.
    this.mfluxEngine.kill();
    // Sessions beim Entladen freigeben (Spec §8: GPU-Speicher-Leak vermeiden).
    void this.engine?.dispose().catch(() => {});
    this.engine = null;
  }

  onModelDeleted(): void {
    // Erst die Sessions freigeben, dann verwerfen (fire-and-forget: onModelDeleted
    // ist synchron, der Release muss den UI-Refresh nicht blockieren; Spec §8).
    void this.engine?.dispose().catch(() => {});
    this.engine = null;
    this.state.model = { kind: "missing" };
    this.refreshViews();
  }

  // Die bisherige reine Ladelogik — unverändert, nur aus ensureEngine() extrahiert,
  // damit raceTimeout() genau diese eine Promise umschließen kann.
  private async loadEngine(): Promise<SdTurboEngine> {
    const [textEncoder, unet, vaeDecoder] = await Promise.all([
      this.modelStore.getBuffer("text_encoder").then(createOrtSession),
      this.modelStore.getBuffer("unet").then(createOrtSession),
      this.modelStore.getBuffer("vae_decoder").then(createOrtSession),
    ]);
    const vocab = JSON.parse(await this.modelStore.getText("vocab")) as Record<string, number>;
    const merges = (await this.modelStore.getText("merges"))
      .split("\n")
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    return new SdTurboEngine({ textEncoder, unet, vaeDecoder }, { vocab, merges });
  }

  // Watchdog + Ladephasen-Status um loadEngine() (Spec 2026-07-18-robustheits-block-
  // design.md §2.4): ORT bietet kein AbortSignal für InferenceSession.create, ein
  // Timeout kann den Aufruf also nicht wirklich abbrechen — nur der UI melden und die
  // Promise im Hintergrund verwaisen lassen. Die Generation-ID erkennt genau das: löst
  // ein verwaister alter Ladeversuch später doch noch auf, wird die Session sofort
  // freigegeben statt geleakt (bekannter GPU-Leak-Bug aus 0.1).
  private async ensureEngine(): Promise<SdTurboEngine> {
    if (this.engine) return this.engine;
    const myGeneration = ++this.engineLoadGeneration;
    this.state.run = { kind: "loading", elapsedSec: 0 };
    this.refreshViews();
    const tick = window.setInterval(() => {
      if (this.state.run.kind === "loading") {
        this.state.run = { kind: "loading", elapsedSec: this.state.run.elapsedSec + 1 };
        this.refreshViews();
      }
    }, 1000);
    const loadPromise = this.loadEngine();
    try {
      const engine = await raceTimeout(loadPromise, 5 * 60_000, "engine load timed out");
      if (myGeneration !== this.engineLoadGeneration) {
        // Ein neuerer Ladeversuch läuft bereits (Retry nach Timeout/unhandledrejection) —
        // dieser hier ist verwaist. Sofort freigeben statt GPU-Speicher zu leaken.
        void engine.dispose().catch(() => {});
        throw new Error("stale engine load result");
      }
      this.engine = engine;
      return engine;
    } catch (e) {
      if (myGeneration === this.engineLoadGeneration) {
        this.state.run = { kind: "error", message: t("status.engineLoadFailed") };
        this.refreshViews();
      }
      // Ab HIER steht endgültig fest, dass dieser Aufruf loadPromise nicht adoptiert —
      // egal ob raceTimeout() selbst das Timeout-Fehler geworfen hat, loadEngine() direkt
      // abgelehnt wurde, oder der "stale"-Zweig oben schon synchron disposed hat (dann ist
      // dieser zweite dispose()-Aufruf ein harmloser No-op, SdTurboEngine.dispose() ist
      // idempotent). ORT kennt kein AbortSignal — läuft loadPromise nach einem Watchdog-
      // Timeout im Hintergrund weiter und löst SPÄTER doch noch auf (der Normalfall: das
      // Laden war nur langsam, kein echter Hänger), wird sie hier trotzdem freigegeben,
      // unabhängig davon, ob inzwischen ein Retry die Generation-ID weitergezählt hat.
      // Vor diesem Punkt (eager, direkt nach dem Erzeugen von loadPromise) anzuhängen
      // würde den GLÜCKSFALL fälschlich disposen: der Handler würde vor der
      // this.engine-Zuweisung oben feuern (Promise.race abonniert loadPromise ebenfalls,
      // aber "await raceTimeout(...)" resumt erst einen Microtask-Hop später als direkte
      // loadPromise-Subscriber) und die gerade erfolgreich geladene Engine zerstören,
      // bevor sie adoptiert wird.
      loadPromise.then((lateEngine) => void lateEngine.dispose().catch(() => {})).catch(() => {});
      throw e;
    } finally {
      window.clearInterval(tick);
    }
  }

  // Engine-Router (Spec §5/§7): sd-turbo läuft weiter über ORT/WebGPU (generateOrt),
  // FLUX.2 über den mflux-Kindprozess (generateMflux). Der Katalog (models.ts) entscheidet
  // die Weiche — kein Modell-if/else in den Panels.
  private async generate(steps: number, seed: number, width: number, height: number): Promise<void> {
    if (this.state.run.kind === "running" || this.state.run.kind === "loading") return;
    const spec = getModel(this.settings.selectedModel);
    // Prompt HIER festhalten: zwischen Start und Ende kann der Nutzer weitertippen,
    // und die Ergebnis-Notiz muss das Bild beschreiben, das entstanden ist.
    const prompt = this.state.prompt;
    if (spec.engine === "mflux") return this.generateMflux(spec, prompt, steps, seed, width, height);
    return this.generateOrt(prompt, steps, seed); // Katalog garantiert 512² für sd-turbo
  }

  private async generateOrt(prompt: string, steps: number, seed: number): Promise<void> {
    let engine: SdTurboEngine;
    try {
      engine = await this.ensureEngine();
    } catch {
      // ensureEngine() hat state.run bereits auf status.engineLoadFailed gesetzt und
      // selbst refreshViews() aufgerufen (Watchdog- oder Generation-Mismatch-Fall) —
      // hier nichts weiter zu tun, der Generate-Button ist bereits wieder aktiv.
      return;
    }
    this.state.run = { kind: "running", step: 0, total: steps };
    this.refreshViews();
    let succeeded = false;
    try {
      const result = await engine.generate({ prompt, steps, seed }, (step, total) => {
        this.state.run = { kind: "running", step, total };
        this.refreshViews();
      });
      this.state.image = {
        dataUrl: rgbaToDataUrl(result.rgba, result.width, result.height),
        params: {
          prompt,
          seed: result.seed,
          steps,
          model: MODEL_ID,
          // Aus dem Engine-Ergebnis übernehmen statt erneut zu hardcoden: EINE Quelle für
          // die 512² (IMAGE_SIZE in engine.ts), kein zweiter unabhängiger Literal hier, der
          // aus dem Tritt geraten könnte (ersetzt den Übergangsfix aus Task 3).
          width: result.width,
          height: result.height,
          date: isoStamp(new Date()),
        },
      };
      this.state.run = { kind: "idle" };
      succeeded = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.run = { kind: "error", message: msg };
      // Sessions freigeben und verwerfen, nächster Lauf lädt neu (Spec §8).
      // Fire-and-forget: der Fehlerpfad soll den UI-Refresh nicht blockieren.
      void this.engine?.dispose().catch(() => {});
      this.engine = null;
      new Notice(t("notice.oomHint"));
    } finally {
      this.refreshViews();
    }
    // Bewusst AUSSERHALB des try/catch der Generierung: ein Fehler hier (z.B. defekte
    // Historie) darf weder als Generierungsfehler gemeldet werden noch die bereits
    // erfolgreich befüllte Engine verwerfen. Erst bei Erfolg aufnehmen — sonst füllt
    // sich die Liste mit Halbsätzen und Fehlversuchen. saveSettings bewusst
    // fire-and-forget: ein langsamer Schreibvorgang darf das fertige Bild nicht aufhalten.
    if (succeeded && this.state.image) {
      // Volles Rezept aus dem beim Erfolg eingefrorenen img.params (kein "jetzt"-Nachziehen).
      const p = this.state.image.params;
      this.settings.history = pushHistory(this.settings.history, {
        prompt: p.prompt,
        seed: p.seed,
        steps: p.steps,
        model: p.model,
        width: p.width,
        height: p.height,
        created: p.date,
      });
      void this.saveSettings();
    }
  }

  // FLUX.2 über den mflux-Kindprozess (Spec §5/§7): mflux lädt das Modell bei jedem
  // Aufruf neu in den Speicher (kein Server-Modus) — die Ladephase mit Sekundenzähler
  // spiegelt das wie ensureEngine(); der erste Step-Callback beendet sie.
  private async generateMflux(
    spec: ModelSpec,
    prompt: string,
    steps: number,
    seed: number,
    width: number,
    height: number,
  ): Promise<void> {
    const binary = this.state.mflux.binary;
    if (binary === null || this.state.mflux.weights !== "ready" || this.mfluxEngine.busy) return; // ViewModel gated das bereits — Defensive
    this.state.run = { kind: "loading", elapsedSec: 0 };
    this.refreshViews();
    const tick = window.setInterval(() => {
      if (this.state.run.kind === "loading") {
        this.state.run = { kind: "loading", elapsedSec: this.state.run.elapsedSec + 1 };
        this.refreshViews();
      }
    }, 1000);
    let succeeded = false;
    try {
      const png = await this.mfluxEngine.run(
        binary,
        spec,
        { prompt, seed, steps, width, height },
        this.settings.modelsDir.trim(),
        {
          onDownload: (file, pct) => {
            // Sollte im Normalfall nie feuern (Gewichte-Gate oben) — falls doch (Cache extern
            // gelöscht), ehrlich als Download anzeigen statt minutenlang "Loading".
            this.state.mflux = { ...this.state.mflux, weights: "downloading", download: { file, pct } };
            this.refreshViews();
          },
          onStep: (step, total) => {
            this.state.run = { kind: "running", step, total };
            this.refreshViews();
          },
        },
      );
      this.state.image = {
        dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        params: { prompt, seed, steps, model: spec.id, width, height, date: isoStamp(new Date()) },
      };
      this.state.run = { kind: "idle" };
      this.state.mflux = { ...this.state.mflux, weights: "ready", download: null };
      succeeded = true;
    } catch (e) {
      // "cancelled" (View-Close/Unload hat gekillt) ist kein Fehler — UI still auf idle.
      const msg = e instanceof Error ? e.message : String(e);
      this.state.run = msg === "cancelled" ? { kind: "idle" } : { kind: "error", message: msg };
    } finally {
      window.clearInterval(tick);
      this.refreshViews();
    }
    if (succeeded && this.state.image) {
      const p = this.state.image.params;
      this.settings.history = pushHistory(this.settings.history, {
        prompt: p.prompt,
        seed: p.seed,
        steps: p.steps,
        model: p.model,
        width: p.width,
        height: p.height,
        created: p.date,
      });
      void this.saveSettings();
    }
  }

  /** Vorbereitungslauf (Spec §6): 1 Step / 512² / Seed 0 — mflux lädt dabei die Gewichte;
   *  das Mini-Bild wird verworfen (Temp-Cleanup der Engine, s. mflux-engine.ts finally).
   *  Ein reiner Download-Befehl existiert in der verifizierten mflux-Version nicht. */
  async downloadFluxModel(): Promise<void> {
    const spec = getModel("flux2-klein-4b");
    const binary = this.state.mflux.binary;
    if (binary === null || this.mfluxEngine.busy) return;
    this.state.mflux = { ...this.state.mflux, weights: "downloading", download: { file: "…", pct: 0 } };
    this.refreshViews();
    try {
      await this.mfluxEngine.run(
        binary,
        spec,
        { prompt: "warmup", seed: 0, steps: 1, width: 512, height: 512 },
        this.settings.modelsDir.trim(),
        {
          onDownload: (file, pct) => {
            this.state.mflux = { ...this.state.mflux, weights: "downloading", download: { file, pct } };
            this.refreshViews();
          },
          onStep: () => {},
        },
      );
      this.state.mflux = { ...this.state.mflux, weights: "ready", download: null };
    } catch (e) {
      this.state.mflux = { ...this.state.mflux, weights: fluxWeightsReady(this.settings) ? "ready" : "missing", download: null };
      throw e;
    } finally {
      this.refreshViews();
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
