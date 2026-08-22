// Generations-Grenzen (Spec §4) — ersetzen den Modell-Katalog (models.ts stirbt in Task 8):
// der Server hält die Modelle, das Plugin bietet generische, ehrliche Regler.
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

import { BUILTIN_MODEL } from "./model-manifest";
import type { EngineChoice } from "./settings";

/** Was ein Backend EHRLICH kann (Keine-Attrappen-Linie aus 0.2). Einzige Quelle: das
 *  ViewModel leitet daraus seine Regler ab, die Provider-API ihr `capabilities`-Feld.
 *  Zwei Listen würden auseinanderlaufen, und die API würde Konsumenten Regler versprechen,
 *  die das Panel längst versteckt. */
export interface BackendCapabilities {
  negativePrompt: boolean;
  cfg: boolean;
  minSteps: number;
  maxSteps: number;
  /** Nicht-null heißt: das Backend kann NUR diese eine Größe (SD-Turbo ist auf 512²
   *  destilliert). null heißt: der Aufrufer wählt. */
  fixedSize: { width: number; height: number } | null;
}

export function backendCapabilities(mode: EngineChoice): BackendCapabilities {
  return mode === "builtin"
    ? {
        negativePrompt: false,
        cfg: false,
        minSteps: BUILTIN_MODEL.steps.min,
        maxSteps: BUILTIN_MODEL.steps.max,
        fixedSize: { width: BUILTIN_MODEL.size, height: BUILTIN_MODEL.size },
      }
    : { negativePrompt: true, cfg: true, minSteps: STEPS.min, maxSteps: STEPS.max, fixedSize: null };
}
