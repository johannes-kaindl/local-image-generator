import { describe, expect, it } from "vitest";
import { allAssets, assetUrl, BUILTIN_MODEL, cacheKey, DEFAULT_ASSET_BASE_URL, RUNTIME_WASM, totalBytes } from "../src/core/model-manifest";

describe("model-manifest", () => {
  it("Katalog trägt sd-turbo mit fünf Dateien, jede mit 64-stelligem Hash und Größe > 0", () => {
    expect(BUILTIN_MODEL.id).toBe("sd-turbo");
    expect(BUILTIN_MODEL.files.map((f) => f.key).sort()).toEqual(["merges", "text_encoder", "unet", "vae_decoder", "vocab"]);
    for (const f of BUILTIN_MODEL.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
    }
    expect(BUILTIN_MODEL.steps).toEqual({ min: 1, max: 4, default: 4 });
    expect(BUILTIN_MODEL.size).toBe(512);
  });
  it("assetUrl fügt Basis und Pfad ohne doppelte Slashes zusammen", () => {
    const f = BUILTIN_MODEL.files.find((x) => x.key === "unet")!;
    expect(assetUrl("http://127.0.0.1:7862/", f)).toBe(`http://127.0.0.1:7862/${f.path}`);
    expect(assetUrl(DEFAULT_ASSET_BASE_URL, f)).toBe(`${DEFAULT_ASSET_BASE_URL}/${f.path}`);
  });
  it("cacheKey ist URL-unabhängig, URL-förmig und trägt den Hash-Präfix", () => {
    const f = RUNTIME_WASM;
    expect(cacheKey(f)).toBe(`https://lig-asset.invalid/ort_wasm/${f.sha256.slice(0, 16)}/${f.path.split("/").pop()}`);
    expect(() => new URL(cacheKey(f))).not.toThrow();
  });
  it("allAssets = Modell + Runtime; totalBytes summiert", () => {
    const all = allAssets();
    expect(all).toHaveLength(6);
    expect(all.some((f) => f.kind === "wasm")).toBe(true);
    expect(totalBytes(all)).toBe(all.reduce((s, f) => s + f.bytes, 0));
  });
});
