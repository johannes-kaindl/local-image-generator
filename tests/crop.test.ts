import { describe, expect, it } from "vitest";
import { formatCrop, cropEquals, cropSourceRect, defaultCrop, moveCrop, parseCrop, resizeCrop, MIN_CROP_PX } from "../src/core/crop";

describe("cropSourceRect", () => {
  it("null = zentriertes Quadrat der kuerzeren Seite (das bisherige Verhalten der eingebauten Engine)", () => {
    expect(cropSourceRect(1200, 746, null)).toEqual({ sx: 227, sy: 0, sw: 746, sh: 746 });
    expect(cropSourceRect(500, 800, null)).toEqual({ sx: 0, sy: 150, sw: 500, sh: 500 });
  });
  it("mit Ausschnitt: normalisierte Werte mal Originalgroesse, gerundet", () => {
    expect(cropSourceRect(1000, 500, { x: 0.1, y: 0.2, w: 0.4, h: 0.8 })).toEqual({ sx: 100, sy: 100, sw: 400, sh: 400 });
  });
  it("bleibt im Bild, auch wenn Rundung ueber den Rand rutschen wuerde", () => {
    const r = cropSourceRect(333, 333, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(r.sx + r.sw).toBeLessThanOrEqual(333);
    expect(r.sy + r.sh).toBeLessThanOrEqual(333);
  });
});

describe("defaultCrop", () => {
  it("ist das groesste zentrierte Quadrat, normalisiert", () => {
    const c = defaultCrop(1200, 600);
    expect(c.w * 1200).toBeCloseTo(600);
    expect(c.h * 600).toBeCloseTo(600);
    expect(c.x).toBeCloseTo(0.25);
    expect(c.y).toBeCloseTo(0);
  });
});

describe("moveCrop", () => {
  const c = { x: 0.25, y: 0, w: 0.5, h: 1 }; // 600x600 in 1200x600
  it("verschiebt um Bildpunkte", () => {
    const m = moveCrop(c, 1200, 600, 100, 0);
    expect(m.x).toBeCloseTo(0.25 + 100 / 1200);
    expect(m.w).toBe(c.w);
  });
  it("kann das Bild nicht verlassen (links, rechts, oben, unten)", () => {
    expect(moveCrop(c, 1200, 600, -9999, 0).x).toBe(0);
    expect(moveCrop(c, 1200, 600, 9999, 0).x).toBeCloseTo(0.5);
    expect(moveCrop(c, 1200, 600, 0, -50).y).toBe(0);
    expect(moveCrop(c, 1200, 600, 0, 50).y).toBe(0); // Rahmen fuellt die Hoehe, nichts zu verschieben
  });
});

describe("resizeCrop", () => {
  it("bleibt quadratisch in Bildpunkten und verankert links oben", () => {
    const c = { x: 0.1, y: 0.1, w: 0.2, h: 0.4 }; // 200x200 in 1000x500
    const r = resizeCrop(c, 1000, 500, 100);
    expect(r.x).toBe(c.x);
    expect(r.y).toBe(c.y);
    expect(r.w * 1000).toBeCloseTo(300);
    expect(r.h * 500).toBeCloseTo(300);
  });
  it("klemmt am Bildrand und an der Mindestgroesse", () => {
    const c = { x: 0.5, y: 0.5, w: 0.2, h: 0.4 };
    const gross = resizeCrop(c, 1000, 500, 99999);
    expect(gross.x + gross.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(gross.y + gross.h).toBeLessThanOrEqual(1 + 1e-9);
    const klein = resizeCrop(c, 1000, 500, -99999);
    expect(klein.w * 1000).toBeCloseTo(MIN_CROP_PX);
    expect(klein.h * 500).toBeCloseTo(MIN_CROP_PX);
  });
});

describe("parseCrop", () => {
  it("nimmt gueltige Werte an", () => {
    expect(parseCrop({ x: 0, y: 0.1, w: 0.5, h: 0.9 })).toEqual({ x: 0, y: 0.1, w: 0.5, h: 0.9 });
  });
  it("verwirft alles Unsinnige zu null (nie werfen: kommt aus data.json und von Fremdplugins)", () => {
    for (const v of [null, undefined, 3, "x", {}, { x: 0, y: 0, w: 0, h: 1 }, { x: -0.1, y: 0, w: 0.5, h: 0.5 }, { x: 0.6, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: NaN, h: 1 }, { x: "0", y: 0, w: 1, h: 1 }]) {
      expect(parseCrop(v)).toBeNull();
    }
  });
});

describe("cropEquals", () => {
  it("vergleicht Werte, null gleich null", () => {
    expect(cropEquals(null, null)).toBe(true);
    expect(cropEquals({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(cropEquals({ x: 0, y: 0, w: 1, h: 1 }, null)).toBe(false);
    expect(cropEquals({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 0.9 })).toBe(false);
  });
});

describe("formatCrop", () => {
  it("schreibt vier benannte Werte, auf vier Stellen gerundet", () => {
    expect(formatCrop({ x: 0.125, y: 0, w: 0.75, h: 1 })).toBe("x=0.125 y=0 w=0.75 h=1");
    expect(formatCrop({ x: 1 / 3, y: 0, w: 2 / 3, h: 1 })).toBe("x=0.3333 y=0 w=0.6667 h=1");
  });
});
