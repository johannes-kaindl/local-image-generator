// State → ViewModel als pure Funktion (UI-STANDARD §6). Die View rendert nur das
// ViewModel, trifft keine Entscheidungen.
import { t } from "../vendor/kit/i18n";
import { STEPS } from "./generation";
import { BUILTIN_MODEL } from "./model-manifest";

/** Erreichbarkeit/Konfiguration des A1111-kompatiblen Servers (Spec §3/§4): ersetzt die
 *  alte GPU-/Modell-Download-Maschine — der Thin-Client kennt nur noch "ist ein Endpunkt
 *  eingetragen, antwortet er, und welches Modell hat er gerade geladen". */
export type ServerState =
  | { kind: "unconfigured" }
  | { kind: "checking" }
  | { kind: "ok"; modelName: string | null }
  | { kind: "unreachable" };

/** Zustand der eingebauten Engine (Spec 0.6 §2) — nur im builtin-Modus relevant. Der Weg von
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
  | { kind: "error"; message: string };

/** Die Parameter, aus denen ein Bild entstanden ist — beim Generieren eingefroren, damit
 *  die Ergebnis-Notiz das Bild beschreibt, das man sieht (und nicht den inzwischen
 *  weitergetippten Prompt). */
export interface GenParams {
  prompt: string;
  /** Negativ-Prompt (A1111-kompatibel) — leerer String heißt "nicht gesetzt" (Spec §5). */
  negativePrompt: string;
  seed: number;
  steps: number;
  /** Classifier-Free-Guidance-Wert (A1111-kompatibel, Spec §5). */
  cfg: number;
  model: string;
  width: number;
  height: number;
  /** Lokaler ISO-8601-Stempel, siehe isoStamp() in filename.ts. */
  date: string;
}

export interface PanelState {
  /** Welches Backend gerade gilt (settings.engine). */
  mode: "builtin" | "server";
  engine: EngineState;
  server: ServerState;
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
  controls: { negative: boolean; cfg: boolean; size: boolean; stepsMin: number; stepsMax: number };
  /** Text der Modell-Zeile im Panel. */
  modelLabel: string;
}

/** Bytes als "812 MB" / "1.7 GB" — für Download-Fortschritt und Modell-Zeile. */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

/** Sekunden als "m:ss" (kein echter Fortschritt — nur ein Lebensbeweis während der
 *  GPU-Ladephase, siehe Spec 2026-07-18-robustheits-block-design.md §2.3). */
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
function recipeUnchanged(s: PanelState): boolean {
  const p = s.image?.params;
  const modelUnchanged =
    s.mode === "builtin"
      ? p?.model === BUILTIN_MODEL.id
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
    p.height === s.height
  );
}

function serverStatus(s: PanelState): PanelViewModel["status"] {
  if (s.run.kind === "error") return { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  if (s.server.kind === "unconfigured") return { icon: "circle-x", text: t("status.noEndpoint"), cls: "is-error" };
  if (s.server.kind === "checking") return { icon: "loader", text: t("status.serverChecking"), cls: "is-checking" };
  if (s.server.kind === "unreachable") return { icon: "circle-x", text: t("status.serverUnreachable"), cls: "is-error" };
  return runStatus(s);
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
  return runStatus(s);
}

function runStatus(s: PanelState): PanelViewModel["status"] {
  if (s.run.kind === "contacting") return { icon: "loader", text: t("status.contacting"), cls: "is-checking" };
  if (s.run.kind === "loading-model") return { icon: "loader", text: t("status.loadingModel", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
  if (s.run.kind === "generating")
    return s.run.pct !== null
      ? { icon: "loader", text: t("status.generatingPct", s.run.pct), cls: "is-checking" }
      : { icon: "loader", text: t("status.generatingElapsed", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
  return { icon: "circle-check", text: t("status.ready"), cls: "is-ok" };
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
  if (e.kind === "not-downloaded" || e.kind === "error")
    return { text: t("empty.notDownloaded"), ctaLabel: t("empty.downloadCta"), ctaAction: "download" };
  if (e.kind === "downloading" || e.kind === "verifying")
    return { text: t("empty.downloading"), ctaLabel: t("empty.cancelCta"), ctaAction: "cancel-download" };
  if (e.kind === "ready" && !s.image && !busy) return { text: t("empty.noImage") };
  return null;
}

export function buildViewModel(s: PanelState): PanelViewModel {
  const busy = s.run.kind === "contacting" || s.run.kind === "generating" || s.run.kind === "loading-model";
  const builtin = s.mode === "builtin";
  const backendReady = builtin ? s.engine.kind === "ready" : s.server.kind === "ok";

  const status = builtin ? engineStatus(s) : serverStatus(s);
  const empty = builtin ? engineEmpty(s, busy) : serverEmpty(s, busy);

  const modelLabel = builtin
    ? t("generate.modelBuiltin", BUILTIN_MODEL.label)
    : s.server.kind === "ok" && s.server.modelName !== null
      ? t("generate.modelInfo", s.server.modelName)
      : t("generate.modelInApp");

  return {
    status,
    empty,
    generateEnabled: backendReady && !busy && s.prompt.trim().length > 0 && !recipeUnchanged(s),
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
    controls: builtin
      ? { negative: false, cfg: false, size: false, stepsMin: BUILTIN_MODEL.steps.min, stepsMax: BUILTIN_MODEL.steps.max }
      : { negative: true, cfg: true, size: true, stepsMin: STEPS.min, stepsMax: STEPS.max },
    modelLabel,
  };
}
