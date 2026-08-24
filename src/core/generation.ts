// Generations-Grenzen (Spec §4) — ersetzen den Modell-Katalog (models.ts stirbt in Task 8):
// der Server hält die Modelle, das Plugin bietet generische, ehrliche Regler.
import { BUILTIN_MODEL } from "./model-manifest";
import type { EngineChoice } from "./settings";

export interface SizeOption { width: number; height: number; }

export const SIZES: readonly SizeOption[] = [
  { width: 512, height: 512 },
  { width: 768, height: 768 },
  { width: 1024, height: 1024 },
  { width: 768, height: 512 },
  { width: 512, height: 768 },
  { width: 1024, height: 576 },
  { width: 576, height: 1024 },
];
export const DEFAULT_SIZE: SizeOption = SIZES[0]!;

export const STEPS = { min: 1, max: 50, default: 20 } as const;
export const CFG = { min: 1, max: 15, step: 0.5, default: 7 } as const;
/** Wieviel das Backend an einer Vorlage aendern darf (A1111: `denoising_strength`).
 *  0 = Vorlage bleibt, 1 = quasi freie Erzeugung. Nur im img2img-Fall ueberhaupt gesetzt. */
export const DENOISING = { min: 0, max: 1, step: 0.05, default: 0.75 } as const;

/** Was ein Backend EHRLICH kann (Keine-Attrappen-Linie aus 0.2). Einzige Quelle: das
 *  ViewModel leitet daraus seine Regler ab, die Provider-API ihr `capabilities`-Feld.
 *  Zwei Listen würden auseinanderlaufen, und die API würde Konsumenten Regler versprechen,
 *  die das Panel längst versteckt. */
export interface BackendCapabilities {
  negativePrompt: boolean;
  cfg: boolean;
  minSteps: number;
  maxSteps: number;
  /** Kann das Backend ein Ausgangsbild weiterrechnen (img2img)? Die eingebaute Engine
   *  kann es nicht — ihr fehlt der VAE-Encoder (Roadmap-Posten 4a). */
  initImage: boolean;
  /** Nicht-null heißt: das Backend kann NUR diese eine Größe (SD-Turbo ist auf 512²
   *  destilliert). null heißt: der Aufrufer wählt. */
  fixedSize: { width: number; height: number } | null;
}

export function backendCapabilities(mode: EngineChoice): BackendCapabilities {
  return mode === "builtin"
    ? {
        negativePrompt: false,
        cfg: false,
        initImage: false,
        minSteps: BUILTIN_MODEL.steps.min,
        maxSteps: BUILTIN_MODEL.steps.max,
        fixedSize: BUILTIN_MODEL.sizes[0] ?? { width: 512, height: 512 },
      }
    : { negativePrompt: true, cfg: true, initImage: true, minSteps: STEPS.min, maxSteps: STEPS.max, fixedSize: null };
}
