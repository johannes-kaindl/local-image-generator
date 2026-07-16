import { describe, expect, it } from "vitest";
import { isDownloadComplete, MODEL_FILES, missingFiles, totalApproxBytes } from "../src/core/model-manifest";

describe("model-manifest", () => {
  it("kennt genau 5 Dateien (3 ONNX + vocab + merges), alle auf huggingface.co", () => {
    expect(MODEL_FILES.length).toBe(5);
    for (const f of MODEL_FILES) expect(f.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+/);
    expect(MODEL_FILES.filter((f) => f.kind === "onnx").length).toBe(3);
  });
  it("missingFiles liefert nur nicht-gecachte Dateien", () => {
    const missing = missingFiles(["unet", "vocab"]);
    expect(missing.map((f) => f.key).sort()).toEqual(["merges", "text_encoder", "vae_decoder"]);
  });
  it("totalApproxBytes summiert (~2.5 GB Gesamtgröße)", () => {
    const total = totalApproxBytes(MODEL_FILES);
    expect(total).toBeGreaterThan(2.3e9);
    expect(total).toBeLessThan(2.8e9);
  });
  it("isDownloadComplete: exakt bei bekannter Länge, sonst >0", () => {
    expect(isDownloadComplete(100, 100)).toBe(true);
    expect(isDownloadComplete(99, 100)).toBe(false);
    expect(isDownloadComplete(1, null)).toBe(true);
    expect(isDownloadComplete(0, null)).toBe(false);
  });
});
