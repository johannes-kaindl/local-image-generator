// Zustand des hinterlegten ComfyUI-Workflows — pure. Symmetrisch zu EngineState fuer den
// builtin-Modus: der Weg von "nichts hinterlegt" bis "bereit" ist sichtbar gemacht, weil
// jeder Zwischenschritt eine eigene Handlungsaufforderung braucht.
import { inspectWorkflow, type InspectError, type WorkflowSlots } from "./workflow";

export type WorkflowProblem = { kind: "json" } | InspectError;

export type WorkflowState =
  | { kind: "unconfigured" }
  | { kind: "missing"; path: string }
  | { kind: "invalid"; path: string; reason: WorkflowProblem }
  | { kind: "ok"; path: string; slots: WorkflowSlots; json: string };

/** `raw` ist der Dateiinhalt oder null, wenn die Datei nicht existiert. Das Lesen selbst
 *  passiert im Wirt (main.ts) — hier wird nur geurteilt, damit der Fall ohne Vault
 *  testbar bleibt. */
export function workflowStateFrom(path: string, raw: string | null): WorkflowState {
  if (path.trim() === "") return { kind: "unconfigured" };
  if (raw === null) return { kind: "missing", path };

  let graph: unknown;
  try {
    graph = JSON.parse(raw);
  } catch {
    return { kind: "invalid", path, reason: { kind: "json" } };
  }

  const inspected = inspectWorkflow(graph);
  if (!inspected.ok) return { kind: "invalid", path, reason: inspected.error };

  // Das ROHE JSON wird mitgefuehrt, nicht der geparste Graph: ComfyClient parst selbst und
  // arbeitet dann auf dem unveraenderten Graphen des Nutzers.
  return { kind: "ok", path, slots: inspected.slots, json: raw };
}

/** Die Slots fuer den Capabilities-Kontext — null in jedem nicht-fertigen Zustand. */
export function slotsOf(s: WorkflowState): WorkflowSlots | null {
  return s.kind === "ok" ? s.slots : null;
}
