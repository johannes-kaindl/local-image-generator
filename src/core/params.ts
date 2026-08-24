import { backendCapabilities, CFG, DEFAULT_SIZE, DENOISING } from "./generation";
import type { BuiltinModelId } from "./model-manifest";
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
  /** Die ANWESENHEIT dieses Objekts ist das img2img-Signal, `ref` nur die Herkunft:
   *  `{ ref: "Bilder/a.png" }` kommt aus dem Panel, `{ ref: null }` von einem Fremdplugin,
   *  das Bytes ohne Vault-Datei schickt. Waere das Signal der Pfad, verlore jeder API-Lauf
   *  sein `denoising`. */
  initImage?: { ref: string | null };
  denoising?: number;
}

export interface HardenContext {
  mode: EngineChoice;
  /** Startwert fuer Steps, wenn der Auftrag keinen nennt (settings.defaultSteps). */
  defaultSteps: number;
  /** Modellname, wie ihn das Backend meldet. Im Server-Modus waehlt ihn der Server. */
  model: string;
  /** Das AKTIVE eingebaute Modell (settings.builtinModel) — getrennt von `model` oben, weil
   *  `model` ein loser String ist (Server-Modus traegt dort einen `.safetensors`-Namen, den
   *  `backendCapabilities` nicht als BuiltinModelId lesen kann). Pflichtfeld, nicht optional:
   *  ohne diese Trennung fiel `backendCapabilities(ctx.mode)` auf ihren Default-Parameter
   *  zurueck (SD-Turbo) und ueberschrieb im builtin-Modus JEDE Groesse eines anderen Modells
   *  still auf 512x512 — SDXL-Turbos 1024x1024 kam nie im GenParams an, obwohl Panel und
   *  Settings-Tab es korrekt anboten (Review-Fund, Task 12 Fixrunde). Im Server-Modus
   *  ungenutzt (backendCapabilities ignoriert `model`, wenn mode !== "builtin"), aber trotzdem
   *  Pflicht: ein optionales Feld waere wieder ein stiller Default gewesen. */
  builtinModel: BuiltinModelId;
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
// Der Fallback darf auch ein Thunk sein: `ctx.randomSeed` ist ein injizierter Callback, und
// ein eifrig ausgewerteter Fallback zieht ihn bei JEDEM Aufruf — auch wenn der Auftrag einen
// brauchbaren Seed mitbringt. Heute folgenlos (eine Ziehung zu viel), aber sobald `randomSeed`
// je einen Seiteneffekt bekommt (Zaehler, PRNG-Fortschaltung), schaltet die Haertung ihn hinter
// dem Ruecken des Aufrufers weiter. Konstante Fallbacks bleiben Werte — kein Thunk-Rauschen.
function finite(value: number | undefined, fallback: number | (() => number)): number {
  if (value !== undefined && Number.isFinite(value)) return value;
  return typeof fallback === "function" ? fallback() : fallback;
}

/** Wie `clampInt`, aber ohne Runden — `denoising` ist ein Bruch. Eigene Funktion, weil das
 *  vendorte `clampInt` seinen Fallback UNGEPRUEFT zurueckgibt (LESSONS 2026-08-23); hier
 *  laeuft auch der Fallback durch die Klemme. */
function clampFloat(v: number | undefined, min: number, max: number, fallback: number): number {
  const n = v !== undefined && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

export function hardenParams(input: HardenInput, ctx: HardenContext): GenParams {
  const caps = backendCapabilities(ctx.mode, ctx.builtinModel);
  // clampInt gibt seinen Fallback UNGEPRUEFT zurueck — ein defaultSteps von 20 landete im
  // builtin-Modus (max 4) sonst unveraendert im Ergebnis. Deshalb wird auch er geklemmt;
  // das faengt zugleich ein kaputtes defaultSteps aus einer handeditierten data.json.
  const fallbackSteps = clampInt(ctx.defaultSteps, caps.minSteps, caps.maxSteps, caps.minSteps);
  // Kann das Backend kein img2img, faellt die ganze Vorlage weg — still, wie Negativ-Prompt
  // und CFG (Keine-Attrappen-Linie). Das SIGNAL ist die Anwesenheit, nicht der Pfad darin.
  const wanted = caps.initImage ? input.initImage : undefined;
  return {
    prompt: input.prompt,
    // Ein Regler, den das Backend nicht kann, wird nicht abgelehnt, sondern neutralisiert —
    // der Aufrufer sieht am Rueckgabewert, was daraus wurde (Keine-Attrappen-Linie).
    negativePrompt: caps.negativePrompt ? (input.negativePrompt ?? "") : "",
    cfg: caps.cfg ? finite(input.cfg, CFG.default) : 1,
    width: caps.fixedSize?.width ?? finite(input.width, DEFAULT_SIZE.width),
    height: caps.fixedSize?.height ?? finite(input.height, DEFAULT_SIZE.height),
    steps: clampInt(input.steps ?? ctx.defaultSteps, caps.minSteps, caps.maxSteps, fallbackSteps),
    seed: finite(input.seed, () => ctx.randomSeed()),
    model: ctx.model,
    date: isoStamp(ctx.now),
    initImage: wanted?.ref ?? null,
    denoising: wanted === undefined ? null : clampFloat(input.denoising, DENOISING.min, DENOISING.max, DENOISING.default),
  };
}
