// State → ViewModel als pure Funktion (UI-STANDARD §6). Die View rendert nur das
// ViewModel, trifft keine Entscheidungen.
import { t } from "../vendor/kit/i18n";

/** Erreichbarkeit/Konfiguration des A1111-kompatiblen Servers (Spec §3/§4): ersetzt die
 *  alte GPU-/Modell-Download-Maschine — der Thin-Client kennt nur noch "ist ein Endpunkt
 *  eingetragen, antwortet er, und welches Modell hat er gerade geladen". */
export type ServerState =
  | { kind: "unconfigured" }
  | { kind: "checking" }
  | { kind: "ok"; modelName: string | null }
  | { kind: "unreachable" };

export type RunState =
  | { kind: "idle" }
  | { kind: "contacting" }
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
  empty: { text: string; ctaLabel?: string; ctaAction?: "settings" | "recheck" } | null;
  generateEnabled: boolean;
  insertEnabled: boolean;
  showImage: boolean;
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
  return (
    p !== undefined &&
    s.server.kind === "ok" &&
    s.server.modelName !== null &&
    s.server.modelName === p.model &&
    p.prompt === s.prompt &&
    p.negativePrompt === s.negativePrompt &&
    p.seed === s.seed &&
    p.steps === s.steps &&
    p.cfg === s.cfg &&
    p.width === s.width &&
    p.height === s.height
  );
}

export function buildViewModel(s: PanelState): PanelViewModel {
  const busy = s.run.kind === "contacting" || s.run.kind === "generating";

  let status: PanelViewModel["status"];
  if (s.run.kind === "error") status = { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  else if (s.server.kind === "unconfigured")
    status = { icon: "circle-x", text: t("status.noEndpoint"), cls: "is-error" };
  else if (s.server.kind === "checking")
    status = { icon: "loader", text: t("status.serverChecking"), cls: "is-checking" };
  else if (s.server.kind === "unreachable")
    status = { icon: "circle-x", text: t("status.serverUnreachable"), cls: "is-error" };
  else if (s.run.kind === "contacting")
    status = { icon: "loader", text: t("status.contacting"), cls: "is-checking" };
  else if (s.run.kind === "generating")
    status =
      s.run.pct !== null
        ? { icon: "loader", text: t("status.generatingPct", s.run.pct), cls: "is-checking" }
        : { icon: "loader", text: t("status.generatingElapsed", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
  else status = { icon: "circle-check", text: t("status.ready"), cls: "is-ok" };

  let empty: PanelViewModel["empty"] = null;
  if (s.server.kind === "unconfigured")
    empty = { text: t("empty.noServer"), ctaLabel: t("empty.noServerCta"), ctaAction: "settings" };
  else if (s.server.kind === "unreachable")
    empty = { text: t("empty.unreachable"), ctaLabel: t("empty.unreachableCta"), ctaAction: "recheck" };
  else if (!s.image && !busy) empty = { text: t("empty.noImage") };

  return {
    status,
    empty,
    generateEnabled: s.server.kind === "ok" && !busy && s.prompt.trim().length > 0 && !recipeUnchanged(s),
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
}
