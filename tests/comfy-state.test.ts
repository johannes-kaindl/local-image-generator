import { describe, expect, it } from "vitest";
import { workflowStateFrom } from "../src/core/comfy/state";

const GUELTIG = JSON.stringify({
  "1": { class_type: "KSampler", inputs: { positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 1, steps: 6 } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
});

describe("workflowStateFrom", () => {
  it("leerer Pfad heisst unconfigured", () => {
    expect(workflowStateFrom("", null).kind).toBe("unconfigured");
  });

  it("Pfad gesetzt, Datei nicht da heisst missing", () => {
    const s = workflowStateFrom("w/flow.json", null);
    expect(s.kind).toBe("missing");
    if (s.kind === "missing") expect(s.path).toBe("w/flow.json");
  });

  it("kaputtes JSON heisst invalid mit Grund json", () => {
    const s = workflowStateFrom("w/flow.json", "{nicht json");
    expect(s.kind).toBe("invalid");
    if (s.kind === "invalid") expect(s.reason.kind).toBe("json");
  });

  it("reicht den InspectError unveraendert durch", () => {
    const s = workflowStateFrom("w/flow.json", JSON.stringify({ "1": { class_type: "X", inputs: {} } }));
    expect(s.kind).toBe("invalid");
    if (s.kind === "invalid") expect(s.reason.kind).toBe("no-sampler");
  });

  it("gueltiger Workflow liefert Slots und das rohe JSON", () => {
    const s = workflowStateFrom("w/flow.json", GUELTIG);
    expect(s.kind).toBe("ok");
    if (s.kind === "ok") {
      expect(s.slots.sampler).toBe("1");
      expect(s.slots.workflowSteps).toBe(6);
      // Das ROHE JSON, nicht das geparste: ComfyClient parst selbst und bekommt so den
      // unveraenderten Graphen des Nutzers, inklusive Felder, die wir nicht kennen.
      expect(s.json).toBe(GUELTIG);
    }
  });
});
