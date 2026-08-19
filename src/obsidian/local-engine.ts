// Eingebautes Backend (Spec 0.6 §2/§5): SD-Turbo im Renderer über onnxruntime-web/WebGPU.
// Implementiert dasselbe ImageBackend wie der Txt2ImgClient — der Router in main.ts sieht keinen
// Unterschied. Alles Schwere ist injiziert (Store, Session-Fabrik, Runtime-Init, GPU-Check,
// PNG-Encoder), damit die Ladeschritte in Node testbar sind. Kein obsidian-Import nötig.
import { SdTurboEngine, type Session } from "../core/engine";
import { BUILTIN_MODEL, RUNTIME_WASM, type AssetFile, type BuiltinModel } from "../core/model-manifest";
import type { TokenizerData } from "../core/pipeline/tokenizer";
import type { ImageBackend, ImageRequest } from "../core/txt2img";
import type { ModelStore } from "./model-store";

export type EnginePhase = "loading-model" | "generating";

export interface LocalEngineDeps {
  store: Pick<ModelStore, "getBuffer" | "getText">;
  createSession: (buf: ArrayBuffer) => Promise<Session>;
  initRuntime: (wasm: ArrayBuffer) => void;
  checkGpu: () => Promise<"ok" | "no-webgpu" | "no-f16">;
  /** RGBA → PNG-Data-URL (Canvas im Renderer, Fake im Test). */
  encodePng: (rgba: Uint8ClampedArray, w: number, h: number) => string;
}

function fileOf(model: BuiltinModel, key: AssetFile["key"]): AssetFile {
  const f = model.files.find((x) => x.key === key);
  if (!f) throw new Error(`model ${model.id} has no asset ${key}`);
  return f;
}

export class LocalEngineBackend implements ImageBackend {
  /** Phasen-Meldung an den Host: „loading-model" einmal je Sitzung vor dem ersten Bild
   *  (Weight-Upload + Shader-Compile, minutenlang möglich), „generating" je UNet-Schritt. */
  onPhase?: (phase: EnginePhase, step?: number, total?: number) => void;

  private engine: SdTurboEngine | null = null;
  private loading: Promise<SdTurboEngine> | null = null;
  private runtimeReady = false;

  constructor(
    private readonly deps: LocalEngineDeps,
    private readonly model: BuiltinModel = BUILTIN_MODEL,
  ) {}

  get loaded(): boolean {
    return this.engine !== null;
  }

  async generate(req: ImageRequest): Promise<string> {
    const engine = await this.ensureLoaded();
    const steps = Math.min(this.model.steps.max, Math.max(this.model.steps.min, Math.round(req.steps)));
    const res = await engine.generate({ prompt: req.prompt, steps, seed: req.seed }, (s, t) => this.onPhase?.("generating", s, t));
    const dataUrl = this.deps.encodePng(res.rgba, res.width, res.height);
    // Wie Txt2ImgClient: nackte Base64 — main.ts hängt das data:-Präfix selbst an.
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }

  /** Sessions freigeben (GPU-Speicher, 0.1-Leak-Befund). Idempotent; ein laufendes Laden wird
   *  abgewartet und dann ebenfalls freigegeben. */
  async dispose(): Promise<void> {
    if (this.loading) {
      try { await this.loading; } catch { /* Ladefehler ist hier egal — es gibt nichts freizugeben */ }
    }
    const e = this.engine;
    this.engine = null;
    this.loading = null;
    if (e) await e.dispose();
  }

  private ensureLoaded(): Promise<SdTurboEngine> {
    if (this.engine) return Promise.resolve(this.engine);
    if (!this.loading) {
      this.onPhase?.("loading-model");
      this.loading = this.load()
        .then((e) => { this.engine = e; return e; })
        .finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  private async load(): Promise<SdTurboEngine> {
    const { store, createSession, initRuntime } = this.deps;
    if (!this.runtimeReady) {
      initRuntime(await store.getBuffer(RUNTIME_WASM));
      this.runtimeReady = true;
    }
    const [textEncoder, unet, vaeDecoder, vocabText, mergesText] = await Promise.all([
      store.getBuffer(fileOf(this.model, "text_encoder")).then(createSession),
      store.getBuffer(fileOf(this.model, "unet")).then(createSession),
      store.getBuffer(fileOf(this.model, "vae_decoder")).then(createSession),
      store.getText(fileOf(this.model, "vocab")),
      store.getText(fileOf(this.model, "merges")),
    ]);
    const tokenizer: TokenizerData = {
      vocab: JSON.parse(vocabText) as Record<string, number>,
      merges: mergesText.split("\n").filter((l) => l.length > 0 && !l.startsWith("#")),
    };
    return new SdTurboEngine({ textEncoder, unet, vaeDecoder }, tokenizer);
  }
}
