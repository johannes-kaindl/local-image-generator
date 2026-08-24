// SDXL-Turbo-Pipeline (Spec 0.9 §5.2) — siehe engine.ts fuer die Grundstruktur: tokenize →
// text_encoder → UNet-Loop (Euler-Ancestral, guidance 1.0) → VAE-Decode → RGBA. SDXL hat
// ZWEI Text-Encoder statt einem: deren vorletzte Hidden-States werden auf 2048 konkateniert,
// dazu kommen die pooled Embeddings (`text_embeds`) aus dem ZWEITEN Encoder und `time_ids`.
// Helfer (toF32, floatFeed, timestepFeed, idsFeed, firstOutput) sind aus engine.ts importiert,
// nicht kopiert — Verbatim-Duplikate eines Logikblocks gelten in diesem Projekt als Defekt.
// SD-Turbo (engine.ts) bleibt dabei unangetastet.
import {
  firstOutput,
  floatFeed,
  idsFeed,
  timestepFeed,
  toF32,
  type BuiltinEngine,
  type GenerateRequest,
  type GenerateResult,
  type OrtValue,
  type ProgressFn,
  type Session,
} from "./engine";
import { chwToRgba } from "./pipeline/image";
import { gaussianArray } from "./pipeline/prng";
import { makeSchedule, scaleInput, schedulerStep } from "./pipeline/scheduler";
import { tokenize, type TokenizerData } from "./pipeline/tokenizer";

export interface SdxlSessions {
  textEncoder: Session;
  textEncoder2: Session;
  unet: Session;
  vaeDecoder: Session;
}

export interface SdxlTokenizers {
  primary: TokenizerData;
  secondary: TokenizerData;
}

export interface SdxlEngineOpts {
  /** SDXL: 0.13025 (SD-Turbo: 0.18215) — Konstruktor-Parameter statt Modul-Konstante,
   *  damit engine.ts unangetastet bleibt. */
  vaeScaling: number;
  /** Default-Kantenlaenge, falls die Anfrage keine `size` traegt (Katalog liefert
   *  `model.sizes[0]`; welche Groesse pro Anfrage gewaehlt wird, ist nicht dieser Task). */
  size: number;
}

// Gemessen an den HF-Configs 2026-08-23 (AGENTS.md "Das Pad-Token ist pro Tokenizer
// verschieden — und die Abweichung sitzt beim ERSTEN"): der PRIMAERE SDXL-Tokenizer
// (CLIP-L, "tokenizer") padded mit <|endoftext|> = 49407, NICHT mit 0. Der ZWEITE
// (bigG, "tokenizer_2") padded mit 0, wie sd-turbo. Kontraintuitiv — wer die Abweichung
// beim zweiten vermutet, baut sie falsch herum ein und merkt es nie: kein Fehler,
// nur ein leise schlechteres Bild.
const PRIMARY_PAD_TOKEN = 49407;
const SECONDARY_PAD_TOKEN = 0;

// SDXLs Text-Encoder liefern die Hidden States als INDIZIERTE EINZELAUSGAENGE
// (hidden_states.0 … hidden_states.N), nicht als einen Ausgang "hidden_states"
// (gemessen am echten Modell, scripts/verify-model.mjs). SDXL braucht den VORLETZTEN
// Layer — also den zweithoechsten Index. Fehlt der Ausgang, wird geworfen statt still
// auf last_hidden_state zurueckzufallen (Spec §9-Risiko 1: das waere der leise
// Qualitaetsverlust, den diese Funktion gerade verhindern soll).
function pickHidden(outputs: Record<string, OrtValue>): OrtValue {
  const indices = Object.keys(outputs)
    .map((k) => /^hidden_states\.(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  if (indices.length < 2) {
    throw new Error(
      "pickHidden: kein indizierter hidden_states.N-Ausgang gefunden (SDXL-Text-Encoder liefern sie einzeln, Spec 0.9 §9.1)",
    );
  }
  const vorletzter = indices[indices.length - 2]!;
  const out = outputs[`hidden_states.${vorletzter}`];
  if (!out) throw new Error(`pickHidden: hidden_states.${vorletzter} fehlt trotz gefundenem Index`);
  return out;
}

// Named-Output-Zugriff mit hartem Fehlschlag statt undefined — die Reihenfolge der
// Ausgaenge ist keine Zusage des Exports (gemessen: text_embeds steht beim zweiten
// SDXL-Encoder VOR last_hidden_state).
function pickOutput(outputs: Record<string, OrtValue>, name: string): OrtValue {
  const out = outputs[name];
  if (!out) throw new Error(`pickOutput: Ausgang "${name}" fehlt`);
  return out;
}

// Zwei Hidden-State-Tensoren [1,seq,dimA] + [1,seq,dimB] auf der letzten Achse zu
// [1,seq,dimA+dimB] konkatenieren — SDXLs UNet erwartet encoder_hidden_states als
// [batch,seq,2048] (768 aus CLIP-L + 1280 aus bigG).
function concatLastDim(a: Float32Array, dimA: number, b: Float32Array, dimB: number, seq: number): Float32Array {
  const out = new Float32Array(seq * (dimA + dimB));
  for (let s = 0; s < seq; s++) {
    out.set(a.subarray(s * dimA, (s + 1) * dimA), s * (dimA + dimB));
    out.set(b.subarray(s * dimB, (s + 1) * dimB), s * (dimA + dimB) + dimA);
  }
  return out;
}

export class SdxlTurboEngine implements BuiltinEngine {
  private _busy = false;
  private _disposed = false;

  constructor(
    private readonly sessions: SdxlSessions,
    private readonly tokenizers: SdxlTokenizers,
    private readonly opts: SdxlEngineOpts,
  ) {}

  get busy(): boolean {
    return this._busy;
  }

  // Gibt alle vier ORT-Sessions frei (Spec §8: GPU-Speicher-Leak vermeiden). Idempotent,
  // Best-Effort wie SdTurboEngine.dispose().
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    await Promise.all(
      [this.sessions.textEncoder, this.sessions.textEncoder2, this.sessions.unet, this.sessions.vaeDecoder].map((s) =>
        s.release().catch(() => {}),
      ),
    );
  }

  async generate(req: GenerateRequest, onProgress?: ProgressFn): Promise<GenerateResult> {
    if (this._busy) throw new Error("engine is busy");
    this._busy = true;
    try {
      const size = req.size ?? this.opts.size;
      const latentSide = size / 8;
      const n = 4 * latentSide * latentSide;

      const idsA = tokenize(req.prompt, this.tokenizers.primary, { pad: PRIMARY_PAD_TOKEN });
      const idsB = tokenize(req.prompt, this.tokenizers.secondary, { pad: SECONDARY_PAD_TOKEN });

      const encAOut = await this.sessions.textEncoder.run({
        input_ids: idsFeed(this.sessions.textEncoder, "input_ids", new Int32Array(idsA)),
      });
      const encBOut = await this.sessions.textEncoder2.run({
        input_ids: idsFeed(this.sessions.textEncoder2, "input_ids", new Int32Array(idsB)),
      });

      const hidA = pickHidden(encAOut);
      const hidB = pickHidden(encBOut);
      const seq = hidA.dims[1] ?? 0;
      const dimA = hidA.dims[2] ?? 0;
      const dimB = hidB.dims[2] ?? 0;
      const hidden = concatLastDim(toF32(hidA), dimA, toF32(hidB), dimB, seq);
      const hiddenDims = [1, seq, dimA + dimB];

      const pooledOut = pickOutput(encBOut, "text_embeds");
      const pooled = toF32(pooledOut);
      const timeIds = new Float32Array([size, size, 0, 0, size, size]);

      const schedule = makeSchedule(req.steps);
      let latents = gaussianArray(req.seed, n);
      for (let i = 0; i < n; i++) latents[i] = latents[i]! * schedule.initNoiseSigma;

      for (let i = 0; i < schedule.timesteps.length; i++) {
        const sigma = schedule.sigmas[i]!;
        const scaled = scaleInput(latents, sigma);
        const unetOut = await this.sessions.unet.run({
          sample: floatFeed(this.sessions.unet, "sample", scaled, [1, 4, latentSide, latentSide]),
          timestep: timestepFeed(this.sessions.unet, "timestep", schedule.timesteps[i]!),
          encoder_hidden_states: floatFeed(this.sessions.unet, "encoder_hidden_states", hidden, hiddenDims),
          text_embeds: floatFeed(this.sessions.unet, "text_embeds", pooled, pooledOut.dims),
          time_ids: floatFeed(this.sessions.unet, "time_ids", timeIds, [1, 6]),
        });
        const noisePred = toF32(firstOutput(this.sessions.unet, unetOut));
        const stepNoise = gaussianArray(req.seed + 1000 + i, n); // Ancestral-Noise, seed-abgeleitet
        latents = schedulerStep(noisePred, latents, i, schedule.sigmas, stepNoise);
        onProgress?.(i + 1, schedule.timesteps.length);
      }

      const scaledLatents = new Float32Array(n);
      for (let i = 0; i < n; i++) scaledLatents[i] = latents[i]! / this.opts.vaeScaling;
      const vaeOut = await this.sessions.vaeDecoder.run({
        latent_sample: floatFeed(this.sessions.vaeDecoder, "latent_sample", scaledLatents, [1, 4, latentSide, latentSide]),
      });
      const imageChw = toF32(firstOutput(this.sessions.vaeDecoder, vaeOut));
      return { rgba: chwToRgba(imageChw, size, size), width: size, height: size, seed: req.seed };
    } finally {
      this._busy = false;
    }
  }
}
