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
import { buildImageNote } from "./core/note";
import { DEFAULT_SETTINGS, sanitizeSettings, type LigSettings } from "./core/settings";
import type { GenParams, PanelState } from "./core/viewmodel";
import { ConfirmModal } from "./obsidian/confirm-modal";
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
  private settingTab!: LigSettingTab;
  private engineLoadGeneration = 0;
  private state: PanelState = {
    gpu: "checking",
    model: { kind: "missing" },
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "",
  };

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, await this.loadData()));

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
      generate: (steps, seed) => void this.generate(steps, seed),
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
            view.applyRecipe(entry.prompt, entry.seed, entry.steps);
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

    void this.initStatus();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    // Unabhängig vom Watchdog weiter beobachtet: feuert raceTimeout() zuerst, läuft
    // loadPromise im Hintergrund weiter (ORT kennt kein AbortSignal). Löst sie später
    // doch noch erfolgreich auf, muss sie trotzdem freigegeben werden — sonst leakt
    // genau der GPU-Speicher, den die Generation-ID eigentlich verhindern soll. Eine
    // spätere Ablehnung wird hier bewusst geschluckt (kein zweiter unhandledrejection-
    // Kanal) — Fehler-Reporting für den aktuellen Ladeversuch läuft bereits über den
    // catch-Zweig unten bzw. den unhandledrejection-Listener.
    loadPromise.then(
      (engine) => {
        if (myGeneration !== this.engineLoadGeneration) void engine.dispose().catch(() => {});
      },
      () => {},
    );
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
      throw e;
    } finally {
      window.clearInterval(tick);
    }
  }

  private async generate(steps: number, seed: number): Promise<void> {
    if (this.state.run.kind === "running" || this.state.run.kind === "loading") return;
    // Prompt HIER festhalten: zwischen Start und Ende kann der Nutzer weitertippen,
    // und die Ergebnis-Notiz muss das Bild beschreiben, das entstanden ist.
    const prompt = this.state.prompt;
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
        params: { prompt, seed: result.seed, steps, model: MODEL_ID, date: isoStamp(new Date()) },
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
        created: p.date,
      });
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
