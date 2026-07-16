import { describe, expect, it } from "vitest";
import { buildImageFilename, dedupeFilename } from "../src/core/filename";

describe("buildImageFilename", () => {
  it("Schema lig-YYYYMMDD-HHmmss-s<seed>.png", () => {
    const d = new Date(2026, 6, 16, 14, 5, 9); // 16. Juli 2026, 14:05:09 lokal
    expect(buildImageFilename(d, 12345)).toBe("lig-20260716-140509-s12345.png");
  });
});

describe("dedupeFilename", () => {
  it("gibt den Basis-Pfad zurück, wenn er frei ist", () => {
    expect(dedupeFilename("art/pic.png", () => false)).toBe("art/pic.png");
  });
  it("hängt -2 vor .png an, wenn der Basis-Pfad belegt ist", () => {
    const taken = new Set(["art/pic.png"]);
    expect(dedupeFilename("art/pic.png", (p) => taken.has(p))).toBe("art/pic-2.png");
  });
  it("zählt hoch, bis ein freier Pfad gefunden ist", () => {
    const taken = new Set(["art/pic.png", "art/pic-2.png", "art/pic-3.png"]);
    expect(dedupeFilename("art/pic.png", (p) => taken.has(p))).toBe("art/pic-4.png");
  });
});
