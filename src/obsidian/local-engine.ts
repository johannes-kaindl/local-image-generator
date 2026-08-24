// Eingebautes Backend (Spec 0.6 §2/§5): SD-Turbo im Renderer über onnxruntime-web/WebGPU.
// Implementiert dasselbe ImageBackend wie der A1111Client — der Router in main.ts sieht keinen
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

/** Die Engine ist bis Task 8/9 SD-Turbo-spezifisch (kein Modellwechsel hier, das ist die
 *  Aufgabe der Aufrufer in Task 10–12) — deshalb der feste Fünfer statt eines generischen
 *  Katalog-Walks, und ein Guard, der bei einem sdxl-geformten Modell sofort und lesbar
 *  scheitert statt mit einem irrefuehrenden `undefined`-Zugriff auf `parts.textEncoder2`. */
function fileOf(model: BuiltinModel, key: "text_encoder" | "unet" | "vae_decoder" | "vocab" | "merges"): AssetFile {
  if (model.kind !== "sd") {
    throw new Error(`LocalEngineBackend kennt nur SD-Turbo-foermige Modelle, nicht "${model.id}" (kind "${model.kind}")`);
  }
  switch (key) {
    case "text_encoder": return model.parts.textEncoder.file;
    case "unet": return model.parts.unet.file;
    case "vae_decoder": return model.parts.vaeDecoder.file;
    case "vocab": return model.parts.tokenizer.vocab;
    case "merges": return model.parts.tokenizer.merges;
  }
}

export class LocalEngineBackend implements ImageBackend {
  /** Phasen-Meldung an den Host: „loading-model" einmal je Sitzung vor dem ersten Bild
   *  (Weight-Upload + Shader-Compile, minutenlang möglich), „generating" je UNet-Schritt. */
  onPhase?: (phase: EnginePhase, step?: number, total?: number) => void;

  private engine: SdTurboEngine | null = null;
  private loading: Promise<SdTurboEngine> | null = null;
  /** Laufender generate()-Aufruf — dispose() wartet darauf, statt die GPU-Sessions unter einem
   *  aktiven UNet-Schritt wegzuziehen (Review 2026-08-19). */
  private running: Promise<unknown> | null = null;
  private runtimeReady = false;

  constructor(
    private readonly deps: LocalEngineDeps,
    private readonly model: BuiltinModel = BUILTIN_MODEL,
  ) {}

  get loaded(): boolean {
    return this.engine !== null;
  }

  async generate(req: ImageRequest): Promise<string> {
    const run = this.run(req);
    this.running = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.running = null;
    }
  }

  private async run(req: ImageRequest): Promise<string> {
    const engine = await this.ensureLoaded();
    const steps = Math.min(this.model.steps.max, Math.max(this.model.steps.min, Math.round(req.steps)));
    const res = await engine.generate({ prompt: req.prompt, steps, seed: req.seed }, (s, t) => this.onPhase?.("generating", s, t));
    const dataUrl = this.deps.encodePng(res.rgba, res.width, res.height);
    // Wie A1111Client: nackte Base64 — main.ts hängt das data:-Präfix selbst an.
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }

  /** Sessions freigeben (GPU-Speicher, 0.1-Leak-Befund). Idempotent; ein laufendes Laden oder
   *  Generieren wird abgewartet und dann freigegeben — nie mitten im UNet-Schritt. */
  async dispose(): Promise<void> {
    if (this.loading) {
      try { await this.loading; } catch { /* Ladefehler ist hier egal — es gibt nichts freizugeben */ }
    }
    if (this.running) await this.running;
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
