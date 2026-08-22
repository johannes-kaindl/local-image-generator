// Provider-API v1 (Spec 2026-08-22-provider-api-v1-design.md §4) — der Vertrag, den dieses
// Plugin anderen Obsidian-Plugins als `app.plugins.plugins["local-image-generator"].api`
// anbietet. Pure Fassade ueber injizierte Abhaengigkeiten (Muster: vault-rag/src/plugin_api.ts,
// LocalEngineDeps) — testbar ohne Obsidian, keine eigene Entscheidung ausser Uebersetzung.
import { backendCapabilities } from "./generation";
import type { HardenInput } from "./params";
import type { GenParams } from "./viewmodel";
import type { EngineChoice } from "./settings";

export const IMAGE_GENERATION_API_VERSION = 1;

/** Erwartbare Zustände. Eigener Union, weil `status()` denselben Satz meldet wie
 *  `generate()` — nur `failed` fehlt dort, das entsteht erst beim Rechnen. */
export type ApiFailure =
  | "busy"
  | "not-configured"        // Server-Modus ohne Endpunkt
  | "unreachable"           // Endpunkt gesetzt, Server antwortet nicht
  | "model-not-downloaded"  // builtin-Modus, Assets fehlen — wir laden NICHT nach
  | "no-gpu";

/** Nur `prompt` ist Pflicht. Alles Fehlende kommt aus den Einstellungen des Nutzers. */
export interface ApiRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number; height?: number;
  steps?: number; cfg?: number;
  /** Fehlt der Seed, wird gewuerfelt — wie „Reroll" im Panel. Der verwendete Wert steht
   *  danach in `ApiParams.seed`, damit ein Konsument das Ergebnis reproduzieren kann. */
  seed?: number;
  /** `pct` ist null, wenn das Backend keinen Fortschritt liefert (Draw Things kennt
   *  /sdapi/v1/progress nicht). Die Phase kommt trotzdem — ein builtin-Lauf steht
   *  minutenlang in "loading-model", und ein Konsument ohne dieses Signal zeigt einen
   *  Hänger statt einer Ladephase. */
  onProgress?: (pct: number | null, phase: "loading-model" | "generating") => void;
}

/** Was TATSÄCHLICH gerechnet wurde — nicht, was angefragt war. Der builtin-Modus
 *  überschreibt still (cfg 1, 512 px, kein Negativ-Prompt); wer das nicht zurückbekommt,
 *  schreibt falsche Metadaten in seine eigene Notiz. */
export interface ApiParams {
  prompt: string; negativePrompt: string;
  width: number; height: number;
  steps: number; seed: number; cfg: number;
  model: string;      // im Server-Modus wählt ihn der Server, wir melden ihn nur
  created: string;    // lokale Zeit ohne Offset, wie in den Ergebnis-Notizen
}

export interface ApiImage { base64: string; params: ApiParams }   // PNG ohne data:-Präfix

export type ApiResult =
  | { ok: true; image: ApiImage }
  | { ok: false; reason: ApiFailure }
  | { ok: false; reason: "failed"; message: string };  // rohe Backend-Meldung, unübersetzt

export interface ApiStatus {
  apiVersion: number;
  engine: "builtin" | "server";
  /** Synchron und netzfrei. Sagt NICHTS über die aktuelle Erreichbarkeit eines Servers —
   *  das ginge nur mit einem Netzaufruf, und `status()` macht keinen. Im Server-Modus
   *  spiegelt es den zuletzt ermittelten Zustand. */
  ready: boolean;
  reason: ApiFailure | null;
  /** Was das Backend WIRKLICH kann. Ohne dieses Feld baut ein Konsument im builtin-Modus
   *  einen CFG-Regler, der nichts tut — genau die Attrappe, die dieses Plugin bei sich
   *  selbst verboten hat (Keine-Attrappen-Linie, bewacht von Smoke-Punkt 17). */
  capabilities: {
    negativePrompt: boolean;
    cfg: boolean;
    maxSteps: number;
    fixedSize: { width: number; height: number } | null;
  };
}
// Konkret: builtin → { negativePrompt: false, cfg: false, maxSteps: BUILTIN_MODEL.steps.max (4),
//                      fixedSize: { width: BUILTIN_MODEL.size, height: BUILTIN_MODEL.size } (512x512) }
//          server  → { negativePrompt: true,  cfg: true,  maxSteps: STEPS.max (50),
//                      fixedSize: null }
// Die Werte stammen aus denselben Konstanten, die das Panel benutzt (core/generation.ts,
// core/model-manifest.ts) — nicht aus einer zweiten Liste, die auseinanderlaufen kann.

export type ApiSaveResult =
  | { ok: true; imagePath: string; notePath: string | null }
  | { ok: false; reason: "write-failed"; message: string };

export interface ImageGenerationApi {
  readonly apiVersion: number;
  status(): ApiStatus;
  generate(req: ApiRequest): Promise<ApiResult>;
  /** Legt das Ergebnis nach den Ausgabeziel-Einstellungen des Nutzers ab (Ordner,
   *  Dateiname, Kollisions-Dedup, optional Ergebnis-Notiz). Der EINZIGE Vault-Write
   *  des Vertrags. */
  save(
    image: ApiImage,
    /** `createNote` fehlt → es gilt die Nutzer-Einstellung (`settings.createMode === "note"`).
     *  Ein Konsument, der die Wahl des Nutzers respektieren will, laesst das Feld weg. */
    opts?: { createNote?: boolean },
  ): Promise<ApiSaveResult>;
}

/** Was die Fassade vom Wirt braucht. Alles injiziert, damit der Vertrag ohne Obsidian
 *  testbar ist (Muster: LocalEngineDeps). */
export interface ApiDeps {
  getMode(): EngineChoice;
  /** Netzfreie Bereitschaft. `main.ts` leitet sie aus state.engine/state.server ab —
   *  status() macht selbst KEINEN Netzaufruf.
   *  Als Union, nicht als flaches Objekt: `{ ready: false }` OHNE Grund waere ein Zustand,
   *  ueber den status() und generate() verschieden urteilen muessten — der Typ macht ihn
   *  gar nicht erst konstruierbar. */
  readiness(): { ready: true } | { ready: false; reason: ApiFailure };
  isBusy(): boolean;
  harden(input: HardenInput): GenParams;
  /** Rechnet. Wirft nicht — Fehlschlaege kommen als message zurueck, damit der Vertrag
   *  erwartbare Zustaende als Werte fuehrt statt als Ausnahmen. */
  run(
    params: GenParams,
    onProgress?: ApiRequest["onProgress"],
  ): Promise<{ ok: true; base64: string } | { ok: false; message: string }>;
  save(image: ApiImage, createNote: boolean): Promise<ApiSaveResult>;
  /** Voreinstellung des Nutzers (settings.createMode === "note"). */
  defaultCreateNote(): boolean;
}

/** Interner GenParams → Vertrags-ApiParams. Bewusst eine Uebersetzung statt derselben
 *  Form: `date` heisst im Vertrag `created`, und der Vertrag darf nicht mitwandern,
 *  wenn wir intern umbenennen. */
function toApiParams(g: GenParams): ApiParams {
  const { date, ...rest } = g;
  return { ...rest, created: date };
}

/** `save()` formt aus den uebergebenen Params einen VAULT-PFAD: `buildImageFilename`
 *  interpoliert `created` und `seed` direkt in den Dateinamen. Der Vertrag sagt zwar "gib
 *  zurueck, was generate() geliefert hat", aber ein Konsument kann dazwischen alles
 *  veraendern — und TypeScript schuetzt keinen JS-Aufrufer. Ohne diese Pruefung entsteht aus
 *  einem kaputten `created` die Datei `lig-NaNNaNNaN-NaNNaNNaN-s7.png`, und ein `seed`, der
 *  zur Laufzeit kein number ist, formt den Pfad frei mit. Das ist KEINE Rechteausweitung
 *  (wer die API rufen kann, kann auch app.vault) — es haelt nur einen buggy Nachbarn davon
 *  ab, einen Pfad zu formen, den niemand gemeint hat. Rueckgabe: Grund, oder null wenn ok. */
function unusableParams(p: ApiParams | undefined | null): string | null {
  if (p === undefined || p === null) return "image.params is missing";
  if (typeof p.seed !== "number" || !Number.isFinite(p.seed)) return "params.seed must be a finite number";
  if (typeof p.created !== "string" || Number.isNaN(new Date(p.created).getTime()))
    return "params.created must be a readable timestamp";
  return null;
}

export function createImageGenerationApi(deps: ApiDeps): ImageGenerationApi {
  return {
    apiVersion: IMAGE_GENERATION_API_VERSION,

    status(): ApiStatus {
      const caps = backendCapabilities(deps.getMode());
      const r = deps.readiness();
      // busy schlaegt jede andere Bereitschaft: das Backend mag geladen sein, aber es
      // rechnet gerade — ein Konsument, der jetzt anfragt, bekaeme eine Absage.
      const busy = deps.isBusy();
      return {
        apiVersion: IMAGE_GENERATION_API_VERSION,
        engine: deps.getMode(),
        ready: r.ready && !busy,
        reason: busy ? "busy" : r.ready ? null : r.reason,
        capabilities: {
          negativePrompt: caps.negativePrompt,
          cfg: caps.cfg,
          maxSteps: caps.maxSteps,
          fixedSize: caps.fixedSize,
        },
      };
    },

    async generate(req: ApiRequest): Promise<ApiResult> {
      if (deps.isBusy()) return { ok: false, reason: "busy" };
      const r = deps.readiness();
      if (!r.ready) return { ok: false, reason: r.reason };
      const params = deps.harden(req);
      const out = await deps.run(params, req.onProgress);
      if (!out.ok) return { ok: false, reason: "failed", message: out.message };
      return { ok: true, image: { base64: out.base64, params: toApiParams(params) } };
    },

    async save(image: ApiImage, opts?: { createNote?: boolean }): Promise<ApiSaveResult> {
      // Vor dem Vault-Write, nicht danach: ein abgewiesener Auftrag darf keine Datei
      // hinterlassen. `write-failed` statt eines neuen Grundes — die Fehler-Union von v1
      // bleibt unveraendert, und "geschrieben wurde nichts" trifft beides.
      const bad = unusableParams(image?.params);
      if (bad !== null) return { ok: false, reason: "write-failed", message: bad };
      return deps.save(image, opts?.createNote ?? deps.defaultCreateNote());
    },
  };
}
