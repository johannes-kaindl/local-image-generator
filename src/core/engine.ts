// zurueckgeholt aus local-image-generator@0.4.4, 2026-08-19
// sd-turbo-Pipeline (Spec §5): tokenize → text_encoder → UNet-Loop (Euler-Ancestral,
// guidance 1.0) → VAE-Decode → RGBA. Sessions/Tensoren sind injiziert (OrtValue ist
// strukturell ort.Tensor-kompatibel) — die Engine bleibt pure und Node-testbar.
import { f16ArrayToF32, f32ArrayToF16 } from "./pipeline/f16";
import { chwToRgba } from "./pipeline/image";
import { gaussianArray } from "./pipeline/prng";
import { denoiseEntry, makeSchedule, scaleInput, schedulerStep, type Schedule } from "./pipeline/scheduler";
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
   *  fp16-EINGÄNGE (Smoke-Test-Befund 2026-07-16 an einem fp16-Export mit fp32-Inputs;
   *  unsere eigene Konversion (tools/convert/, keep_io_types=True) hat dieselbe Paarung —
   *  gemessen mit scripts/verify-model.mjs). Fehlender Eintrag → float32/int32-Default. */
  inputTypes: Readonly<Record<string, string>>;
  /** Deklarierte Eingabe-Shapes je Input-Name (symbolische Dims als String). Nur der Rang zählt:
   *  ein `timestep` mit shape [] ist ein 0-d-Skalar und will dims [] — die eigene Konversion
   *  (optimum, 2026-08-19) exportiert ihn so; ältere Exporte hatten [1]. Fehlt der Eintrag,
   *  bleibt dims [1] (gemessen am ORT-Web-Fehler „Gemm: Input tensors A and B must be 2
   *  dimensional" beim ersten Live-Lauf 0.6). */
  inputShapes?: Readonly<Record<string, readonly (number | string)[]>>;
  run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>>;
  release(): Promise<void>;
}

export interface EngineSessions {
  textEncoder: Session;
  unet: Session;
  vaeDecoder: Session;
  /** img2img (Spec 0.9 §4a): Vorlagen-Pixel → Start-Latents. Pflichtfeld — der Katalog
   *  (`model-manifest.ts`) laedt ihn fuer jedes builtin-Modell mit; txt2img ruft ihn nie
   *  auf (Keine-Attrappen-Linie waere sonst umgekehrt verletzt: eine Session, die geladen,
   *  aber nie gebraucht wird, ist kein Attrappen-Risiko — eine BEDINGT geladene waere ein
   *  zweiter Ladepfad, den lokal-engine.ts nicht kennt). */
  vaeEncoder: Session;
}

/** Provider-Sicht (yijing-oracle, Spec 0.4 §10): model/width/height sind dort OPTIONAL
 *  mit Default sd-turbo/512² — unabhängig vom UI-Dropdown. Die interne Pipeline hier
 *  bleibt bewusst schmal (prompt/steps/seed); der Router in main.ts füllt die Defaults. */
export interface GenerateRequest {
  prompt: string;
  steps: number;
  seed: number;
  /** Kantenlänge in Pixeln. OPTIONAL — SdTurboEngine ignoriert es (immer 512),
   *  SdxlTurboEngine liest `req.size ?? opts.size` (Spec 0.9 §5.2). Pflicht hätte
   *  SdTurboEngine und alle bestehenden Aufrufer geändert, gegen die Zusage, dass
   *  SD-Turbo unangetastet bleibt (Controller-Ruling Task 9). */
  size?: number;
  /** img2img (Spec 4a): Vorlagen-Pixel CHW [-1,1], BEREITS auf Zielgroesse (Base64→Pixel
   *  braucht DOM und sitzt in png.ts/local-engine — Pure-Core-Schnitt). undefined = txt2img. */
  initPixels?: Float32Array;
  /** Effektive, schon GEHAERTETE Aenderungsstaerke (Raster {1/steps..1}). Die Engine leitet
   *  daraus nur noch den Einstiegspunkt ab — mit denoiseRaster, derselben Formel wie die
   *  Haertung. `d` ist bereits Rasterwert, die Ableitung ist exakt. */
  denoising?: number;
}

export interface GenerateResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  seed: number;
}

export type ProgressFn = (step: number, total: number) => void;

/** Gemeinsame Schnittstelle beider eingebauter Pipelines (SdTurboEngine, SdxlTurboEngine) —
 *  `local-engine.ts` routet über `model.kind`, ohne den konkreten Typ zu kennen. */
export interface BuiltinEngine {
  readonly busy: boolean;
  generate(req: GenerateRequest, onProgress?: ProgressFn): Promise<GenerateResult>;
  dispose(): Promise<void>;
}

const LATENT = { c: 4, h: 64, w: 64 } as const;
const IMAGE_SIZE = 512;
const VAE_SCALING = 0.18215;

export function toF32(v: OrtValue): Float32Array {
  if (v.data instanceof Uint16Array) return f16ArrayToF32(v.data);
  if (v.data instanceof Float32Array) return v.data;
  throw new Error(`unexpected tensor dtype for ${v.dims.join("x")}`);
}

// Float-Feed passend zum deklarierten Eingabetyp der Session bauen.
export function floatFeed(session: Session, name: string, f32: Float32Array, dims: readonly number[]): OrtValue {
  return session.inputTypes[name] === "float16"
    ? { data: f32ArrayToF16(f32), dims }
    : { data: f32, dims };
}

// Skalarer Timestep im deklarierten Typ (int64 | float32 | float16) und Rang (0-d oder [1]).
export function timestepFeed(session: Session, name: string, t: number): OrtValue {
  const type = session.inputTypes[name] ?? "int64";
  const dims: number[] = session.inputShapes?.[name]?.length === 0 ? [] : [1];
  if (type === "float32") return { data: new Float32Array([t]), dims };
  if (type === "float16") return { data: f32ArrayToF16(new Float32Array([t])), dims };
  return { data: new BigInt64Array([BigInt(t)]), dims };
}

// Token-IDs im deklarierten Typ (int32 | int64).
export function idsFeed(session: Session, name: string, ids: Int32Array): OrtValue {
  return session.inputTypes[name] === "int64"
    ? { data: BigInt64Array.from(ids, (x) => BigInt(x)), dims: [1, ids.length] }
    : { data: new Int32Array(ids), dims: [1, ids.length] };
}

export function firstOutput(session: Session, outputs: Record<string, OrtValue>): OrtValue {
  const name = session.outputNames[0];
  const out = name !== undefined ? outputs[name] : undefined;
  if (!out) throw new Error("session returned no output");
  return out;
}

// UNet-Schleife (Euler-Ancestral, Spec §5) — geteilt zwischen SdTurboEngine und
// SdxlTurboEngine (Review Task 9: die Schleife war ein Verbatim-Duplikat bis auf
// Latent-Dims und zwei Zusatz-Feeds). `extraFeeds` traegt alles, was ein Encoder-Setup
// dem UNet zusaetzlich zu `sample`/`timestep` gibt — SD-Turbo nur `encoder_hidden_states`,
// SDXL zusaetzlich `text_embeds`/`time_ids`. Reine Latents-Rueckgabe (kein VAE-Decode) —
// dafuer ist `decodeLatents` zustaendig.
export async function runDiffusion(
  unet: Session,
  schedule: Schedule,
  seed: number,
  latentDims: readonly number[],
  extraFeeds: Record<string, OrtValue>,
  onProgress?: ProgressFn,
  // img2img (Spec 0.9 §4a): Teil-Denoising ab einem Einstiegspunkt statt vom reinen Rauschen.
  // `init` traegt die bereits verrauschten Vorlagen-Latents UND den Einstiegspunkt im
  // Zeitplan — ohne `init` bleibt das Verhalten fuer txt2img-Aufrufer EXAKT wie zuvor
  // (startAt 0, volle Schrittzahl, Fortschritt 1..total).
  init?: { latents: Float32Array; startAt: number },
): Promise<Float32Array> {
  const n = latentDims.reduce((a, b) => a * b, 1);
  const startAt = init?.startAt ?? 0;
  let latents: Float32Array;
  if (init) {
    latents = init.latents;
  } else {
    latents = gaussianArray(seed, n);
    for (let i = 0; i < n; i++) latents[i] = latents[i]! * schedule.initNoiseSigma;
  }

  for (let i = startAt; i < schedule.timesteps.length; i++) {
    const sigma = schedule.sigmas[i]!;
    const scaled = scaleInput(latents, sigma);
    const unetOut = await unet.run({
      // Spread ZUERST: die beiden Kern-Feeds gewinnen gegen einen Aufrufer, der `sample` oder
      // `timestep` in `extraFeeds` mitschickt. Andersherum ueberschriebe er still die
      // gemeinsame Konstruktion samt der 0-d-`timestep`-Regel (dims [1] bricht das UNet mit
      // „Gemm: must be 2 dimensional") — ein Modellabbruch weit weg von seiner Ursache.
      // Kein heutiger Aufrufer tut das; die Reihenfolge ist der billige Teil der Vorsorge,
      // festgenagelt in tests/engine.test.ts (Nachlese 0.9.0).
      ...extraFeeds,
      sample: floatFeed(unet, "sample", scaled, latentDims),
      timestep: timestepFeed(unet, "timestep", schedule.timesteps[i]!),
    });
    const noisePred = toF32(firstOutput(unet, unetOut));
    const stepNoise = gaussianArray(seed + 1000 + i, n); // Ancestral-Noise, seed-abgeleitet
    latents = schedulerStep(noisePred, latents, i, schedule.sigmas, stepNoise);
    onProgress?.(i - startAt + 1, schedule.timesteps.length - startAt);
  }
  return latents;
}

/** Vorlagen-Pixel → skalierte Latents: Encoder liefert latent_parameters [1,8,h/8,w/8]
 *  (concat aus mean und logvar); img2img nimmt die mean-Kanaele 0..3 (deterministisch —
 *  kein Sampling) mal vaeScaling. */
export async function encodeInitImage(vaeEncoder: Session, pixels: Float32Array, size: number, vaeScaling: number): Promise<Float32Array> {
  const out = await vaeEncoder.run({ sample: floatFeed(vaeEncoder, "sample", pixels, [1, 3, size, size]) });
  const params = toF32(firstOutput(vaeEncoder, out));
  const n = 4 * (size / 8) * (size / 8);
  const lat = new Float32Array(n);
  for (let i = 0; i < n; i++) lat[i] = params[i]! * vaeScaling;
  return lat;
}

/** img2img-Start: Vorlagen-Latents am Einstiegspunkt verrauschen (Euler-Ancestral:
 *  noisy = orig + noise * sigma). Noise nimmt `seed` direkt — wie txt2imgs Start-Latents. */
export function noisedInitLatents(init: Float32Array, seed: number, sigma: number): Float32Array {
  const noise = gaussianArray(seed, init.length);
  const out = new Float32Array(init.length);
  for (let i = 0; i < init.length; i++) out[i] = init[i]! + noise[i]! * sigma;
  return out;
}

// VAE-Rueckskalierung + Decode + CHW→RGBA — geteilt zwischen SdTurboEngine und
// SdxlTurboEngine (Review Task 9), Skalierungskonstante und Zielgroesse sind Parameter
// statt Modul-Konstanten, damit SDXL (0.13025, 512/1024) SD-Turbo (0.18215, 512) nicht
// anfasst.
export async function decodeLatents(
  vaeDecoder: Session,
  latents: Float32Array,
  latentDims: readonly number[],
  vaeScaling: number,
  size: number,
  seed: number,
): Promise<GenerateResult> {
  const n = latentDims.reduce((a, b) => a * b, 1);
  const scaledLatents = new Float32Array(n);
  for (let i = 0; i < n; i++) scaledLatents[i] = latents[i]! / vaeScaling;
  const vaeOut = await vaeDecoder.run({
    latent_sample: floatFeed(vaeDecoder, "latent_sample", scaledLatents, latentDims),
  });
  const imageChw = toF32(firstOutput(vaeDecoder, vaeOut));
  return { rgba: chwToRgba(imageChw, size, size), width: size, height: size, seed };
}

export class SdTurboEngine implements BuiltinEngine {
  private _busy = false;
  private _disposed = false;

  constructor(
    private readonly sessions: EngineSessions,
    private readonly tokenizerData: TokenizerData,
  ) {}

  get busy(): boolean {
    return this._busy;
  }

  // Gibt die vier ORT-Sessions frei (Spec §8: GPU-Speicher-Leak vermeiden).
  // Idempotent — mehrfaches dispose ruft release nur einmal. Einzelne
  // release-Fehler werden geschluckt, damit ein fehlschlagender Session-Release
  // die anderen drei nicht blockiert (Best-Effort-Cleanup).
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    await Promise.all(
      [this.sessions.textEncoder, this.sessions.unet, this.sessions.vaeDecoder, this.sessions.vaeEncoder].map((s) =>
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

      const latentDims = [1, LATENT.c, LATENT.h, LATENT.w] as const;
      const schedule = makeSchedule(req.steps);

      // img2img (Spec 0.9 §4a): nur bei einer Vorlage — sonst bleibt der txt2img-Pfad
      // exakt wie zuvor (init bleibt undefined, runDiffusion startet bei 0).
      let init: { latents: Float32Array; startAt: number } | undefined;
      if (req.initPixels) {
        const entry = denoiseEntry(req.steps, req.denoising ?? 1, schedule.sigmas, schedule.timesteps);
        // Die FOLGE anpassen, nicht nur das Latent: schedulerStep und die Schleife in
        // runDiffusion lesen Sigma und Timestep selbst aus dem Zeitplan. `schedule` ist
        // pro Lauf frisch aus makeSchedule — die Mutation trifft niemanden sonst.
        schedule.sigmas[entry.startAt] = entry.sigma;
        schedule.timesteps[entry.startAt] = entry.timestep;
        const encoded = await encodeInitImage(this.sessions.vaeEncoder, req.initPixels, IMAGE_SIZE, VAE_SCALING);
        init = { latents: noisedInitLatents(encoded, req.seed, entry.sigma), startAt: entry.startAt };
      }

      const latents = await runDiffusion(
        this.sessions.unet,
        schedule,
        req.seed,
        latentDims,
        { encoder_hidden_states: floatFeed(this.sessions.unet, "encoder_hidden_states", hiddenF32, hidden.dims) },
        onProgress,
        init,
      );
      return await decodeLatents(this.sessions.vaeDecoder, latents, latentDims, VAE_SCALING, IMAGE_SIZE, req.seed);
    } finally {
      this._busy = false;
    }
  }
}