// Eingebautes Backend (Spec 0.6 §2/§5): SD-Turbo im Renderer über onnxruntime-web/WebGPU.
// Implementiert dasselbe ImageBackend wie der A1111Client — der Router in main.ts sieht keinen
// Unterschied. Alles Schwere ist injiziert (Store, Session-Fabrik, Runtime-Init, GPU-Check,
// PNG-Encoder), damit die Ladeschritte in Node testbar sind. Kein obsidian-Import nötig.
import { SdTurboEngine, type Session } from "../core/engine";
import { BUILTIN_MODEL, RUNTIME_WASM, type BuiltinModel, type ModelPart } from "../core/model-manifest";
import type { TokenizerData } from "../core/pipeline/tokenizer";
import type { ImageBackend, ImageRequest } from "../core/txt2img";
import type { ModelStore } from "./model-store";

export type EnginePhase = "loading-model" | "generating";

export interface LocalEngineDeps {
  store: Pick<ModelStore, "getBuffer" | "getText">;
  createSession: (buf: ArrayBuffer, externalData?: readonly { path: string; data: ArrayBuffer }[]) => Promise<Session>;
  initRuntime: (wasm: ArrayBuffer) => void;
  checkGpu: () => Promise<"ok" | "no-webgpu" | "no-f16">;
  /** RGBA → PNG-Data-URL (Canvas im Renderer, Fake im Test). */
  encodePng: (rgba: Uint8ClampedArray, w: number, h: number) => string;
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

  /** Ein Modellteil samt seiner External-Data-Buckets laden (SDXL-Turbos UNet: 13 Stueck,
   *  alles andere: leere Liste). Reihenfolge ist tragend — `p.data` steht in Manifest-
   *  Reihenfolge (`_000`, `_001`, …), und `ext[i]` muss zu `data[i]` passen; deshalb hier
   *  ein Promise.all ueber ein ARRAY statt ueber ein Objekt (dessen Key-Reihenfolge nicht
   *  zugesichert waere). `path` MUSS der reine location-Dateiname sein, nicht der Cache-
   *  Schluessel aus `d.key` und nicht der HF-Pfad aus `d.path` — sonst findet ORT die
   *  Daten nicht. */
  private async loadPart(p: ModelPart): Promise<Session> {
    const [buf, ...data] = await Promise.all([
      this.deps.store.getBuffer(p.file),
      ...p.data.map((d) => this.deps.store.getBuffer(d)),
    ]);
    const ext = p.data.map((d, i) => {
      const bytes = data[i];
      if (bytes === undefined) throw new Error(`loadPart: fehlender Bucket-Puffer fuer "${d.path}"`);
      return { path: d.path.split("/").pop() ?? d.path, data: bytes };
    });
    return this.deps.createSession(buf, ext);
  }

  private async load(): Promise<SdTurboEngine> {
    const { store, initRuntime } = this.deps;
    if (!this.runtimeReady) {
      initRuntime(await store.getBuffer(RUNTIME_WASM));
      this.runtimeReady = true;
    }
    const { textEncoder, unet, vaeDecoder, tokenizer } = this.model.parts;
    const [textEncoderSession, unetSession, vaeDecoderSession, vocabText, mergesText] = await Promise.all([
      this.loadPart(textEncoder),
      this.loadPart(unet),
      this.loadPart(vaeDecoder),
      store.getText(tokenizer.vocab),
      store.getText(tokenizer.merges),
    ]);
    const tokenizerData: TokenizerData = {
      vocab: JSON.parse(vocabText) as Record<string, number>,
      merges: mergesText.split("\n").filter((l) => l.length > 0 && !l.startsWith("#")),
    };
    return new SdTurboEngine({ textEncoder: textEncoderSession, unet: unetSession, vaeDecoder: vaeDecoderSession }, tokenizerData);
  }
}
