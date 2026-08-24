import { describe, expect, it } from "vitest";
import { backendCapabilities, CFG, DEFAULT_SIZE, SIZES, STEPS } from "../src/core/generation";
import { BUILTIN_MODEL } from "../src/core/model-manifest";

describe("generation constants (Spec §4)", () => {
  it("SIZES enthält 7 Einträge", () => {
    expect(SIZES).toHaveLength(7);
  });

  it("alle SIZES-Werte sind Vielfache von 16", () => {
    for (const s of SIZES) {
      expect(s.width % 16).toBe(0);
      expect(s.height % 16).toBe(0);
    }
  });

  it("DEFAULT_SIZE ist der erste Eintrag aus SIZES", () => {
    expect(DEFAULT_SIZE).toEqual(SIZES[0]);
  });

  it("STEPS-Grenzen", () => {
    expect(STEPS.min).toBe(1);
    expect(STEPS.max).toBe(50);
    expect(STEPS.default).toBe(20);
  });

  it("CFG-Grenzen", () => {
    expect(CFG.min).toBe(1);
    expect(CFG.max).toBe(15);
    expect(CFG.step).toBe(0.5);
    expect(CFG.default).toBe(7);
  });
});

describe("backendCapabilities", () => {
  it("builtin ist guidance-frei, auf 512² und auf wenige Steps begrenzt", () => {
    expect(backendCapabilities("builtin")).toEqual({
      negativePrompt: false,
      cfg: false,
      initImage: false,
      minSteps: BUILTIN_MODEL.steps.min,
      maxSteps: BUILTIN_MODEL.steps.max,
      fixedSize: BUILTIN_MODEL.sizes[0],
      sizes: BUILTIN_MODEL.sizes,
    });
  });
  it("server kann alles, was das Panel anbietet", () => {
    expect(backendCapabilities("server")).toEqual({
      negativePrompt: true, cfg: true, initImage: true, minSteps: STEPS.min, maxSteps: STEPS.max,
      fixedSize: null, sizes: null,
    });
  });
});

describe("backendCapabilities pro Modell (Spec 0.9 §6.3)", () => {
  it("sd-turbo: eine feste Groesse, sizes hat einen Eintrag", () => {
    const c = backendCapabilities("builtin", "sd-turbo");
    expect(c.fixedSize).toEqual({ width: 512, height: 512 });
    expect(c.sizes).toEqual([{ width: 512, height: 512 }]);
    expect(c.maxSteps).toBe(4);
  });

  it("sdxl-turbo: fixedSize null, aber zwei erlaubte Groessen", () => {
    const c = backendCapabilities("builtin", "sdxl-turbo");
    expect(c.fixedSize).toBeNull();
    expect(c.sizes).toEqual([{ width: 512, height: 512 }, { width: 1024, height: 1024 }]);
  });

  it("beide builtin-Modelle bleiben ohne Negativ-Prompt, CFG und img2img", () => {
    for (const id of ["sd-turbo", "sdxl-turbo"] as const) {
      const c = backendCapabilities("builtin", id);
      expect(c.negativePrompt).toBe(false);
      expect(c.cfg).toBe(false);
      expect(c.initImage).toBe(false);
    }
  });

  it("Server bleibt unveraendert: freie Wahl, sizes null", () => {
    const c = backendCapabilities("server");
    expect(c.fixedSize).toBeNull();
    expect(c.sizes).toBeNull();
    expect(c.maxSteps).toBe(50);
  });

  it("ohne Modellargument gilt der Default", () => {
    expect(backendCapabilities("builtin")).toEqual(backendCapabilities("builtin", "sd-turbo"));
  });
});

describe("img2img-Faehigkeit", () => {
  it("nur der Server-Modus kann ein Ausgangsbild", () => {
    expect(backendCapabilities("server").initImage).toBe(true);
    expect(backendCapabilities("builtin").initImage).toBe(false);
  });
});
