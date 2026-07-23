import { describe, expect, it } from "vitest";
import { CFG, DEFAULT_SIZE, SIZES, STEPS } from "../src/core/generation";

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
