// State → ViewModel als pure Funktion (UI-STANDARD §6). Die View rendert nur das
// ViewModel, trifft keine Entscheidungen.
import { t } from "../vendor/kit/i18n";

export type GpuState = "checking" | "ok" | "no-webgpu" | "no-f16";
export type ModelState = { kind: "missing" } | { kind: "downloading"; pct: number } | { kind: "ready" };
export type RunState =
  | { kind: "idle" }
  | { kind: "running"; step: number; total: number }
  | { kind: "error"; message: string };

/** Die Parameter, aus denen ein Bild entstanden ist — beim Generieren eingefroren, damit
 *  die Ergebnis-Notiz das Bild beschreibt, das man sieht (und nicht den inzwischen
 *  weitergetippten Prompt). */
export interface GenParams {
  prompt: string;
  seed: number;
  steps: number;
  model: string;
  /** Lokaler ISO-8601-Stempel, siehe isoStamp() in filename.ts. */
  date: string;
}

export interface PanelState {
  gpu: GpuState;
  model: ModelState;
  run: RunState;
  image: { dataUrl: string; params: GenParams } | null;
  editorActive: boolean;
  prompt: string;
}

export interface PanelViewModel {
  status: { icon: "loader" | "circle-check" | "circle-x"; text: string; cls: "is-checking" | "is-ok" | "is-error" };
  empty: { text: string; ctaLabel?: string } | null;
  generateEnabled: boolean;
  insertEnabled: boolean;
  showImage: boolean;
}

export function buildViewModel(s: PanelState): PanelViewModel {
  const gpuBlocked = s.gpu === "no-webgpu" || s.gpu === "no-f16";
  const busy = s.run.kind === "running" || s.model.kind === "downloading" || s.gpu === "checking";

  let status: PanelViewModel["status"];
  if (s.run.kind === "error") status = { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  else if (s.gpu === "no-webgpu") status = { icon: "circle-x", text: t("status.noWebgpu"), cls: "is-error" };
  else if (s.gpu === "no-f16") status = { icon: "circle-x", text: t("status.noF16"), cls: "is-error" };
  else if (s.gpu === "checking") status = { icon: "loader", text: t("status.checking"), cls: "is-checking" };
  else if (s.model.kind === "downloading")
    status = { icon: "loader", text: t("status.downloading", s.model.pct), cls: "is-checking" };
  else if (s.run.kind === "running")
    status = { icon: "loader", text: t("status.generating", s.run.step, s.run.total), cls: "is-checking" };
  else status = { icon: "circle-check", text: t("status.ready"), cls: "is-ok" };

  let empty: PanelViewModel["empty"] = null;
  if (gpuBlocked) empty = { text: s.gpu === "no-webgpu" ? t("status.noWebgpu") : t("status.noF16") };
  else if (s.model.kind === "missing") empty = { text: t("empty.noModel"), ctaLabel: t("empty.noModelCta") };
  else if (!s.image && s.run.kind !== "running") empty = { text: t("empty.noImage") };

  return {
    status,
    empty,
    generateEnabled: !gpuBlocked && !busy && s.model.kind === "ready" && s.prompt.trim().length > 0,
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
}
