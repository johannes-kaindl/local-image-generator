// Generations-Grenzen (Spec §4) — ersetzen den Modell-Katalog (models.ts stirbt in Task 8):
// der Server hält die Modelle, das Plugin bietet generische, ehrliche Regler.
import { modelById, type BuiltinModelId } from "./model-manifest";
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
 *  0 = Vorlage bleibt UNVERAENDERT, 1 = quasi freie Erzeugung. Nur im img2img-Fall ueberhaupt
 *  gesetzt. Der linke Anschlag ist kein Sonderfall der UI: die eingebauten Engines
 *  ueberspringen bei 0 den Diffusions-Lauf und dekodieren das Vorlagen-Latent direkt (ein
 *  Euler-Schritt mit Sigma 0 waere eine Division durch null — K1, 2026-09-05). */
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
  /** Kann das Backend ein Ausgangsbild weiterrechnen (img2img)? Seit 0.11 kann die
   *  eingebaute Engine das ebenfalls — der VAE-Encoder ist Pflicht-Asset. */
  initImage: boolean;
  /** Nicht-null heißt: das Backend kann NUR diese eine Größe (SD-Turbo ist auf 512²
   *  destilliert). null heißt: der Aufrufer wählt — entweder frei (Server) oder aus `sizes`
   *  (ein builtin-Modell mit mehr als einer Größe, z. B. SDXL-Turbo). */
  fixedSize: { width: number; height: number } | null;
  /** Die Größen, aus denen ueberhaupt gewaehlt werden darf. `null` heißt: freie Wahl
   *  (Server-Modus). Ein builtin-Modell traegt hier immer seinen eigenen `sizes`-Katalog —
   *  bei genau einem Eintrag deckt sich das mit `fixedSize`, bei mehreren (SDXL-Turbo) ist
   *  `fixedSize` null und `sizes` sagt, woraus gewaehlt wird. */
  sizes: readonly SizeOption[] | null;
}

/** Was ein Backend ehrlich kann. Im builtin-Modus haengt das Ergebnis vom AKTIVEN Modell ab
 *  (SD-Turbo: eine Größe, SDXL-Turbo: zwei) — `model` ist deshalb PFLICHT, kein Default mehr
 *  (Final-Review-Fund, 2026-08-24): ein still auf `DEFAULT_BUILTIN_MODEL_ID` zurueckfallender
 *  Aufruf ohne zweites Argument war genau der Mechanismus, der C1 (`local-engine.ts` rechnete
 *  SDXL-Turbo-Anfragen still auf SD-Turbos 512²) im Vorfeld unsichtbar hielt — ein Test, der
 *  nur "ohne Modellargument gilt der Default" belegte, waere nach C1 eine Rechtfertigung fuer
 *  denselben Fehler gewesen. `HardenContext.builtinModel` ist schon seit Task 12 Pflichtfeld;
 *  jeder Produktionsaufrufer uebergab bereits ein Modell. Der Server-Zweig bleibt vom Argument
 *  unberuehrt: er kennt kein "Modell" in diesem Sinn, der Server waehlt selbst. */
export function backendCapabilities(mode: EngineChoice, model: BuiltinModelId): BackendCapabilities {
  if (mode !== "builtin") {
    return {
      negativePrompt: true, cfg: true, initImage: true,
      minSteps: STEPS.min, maxSteps: STEPS.max,
      fixedSize: null, sizes: null,
    };
  }
  const m = modelById(model);
  const only = m.sizes.length === 1 ? (m.sizes[0] ?? null) : null;
  return {
    negativePrompt: false,
    cfg: false,
    initImage: true,
    minSteps: m.steps.min,
    maxSteps: m.steps.max,
    // fixedSize bleibt die v1-Zusage „genau diese eine Groesse". Bei zwei erlaubten Groessen
    // gibt es keine solche — dann null (= waehl selbst), und `sizes` sagt, woraus.
    fixedSize: only,
    sizes: m.sizes,
  };
}
