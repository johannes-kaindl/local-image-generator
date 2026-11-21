import { describe, expect, it } from "vitest";
import {
  classifyWorkflow,
  inspectWorkflow,
  patchEdit,
  patchUpscale,
  type ComfyGraph,
  type EditSlots,
  type UpscaleSlots,
} from "../src/core/comfy/workflow";
import flux3 from "../comfy/workflows/flux3-klein.api.json";
import sdxlBase from "../comfy/workflows/sdxl-base.api.json";
import sdxlPixel from "../comfy/workflows/sdxl-pixel-art.api.json";
import flux3Edit from "../comfy/workflows/flux3-klein-edit.api.json";
import upscale from "../comfy/workflows/upscale-4x-ultrasharp.api.json";
import img2img from "./fixtures/comfy/sdxl_img2img_api.json";
import controlnet from "./fixtures/comfy/sdxl_controlnet_canny_api.json";

const g = (x: unknown): ComfyGraph => JSON.parse(JSON.stringify(x)) as ComfyGraph;

describe("classifyWorkflow — die Referenz-Workflows", () => {
  it.each([
    ["flux3-klein", flux3],
    ["sdxl-base", sdxlBase],
    ["sdxl-pixel-art", sdxlPixel],
  ])("%s ist ein Erzeugen-Workflow mit denselben Slots wie inspectWorkflow", (_n, wf) => {
    const c = classifyWorkflow(g(wf));
    const inspected = inspectWorkflow(g(wf));
    expect(inspected.ok).toBe(true);
    expect(c).toEqual({ role: "txt2img", slots: inspected.ok ? inspected.slots : null });
  });

  it("flux3-klein-edit ist ein Bearbeiten-Workflow", () => {
    expect(classifyWorkflow(g(flux3Edit))).toEqual({
      role: "edit",
      slots: { image: "11", sampler: "7", prompt: "4", seedField: "seed", stepsField: "steps", workflowSteps: 16 },
    });
  });

  it("upscale-4x-ultrasharp ist ein Hochskalieren-Workflow mit Zwischenskalierung", () => {
    expect(classifyWorkflow(g(upscale))).toEqual({ role: "upscale", slots: { image: "1", prescale: "6" } });
  });

  it("ein Upscale ohne ImageScale davor wird angenommen, prescale ist null", () => {
    const wf = g(upscale);
    delete wf["6"];
    wf["3"]!.inputs.image = ["1", 0];
    expect(classifyWorkflow(wf)).toEqual({ role: "upscale", slots: { image: "1", prescale: null } });
  });
});

describe("classifyWorkflow — Abweisungen", () => {
  it("SDXL-img2img (Bild per VAEEncode in den Latent) wird abgewiesen", () => {
    expect(classifyWorkflow(g(img2img))).toEqual({ role: null, error: { kind: "img2img-unsupported" } });
  });

  it("ControlNet wird abgewiesen, nicht als Bearbeiten erkannt", () => {
    expect(classifyWorkflow(g(controlnet))).toEqual({ role: null, error: { kind: "controlnet-unsupported" } });
  });

  it("zwei Bild-Eingänge sind mehrdeutig", () => {
    const wf = g(flux3Edit);
    wf["99"] = { class_type: "LoadImage", inputs: { image: "b.png" } };
    expect(classifyWorkflow(wf)).toEqual({ role: null, error: { kind: "ambiguous-image-input", ids: ["11", "99"] } });
  });

  it("ein Edit mit eigenem Negativ-Text ist mehrdeutig (beide Texte sind über den Referenz-Knoten erreichbar)", () => {
    const wf = g(flux3Edit);
    wf["40"] = { class_type: "CLIPTextEncode", inputs: { text: "blurry", clip: ["2", 0] } };
    wf["17"]!.inputs.negative = ["40", 0];
    expect(classifyWorkflow(wf)).toEqual({ role: null, error: { kind: "ambiguous-prompt-node", ids: ["4", "40"] } });
  });

  it("ein Edit ohne Text-Knoten hat keinen Prompt-Slot", () => {
    const wf = g(flux3Edit);
    wf["4"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["32", 0] } };
    wf["32"] = { class_type: "Foo", inputs: { clip: ["2", 0] } };
    expect(classifyWorkflow(wf)).toEqual({ role: null, error: { kind: "no-prompt-node" } });
  });

  it("ein Edit ohne Steps wird abgewiesen", () => {
    const wf = g(flux3Edit);
    delete wf["7"]!.inputs.steps;
    expect(classifyWorkflow(wf)).toEqual({ role: null, error: { kind: "no-steps-field" } });
  });

  it("Bild-Eingang und Sampler, aber der Latent kommt nicht aus dem Bild", () => {
    const wf = g(flux3Edit);
    wf["44"] = { class_type: "EmptyFlux2LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } };
    wf["7"]!.inputs.latent_image = ["44", 0];
    expect(classifyWorkflow(wf)).toEqual({ role: null, error: { kind: "image-not-in-latent" } });
  });

  it("Bild-Eingang ohne Sampler und ohne Upscale-Modell", () => {
    const wf = g(upscale);
    delete wf["2"];
    delete wf["3"];
    wf["4"]!.inputs.image = ["6", 0];
    expect(classifyWorkflow(wf)).toEqual({ role: null, error: { kind: "no-upscaler" } });
  });

  it("ohne Bild-Eingang gelten die Gründe von inspectWorkflow", () => {
    expect(classifyWorkflow([])).toEqual({ role: null, error: { kind: "not-an-object" } });
    expect(classifyWorkflow({})).toEqual({ role: null, error: { kind: "no-sampler" } });
  });

  it("ein LoadImage mit verlinktem Eingang ist kein Bild-Eingang", () => {
    const wf = g(sdxlBase);
    wf["90"] = { class_type: "LoadImage", inputs: { image: ["1", 0] } };
    expect(classifyWorkflow(wf).role).toBe("txt2img");
  });
});

describe("patchEdit / patchUpscale", () => {
  const editSlots: EditSlots = { image: "11", sampler: "7", prompt: "4", seedField: "seed", stepsField: "steps", workflowSteps: 16 };

  it("patchEdit setzt Anweisung, Seed, Steps und Bildnamen in eine Kopie, sonst nichts", () => {
    const wf = g(flux3Edit);
    const before = JSON.stringify(wf);
    const out = patchEdit(wf, editSlots, { prompt: "make it rain", seed: 7, steps: 12, imageName: "lig-abc.png" });
    expect(JSON.stringify(wf)).toBe(before);
    expect(out["4"]!.inputs.text).toBe("make it rain");
    expect(out["7"]!.inputs.seed).toBe(7);
    expect(out["7"]!.inputs.steps).toBe(12);
    expect(out["11"]!.inputs.image).toBe("lig-abc.png");
    const rest = (x: ComfyGraph): ComfyGraph => {
      const c = g(x);
      delete c["4"]!.inputs.text;
      delete c["7"]!.inputs.seed;
      delete c["7"]!.inputs.steps;
      delete c["11"]!.inputs.image;
      return c;
    };
    expect(rest(out)).toEqual(rest(wf));
  });

  it("patchUpscale setzt Bildnamen und Maße der Zwischenskalierung", () => {
    const slots: UpscaleSlots = { image: "1", prescale: "6" };
    const wf = g(upscale);
    const out = patchUpscale(wf, slots, { imageName: "lig-x.png", width: 640, height: 480 });
    expect(out["1"]!.inputs.image).toBe("lig-x.png");
    expect(out["6"]!.inputs.width).toBe(640);
    expect(out["6"]!.inputs.height).toBe(480);
    expect(wf["6"]!.inputs.width).toBe(1344);
  });

  it("patchUpscale ohne Zwischenskalierung setzt nur den Bildnamen", () => {
    const wf = g(upscale);
    delete wf["6"];
    wf["3"]!.inputs.image = ["1", 0];
    const out = patchUpscale(wf, { image: "1", prescale: null }, { imageName: "lig-x.png", width: 640, height: 480 });
    expect(out["1"]!.inputs.image).toBe("lig-x.png");
    expect(JSON.stringify(out).includes("640")).toBe(false);
  });
});
