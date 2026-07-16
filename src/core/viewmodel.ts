// State → ViewModel als pure Funktion (UI-STANDARD §6). Die View rendert nur das
// ViewModel, trifft keine Entscheidungen.
import { STRINGS } from "./strings";

export type GpuState = "checking" | "ok" | "no-webgpu" | "no-f16";
export type ModelState = { kind: "missing" } | { kind: "downloading"; pct: number } | { kind: "ready" };
export type RunState =
  | { kind: "idle" }
  | { kind: "running"; step: number; total: number }
  | { kind: "error"; message: string };

export interface PanelState {
  gpu: GpuState;
  model: ModelState;
  run: RunState;
  image: { seed: number; dataUrl: string } | null;
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
  if (s.run.kind === "error") status = { icon: "circle-x", text: STRINGS.statusError(s.run.message), cls: "is-error" };
  else if (s.gpu === "no-webgpu") status = { icon: "circle-x", text: STRINGS.statusNoWebgpu, cls: "is-error" };
  else if (s.gpu === "no-f16") status = { icon: "circle-x", text: STRINGS.statusNoF16, cls: "is-error" };
  else if (s.gpu === "checking") status = { icon: "loader", text: STRINGS.statusChecking, cls: "is-checking" };
  else if (s.model.kind === "downloading")
    status = { icon: "loader", text: STRINGS.statusDownloading(s.model.pct), cls: "is-checking" };
  else if (s.run.kind === "running")
    status = { icon: "loader", text: STRINGS.statusGenerating(s.run.step, s.run.total), cls: "is-checking" };
  else status = { icon: "circle-check", text: STRINGS.statusReady, cls: "is-ok" };

  let empty: PanelViewModel["empty"] = null;
  if (gpuBlocked) empty = { text: s.gpu === "no-webgpu" ? STRINGS.statusNoWebgpu : STRINGS.statusNoF16 };
  else if (s.model.kind === "missing") empty = { text: STRINGS.emptyNoModel, ctaLabel: STRINGS.emptyNoModelCta };
  else if (!s.image && s.run.kind !== "running") empty = { text: STRINGS.emptyNoImage };

  return {
    status,
    empty,
    generateEnabled: !gpuBlocked && !busy && s.model.kind === "ready" && s.prompt.trim().length > 0,
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
}
