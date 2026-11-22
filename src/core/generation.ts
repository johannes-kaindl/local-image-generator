// Generations-Grenzen — ersetzen den frueheren Modell-Katalog (models.ts ist entfallen):
// der Server hält die Modelle, das Plugin bietet generische, ehrliche Regler.
import { modelById, type BuiltinModelId } from "./model-manifest";
import type { EngineChoice } from "./settings";
import type { WorkflowRole } from "./comfy/workflow";
import type { ActiveWorkflow } from "./comfy/library";

export interface SizeOption { width: number; height: number; }

// Nur der SERVER-Modus waehlt hieraus (`capabilities.sizes` ist dort null — freie Wahl, die
// Haertung laesst jede Groesse durch). Der builtin-Modus zieht seine Groessen aus dem
// Modellkatalog und wird von dieser Liste nicht beruehrt.
//
// Alle Kanten sind Vielfache von 64: Latents sind 1/8 der Bildgroesse, das UNet hat drei
// Downsampling-Stufen. Deshalb steht hier 2048x1152 und nicht 1920x1080 — 1080 / 64 = 16,875.
//
// Die grossen Formate kamen 2026-09-05 dazu. Anlass: Draw Things mit Flux kann bis 2048,
// das Dropdown bot aber nur bis 1024 an — die Beschraenkung sass in DIESER Liste, nicht im
// Backend. Ein Desktop-Hintergrund war damit gar nicht erzeugbar.
export const SIZES: readonly SizeOption[] = [
  { width: 512, height: 512 },
  { width: 768, height: 768 },
  { width: 1024, height: 1024 },
  { width: 2048, height: 2048 },
  { width: 768, height: 512 },
  { width: 512, height: 768 },
  { width: 1024, height: 576 },
  { width: 576, height: 1024 },
  { width: 2048, height: 1152 },
  { width: 1152, height: 2048 },
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
  /** Nimmt das Backend einen Prompt? Nur Hochskalieren nicht. */
  prompt: boolean;
  /** Nimmt es Steps bzw. einen Seed? playground und Hochskalieren nicht. */
  steps: boolean;
  seed: boolean;
  /** Gibt es eine Groesse zu WAEHLEN (freie Wahl oder mehr als eine erlaubte)? Bearbeiten und Hochskalieren nicht: dort
   *  bestimmen Vorlage und Workflow die Groesse. */
  size: boolean;
  /** Ist eine Vorlage PFLICHT (Bearbeiten, Hochskalieren), nicht nur moeglich (img2img)? */
  initRequired: boolean;
  /** Wirkt ein Denoise-Wert? img2img ja; Bearbeiten nein, obwohl es eine Vorlage nimmt. */
  denoising: boolean;
}

/** Welche Aufgabe im comfy-Modus gerade gilt — die Rolle des Workflows. */
export type ComfyTask = WorkflowRole;

/** Der Kontext, aus dem die Faehigkeiten folgen. Bewusst eine diskriminierte Union statt
 *  weiterer Stellungsargumente: `model` wurde zu einem Pflichtfeld, weil ein still auf den
 *  Default zurueckfallender Aufruf genau der Mechanismus war, der C1 unsichtbar hielt
 *  (local-engine.ts rechnete SDXL-Anfragen auf SD-Turbos 512²). Ein optionaler dritter
 *  Parameter machte denselben Mechanismus fuer `slots` wieder auf; als Union ist der
 *  Fehler nicht verboten, sondern unmoeglich. */
export type BackendContext =
  | { mode: "builtin"; model: BuiltinModelId }
  | { mode: "server" }
  | { mode: "comfy"; task: ComfyTask; workflow: ActiveWorkflow | null }
  | { mode: "playground" };

/** Was ein Backend ehrlich kann. Im builtin-Modus haengt das Ergebnis vom AKTIVEN Modell ab
 *  (SD-Turbo: eine Größe, SDXL-Turbo: zwei); im comfy-Modus vom hinterlegten Workflow — `model`
 *  bzw. `slots` sind deshalb PFLICHT, kein Default mehr: ein
 *  still auf `DEFAULT_BUILTIN_MODEL_ID` zurueckfallender Aufruf ohne zweites Argument war genau
 *  der Mechanismus, der einen frueheren Fehler (`local-engine.ts` rechnete SDXL-Turbo-Anfragen
 *  still auf SD-Turbos 512²) unsichtbar hielt — ein Test, der nur "ohne Modellargument gilt der
 *  Default" belegte, waere eine Rechtfertigung fuer denselben Fehler gewesen. Als Union statt
 *  eines optionalen dritten Stellungsarguments: der Fehler ist damit nicht verboten, sondern
 *  unmoeglich. Der Server-Zweig bleibt von einem Modell unberuehrt: er kennt kein "Modell" in
 *  diesem Sinn, der Server waehlt selbst. */
export function backendCapabilities(ctx: BackendContext): BackendCapabilities {
  if (ctx.mode === "playground") {
    // Image Playground (Apple-Kurzbefehl, Spec Baustein 5) kennt weder Negativ-Prompt noch
    // CFG noch eine waehlbare Groesse noch img2img — der Kurzbefehl nimmt nur den Prompt.
    // `sizes` mit GENAU EINEM Eintrag blendet den Groessen-Regler aus (dasselbe Muster wie
    // ein Ein-Groessen-builtin-Modell); der Wert selbst ist ein Platzhalter, keine Zusage —
    // die tatsaechliche Bildgroesse bestimmt der Kurzbefehl. Settings-Tab und Fehlertext
    // nennen das ausdruecklich (Auftrag C, Welle 13), damit der Platzhalter nicht wie eine
    // Konfigurationsmoeglichkeit aussieht.
    return {
      negativePrompt: false, cfg: false, initImage: false,
      minSteps: STEPS.min, maxSteps: STEPS.max,
      fixedSize: DEFAULT_SIZE, sizes: [DEFAULT_SIZE],
      prompt: true, steps: false, seed: false, size: false, initRequired: false, denoising: false,
    };
  }
  if (ctx.mode === "server") {
    return {
      negativePrompt: true, cfg: true, initImage: true,
      minSteps: STEPS.min, maxSteps: STEPS.max,
      fixedSize: null, sizes: null,
      prompt: true, steps: true, seed: true, size: true, initRequired: false, denoising: true,
    };
  }
  if (ctx.mode === "comfy") {
    // Kein Workflow-Feld fasst CFG an (Sampler, Scheduler, CFG, LoRAs und Upscaler gehoeren dem Nutzer), und ein Denoise
    // hat keine der drei Aufgaben: Bearbeiten fuehrt die Vorlage als Referenz, nicht als Startlatent.
    const common = { cfg: false, denoising: false, minSteps: STEPS.min, maxSteps: STEPS.max, fixedSize: null, sizes: null };
    if (ctx.task === "upscale") {
      return { ...common, negativePrompt: false, initImage: true, initRequired: true, prompt: false, steps: false, seed: false, size: false };
    }
    if (ctx.task === "edit") {
      // Kein Negativ: im Referenz-Graphen sind von `positive` aus beide Text-Knoten erreichbar (classifyWorkflow).
      return { ...common, negativePrompt: false, initImage: true, initRequired: true, prompt: true, steps: true, seed: true, size: false };
    }
    // Erzeugen. Ohne brauchbaren Workflow ist nichts ausfuehrbar (die Statuszeile nennt den Grund); der Negativ-Slot ist
    // Teil der Sampler-Erkennung und existiert nur mit Workflow. Groesse und Steps sichert die Abweisung in
    // inspectWorkflow.
    return {
      ...common, negativePrompt: ctx.workflow !== null, initImage: false, initRequired: false,
      prompt: true, steps: true, seed: true, size: true,
    };
  }
  const m = modelById(ctx.model);
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
    prompt: true, steps: true, seed: true, size: m.sizes.length > 1, initRequired: false, denoising: true,
  };
}

/** Aus den drei Feldern, die Panel, Haertung und Provider-API alle drei fuehren, den
 *  Kontext bauen. EINE Stelle, damit die drei nicht auseinanderlaufen — dieselbe
 *  Begruendung wie fuer die eine Haertungsquelle. */
export function toBackendContext(
  mode: EngineChoice,
  builtinModel: BuiltinModelId,
  comfy: { task: ComfyTask; workflow: ActiveWorkflow | null },
): BackendContext {
  if (mode === "builtin") return { mode, model: builtinModel };
  if (mode === "comfy") return { mode, task: comfy.task, workflow: comfy.workflow };
  if (mode === "playground") return { mode };
  return { mode: "server" };
}
