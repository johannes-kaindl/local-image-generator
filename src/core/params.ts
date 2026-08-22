import { backendCapabilities, CFG, DEFAULT_SIZE } from "./generation";
import { isoStamp } from "./filename";
import type { EngineChoice } from "./settings";
import type { GenParams } from "./viewmodel";
import { clampInt } from "../vendor/kit/num";

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

// `??` faengt nur null/undefined — ein NaN/Infinity aus einem Fremdplugin rutscht daran
// vorbei und muesste sonst als "erfolgreiches" Ergebnis weiterlaufen (Review-Befund: leere
// Schedule, gezeichnetes Nichts, JSON.stringify des Aufrufers macht daraus `null`). Deshalb
// ein eigener Finite-Guard fuer die Regler, die clampInt nicht selbst absichert (cfg, width,
// height, seed haben keine sinnvolle Ober-/Untergrenze hier, nur einen Fallback).
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function hardenParams(input: HardenInput, ctx: HardenContext): GenParams {
  const caps = backendCapabilities(ctx.mode);
  // clampInt gibt seinen Fallback UNGEPRUEFT zurueck — ein defaultSteps von 20 landete im
  // builtin-Modus (max 4) sonst unveraendert im Ergebnis. Deshalb wird auch er geklemmt;
  // das faengt zugleich ein kaputtes defaultSteps aus einer handeditierten data.json.
  const fallbackSteps = clampInt(ctx.defaultSteps, caps.minSteps, caps.maxSteps, caps.minSteps);
  return {
    prompt: input.prompt,
    // Ein Regler, den das Backend nicht kann, wird nicht abgelehnt, sondern neutralisiert —
    // der Aufrufer sieht am Rueckgabewert, was daraus wurde (Keine-Attrappen-Linie).
    negativePrompt: caps.negativePrompt ? (input.negativePrompt ?? "") : "",
    cfg: caps.cfg ? finite(input.cfg, CFG.default) : 1,
    width: caps.fixedSize?.width ?? finite(input.width, DEFAULT_SIZE.width),
    height: caps.fixedSize?.height ?? finite(input.height, DEFAULT_SIZE.height),
    steps: clampInt(input.steps ?? ctx.defaultSteps, caps.minSteps, caps.maxSteps, fallbackSteps),
    seed: finite(input.seed, ctx.randomSeed()),
    model: ctx.model,
    date: isoStamp(ctx.now),
  };
}
