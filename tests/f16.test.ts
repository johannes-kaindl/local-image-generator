import { describe, expect, it } from "vitest";
import { f16ArrayToF32, f16ToF32, f32ArrayToF16, f32ToF16 } from "../src/core/pipeline/f16";

describe("f16", () => {
  it("Roundtrip exakter f16-Werte", () => {
    for (const v of [0, 1, -1, 0.5, -2, 1024, 65504, -65504]) {
      expect(f16ToF32(f32ToF16(v))).toBe(v);
    }
  });
  it("bekannte Bitmuster", () => {
    expect(f32ToF16(1)).toBe(0x3c00);
    expect(f32ToF16(-2)).toBe(0xc000);
    expect(f16ToF32(0x7bff)).toBe(65504); // max f16
  });
  it("Überlauf wird auf Infinity abgebildet", () => {
    expect(f16ToF32(f32ToF16(1e6))).toBe(Infinity);
  });
  it("Array-Roundtrip erhält Länge und Werte approx", () => {
    const src = new Float32Array([0.1, -0.9, 3.3, 14.6146]);
    const back = f16ArrayToF32(f32ArrayToF16(src));
    expect(back.length).toBe(4);
    for (let i = 0; i < 4; i++) expect(Math.abs(back[i]! - src[i]!)).toBeLessThan(0.01);
  });
});
