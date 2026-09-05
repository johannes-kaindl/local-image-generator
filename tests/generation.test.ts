import { describe, expect, it } from "vitest";
import { backendCapabilities, CFG, DEFAULT_SIZE, SIZES, STEPS } from "../src/core/generation";
import { BUILTIN_MODELS } from "../src/core/model-manifest";

describe("generation constants (Spec §4)", () => {
  it("SIZES enthält 10 Einträge", () => {
    expect(SIZES).toHaveLength(10);
  });

  it("alle SIZES-Werte sind Vielfache von 16", () => {
    for (const s of SIZES) {
      expect(s.width % 16).toBe(0);
      expect(s.height % 16).toBe(0);
    }
  });

  // Schaerfer als die 16er-Zusage darueber, und zwar aus dem Modell heraus: Latents sind
  // 1/8 der Bildgroesse, das UNet hat drei Downsampling-Stufen — 8 x 8 = 64. Der Bestand
  // erfuellt das ohnehin (512/768/1024/576 sind alle durch 64 teilbar); der Test haelt es
  // fest, damit ein spaeterer Eintrag wie 1920x1080 nicht durchrutscht: 1080 / 64 = 16,875.
  it("alle SIZES-Werte sind Vielfache von 64", () => {
    for (const s of SIZES) {
      expect(s.width % 64).toBe(0);
      expect(s.height % 64).toBe(0);
    }
  });

  // Der Anlass fuer die drei grossen Formate: Draw Things mit Flux kann bis 2048, das
  // Panel-Dropdown bot aber nur bis 1024 an — die Beschraenkung sass in DIESER Liste, nicht
  // im Backend (`capabilities.sizes` ist im Server-Modus null, die Haertung laesst dort
  // ohnehin jede Groesse durch). Ohne sie war kein Desktop-Hintergrund erzeugbar.
  it("bietet grosse 16:9- und Quadrat-Formate fuer Desktop-Hintergruende", () => {
    expect(SIZES).toContainEqual({ width: 2048, height: 1152 });
    expect(SIZES).toContainEqual({ width: 1152, height: 2048 });
    expect(SIZES).toContainEqual({ width: 2048, height: 2048 });
  });

  // Die Liste ist durchgehend paarweise gebaut (jedes Querformat hat sein Hochformat).
  it("jedes nicht-quadratische Format hat sein gedrehtes Gegenstueck", () => {
    for (const s of SIZES) {
      if (s.width === s.height) continue;
      expect(SIZES).toContainEqual({ width: s.height, height: s.width });
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
  it("builtin ist guidance-frei, auf 512² und auf wenige Steps begrenzt — kann seit 0.11 aber img2img", () => {
    expect(backendCapabilities("builtin", "sd-turbo")).toEqual({
      negativePrompt: false,
      cfg: false,
      initImage: true,
      minSteps: BUILTIN_MODELS["sd-turbo"].steps.min,
      maxSteps: BUILTIN_MODELS["sd-turbo"].steps.max,
      fixedSize: BUILTIN_MODELS["sd-turbo"].sizes[0],
      sizes: BUILTIN_MODELS["sd-turbo"].sizes,
    });
  });
  it("server kann alles, was das Panel anbietet (Modellargument ist Pflicht, aber im Server-Zweig unbeachtet)", () => {
    expect(backendCapabilities("server", "sd-turbo")).toEqual({
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
    expect(c.maxSteps).toBe(8);
  });

  it("sdxl-turbo: fixedSize null, aber zwei erlaubte Groessen", () => {
    const c = backendCapabilities("builtin", "sdxl-turbo");
    expect(c.fixedSize).toBeNull();
    expect(c.sizes).toEqual([{ width: 512, height: 512 }, { width: 1024, height: 1024 }]);
  });

  it("beide builtin-Modelle bleiben ohne Negativ-Prompt und CFG, koennen aber img2img", () => {
    for (const id of ["sd-turbo", "sdxl-turbo"] as const) {
      const c = backendCapabilities("builtin", id);
      expect(c.negativePrompt).toBe(false);
      expect(c.cfg).toBe(false);
      expect(c.initImage).toBe(true);
    }
  });

  it("Server bleibt unveraendert: freie Wahl, sizes null", () => {
    const c = backendCapabilities("server", "sd-turbo");
    expect(c.fixedSize).toBeNull();
    expect(c.sizes).toBeNull();
    expect(c.maxSteps).toBe(50);
  });
});

describe("img2img-Faehigkeit", () => {
  it("seit 0.11 koennen beide Modi ein Ausgangsbild — die eingebaute Engine hat den VAE-Encoder als Pflicht-Asset", () => {
    expect(backendCapabilities("server", "sd-turbo").initImage).toBe(true);
    expect(backendCapabilities("builtin", "sd-turbo").initImage).toBe(true);
  });
});
