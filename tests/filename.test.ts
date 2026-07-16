import { describe, expect, it } from "vitest";
import { buildImageFilename } from "../src/core/filename";

describe("buildImageFilename", () => {
  it("Schema lig-YYYYMMDD-HHmmss-s<seed>.png", () => {
    const d = new Date(2026, 6, 16, 14, 5, 9); // 16. Juli 2026, 14:05:09 lokal
    expect(buildImageFilename(d, 12345)).toBe("lig-20260716-140509-s12345.png");
  });
});
