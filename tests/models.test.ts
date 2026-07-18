import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, getModel, MODELS } from "../src/core/models";

describe("model catalog", () => {
  it("kennt genau sd-turbo und flux2-klein-4b", () => {
    expect(MODELS.map((m) => m.id)).toEqual(["sd-turbo", "flux2-klein-4b"]);
  });
  it("sd-turbo: ORT, nur 512², Steps 1–4", () => {
    const m = getModel("sd-turbo");
    expect(m.engine).toBe("ort");
    expect(m.sizes).toEqual([{ width: 512, height: 512 }]);
    expect(m.steps).toEqual({ min: 1, max: 4, default: 4 });
    expect(m.mflux).toBeUndefined();
  });
  it("flux2-klein-4b: mflux, 7 Größen (alle 16er-Vielfache), Steps 1–8", () => {
    const m = getModel("flux2-klein-4b");
    expect(m.engine).toBe("mflux");
    expect(m.steps).toEqual({ min: 1, max: 8, default: 4 });
    expect(m.sizes).toHaveLength(7);
    for (const s of m.sizes) {
      expect(s.width % 16).toBe(0);
      expect(s.height % 16).toBe(0);
    }
    expect(m.mflux).toEqual({ modelArg: "flux2-klein-4b", hfRepo: "black-forest-labs/FLUX.2-klein-4B" });
  });
  it("getModel fällt bei unbekannter ID auf sd-turbo zurück (Sanitizing-Pfad)", () => {
    expect(getModel("garbage").id).toBe(DEFAULT_MODEL_ID);
    expect(getModel("").id).toBe(DEFAULT_MODEL_ID);
  });
});
