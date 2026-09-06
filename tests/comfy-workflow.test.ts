// uebernommen aus yijing-oracle/tests/comfy-workflow.test.ts, 2026-09-06
// (mitsamt tests/fixtures/comfy-sdxl.json, byte-identisch)
import { describe, expect, it } from "vitest";
import { inspectWorkflow, patchWorkflow, type ComfyGraph, type PatchValues } from "../src/core/comfy/workflow";
import sdxl from "./fixtures/comfy-sdxl.json";

const SDXL = sdxl as unknown as ComfyGraph;

/** Tiefe Kopie des Fixtures — die Tests hängen sonst voneinander ab. */
function clone(): ComfyGraph {
  return JSON.parse(JSON.stringify(SDXL)) as ComfyGraph;
}

describe("inspectWorkflow", () => {
  it("findet die Slots im echten SDXL-Graphen", () => {
    const r = inspectWorkflow(SDXL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slots).toEqual({
      sampler: "3", positive: "6", negative: "7", latent: "5",
      seedField: "seed", stepsField: "steps", workflowSteps: 6,
    });
  });

  it("liest noise_seed bei KSamplerAdvanced statt seed anzunehmen", () => {
    const g = clone();
    g["3"] = { class_type: "KSamplerAdvanced", inputs: {
      noise_seed: 1, steps: 20, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } };
    const r = inspectWorkflow(g);
    expect(r.ok && r.slots.seedField).toBe("noise_seed");
  });

  // Vorher (Quelle yijing-oracle) galt ein Sampler ohne Steps-Feld als gueltig mit
  // `stepsField: null` — Spec §4 dreht das um: derselbe Graph wird jetzt ABGEWIESEN,
  // weil das Plugin sonst keinen ehrlichen Wert fuer die Ergebnis-Notiz haette.
  it("weist einen Sampler ohne Steps-Feld ab (SamplerCustom via sigmas)", () => {
    const g = clone();
    g["3"] = { class_type: "SamplerCustom", inputs: {
      noise_seed: 1, sigmas: ["10", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } };
    const r = inspectWorkflow(g);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("no-steps-field");
  });

  it("scheitert bei zwei Samplern statt zu raten", () => {
    const g = clone();
    g["11"] = { class_type: "KSampler", inputs: {
      seed: 1, steps: 5, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } };
    const r = inspectWorkflow(g);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("ambiguous-sampler");
  });

  it("scheitert ohne Sampler", () => {
    const r = inspectWorkflow({ "1": { class_type: "SaveImage", inputs: {} } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("no-sampler");
  });

  it("scheitert bei einem Verweis ins Leere", () => {
    const g = clone();
    g["3"]!.inputs.positive = ["99", 0];
    const r = inspectWorkflow(g);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("dangling-ref");
  });

  it("scheitert bei Nicht-Objekten", () => {
    for (const bad of [null, 42, "x", []]) {
      expect(inspectWorkflow(bad).ok).toBe(false);
    }
  });

  it("weist einen Sampler ohne steps-Feld ab", () => {
    const g = {
      "1": { class_type: "SamplerCustom", inputs: { positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], noise_seed: 1 } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
    };
    const r = inspectWorkflow(g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("no-steps-field");
  });

  it("weist einen Latent-Node ohne Masse ab", () => {
    const g = {
      "1": { class_type: "KSampler", inputs: { positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 1, steps: 20 } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "4": { class_type: "LatentUpscale", inputs: { samples: ["5", 0] } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
    };
    const r = inspectWorkflow(g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("no-size-fields");
  });

  it("liest die eingestellte Schrittzahl aus dem Sampler", () => {
    const g = {
      "1": { class_type: "KSampler", inputs: { positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 1, steps: 6 } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
    };
    const r = inspectWorkflow(g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slots.workflowSteps).toBe(6);
  });

  it("meldet workflowSteps null, wenn der Wert kein Zahlenliteral ist", () => {
    // In ComfyUI kann `steps` ein VERWEIS auf einen anderen Node sein (["9", 0]) statt
    // einer Zahl. Dann ist der Slot patchbar, der Startwert aber unbekannt.
    const g = {
      "1": { class_type: "KSampler", inputs: { positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 1, steps: ["9", 0] } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
      "9": { class_type: "PrimitiveInt", inputs: { value: 6 } },
    };
    const r = inspectWorkflow(g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slots.workflowSteps).toBeNull();
  });
});

const VALUES: PatchValues = {
  prompt: "a mountain lake, ink wash",
  negativePrompt: "text, watermark",
  seed: 4711,
  steps: 8,
  width: 768,
  height: 768,
};

describe("patchWorkflow", () => {
  const slots = { sampler: "3", positive: "6", negative: "7", latent: "5",
                  seedField: "seed" as const, stepsField: "steps" as const, workflowSteps: 6 };

  it("setzt Prompt, Negativ, Seed, Steps und Größe", () => {
    const out = patchWorkflow(SDXL, slots, VALUES);
    expect(out["6"]!.inputs.text).toBe("a mountain lake, ink wash");
    expect(out["7"]!.inputs.text).toBe("text, watermark");
    expect(out["3"]!.inputs.seed).toBe(4711);
    expect(out["3"]!.inputs.steps).toBe(8);
    expect(out["5"]!.inputs.width).toBe(768);
    expect(out["5"]!.inputs.height).toBe(768);
  });

  it("lässt den Eingabe-Graphen unberührt (keine Mutation)", () => {
    const before = JSON.stringify(SDXL);
    patchWorkflow(SDXL, slots, VALUES);
    expect(JSON.stringify(SDXL)).toBe(before);
  });

  it("lässt jeden anderen Node byte-gleich", () => {
    const out = patchWorkflow(SDXL, slots, VALUES);
    for (const id of ["4", "8", "9"]) {
      expect(out[id]).toEqual(SDXL[id]);
    }
    // Am Sampler bleiben die nicht gepatchten Felder stehen:
    expect(out["3"]!.inputs.cfg).toBe(7.0);
    expect(out["3"]!.inputs.sampler_name).toBe("euler");
  });

  // Die beiden Faelle "steps: null" und "stepsField: null" sind entfallen: seit Spec §4
  // ist PatchValues.steps nicht mehr nullable und stepsField immer "steps" — inspectWorkflow
  // weist einen Workflow ohne Steps-Feld ab, bevor patchWorkflow je einen solchen slots-Wert
  // zu sehen bekommt. Ein Test dafuer waere ein Typfehler, kein Verhaltenstest mehr.

  it("schreibt in noise_seed, wenn der Sampler das so nennt", () => {
    const g = clone();
    g["3"]!.inputs = { noise_seed: 1, steps: 20,
      positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] };
    const out = patchWorkflow(g, { ...slots, seedField: "noise_seed" }, VALUES);
    expect(out["3"]!.inputs.noise_seed).toBe(4711);
    expect(out["3"]!.inputs).not.toHaveProperty("seed");
  });

  it("setzt Größe nur, wenn der Latent-Node width/height kennt", () => {
    const g = clone();
    g["5"] = { class_type: "LatentFromBatch", inputs: { samples: ["4", 0] } };
    const out = patchWorkflow(g, slots, VALUES);
    expect(out["5"]!.inputs).not.toHaveProperty("width");
  });
});
