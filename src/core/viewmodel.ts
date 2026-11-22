// State → ViewModel als pure Funktion (UI-STANDARD §6). Die View rendert nur das
// ViewModel, trifft keine Entscheidungen.
import { getLang, t } from "../vendor/kit/i18n";
import { formatBytes as kitFormatBytes } from "../vendor/kit/format-bytes";
import { backendCapabilities, toBackendContext, type ComfyTask, type SizeOption } from "./generation";
import { filesFor, modelById, totalBytes, type BuiltinModelId } from "./model-manifest";
import { activeEntry, entriesOf, type ActiveWorkflow, type LibraryState, type WorkflowProblem } from "./comfy/library";
import type { EngineChoice } from "./settings";
import { cropEquals, type Crop } from "../vendor/kit/crop";

/** Erreichbarkeit/Konfiguration des A1111-kompatiblen Servers: ersetzt die
 *  alte GPU-/Modell-Download-Maschine — der Thin-Client kennt nur noch "ist ein Endpunkt
 *  eingetragen, antwortet er, und welches Modell hat er gerade geladen". */
export type ServerState =
  | { kind: "unconfigured" }
  | { kind: "checking" }
  | { kind: "ok"; modelName: string | null }
  | { kind: "unreachable" };

/** Zustand der eingebauten Engine — nur im builtin-Modus relevant. Der Weg von
 *  „nichts da" bis „bereit" ist sichtbar gemacht, weil jeder Schritt Minuten dauern kann. */
export type EngineState =
  | { kind: "gpu-checking" }
  | { kind: "gpu-missing"; reason: "no-webgpu" | "no-f16" }
  | { kind: "not-downloaded" }
  | { kind: "downloading"; file: string; received: number; total: number; fileIndex: number; fileCount: number }
  | { kind: "verifying"; file: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export type RunState =
  | { kind: "idle" }
  | { kind: "contacting" }
  /** Weight-Upload + Shader-Compile beim ersten Lauf einer Sitzung — einmalig, minutenlang
   *  möglich; ohne eigene Phase sähe das aus wie ein Hänger (0.2-Backlog Punkt 5). */
  | { kind: "loading-model"; elapsedSec: number }
  | { kind: "generating"; pct: number | null; elapsedSec: number }
  | { kind: "error"; message: string }
  /** Ein Fremdplugin rechnet ueber die Provider-API. Sichtbar, damit das Panel nicht tot
   *  wirkt und die busy-Absage auf den eigenen Klick erklaerbar ist — das Ergebnis landet
   *  aber weder in `image` noch in der Historie. */
  | { kind: "external"; pct: number | null };

/** Die Parameter, aus denen ein Bild entstanden ist — beim Generieren eingefroren, damit
 *  die Ergebnis-Notiz das Bild beschreibt, das man sieht (und nicht den inzwischen
 *  weitergetippten Prompt). */
export interface GenParams {
  prompt: string;
  /** Negativ-Prompt (A1111-kompatibel) — leerer String heißt "nicht gesetzt". */
  negativePrompt: string;
  seed: number;
  steps: number;
  /** Classifier-Free-Guidance-Wert (A1111-kompatibel). **`null` heisst: vom Backend
   *  bestimmt, nicht vom Plugin** — im comfy-Modus fasst `patchWorkflow` das CFG-Feld des
   *  Samplers bewusst nicht an, der Lauf rechnet also mit dem Wert des Nutzer-Workflows.
   *  Eine Zahl hier waere eine Angabe ueber etwas, das dieses Plugin nicht entschieden hat —
   *  dieselbe Erfindung, gegen die die Steps-Abweisung steht. Die Notiz laesst das Feld dann
   *  weg (note.ts), wie bei `denoising` und `negative_prompt`. builtin traegt dagegen eine
   *  ECHTE 1: SD-Turbo ist destilliert und kennt keine Guidance. */
  cfg: number | null;
  model: string;
  width: number;
  height: number;
  /** Lokaler ISO-8601-Stempel, siehe isoStamp() in filename.ts. */
  date: string;
  /** Vault-PFAD der Vorlage — nicht ihre Bytes (die waeren pro Historien-Eintrag ein
   *  Megabyte in data.json). null heisst „keine Vorlage bekannt": entweder txt2img, oder
   *  ein API-Lauf, dessen Bytes gar keine Vault-Datei haben. Ob img2img gerechnet wurde,
   *  sagt `denoising`, nicht dieses Feld. */
  initImage: string | null;
  /** Welcher Bildbereich der Vorlage gerechnet wurde, normalisiert auf [0,1]. `null` = nicht gewaehlt: builtin rechnet zentriert, der Server
   *  entscheidet selbst. Teil des Rezepts wie `initImage`, aber ohne Bilddaten. */
  initCrop: Crop | null;
  /** Nicht-null ⇔ es war ein img2img-Lauf. Nie ein Vorgabewert bei txt2img — das waere
   *  eine Angabe ueber etwas, das nicht stattgefunden hat. */
  denoising: number | null;
  /** ComfyUI-Aufgabe, wenn es kein Erzeugen war. Bei `upscale` sind `prompt`, `negativePrompt`, `seed`, `steps` und
   *  `cfg` KEIN Teil des Rezepts (Hochskalieren hat keine): jeder Schreiber (Notiz, API, Verlauf) verzweigt auf `task`
   *  und gibt sie nicht weiter. */
  task?: "edit" | "upscale";
  /** Dateiname des ComfyUI-Workflows im Workflow-Ordner; fehlt ausserhalb des comfy-Modus. */
  workflow?: string;
}

export interface PanelState {
  /** Welches Backend gerade gilt (settings.engine). Als EngineChoice (nicht nur
   *  "builtin" | "server"), seit es den comfy-Modus gibt. `buildViewModel` verzweigt fuer
   *  comfy inzwischen ausdruecklich (`comfyStatus`/`comfyEmpty`); **offen ist nur noch
   *  `recipeUnchanged`**, das den comfy-Fall weiter in den Server-Vergleich faltet — folgenlos
   *  fuer die Richtigkeit der Notiz, aber `generateEnabled` sperrt dort ein unveraendertes
   *  Rezept nie. Vollstaendige Liste + Schadensbild je Stelle: `.claude/rules/modi-und-main.md`
   *  — "Ein neuer Backend-Modus faellt an rund einem Dutzend Stellen in den else-Zweig". */
  mode: EngineChoice;
  /** Die Workflows des Ordners samt Rolle — der GANZE Zustand, nicht nur der aktive: das ViewModel braucht ihn fuer
   *  Statuszeile, Aufgaben-Schalter und Dropdown, und zwei Quellen fuer dieselbe Sache waeren genau der Drift, gegen
   *  den die eine Haertungsquelle steht. Den aktiven Workflow leitet `comfyActive()` ab. */
  comfyLibrary: LibraryState;
  /** Gewaehlte Aufgabe im comfy-Modus (Laufzeitzustand des Panels, Start: Erzeugen). */
  comfyTask: ComfyTask;
  /** Gewaehlte Datei je Rolle (settings.comfyWorkflowSelection). */
  comfySelection: { txt2img: string; edit: string; upscale: string };
  /** Aenderungsstaerke des Denoise-Reglers, null wenn keine Vorlage gesetzt ist. Liegt im
   *  State (nicht nur im DOM), weil `recipeUnchanged` sie vergleichen muss: derselbe Seed
   *  mit anderer Staerke ergibt ein anderes Bild. */
  denoising: number | null;
  /** Vorlage fuer img2img: Vault-Pfad (fuer Rezept und Notiz) plus dataUrl (fuer das
   *  Vorschaubild UND den naechsten Lauf — die Bytes werden EINMAL gelesen, damit eine
   *  inzwischen geaenderte Datei das Rezept nicht unterlaeuft). null = txt2img. */
  initImage: { path: string; dataUrl: string } | null;
  /** Gewaehlter Ausschnitt der Vorlage (CropModal), null = nicht gewaehlt. Gehoert zur
   *  Vorlage: wird mit ihr gesetzt und geloescht, im Rezept verglichen. */
  initCrop: Crop | null;
  /** Bytes, die dem GEWAEHLTEN Modell noch fehlen — `null`, solange der Cache nicht gemessen
   *  wurde (dann wird die Gesamtgroesse genannt, keine erfundene Teilzahl). Seit 0.11 ist der
   *  Unterschied fuehlbar: eine Bestandsinstallation ist `not-downloaded`, obwohl ihr nur der
   *  VAE-Encoder fehlt. Die Zahl liegt im State, weil nur der Wirt den Cache kennt — die
   *  Rechnung selbst steht einmal in `missingBytes()` (model-manifest.ts). */
  missingBytes: number | null;
  /** Welche eingebauten Modelle vollstaendig im Cache liegen — vom aktiven `mode` unabhaengig,
   *  bezieht sich immer auf alle Eintraege in BUILTIN_MODELS. */
  downloadedModels: BuiltinModelId[];
  /** Das gewaehlte eingebaute Modell (settings.builtinModel) — wie `mode` abgeleitet aus den
   *  Settings, hier aber Teil des States selbst (kein Omit noetig: es lebt nur in Settings,
   *  nicht doppelt in main.ts' internem State). */
  builtinModel: BuiltinModelId;
  /** Will der Nutzer den Modell-Picker ueberhaupt sehen (settings.showModelPicker)? Nur EINE
   *  von zwei unabhaengigen Bedingungen — die zweite ist `downloadedModels.length > 1`. */
  showModelPicker: boolean;
  engine: EngineState;
  server: ServerState;
  /** Kurzbefehl-Name fuers Image-Playground-Backend (settings.playgroundShortcutName) — nur
   *  im playground-Modus relevant, wie `workflow` nur im comfy-Modus. Ein leerer Name ist
   *  "nicht konfiguriert", derselbe Fehlerfall wie ein leerer Server-Endpunkt. */
  playgroundShortcutName: string;
  run: RunState;
  image: { dataUrl: string; params: GenParams } | null;
  editorActive: boolean;
  prompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
}

export interface PanelViewModel {
  status: { icon: "loader" | "circle-check" | "circle-x"; text: string; cls: "is-checking" | "is-ok" | "is-error" };
  /** ctaAction sagt der View, WAS der CTA-Klick auslöst (Settings öffnen vs. Server neu
   *  prüfen) — die View selbst entscheidet nichts, sie liest nur dieses Feld. */
  empty: { text: string; ctaLabel?: string; ctaAction?: "settings" | "recheck" | "download" | "cancel-download" } | null;
  generateEnabled: boolean;
  insertEnabled: boolean;
  showImage: boolean;
  /** Welche Regler der Modus ehrlich anbieten kann (Keine-Attrappen-Linie aus 0.2): SD-Turbo ist
   *  guidance-frei und auf 512² destilliert — Negativ/CFG/Größe wären dort Attrappen. */
  /** Aufgaben-Schalter und Workflow-Wahl — nur im comfy-Modus, sonst null. */
  comfy: {
    tasks: { task: ComfyTask; enabled: boolean; reason: string | null }[];
    task: ComfyTask;
    options: { file: string; label: string }[];
    selected: string | null;
  } | null;
  /** Beschriftung des Hauptknopfs. */
  generateLabel: "generate" | "edit" | "upscale";
  controls: {
    /** Prompt-Feld (Hochskalieren hat keins); `chips` die Stil-Bausteine, nur beim Erzeugen. */
    prompt: boolean;
    chips: boolean;
    /** Vorlage ist Pflicht (Bearbeiten, Hochskalieren): ohne sie bleibt der Knopf gesperrt. */
    initRequired: boolean;
    negative: boolean;
    cfg: boolean;
    size: boolean;
    /** Die Groessen, aus denen bei sichtbarer Groessen-Zeile gewaehlt werden darf — null im
     *  Server-Modus (freie Wahl). `size` haengt an `sizes.length`, nicht am Modellnamen: ein
     *  drittes Modell mit nur einer Groesse braucht dafuer keine neue Fallunterscheidung. */
    sizes: readonly SizeOption[] | null;
    /** Kann das BACKEND ein Ausgangsbild? Steuert die ganze Vorlagen-Zeile. */
    initImage: boolean;
    /** Gibt es ueberhaupt etwas zu aendern? Steuert nur den Denoise-Regler — eine zweite,
     *  unabhaengige Frage: ohne Vorlage bewirkt er nichts und waere eine Attrappe. */
    denoising: boolean;
    /** Zwei unabhaengige Bedingungen wie beim Denoise-Regler: will der Nutzer den Picker
     *  (showModelPicker), UND gibt es ueberhaupt mehr als ein GELADENES Modell zu wechseln.
     *  Nur builtin — der Server waehlt sein Modell selbst. */
    modelPicker: boolean;
    stepsMin: number;
    stepsMax: number;
    /** Nimmt das Backend Steps ueberhaupt entgegen? Bisher gab es nur EINEN gemeinsamen
     *  Bereich (stepsMin/stepsMax) fuer alle Modi — playground ist der erste Modus, der den
     *  Regler nicht nur begrenzt, sondern GANZ ignoriert (der Kurzbefehl kennt kein
     *  Steps-Argument). Ein sichtbarer, bedienbarer Regler ohne Wirkung waere die Attrappe,
     *  gegen die dieses Feld steht (Keine-Attrappen-Linie, wie negative/cfg/size). */
    steps: boolean;
    /** Nimmt das Backend einen Seed entgegen? Steuert Feld UND Wuerfel-Knopf UND „Reroll" —
     *  playground hat weder Determinismus noch Reproduzierbarkeit ueber einen Seed; das Feld
     *  vorzuzeigen behauptete eine Zusage, die der Kurzbefehl nicht einloest. */
    seed: boolean;
  };
  /** Text der Modell-Zeile im Panel. */
  modelLabel: string;
  /** Optionen fuer den Modell-Picker — NUR geladene Modelle: ein Panel-Klick
   *  darf nie einen Download ausloesen. Leer/irrelevant, wenn `controls.modelPicker` false ist. */
  modelOptions: { id: BuiltinModelId; label: string }[];
}

/** Bytes als "812 MB" / "1.7 GB" — für Download-Fortschritt und Modell-Zeile. */
/** Die fehlenden Bytes als Text — oder `null`, wenn sie dem Nutzer nichts Neues sagen und
 *  deshalb die gewoehnliche Gesamtgroessen-Formulierung gilt. Zwei Faelle fuehren zu `null`:
 *  ungemessen (dann waere jede Teilzahl geraten) und ANGEZEIGT gleich der Gesamtgroesse.
 *
 *  Der zweite Fall ist ein Live-Befund vom 2026-09-02 (GUI-Smoke Punkt 13) und kein Detail:
 *  „alles fehlt" ist nie exakt alles — `removeModel()` laesst die ORT-WASM im Cache, also war
 *  `missingBytes` auch bei leerem Modell-Cache echt kleiner als die Summe, und das Panel sagte
 *  „Fehlende 2.6 GB herunterladen". Wahr, und trotzdem irrefuehrend. Verglichen wird deshalb,
 *  was der Nutzer LIEST — ein Zahlenvergleich mit Toleranz waere eine willkuerliche Schwelle.
 *
 *  Steht hier und wird von Panel UND Bestaetigungsdialog (main.ts) benutzt: ein Dialog, der eine
 *  andere Zahl nennt als der Knopf, der ihn geoeffnet hat, sieht wie ein Fehler aus. Dieselbe
 *  Doktrin wie bei `hardenParams` — eine Entscheidung, eine Stelle. */
export function partialDownloadLabel(missingBytes: number | null, totalBytesOfModel: number): string | null {
  if (missingBytes === null) return null;
  const fehlend = formatBytes(missingBytes);
  return fehlend === formatBytes(totalBytesOfModel) ? null : fehlend;
}

/** Dateigroessen in 1000er-Einheiten (B/KB/MB/GB, eine Stelle unter 100) — die Darstellung kommt aus dem Kit; hier nur das Dezimalzeichen der Oberflaechensprache. */
export function formatBytes(n: number): string {
  return kitFormatBytes(n, { decimalSeparator: getLang() === "de" ? "," : "." });
}

/** Sekunden als "m:ss" (kein echter Fortschritt — nur ein Lebensbeweis während der
 *  GPU-Ladephase). */
export function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Prüft, ob Prompt/Negativ-Prompt/Seed/Steps/CFG/Größe UND das aktuell auf dem Server
 *  geladene Modell exakt dem zuletzt erzeugten Bild entsprechen — ein erneuter Klick auf
 *  Generate würde dann byte-identisch dasselbe Bild liefern (deterministischer Seed).
 *  `modelName: null` (Server antwortet, aber ohne beobachtbaren Modellnamen) sperrt NIE
 *  fälschlich: ein unbeobachtbarer Modellwechsel darf Generate nicht blockieren. Reroll ist
 *  davon unabhängig: der würfelt den Seed vorher neu und ist nie an generateEnabled
 *  gebunden (generate-panel.ts). */
/** Der Workflow, mit dem die gewaehlte Aufgabe rechnen wuerde — null ohne gueltigen. */
export function comfyActive(s: Pick<PanelState, "comfyLibrary" | "comfyTask" | "comfySelection">): ActiveWorkflow | null {
  return activeEntry(s.comfyLibrary, s.comfyTask, s.comfySelection[s.comfyTask]);
}

/** comfy: dasselbe Rezept ist dieselbe Aufgabe mit demselben Workflow und denselben Werten, die die Aufgabe nimmt.
 *  CFG und Modellname zaehlen nicht (der Workflow traegt sie), die Groesse nur beim Erzeugen. ComfyUI gaebe fuer ein
 *  unveraendertes Rezept ohnehin das Bild aus seinem Cache zurueck. */
function comfyRecipeUnchanged(s: PanelState): boolean {
  const p = s.image?.params;
  const active = comfyActive(s);
  if (p === undefined || active === null) return false;
  const task = p.task ?? "txt2img";
  if (task !== s.comfyTask || p.workflow !== active.file) return false;
  const sameInit = p.initImage === (s.initImage?.path ?? null) && cropEquals(p.initCrop, s.initCrop);
  if (task === "upscale") return sameInit;
  const sameRecipe = p.prompt === s.prompt && p.seed === s.seed && p.steps === s.steps;
  if (task === "edit") return sameRecipe && sameInit;
  return sameRecipe && p.negativePrompt === s.negativePrompt && p.width === s.width && p.height === s.height;
}

function recipeUnchanged(s: PanelState): boolean {
  if (s.mode === "comfy") return comfyRecipeUnchanged(s);
  const p = s.image?.params;
  // playground faellt bewusst in denselben Zweig wie comfy: `s.server` bleibt fuer
  // playground immer "unconfigured" (kein Server-Konzept), modelUnchanged ist also immer
  // false — derselbe reine UI-Komfortverlust wie bei comfy (AGENTS.md), keine Falschaussage:
  // generateEnabled sperrt ein unveraendertes Rezept dann nie, das Bild bleibt korrekt.
  const modelUnchanged =
    s.mode === "builtin"
      ? p?.model === s.builtinModel
      : s.server.kind === "ok" && s.server.modelName !== null && s.server.modelName === p?.model;
  return (
    p !== undefined &&
    modelUnchanged &&
    p.prompt === s.prompt &&
    p.negativePrompt === s.negativePrompt &&
    p.seed === s.seed &&
    p.steps === s.steps &&
    p.cfg === s.cfg &&
    p.width === s.width &&
    p.height === s.height &&
    // img2img gehoert zum Rezept: derselbe Seed mit einer Vorlage ergibt ein voellig
    // anderes Bild (anderer Endpunkt sogar). Ohne diesen Vergleich bliebe Generate nach
    // dem Setzen einer Vorlage gesperrt — das Feature waere aus dem Panel heraus
    // unbenutzbar, sobald einmal ein Ergebnis dasteht.
    p.denoising === s.denoising &&
    p.initImage === (s.initImage?.path ?? null) &&
    cropEquals(p.initCrop, s.initCrop)
  );
}

function serverStatus(s: PanelState): PanelViewModel["status"] {
  if (s.run.kind === "error") return { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  if (s.server.kind === "unconfigured") return { icon: "circle-x", text: t("status.noEndpoint"), cls: "is-error" };
  if (s.server.kind === "checking") return { icon: "loader", text: t("status.serverChecking"), cls: "is-checking" };
  if (s.server.kind === "unreachable") return { icon: "circle-x", text: t("status.serverUnreachable"), cls: "is-error" };
  return runStatus(s);
}

/** Im comfy-Modus gibt es ZWEI Bedingungen. Der Workflow wird zuerst gemeldet, weil er der
 *  naeher liegende Fehler ist: einen Server startet man einmal, einen Workflow legt man
 *  fuer diese Aufgabe hin. Der Server kommt danach, mit denselben Meldungen wie im
 *  A1111-Modus — er ist derselbe Zustand. */
function comfyStatus(s: PanelState): PanelViewModel["status"] {
  const lib = s.comfyLibrary;
  if (lib.kind === "unconfigured") return { icon: "circle-x", text: t("status.noWorkflow"), cls: "is-error" };
  if (lib.kind === "missing") return { icon: "circle-x", text: t("status.workflowFolderMissing", lib.folder), cls: "is-error" };
  if (comfyActive(s) === null) {
    // Ist die gewaehlte Datei (oder die einzige im Ordner) ungueltig, sagt der Grund mehr als „kein gueltiger
    // Workflow“: der Nutzer soll wissen, WAS er an seinem Graphen aendern muss.
    const named = lib.entries.find((e) => e.file === s.comfySelection[s.comfyTask]) ?? (lib.entries.length === 1 ? lib.entries[0] : undefined);
    if (named !== undefined && named.classified.role === null) {
      return { icon: "circle-x", text: `${named.file}: ${workflowProblemText(named.classified.error)}`, cls: "is-error" };
    }
    return { icon: "circle-x", text: t("comfy.task.none", t(`workflow.role.${s.comfyTask}`)), cls: "is-error" };
  }
  // Die gewaehlte Datei rechnet nicht (geloescht, umbenannt, ungueltig geworden, oder ein zurueckgeladenes Rezept nennt
  // einen Workflow, den es nicht mehr gibt): die Auswahl faellt auf die erste gueltige zurueck, und das soll man sehen —
  // sonst rechnet ein anderer Workflow, als man erwartet, und nur das Dropdown verraet es.
  const gewaehlt = s.comfySelection[s.comfyTask];
  const aktiv = comfyActive(s);
  if (gewaehlt !== "" && aktiv !== null && aktiv.file !== gewaehlt && s.run.kind !== "error") {
    return { icon: "circle-x", text: t("comfy.selectionFallback", gewaehlt, aktiv.file), cls: "is-error" };
  }
  // Der SERVER-Teil bekommt eigene Saetze, obwohl der Zustand derselbe ist: der Endpunkt ist
  // zwischen Server- und comfy-Modus GETEILT. Wer umstellt, behaelt seinen A1111-Endpunkt —
  // der Statuscheck ist dann zu Recht streng, aber „ist die API aktiviert?" schickt den
  // Nutzer auf die falsche Fehlersuche: der Server antwortet, er ist nur der falsche.
  // Ein Laufzeitfehler bleibt vorn (wie in serverStatus), sonst verdeckte die
  // Endpunkt-Meldung die konkrete Fehlermeldung des letzten Laufs.
  if (s.run.kind !== "error") {
    if (s.server.kind === "unconfigured") return { icon: "circle-x", text: t("status.noComfyEndpoint"), cls: "is-error" };
    if (s.server.kind === "unreachable") return { icon: "circle-x", text: t("status.comfyUnreachable"), cls: "is-error" };
  }
  return serverStatus(s);
}

/** Ein Satz je Ausgang, kein generisches "Workflow ungueltig": der Nutzer soll wissen,
 *  WAS er an seinem Graphen aendern muss. */
export function workflowProblemText(p: WorkflowProblem): string {
  switch (p.kind) {
    case "json": return t("workflow.err.json");
    case "not-an-object": return t("workflow.err.notAnObject");
    case "no-sampler": return t("workflow.err.noSampler");
    case "ambiguous-sampler": return t("workflow.err.ambiguous", p.ids.join(", "));
    case "dangling-ref": return t("workflow.err.dangling", p.field, p.id);
    case "no-steps-field": return t("workflow.err.noSteps");
    case "no-size-fields": return t("workflow.err.noSize");
    case "ambiguous-image-input": return t("workflow.err.ambiguousImage", p.ids.join(", "));
    case "img2img-unsupported": return t("workflow.err.img2img");
    case "controlnet-unsupported": return t("workflow.err.controlnet");
    case "image-not-in-latent": return t("workflow.err.imageNotInLatent");
    case "no-prompt-node": return t("workflow.err.noPrompt");
    case "ambiguous-prompt-node": return t("workflow.err.ambiguousPrompt", p.ids.join(", "));
    case "no-upscaler": return t("workflow.err.noUpscaler");
  }
}

/** Wie bei der Statuszeile: fehlt/ist ungueltig der Workflow, ist das der naeher liegende
 *  Fehler und bekommt den Settings-CTA — ein erreichbarer, aber falsch konfigurierter
 *  Server waere hier die falsche Anlaufstelle. Steht der Workflow, gilt derselbe
 *  Leerzustand wie im Server-Modus. */
function comfyEmpty(s: PanelState, busy: boolean): PanelViewModel["empty"] {
  if (comfyActive(s) === null) {
    return { text: t("empty.noWorkflow"), ctaLabel: t("empty.noWorkflowCta"), ctaAction: "settings" };
  }
  // Eigene Texte aus demselben Grund wie in comfyStatus: der Server-Leerzustand schickte den
  // ComfyUI-Nutzer an genau der Stelle, an der er Hilfe braucht, zu Draw Things — und nannte
  // ComfyUIs Standard-Port nirgends. CTA und Aktion bleiben dieselben.
  if (s.server.kind === "unconfigured")
    return { text: t("empty.noComfyServer"), ctaLabel: t("empty.noServerCta"), ctaAction: "settings" };
  if (s.server.kind === "unreachable")
    return { text: t("empty.comfyUnreachable"), ctaLabel: t("empty.unreachableCta"), ctaAction: "recheck" };
  return serverEmpty(s, busy);
}

function engineStatus(s: PanelState): PanelViewModel["status"] {
  if (s.run.kind === "error") return { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  const e = s.engine;
  if (e.kind === "gpu-checking") return { icon: "loader", text: t("status.gpuChecking"), cls: "is-checking" };
  if (e.kind === "gpu-missing")
    return { icon: "circle-x", text: e.reason === "no-webgpu" ? t("status.gpuMissing.noWebgpu") : t("status.gpuMissing.noF16"), cls: "is-error" };
  if (e.kind === "error") return { icon: "circle-x", text: t("status.error", e.message), cls: "is-error" };
  if (e.kind === "not-downloaded") return { icon: "circle-x", text: t("status.notDownloaded"), cls: "is-error" };
  if (e.kind === "downloading")
    return { icon: "loader", text: t("status.downloading", e.file, formatBytes(e.received), formatBytes(e.total), String(e.fileIndex), String(e.fileCount)), cls: "is-checking" };
  if (e.kind === "verifying") return { icon: "loader", text: t("status.verifying", e.file), cls: "is-checking" };
  // „Server wird kontaktiert" wäre hier eine Lüge — die Engine startet lokal.
  if (s.run.kind === "contacting") return { icon: "loader", text: t("status.starting"), cls: "is-checking" };
  return runStatus(s);
}

function runStatus(s: PanelState): PanelViewModel["status"] {
  if (s.run.kind === "contacting") return { icon: "loader", text: t("status.contacting"), cls: "is-checking" };
  if (s.run.kind === "loading-model") return { icon: "loader", text: t("status.loadingModel", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
  if (s.run.kind === "generating")
    return s.run.pct !== null
      ? { icon: "loader", text: t("status.generatingPct", s.run.pct), cls: "is-checking" }
      : { icon: "loader", text: t("status.generatingElapsed", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
  if (s.run.kind === "external")
    return s.run.pct !== null
      ? { icon: "loader", text: t("status.externalRunPct", s.run.pct), cls: "is-checking" }
      : { icon: "loader", text: t("status.externalRun"), cls: "is-checking" };
  return { icon: "circle-check", text: t("status.ready"), cls: "is-ok" };
}

/** Image Playground braucht weder Server noch Workflow — nur einen Kurzbefehl-Namen
 *  (Settings). Ein leerer Name ist derselbe Fehlerfall wie ein leerer Endpunkt im
 *  Server-Modus: "nicht konfiguriert", kein Laufzeitfehler. */
function playgroundStatus(s: PanelState): PanelViewModel["status"] {
  if (s.run.kind === "error") return { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  if (s.playgroundShortcutName.trim() === "") return { icon: "circle-x", text: t("status.noShortcut"), cls: "is-error" };
  return runStatus(s);
}

function playgroundEmpty(s: PanelState, busy: boolean): PanelViewModel["empty"] {
  if (s.playgroundShortcutName.trim() === "")
    return { text: t("empty.noShortcut"), ctaLabel: t("empty.noShortcutCta"), ctaAction: "settings" };
  if (!s.image && !busy) return { text: t("empty.noImage") };
  return null;
}

function serverEmpty(s: PanelState, busy: boolean): PanelViewModel["empty"] {
  if (s.server.kind === "unconfigured") return { text: t("empty.noServer"), ctaLabel: t("empty.noServerCta"), ctaAction: "settings" };
  if (s.server.kind === "unreachable") return { text: t("empty.unreachable"), ctaLabel: t("empty.unreachableCta"), ctaAction: "recheck" };
  if (!s.image && !busy) return { text: t("empty.noImage") };
  return null;
}

function engineEmpty(s: PanelState, busy: boolean): PanelViewModel["empty"] {
  const e = s.engine;
  if (e.kind === "gpu-missing") return { text: t("empty.gpuMissing"), ctaLabel: t("empty.noServerCta"), ctaAction: "settings" };
  if (e.kind === "not-downloaded" || e.kind === "error") {
    // Review-Befund: `allAssets()` liefert IMMER das Default-Modell (sd-turbo) — mit
    // SDXL-Turbo gewaehlt und nicht gecacht zeigte die Zeile dessen 2,5 GB, laed aber
    // tatsaechlich 6,4 GB. `assetsFor(s.builtinModel)` traegt keine Runtime-WASM
    // (Vertrag von assetsFor, siehe AGENTS.md), die haengt jeder Aufrufer selbst an.
    const model = modelById(s.builtinModel);
    const gesamt = totalBytes(filesFor(s.builtinModel));
    const size = formatBytes(gesamt);
    const fehlend = partialDownloadLabel(s.missingBytes, gesamt);
    if (fehlend !== null) {
      return {
        text: t("empty.notDownloadedPartial", model.label, fehlend, size),
        ctaLabel: t("empty.downloadCtaPartial", fehlend),
        ctaAction: "download",
      };
    }
    return {
      text: t("empty.notDownloaded", model.label, size),
      ctaLabel: t("empty.downloadCta", size),
      ctaAction: "download",
    };
  }
  if (e.kind === "downloading" || e.kind === "verifying")
    return { text: t("empty.downloading"), ctaLabel: t("empty.cancelCta"), ctaAction: "cancel-download" };
  if (e.kind === "ready" && !s.image && !busy) return { text: t("empty.noImage") };
  return null;
}

export function buildViewModel(s: PanelState): PanelViewModel {
  const busy = s.run.kind === "contacting" || s.run.kind === "generating"
    || s.run.kind === "loading-model" || s.run.kind === "external";
  const builtin = s.mode === "builtin";
  const comfy = s.mode === "comfy";
  const playground = s.mode === "playground";
  const backendReady = builtin
    ? s.engine.kind === "ready"
    : playground
      ? s.playgroundShortcutName.trim() !== ""
      : s.server.kind === "ok" && (!comfy || comfyActive(s) !== null);
  const task: ComfyTask = comfy ? s.comfyTask : "txt2img";
  const caps = backendCapabilities(toBackendContext(s.mode, s.builtinModel, { task, workflow: comfy ? comfyActive(s) : null }));
  // Pflichten der Aufgabe: ein Prompt nur, wo es einen gibt, eine Vorlage, wo sie Pflicht ist.
  const inputsReady = (!caps.prompt || s.prompt.trim().length > 0) && (!caps.initRequired || s.initImage !== null);

  const status = builtin ? engineStatus(s) : playground ? playgroundStatus(s) : comfy ? comfyStatus(s) : serverStatus(s);
  const empty = builtin ? engineEmpty(s, busy) : playground ? playgroundEmpty(s, busy) : comfy ? comfyEmpty(s, busy) : serverEmpty(s, busy);

  const modelLabel = builtin
    ? t("generate.modelBuiltin", modelById(s.builtinModel).label)
    : playground
      ? t("generate.modelPlayground")
      : s.server.kind === "ok" && s.server.modelName !== null
        ? t("generate.modelInfo", s.server.modelName)
        : t("generate.modelInApp");

  return {
    status,
    empty,
    generateEnabled: backendReady && !busy && inputsReady && !recipeUnchanged(s),
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
    comfy: comfy ? comfyChoice(s) : null,
    generateLabel: task === "txt2img" ? "generate" : task,
    controls: {
      prompt: caps.prompt,
      chips: caps.prompt && task === "txt2img",
      initRequired: caps.initRequired,
      negative: caps.negativePrompt,
      cfg: caps.cfg,
      // Sichtbar, sobald es etwas zu WAEHLEN gibt — nicht „ist es Modell X".
      size: caps.size,
      sizes: caps.sizes,
      initImage: caps.initImage,
      denoising: caps.denoising && s.initImage !== null,
      // Zwei unabhaengige Bedingungen, wie beim Denoise-Regler: will der Nutzer ihn, UND
      // gibt es mindestens zwei GELADENE Modelle zu wechseln.
      modelPicker: builtin && s.showModelPicker && s.downloadedModels.length > 1,
      stepsMin: caps.minSteps,
      stepsMax: caps.maxSteps,
      // Bisher hing an KEINEM Modus ein eigenes Signal fuer Steps/Seed — der Regler war immer
      // sichtbar, nur sein Bereich (stepsMin/stepsMax) wechselte. playground ist der erste
      // Modus, der beides gar nicht entgegennimmt (Abnahme-Befund Welle 13).
      steps: caps.steps,
      seed: caps.seed,
    },
    modelLabel,
    modelOptions: s.downloadedModels.map((id) => ({ id, label: modelById(id).label })),
  };
}

const TASKS: readonly ComfyTask[] = ["txt2img", "edit", "upscale"];

/** Aufgaben-Schalter und Dropdown. Gleiche Anzeigenamen (`a.json`, `a.api.json`) bekommen den Dateinamen, damit zwei
 *  Eintraege nie gleich aussehen. */
function comfyChoice(s: PanelState): NonNullable<PanelViewModel["comfy"]> {
  const tasks = TASKS.map((task) => {
    const enabled = activeEntry(s.comfyLibrary, task, s.comfySelection[task]) !== null;
    return { task, enabled, reason: enabled ? null : t("comfy.task.none", t(`workflow.role.${task}`)) };
  });
  const entries = entriesOf(s.comfyLibrary, s.comfyTask);
  const names = entries.map((e) => e.name);
  const options = entries.map((e) => ({
    file: e.file,
    label: names.indexOf(e.name) !== names.lastIndexOf(e.name) ? e.file : e.name,
  }));
  return { tasks, task: s.comfyTask, options, selected: comfyActive(s)?.file ?? null };
}
