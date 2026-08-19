import { describe, expect, it } from "vitest";
import { chwToRgba } from "../src/core/pipeline/image";

describe("chwToRgba", () => {
  it("mappt [-1,1] auf [0,255], interleaved RGBA, Alpha 255", () => {
    // 1x1-Bild: R=-1, G=0, B=1
    const rgba = chwToRgba(new Float32Array([-1, 0, 1]), 1, 1);
    expect(Array.from(rgba)).toEqual([0, 128, 255, 255]);
  });
  it("clampt Ausreißer", () => {
    const rgba = chwToRgba(new Float32Array([-5, 5, 0]), 1, 1);
    expect(rgba[0]).toBe(0);
    expect(rgba[1]).toBe(255);
  });
  it("CHW→HWC-Reihenfolge stimmt bei 2x1", () => {
    // R-Kanal: [r0,r1], G: [g0,g1], B: [b0,b1] → Pixel0=(r0,g0,b0)
    const rgba = chwToRgba(new Float32Array([-1, 1, 0, 0, 1, -1]), 2, 1);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 128, 255, 255]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([255, 128, 0, 255]);
  });
});
