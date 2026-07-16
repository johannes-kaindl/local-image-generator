// sd-turbo-Pipeline (Spec §5): tokenize → text_encoder → UNet-Loop (Euler-Ancestral,
// guidance 1.0) → VAE-Decode → RGBA. Sessions/Tensoren sind injiziert (OrtValue ist
// strukturell ort.Tensor-kompatibel) — die Engine bleibt pure und Node-testbar.
import { f16ArrayToF32, f32ArrayToF16 } from "./pipeline/f16";
import { chwToRgba } from "./pipeline/image";
import { gaussianArray } from "./pipeline/prng";
import { makeSchedule, scaleInput, schedulerStep } from "./pipeline/scheduler";
import { tokenize, type TokenizerData } from "./pipeline/tokenizer";

export interface OrtValue {
  data: Float32Array | Uint16Array | Int32Array | BigInt64Array;
  dims: readonly number[];
}

export interface Session {
  inputNames: readonly string[];
  outputNames: readonly string[];
  /** ONNX-Eingabetypen je Input-Name (z. B. "float32"|"float16"|"int32"|"int64").
   *  Die Engine passt ihre Feeds daran an — fp16-GEWICHTE implizieren NICHT
   *  fp16-EINGÄNGE (Smoke-Test-Befund 2026-07-16: schmuell/sd-turbo-ort-web
   *  erwartet float32-Inputs). Fehlender Eintrag → float32/int32-Default. */
  inputTypes: Readonly<Record<string, string>>;
  run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>>;
  release(): Promise<void>;
}

export interface EngineSessions {
  textEncoder: Session;
  unet: Session;
  vaeDecoder: Session;
}

export interface GenerateRequest {
  prompt: string;
  steps: number;
  seed: number;
}

export interface GenerateResult {
  rgba: Uint8ClampedArray;
  width: 512;
  height: 512;
  seed: number;
}

export type ProgressFn = (step: number, total: number) => void;

const LATENT = { c: 4, h: 64, w: 64 } as const;
const IMAGE_SIZE = 512;
const VAE_SCALING = 0.18215;

function toF32(v: OrtValue): Float32Array {
  if (v.data instanceof Uint16Array) return f16ArrayToF32(v.data);
  if (v.data instanceof Float32Array) return v.data;
  throw new Error(`unexpected tensor dtype for ${v.dims.join("x")}`);
}

// Float-Feed passend zum deklarierten Eingabetyp der Session bauen.
function floatFeed(session: Session, name: string, f32: Float32Array, dims: readonly number[]): OrtValue {
  return session.inputTypes[name] === "float16"
    ? { data: f32ArrayToF16(f32), dims }
    : { data: f32, dims };
}

// Skalarer Timestep im deklarierten Typ (int64 | float32 | float16).
function timestepFeed(session: Session, name: string, t: number): OrtValue {
  const type = session.inputTypes[name] ?? "int64";
  if (type === "float32") return { data: new Float32Array([t]), dims: [1] };
  if (type === "float16") return { data: f32ArrayToF16(new Float32Array([t])), dims: [1] };
  return { data: new BigInt64Array([BigInt(t)]), dims: [1] };
}

// Token-IDs im deklarierten Typ (int32 | int64).
function idsFeed(session: Session, name: string, ids: Int32Array): OrtValue {
  return session.inputTypes[name] === "int64"
    ? { data: BigInt64Array.from(ids, (x) => BigInt(x)), dims: [1, ids.length] }
    : { data: new Int32Array(ids), dims: [1, ids.length] };
}

function firstOutput(session: Session, outputs: Record<string, OrtValue>): OrtValue {
  const name = session.outputNames[0];
  const out = name !== undefined ? outputs[name] : undefined;
  if (!out) throw new Error("session returned no output");
  return out;
}

export class SdTurboEngine {
  private _busy = false;
  private _disposed = false;

  constructor(
    private readonly sessions: EngineSessions,
    private readonly tokenizerData: TokenizerData,
  ) {}

  get busy(): boolean {
    return this._busy;
  }

  // Gibt die drei ORT-Sessions frei (Spec §8: GPU-Speicher-Leak vermeiden).
  // Idempotent — mehrfaches dispose ruft release nur einmal. Einzelne
  // release-Fehler werden geschluckt, damit ein fehlschlagender Session-Release
  // die anderen beiden nicht blockiert (Best-Effort-Cleanup).
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    await Promise.all(
      [this.sessions.textEncoder, this.sessions.unet, this.sessions.vaeDecoder].map((s) =>
        s.release().catch(() => {}),
      ),
    );
  }

  async generate(req: GenerateRequest, onProgress?: ProgressFn): Promise<GenerateResult> {
    if (this._busy) throw new Error("engine is busy");
    this._busy = true;
    try {
      const ids = tokenize(req.prompt, this.tokenizerData);
      const encOut = await this.sessions.textEncoder.run({
        input_ids: idsFeed(this.sessions.textEncoder, "input_ids", new Int32Array(ids)),
      });
      const hidden = firstOutput(this.sessions.textEncoder, encOut);
      // Encoder-Output in f32 normalisieren; floatFeed konvertiert bei Bedarf
      // zurück nach f16 — je nachdem, was das UNet deklariert.
      const hiddenF32 = toF32(hidden);

      const n = LATENT.c * LATENT.h * LATENT.w;
      const schedule = makeSchedule(req.steps);
      let latents = gaussianArray(req.seed, n);
      for (let i = 0; i < n; i++) latents[i] = latents[i]! * schedule.initNoiseSigma;

      for (let i = 0; i < schedule.timesteps.length; i++) {
        const sigma = schedule.sigmas[i]!;
        const scaled = scaleInput(latents, sigma);
        const unetOut = await this.sessions.unet.run({
          sample: floatFeed(this.sessions.unet, "sample", scaled, [1, LATENT.c, LATENT.h, LATENT.w]),
          timestep: timestepFeed(this.sessions.unet, "timestep", schedule.timesteps[i]!),
          encoder_hidden_states: floatFeed(this.sessions.unet, "encoder_hidden_states", hiddenF32, hidden.dims),
        });
        const noisePred = toF32(firstOutput(this.sessions.unet, unetOut));
        const stepNoise = gaussianArray(req.seed + 1000 + i, n); // Ancestral-Noise, seed-abgeleitet
        latents = schedulerStep(noisePred, latents, i, schedule.sigmas, stepNoise);
        onProgress?.(i + 1, schedule.timesteps.length);
      }

      const scaledLatents = new Float32Array(n);
      for (let i = 0; i < n; i++) scaledLatents[i] = latents[i]! / VAE_SCALING;
      const vaeOut = await this.sessions.vaeDecoder.run({
        latent_sample: floatFeed(this.sessions.vaeDecoder, "latent_sample", scaledLatents, [1, LATENT.c, LATENT.h, LATENT.w]),
      });
      const imageChw = toF32(firstOutput(this.sessions.vaeDecoder, vaeOut));
      return { rgba: chwToRgba(imageChw, IMAGE_SIZE, IMAGE_SIZE), width: IMAGE_SIZE, height: IMAGE_SIZE, seed: req.seed };
    } finally {
      this._busy = false;
    }
  }
}
