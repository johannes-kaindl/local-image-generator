// Wiring (Spec §4): EIN registerView, Command + Ribbon, Host-Implementierung für die
// View. Thin Client — keine In-Process-Engine mehr: generate() spricht über HTTP mit
// einem lokal laufenden A1111-kompatiblen Server (/sdapi/v1/txt2img).
// i18n (docs/superpowers/specs/2026-07-17-i18n-design.md §2): registerI18n() + setLang()
// laufen ZUERST im onload, vor addSettingTab/registerView/addRibbonIcon/addCommand — sonst
// rendern die ersten t()-Aufrufe rohe Keys.
import { getLanguage, MarkdownView, normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { buildImageFilename, buildNoteFilename, dedupeFilename, dirOf, isoStamp } from "./core/filename";
import { deleteEntry, pushHistory } from "./core/history";
import { registerI18n } from "./i18n/strings";
import { buildImageNote } from "./core/note";
import { DEFAULT_SETTINGS, sanitizeSettings, type LigSettings } from "./core/settings";
import { parseOptionsModel, parseProgressPct, Txt2ImgClient } from "./core/txt2img";
import type { GenParams, PanelState } from "./core/viewmodel";
import { ConfirmModal } from "./obsidian/confirm-modal";
import { httpGetJson, httpPostJson } from "./obsidian/http";
import { dataUrlToBytes } from "./obsidian/png";
import { LigSettingTab } from "./obsidian/settings-tab";
import { GeneratorView, VIEW_TYPE, type ViewHost } from "./obsidian/view";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { mergeSettings } from "./vendor/kit/settings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";

export default class LocalImageGeneratorPlugin extends Plugin {
  settings: LigSettings = DEFAULT_SETTINGS;
  private settingTab!: LigSettingTab;
  // Wird in onunload gesetzt. Die generate()-Polling-Callbacks und der Post-await-Block
  // prüfen es, damit ein spät eintreffendes HTTP-Ergebnis nach dem Entladen des Plugins
  // nicht mehr this.state mutiert, refreshViews() ruft oder History schreibt. Der Remote-
  // Call selbst ist nicht abbrechbar (Obsidians requestUrl kennt kein Abort) — wir
  // verhindern nur die späte Nebenwirkung.
  private unloaded = false;
  private state: PanelState = {
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
    this.settings = sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, await this.loadData()));
    this.state.server = { kind: this.settings.endpoint.trim() === "" ? "unconfigured" : "checking" };

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

    void this.checkServer();
  }

  onunload(): void {
    // Thin Client: kein Prozess/keine Session zu killen. Aber eine laufende generate()
    // pollt per setInterval und wartet auf einen nicht abbrechbaren HTTP-Call. Das Flag
    // sorgt dafür, dass deren Callbacks nach dem Entladen zu No-ops werden (kein State-
    // Mutieren, kein refreshViews, kein History-Schreiben).
    this.unloaded = true;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Erreichbarkeit + aktives Modell in den State spiegeln (Spec §3: GET /sdapi/v1/options,
   *  200 ohne Modellfeld gilt als OK — Draw Things liefert die Options-Form nur teilweise). */
  async checkServer(): Promise<void> {
    const ep = this.settings.endpoint.trim();
    if (ep === "") {
      this.state.server = { kind: "unconfigured" };
      this.refreshViews();
      return;
    }
    this.state.server = { kind: "checking" };
    this.refreshViews();
    try {
      const r = await httpGetJson(`${normalizeEndpoint(ep)}/sdapi/v1/options`);
      this.state.server = r.status === 200 ? { kind: "ok", modelName: parseOptionsModel(r.json) } : { kind: "unreachable" };
    } catch {
      this.state.server = { kind: "unreachable" };
    }
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

  private async generate(steps: number, seed: number, cfg: number, width: number, height: number): Promise<void> {
    if (this.state.run.kind === "contacting" || this.state.run.kind === "generating") return;
    if (this.state.server.kind !== "ok") return; // ViewModel gated das bereits — Defensive
    const prompt = this.state.prompt;
    const negativePrompt = this.state.negativePrompt;
    const model = this.state.server.modelName ?? "unknown";
    const client = new Txt2ImgClient(this.settings.endpoint, httpPostJson);
    this.state.run = { kind: "contacting" };
    this.refreshViews();
    // Fortschritt: 1-s-Polling auf /sdapi/v1/progress; liefert der Server keins (404,
    // Timeout, fremde Form), bleibt pct null und die Statuszeile zählt Sekunden.
    let elapsed = 0;
    const tick = window.setInterval(() => {
      if (this.unloaded) return; // Plugin entladen → keine späten State-Mutationen mehr
      elapsed += 1;
      if (this.state.run.kind !== "generating" && this.state.run.kind !== "contacting") return;
      void httpGetJson(`${normalizeEndpoint(this.settings.endpoint)}/sdapi/v1/progress`, 1000)
        .then((r) => {
          if (this.unloaded) return;
          if (this.state.run.kind === "generating" || this.state.run.kind === "contacting")
            this.state.run = { kind: "generating", pct: r.status === 200 ? parseProgressPct(r.json) : null, elapsedSec: elapsed };
          this.refreshViews();
        })
        .catch(() => {
          if (this.unloaded) return;
          if (this.state.run.kind === "generating" || this.state.run.kind === "contacting")
            this.state.run = { kind: "generating", pct: null, elapsedSec: elapsed };
          this.refreshViews();
        });
    }, 1000);
    let succeeded = false;
    try {
      const png = await client.generate({ prompt, negativePrompt, width, height, steps, seed, cfg });
      // Ergebnis kann nach onunload eintreffen (Remote-Call ist nicht abbrechbar). Dann
      // keine State-Mutation, kein refreshViews, kein History-Schreiben — nur das finally
      // räumt den Timer ab. return löst finally aus und überspringt den Post-await-Block.
      if (this.unloaded) return;
      this.state.image = {
        dataUrl: `data:image/png;base64,${png}`,
        params: { prompt, negativePrompt, seed, steps, cfg, model, width, height, date: isoStamp(new Date()) },
      };
      this.state.run = { kind: "idle" };
      succeeded = true;
    } catch (e) {
      if (this.unloaded) return;
      const msg = e instanceof Error ? e.message : String(e);
      this.state.run = { kind: "error", message: msg };
      // Fehlschlag kann Erreichbarkeits-Ursache haben → Serverstatus neu prüfen (fire-and-forget).
      void this.checkServer();
    } finally {
      // Timer immer abräumen (auch wenn onunload zwischen zwei Polls fiel) — verhindert
      // weiteres Feuern; refreshViews aber nur, solange das Plugin noch aktiv ist.
      window.clearInterval(tick);
      if (!this.unloaded) this.refreshViews();
    }
    if (succeeded && this.state.image) {
      const p = this.state.image.params;
      this.settings.history = pushHistory(this.settings.history, {
        prompt: p.prompt, negativePrompt: p.negativePrompt, seed: p.seed, steps: p.steps,
        cfg: p.cfg, model: p.model, width: p.width, height: p.height, created: p.date,
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
