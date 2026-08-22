import { backendCapabilities, CFG, DEFAULT_SIZE } from "./generation";
import { isoStamp } from "./filename";
import type { EngineChoice } from "./settings";
import type { GenParams } from "./viewmodel";

/** Was ein Aufrufer wuenschen darf. Nur `prompt` ist Pflicht. */
export interface HardenInput {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  cfg?: number;
}

export interface HardenContext {
  mode: EngineChoice;
  /** Startwert fuer Steps, wenn der Auftrag keinen nennt (settings.defaultSteps). */
  defaultSteps: number;
  /** Modellname, wie ihn das Backend meldet. Im Server-Modus waehlt ihn der Server. */
  model: string;
  /** Wird eingefroren — die Notiz beschreibt das Bild, das man sieht. */
  now: Date;
  /** Injiziert statt Math.random(), damit die Haertung testbar bleibt. */
  randomSeed: () => number;
}

function clampSteps(want: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(want)));
}

export function hardenParams(input: HardenInput, ctx: HardenContext): GenParams {
  const caps = backendCapabilities(ctx.mode);
  return {
    prompt: input.prompt,
    // Ein Regler, den das Backend nicht kann, wird nicht abgelehnt, sondern neutralisiert —
    // der Aufrufer sieht am Rueckgabewert, was daraus wurde (Keine-Attrappen-Linie).
    negativePrompt: caps.negativePrompt ? (input.negativePrompt ?? "") : "",
    cfg: caps.cfg ? (input.cfg ?? CFG.default) : 1,
    width: caps.fixedSize?.width ?? input.width ?? DEFAULT_SIZE.width,
    height: caps.fixedSize?.height ?? input.height ?? DEFAULT_SIZE.height,
    steps: clampSteps(input.steps ?? ctx.defaultSteps, caps.minSteps, caps.maxSteps),
    seed: input.seed ?? ctx.randomSeed(),
    model: ctx.model,
    date: isoStamp(ctx.now),
  };
}
