// Provider-API v1 (Spec 2026-08-22-provider-api-v1-design.md §4) — der Vertrag, den dieses
// Plugin anderen Obsidian-Plugins als `app.plugins.plugins["local-image-generator"].api`
// anbietet. Pure Fassade ueber injizierte Abhaengigkeiten (Muster: vault-rag/src/plugin_api.ts,
// LocalEngineDeps) — testbar ohne Obsidian, keine eigene Entscheidung ausser Uebersetzung.
import { backendCapabilities, toBackendContext, type SizeOption } from "./generation";
import type { BuiltinModelId } from "./model-manifest";
import type { HardenInput } from "./params";
import type { GenParams } from "./viewmodel";
import type { EngineChoice } from "./settings";
import type { WorkflowSlots } from "./comfy/workflow";

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
  /** Vorlage fuer img2img: Base64-PNG **ohne** `data:`-Praefix. Fehlt es, ist der Lauf
   *  txt2img. Seit 0.11 in BEIDEN Modi wirksam — `capabilities.initImage` sagt vorher, ob
   *  das aktuelle Backend es ueberhaupt anbietet. */
  initImage?: string;
  /** Bricht den Lauf ab. Ergebnis ist dann `{ ok: false, reason: "aborted" }`.
   *
   *  ⚠️ **Was „abbrechen" heisst, haengt am Modus — und das ist eine Zusage, keine
   *  Ungenauigkeit.** Im **builtin**-Modus ist es ein echter Abbruch: die Diffusionsschleife
   *  prueft zwischen zwei Schritten und hoert auf zu rechnen. Im **server**- und
   *  **comfy**-Modus bricht `signal` nur die WARTEZEIT ab — der Server rechnet sein Bild
   *  fertig, wir sehen es nur nicht mehr an. `requestUrl` (Obsidian) kennt weder Abort noch
   *  Timeout, es gibt also gar keinen Weg, einen laufenden HTTP-Aufruf zurueckzunehmen.
   *
   *  Das steht hier so ausdruecklich, weil die Alternative eine Attrappe waere: ein Feld,
   *  das in einem Modus echt und im anderen kosmetisch ist, muss den Unterschied im Vertrag
   *  tragen — sonst baut ein Konsument einen „Stop"-Knopf, der die Serverlast nicht senkt,
   *  und wundert sich ueber die GPU-Auslastung. Praktische Folge fuer einen Deck-Durchlauf:
   *  nach einem Abbruch im Server-Modus laeuft das begonnene Bild noch, das NAECHSTE
   *  startet aber nicht mehr. */
  signal?: AbortSignal;
  /** Wie stark die Vorlage geaendert werden darf, 0..1 (A1111: `denoising_strength`).
   *  Ohne `initImage` ohne Wirkung. Fehlt es, gilt 0.75.
   *
   *  **Seit 0.12 kontinuierlich in BEIDEN Modi.** Bis 0.11 quantisierte die Haertung im
   *  builtin-Modus auf ein Steps-Raster {1/steps … 1} — eine angefragte 0.65 kam als 0.75
   *  zurueck. Die eingebaute Engine interpoliert ihren Einstiegspunkt jetzt zwischen zwei
   *  Rauschstufen, der Wert wird also unveraendert uebernommen (nur auf [0,1] geklemmt).
   *  Massgeblich bleibt trotzdem der Wert in den zurueckgegebenen `ApiParams.denoising`,
   *  nicht die Eingabe hier.
   *
   *  `denoising: 0` heisst „Vorlage unveraendert": der builtin-Lauf ueberspringt die
   *  Diffusion und dekodiert das Vorlagen-Latent direkt — das Ergebnis ist die Vorlage nach
   *  einem VAE-Roundtrip, nicht ein Bild mit Restrauschen. */
  denoising?: number;
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
  steps: number; seed: number;
  /** `null` heisst: **das Plugin hat den Wert nicht bestimmt** — im comfy-Modus rechnet der
   *  Workflow des Nutzers mit seinem eigenen CFG, und `patchWorkflow` fasst das Feld nicht
   *  an. Eine Zahl waere dort eine Falschaussage: ein Konsument schriebe sie in seine eigene
   *  Notiz, und der Wert galt nie.
   *
   *  **`apiVersion` bleibt trotzdem 1.** Zwei Gruende: gemessen liest kein Konsument im
   *  Workspace dieses Feld (vier Repos geprueft), und der Vertrag beschreibt `ApiParams`
   *  ausdruecklich als „was die Haertung still ueberschrieben hat" — im comfy-Modus hat sie
   *  nichts ueberschrieben, `null` ist also die vertragstreue Antwort und keine neue Semantik.
   *  Dieselbe additive Logik wie bei `engine: "comfy"` und `recheck()` in 0.10.0. */
  cfg: number | null;
  model: string;      // im Server-Modus wählt ihn der Server, wir melden ihn nur
  created: string;    // lokale Zeit ohne Offset, wie in den Ergebnis-Notizen
  /** Nicht-null ⇔ es wurde von einer Vorlage aus weitergerechnet (img2img). Der Konsument
   *  hat das Bild selbst geschickt, bekommt es also nicht zurueck — wohl aber die Staerke,
   *  mit der es geaendert wurde, sonst schreibt er falsche Metadaten in seine Notiz. */
  denoising: number | null;
}

export interface ApiImage { base64: string; params: ApiParams }   // PNG ohne data:-Präfix

export type ApiResult =
  | { ok: true; image: ApiImage }
  | { ok: false; reason: ApiFailure }
  | { ok: false; reason: "failed"; message: string }   // rohe Backend-Meldung, unübersetzt
  /** Der Aufrufer hat ueber `ApiRequest.signal` abgebrochen. BEWUSST kein Wert in
   *  `ApiFailure`: den Union teilt sich `generate()` mit `status()`, und ein Status kann
   *  nicht „abgebrochen" sein — dieselbe Trennung wie bei `failed`. Ein Konsument, der
   *  `signal` nicht setzt, bekommt diesen Wert nie, die Erweiterung ist fuer ihn also
   *  unsichtbar (`apiVersion` bleibt 1, additiv wie `recheck()` in 0.10.0). */
  | { ok: false; reason: "aborted" };

export interface ApiStatus {
  apiVersion: number;
  /** Deskriptiv, keine Steuerung — ein Konsument liest `capabilities` und `ready`/`reason`,
   *  nicht dieses Feld (gemessen: derzeit kein Konsument im Workspace liest es ueberhaupt).
   *  Deshalb bleibt `apiVersion` bei der Erweiterung um "comfy" auf 1: "server" fuer ComfyUI
   *  zu melden waere eine Falschaussage ueber das laufende Backend (Keine-Attrappen-Linie),
   *  und ein Versions-Sprung zwaenge Konsumenten zu einer Pruefung, fuer die sich nichts
   *  aendert — dieselbe additive Logik wie bei `recheck()` in 0.10.0. */
  engine: "builtin" | "server" | "comfy";
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
    /** Kann dieses Backend von einer Vorlage aus weiterrechnen (img2img)? */
    initImage: boolean;
    /** Die Groessen, aus denen ueberhaupt gewaehlt werden darf. `null` = freie Wahl
     *  (Server-Modus). Im builtin-Modus die `sizes`-Liste des AKTIVEN Modells — bei SD-Turbo
     *  ein Eintrag (deckt sich mit `fixedSize`), bei SDXL-Turbo zwei (`fixedSize` ist dann
     *  null, weil keine der beiden Größen allein die Zusage traegt). */
    sizes: readonly SizeOption[] | null;
  };
}
// Konkret (builtin haengt vom AKTIVEN Modell ab, deps.builtinModel()):
//   sd-turbo   → { negativePrompt: false, cfg: false, maxSteps: 8,
//                  fixedSize: { width: 512, height: 512 }, sizes: [512x512] }
//   sdxl-turbo → { negativePrompt: false, cfg: false, maxSteps: 8,
//                  fixedSize: null, sizes: [512x512, 1024x1024] }
//   server     → { negativePrompt: true, cfg: true, maxSteps: STEPS.max (50),
//                  fixedSize: null, sizes: null }
// Die Werte stammen aus denselben Konstanten, die das Panel benutzt (core/generation.ts,
// core/model-manifest.ts) — nicht aus einer zweiten Liste, die auseinanderlaufen kann.

export type ApiSaveResult =
  | { ok: true; imagePath: string; notePath: string | null }
  | { ok: false; reason: "write-failed"; message: string };

export interface ImageGenerationApi {
  readonly apiVersion: number;
  status(): ApiStatus;
  /** Ermittelt die Bereitschaft NEU und liefert den frischen Stand — das Gegenstueck zu
   *  `status()`, das per Vertrag netzfrei und synchron ist und deshalb einen veralteten
   *  Serverzustand nicht heilen kann. */
  recheck(): Promise<ApiStatus>;
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
  /** Welches eingebaute Modell aktiv ist (`settings.builtinModel`) — `backendCapabilities`
   *  braucht es, um zwischen SD-Turbos einer Größe und SDXL-Turbos zweien zu unterscheiden.
   *  Im Server-Modus ungenutzt (der Server waehlt selbst). */
  builtinModel(): BuiltinModelId;
  /** Die Slots des hinterlegten ComfyUI-Workflows, oder null ohne brauchbaren Workflow —
   *  `backendCapabilities` braucht sie im comfy-Modus. Pflicht, nicht optional (wie
   *  `builtinModel` oben): ein optionales Feld waere wieder ein stiller Default. */
  workflowSlots(): WorkflowSlots | null;
  /** Netzfreie Bereitschaft. `main.ts` leitet sie aus state.engine/state.server ab —
   *  status() macht selbst KEINEN Netzaufruf.
   *  Als Union, nicht als flaches Objekt: `{ ready: false }` OHNE Grund waere ein Zustand,
   *  ueber den status() und generate() verschieden urteilen muessten — der Typ macht ihn
   *  gar nicht erst konstruierbar. */
  readiness(): { ready: true } | { ready: false; reason: ApiFailure };
  /** EIN Netzaufruf, der den Serverzustand neu ermittelt. Wirft nicht — ein nicht
   *  erreichbarer Server ist ein Ergebnis, keine Ausnahme; `recheck()` liest den neuen
   *  Stand danach ueber `readiness()`, nicht aus dem Rueckgabewert. */
  recheckServer(): Promise<void>;
  isBusy(): boolean;
  harden(input: HardenInput): GenParams;
  /** Rechnet. Wirft nicht — Fehlschlaege kommen als message zurueck, damit der Vertrag
   *  erwartbare Zustaende als Werte fuehrt statt als Ausnahmen. */
  run(
    params: GenParams,
    onProgress?: ApiRequest["onProgress"],
    /** Die BYTES der Vorlage — bewusst ein eigener Parameter statt eines Feldes in
     *  `params`: das Rezept traegt nur die Herkunft, nie das Bild (Spec §1). */
    initImageData?: string | null,
    /** Durchgereicht aus `ApiRequest.signal`. Der Wirt gibt es an das Backend weiter; was
     *  ein Abbruch dort bewirkt, haengt am Modus (s. `ApiRequest.signal`). */
    signal?: AbortSignal,
  ): Promise<{ ok: true; base64: string } | { ok: false; message: string }>;
  save(image: ApiImage, createNote: boolean): Promise<ApiSaveResult>;
  /** Voreinstellung des Nutzers (settings.createMode === "note"). */
  defaultCreateNote(): boolean;
}

/** Interner GenParams → Vertrags-ApiParams. Bewusst eine Uebersetzung statt derselben
 *  Form: `date` heisst im Vertrag `created`, und der Vertrag darf nicht mitwandern,
 *  wenn wir intern umbenennen. */
function toApiParams(g: GenParams): ApiParams {
  // `initImage` faellt hier heraus wie `date` umbenannt wird — und aus demselben Grund: der
  // Vertrag ist nicht die interne Form. Intern ist es ein VAULT-PFAD, im Vertrag heisst
  // `initImage` die Base64-Vorlage des Konsumenten (ApiRequest). Beides unter einem Namen
  // zurueckzugeben, waere ein Feld mit zwei Bedeutungen; bei einem API-Lauf ist der Pfad
  // ohnehin immer null.
  const { date, initImage: _pfad, ...rest } = g;
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
  // Als benannte Funktion statt als Methode, damit `recheck()` sie ohne `this` aufrufen kann:
  // ein Konsument darf `const { recheck } = api` schreiben, und dann gaebe es kein `this`.
  const readStatus = (): ApiStatus => {
      const caps = backendCapabilities(toBackendContext(deps.getMode(), deps.builtinModel(), deps.workflowSlots()));
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
          initImage: caps.initImage,
          sizes: caps.sizes,
        },
      };
  };

  return {
    apiVersion: IMAGE_GENERATION_API_VERSION,

    status: readStatus,

    async recheck(): Promise<ApiStatus> {
      // Server UND comfy haben einen entfernten Zustand, der sich hinter unserem Ruecken
      // aendern kann (der A1111-Endpunkt bzw. der ComfyUI-Server) — beide fragt derselbe
      // `deps.recheckServer()`-Weg ab (main.ts::checkServer() ist modusneutral). GPU und
      // Assets kennt das Plugin selbst, und `status()` liest sie ohnehin bei jedem Aufruf
      // frisch — ein „Neupruefen", das dort nichts pruefte, waere genau die Attrappe, die
      // dieses Plugin sonst weglaesst (Keine-Attrappen-Linie).
      if (deps.getMode() === "server" || deps.getMode() === "comfy") await deps.recheckServer();
      return readStatus();
    },

    async generate(req: ApiRequest): Promise<ApiResult> {
      // Als FUNKTION, nicht als `if (req.signal?.aborted === true)` zweimal hingeschrieben:
      // `aborted` ist ein veraenderliches Feld, das genau waehrend `deps.run(...)` umspringt
      // — und TypeScript weiss das nicht. Nach einer direkten Pruefung verengt es den Typ auf
      // `false | undefined` und meldet die zweite unten als „unintentional comparison"
      // (TS2367). Der Compiler haette hier also die noetige Pruefung wegargumentiert; ein
      // Aufruf ist die ehrliche Form, weil er sagt: der Wert wird NEU gelesen.
      const abgebrochen = (): boolean => req.signal?.aborted === true;
      // Vor allem anderen: ein bereits abgebrochener Auftrag darf nicht erst das Backend
      // beschaeftigen. Im builtin-Modus kostet ein gestarteter Lauf Minuten GPU-Zeit, die
      // niemand mehr abholt.
      if (abgebrochen()) return { ok: false, reason: "aborted" };
      if (deps.isBusy()) return { ok: false, reason: "busy" };
      const r = deps.readiness();
      if (!r.ready) return { ok: false, reason: r.reason };
      // NIE `deps.harden(req)`: `ApiRequest.initImage` ist BASE64, `HardenInput.initImage`
      // ist `{ ref }` — der bequeme Spread legte megabytegrosse Bilddaten ins Pfad-Feld und
      // schriebe sie als `init_image: [[…]]` in die Ergebnis-Notiz. Die Uebersetzung ist
      // deshalb ausdruecklich, und `{ ref: null }` sagt genau das Richtige: es gibt eine
      // Vorlage, aber keine benennbare Herkunft.
      const params = deps.harden({
        ...req,
        initImage: req.initImage !== undefined ? { ref: null } : undefined,
      });
      const out = await deps.run(params, req.onProgress, req.initImage ?? null, req.signal);
      if (!out.ok) {
        // Reihenfolge ist die Aussage: ein Fehlschlag WAEHREND eines abgebrochenen Laufs ist
        // ein Abbruch, kein Defekt — sonst kaeme beim Konsumenten die rohe Backend-Meldung
        // an, obwohl er selbst gestoppt hat. Geprueft wird der Zustand des Signals, nicht der
        // Meldungstext: ein Textvergleich braeche bei jeder Uebersetzung und bei jedem
        // Backend, das anders formuliert.
        if (abgebrochen()) return { ok: false, reason: "aborted" };
        return { ok: false, reason: "failed", message: out.message };
      }
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
