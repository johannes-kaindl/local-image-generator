// Wiring (Spec §4): EIN registerView, Command + Ribbon, Host-Implementierung für die
// View, Lazy-Init der Engine (GPU-Check → Cache-Buffers → ORT-Sessions).
import { MarkdownView, normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { SdTurboEngine } from "./core/engine";
import { buildImageFilename, buildNoteFilename, dedupeFilename, dirOf, isoStamp } from "./core/filename";
import { pushHistory } from "./core/history";
import { MODEL_ID } from "./core/model-manifest";
import { buildImageNote } from "./core/note";
import { DEFAULT_SETTINGS, sanitizeSettings, type LigSettings } from "./core/settings";
import { STRINGS } from "./core/strings";
import type { GenParams, PanelState } from "./core/viewmodel";
import { ModelStore } from "./obsidian/model-store";
import { checkGpu, createOrtSession } from "./obsidian/ort-host";
import { dataUrlToBytes, rgbaToDataUrl } from "./obsidian/png";
import { LigSettingTab } from "./obsidian/settings-tab";
import { GeneratorView, VIEW_TYPE, type ViewHost } from "./obsidian/view";
import { mergeSettings } from "./vendor/kit/settings";

export default class LocalImageGeneratorPlugin extends Plugin {
  settings: LigSettings = DEFAULT_SETTINGS;
  modelStore = new ModelStore();
  private engine: SdTurboEngine | null = null;
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
    this.addSettingTab(new LigSettingTab(this.app, this));

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
    };

    this.registerView(VIEW_TYPE, (leaf) => new GeneratorView(leaf, host));
    this.addRibbonIcon("image-plus", STRINGS.viewTitle, () => void this.activateView());
    this.addCommand({ id: "open", name: STRINGS.openCommand, callback: () => void this.activateView() });

    void this.initStatus();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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

  async downloadModel(onProgress: (pct: number) => void): Promise<void> {
    this.state.model = { kind: "downloading", pct: 0 };
    this.refreshViews();
    try {
      await this.modelStore.download((pct) => {
        this.state.model = { kind: "downloading", pct };
        onProgress(pct);
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

  private async ensureEngine(): Promise<SdTurboEngine> {
    if (this.engine) return this.engine;
    const [textEncoder, unet, vaeDecoder] = await Promise.all([
      this.modelStore.getBuffer("text_encoder").then(createOrtSession),
      this.modelStore.getBuffer("unet").then(createOrtSession),
      this.modelStore.getBuffer("vae_decoder").then(createOrtSession),
    ]);
    const vocab = JSON.parse(await this.modelStore.getText("vocab")) as Record<string, number>;
    const merges = (await this.modelStore.getText("merges"))
      .split("\n")
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    this.engine = new SdTurboEngine({ textEncoder, unet, vaeDecoder }, { vocab, merges });
    return this.engine;
  }

  private async generate(steps: number, seed: number): Promise<void> {
    if (this.state.run.kind === "running") return;
    // Prompt HIER festhalten: zwischen Start und Ende kann der Nutzer weitertippen,
    // und die Ergebnis-Notiz muss das Bild beschreiben, das entstanden ist.
    const prompt = this.state.prompt;
    this.state.run = { kind: "running", step: 0, total: steps };
    this.refreshViews();
    let succeeded = false;
    try {
      const engine = await this.ensureEngine();
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
      new Notice(STRINGS.oomHint);
    } finally {
      this.refreshViews();
    }
    // Bewusst AUSSERHALB des try/catch der Generierung: ein Fehler hier (z.B. defekte
    // Historie) darf weder als Generierungsfehler gemeldet werden noch die bereits
    // erfolgreich befüllte Engine verwerfen. Erst bei Erfolg aufnehmen — sonst füllt
    // sich die Liste mit Halbsätzen und Fehlversuchen. saveSettings bewusst
    // fire-and-forget: ein langsamer Schreibvorgang darf das fertige Bild nicht aufhalten.
    if (succeeded) {
      this.settings.promptHistory = pushHistory(this.settings.promptHistory, prompt);
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
      new Notice(STRINGS.saveFailed(e instanceof Error ? e.message : String(e)));
      return;
    }

    if (mode === "insert") {
      const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
      if (editor) editor.replaceSelection(`![[${file.path}]]`);
      else new Notice(STRINGS.insertNeedsEditor);
      new Notice(STRINGS.saved(file.path));
      return;
    }

    if (this.settings.createMode !== "note") {
      await this.revealFile(file);
      new Notice(STRINGS.saved(file.path));
      return;
    }

    // Ab hier ist das Bild bereits geschrieben. Ein Fehler in der Notiz darf es NICHT
    // entwerten — deshalb eigener try und eine Meldung, die beides benennt.
    let note: TFile;
    try {
      note = await this.createNote(img.params, file.path);
    } catch (e) {
      new Notice(STRINGS.noteFailed(e instanceof Error ? e.message : String(e), file.path));
      return;
    }
    // Öffnen erst NACH dem try: scheitert nur das Öffnen, ist die Notiz trotzdem da —
    // sie hier mit "note failed" zu melden wäre schlicht gelogen.
    await this.revealFile(note);
    new Notice(STRINGS.saved(note.path));
  }
}
