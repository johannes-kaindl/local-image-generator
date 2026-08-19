import { describe, expect, it } from "vitest";
import { gaussianArray, mulberry32 } from "../src/core/pipeline/prng";

describe("prng", () => {
  it("mulberry32 ist deterministisch und in [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it("gaussianArray: gleicher Seed → identisch, anderer Seed → verschieden", () => {
    const g1 = gaussianArray(7, 64);
    const g2 = gaussianArray(7, 64);
    const g3 = gaussianArray(8, 64);
    expect(Array.from(g1)).toEqual(Array.from(g2));
    expect(Array.from(g1)).not.toEqual(Array.from(g3));
  });
  it("gaussianArray: Mittel ≈ 0, Std ≈ 1 (10k Samples)", () => {
    const g = gaussianArray(1, 10000);
    const mean = g.reduce((s, x) => s + x, 0) / g.length;
    const std = Math.sqrt(g.reduce((s, x) => s + (x - mean) ** 2, 0) / g.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(std - 1)).toBeLessThan(0.05);
  });
});
