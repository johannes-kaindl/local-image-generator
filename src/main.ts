// Wiring (Spec §4): EIN registerView, Command + Ribbon, Host-Implementierung für die
// View, Lazy-Init der Engine (GPU-Check → Cache-Buffers → ORT-Sessions).
import { MarkdownView, normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { SdTurboEngine } from "./core/engine";
import { buildImageFilename, dedupeFilename } from "./core/filename";
import { DEFAULT_SETTINGS, type LigSettings } from "./core/settings";
import { STRINGS } from "./core/strings";
import type { PanelState } from "./core/viewmodel";
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
    this.settings = mergeSettings(DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new LigSettingTab(this.app, this));

    const host: ViewHost = {
      getPanelState: () => {
        this.state.editorActive = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor !== undefined;
        return this.state;
      },
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
    this.refreshView();
  }

  private refreshView(): void {
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
    this.refreshView();
    try {
      await this.modelStore.download((pct) => {
        this.state.model = { kind: "downloading", pct };
        onProgress(pct);
        this.refreshView();
      });
      this.state.model = { kind: "ready" };
    } catch (e) {
      this.state.model = { kind: "missing" };
      throw e;
    } finally {
      this.refreshView();
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
    this.refreshView();
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
    this.state.run = { kind: "running", step: 0, total: steps };
    this.refreshView();
    try {
      const engine = await this.ensureEngine();
      const result = await engine.generate({ prompt: this.state.prompt, steps, seed }, (step, total) => {
        this.state.run = { kind: "running", step, total };
        this.refreshView();
      });
      this.state.image = { seed: result.seed, dataUrl: rgbaToDataUrl(result.rgba, result.width, result.height) };
      this.state.run = { kind: "idle" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.run = { kind: "error", message: msg };
      // Sessions freigeben und verwerfen, nächster Lauf lädt neu (Spec §8).
      // Fire-and-forget: der Fehlerpfad soll den UI-Refresh nicht blockieren.
      void this.engine?.dispose().catch(() => {});
      this.engine = null;
      new Notice(STRINGS.oomHint);
    } finally {
      this.refreshView();
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

  private async saveImage(mode: "create" | "insert"): Promise<void> {
    const img = this.state.image;
    if (!img) return;
    try {
      const path = await this.resolveImagePath(buildImageFilename(new Date(), img.seed));
      const file = await this.app.vault.createBinary(path, dataUrlToBytes(img.dataUrl));
      if (mode === "insert") {
        const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (editor) editor.replaceSelection(`![[${file.path}]]`);
        else new Notice(STRINGS.insertNeedsEditor);
      } else if (file instanceof TFile) {
        await this.app.workspace.getLeaf(true).openFile(file);
      }
      new Notice(`Saved: ${file.path}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(STRINGS.saveFailed(msg));
    }
  }
}
