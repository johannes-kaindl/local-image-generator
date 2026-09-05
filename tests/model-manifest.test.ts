import { describe, expect, it } from "vitest";
import {
  allAssets,
  assetsFor,
  assetUrl,
  BUILTIN_MODELS,
  cacheKey,
  DEFAULT_ASSET_BASE_URL,
  DEFAULT_BUILTIN_MODEL_ID,
  isBuiltinModelId,
  modelById,
  RUNTIME_WASM,
  filesFor,
  missingBytes,
  totalBytes,
  type AssetFile,
} from "../src/core/model-manifest";

describe("model-manifest", () => {
  it("Katalog trägt sd-turbo mit sechs Dateien, jede mit 64-stelligem Hash und Größe > 0", () => {
    expect(BUILTIN_MODELS["sd-turbo"].id).toBe("sd-turbo");
    const files = assetsFor("sd-turbo");
    expect(files.map((f) => f.key).sort()).toEqual(
      ["sd-turbo/merges", "sd-turbo/text_encoder", "sd-turbo/unet", "sd-turbo/vae_decoder", "sd-turbo/vae_encoder", "sd-turbo/vocab"],
    );
    for (const f of files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
    }
    expect(BUILTIN_MODELS["sd-turbo"].steps).toEqual({ min: 1, max: 8, default: 4 });
    expect(BUILTIN_MODELS["sd-turbo"].sizes).toEqual([{ width: 512, height: 512 }]);
  });
  it("assetUrl fügt Basis und Pfad ohne doppelte Slashes zusammen", () => {
    const f = assetsFor("sd-turbo").find((x) => x.key === "sd-turbo/unet")!;
    expect(assetUrl("http://127.0.0.1:7862/", f)).toBe(`http://127.0.0.1:7862/${f.path}`);
    expect(assetUrl(DEFAULT_ASSET_BASE_URL, f)).toBe(`${DEFAULT_ASSET_BASE_URL}/${f.path}`);
  });
  it("cacheKey ist URL-unabhängig, URL-förmig und trägt den Hash-Präfix", () => {
    const f = RUNTIME_WASM;
    expect(cacheKey(f)).toBe(`https://lig-asset.invalid/ort_wasm/${f.sha256.slice(0, 16)}/${f.path.split("/").pop()}`);
    expect(() => new URL(cacheKey(f))).not.toThrow();
  });
  it("allAssets = Default-Modell (sd-turbo) + Runtime; totalBytes summiert", () => {
    const all = allAssets();
    expect(all).toHaveLength(7);
    expect(all.some((f) => f.kind === "wasm")).toBe(true);
    expect(totalBytes(all)).toBe(all.reduce((s, f) => s + f.bytes, 0));
  });
});

describe("Modellkatalog (Spec 0.9 §3.3)", () => {
  it("kennt genau zwei Modelle, Default ist sd-turbo", () => {
    expect(Object.keys(BUILTIN_MODELS).sort()).toEqual(["sd-turbo", "sdxl-turbo"]);
    expect(DEFAULT_BUILTIN_MODEL_ID).toBe("sd-turbo");
  });

  it("sd-turbo hat eine Groesse, sdxl-turbo zwei", () => {
    expect(BUILTIN_MODELS["sd-turbo"].sizes).toEqual([{ width: 512, height: 512 }]);
    expect(BUILTIN_MODELS["sdxl-turbo"].sizes).toEqual([
      { width: 512, height: 512 },
      { width: 1024, height: 1024 },
    ]);
  });

  it("VAE-Skalierung ist pro Modell verschieden", () => {
    expect(BUILTIN_MODELS["sd-turbo"].vaeScaling).toBeCloseTo(0.18215, 5);
    expect(BUILTIN_MODELS["sdxl-turbo"].vaeScaling).toBeCloseTo(0.13025, 5);
  });

  it("assetsFor loest Buckets mit auf und enthaelt die Runtime NICHT", () => {
    const sd = assetsFor("sd-turbo");
    const xl = assetsFor("sdxl-turbo");
    expect(sd.some((f) => f.key === "ort_wasm")).toBe(false);
    expect(xl.length).toBeGreaterThan(sd.length);
    expect(xl.filter((f) => f.kind === "data").length).toBeGreaterThanOrEqual(2);
  });

  it("jede Datei hat einen eindeutigen Cache-Key", () => {
    const keys = [...assetsFor("sd-turbo"), ...assetsFor("sdxl-turbo")].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("nur sdxl-turbo traegt einen zweiten Text-Encoder", () => {
    const xl = modelById("sdxl-turbo");
    expect(xl.kind).toBe("sdxl");
    if (xl.kind === "sdxl") expect(xl.parts.textEncoder2.file.bytes).toBeGreaterThan(0);
    expect(modelById("sd-turbo").kind).toBe("sd");
  });

  it("isBuiltinModelId weist Unbekanntes ab", () => {
    expect(isBuiltinModelId("sdxl-turbo")).toBe(true);
    expect(isBuiltinModelId("flux")).toBe(false);
    expect(isBuiltinModelId(null)).toBe(false);
  });

  it("assetsFor enthaelt den vaeEncoder-Teil (img2img, Spec 0.9 §4a) in beiden Modell-Varianten", () => {
    expect(assetsFor("sd-turbo").some((f) => f.key === "sd-turbo/vae_encoder")).toBe(true);
    expect(assetsFor("sdxl-turbo").some((f) => f.key === "sdxl-turbo/vae_encoder")).toBe(true);
  });

  it("kein Pfad traegt den Modellordner doppelt", () => {
    for (const id of ["sd-turbo", "sdxl-turbo"] as const) {
      for (const f of assetsFor(id)) {
        const prefix = `${id}/${id}/`;
        expect(f.path.startsWith(prefix)).toBe(false);
      }
    }
  });
});

describe("missingBytes", () => {
  const datei = (key: string, bytes: number): AssetFile => ({ key, path: `x/${key}`, bytes, sha256: "0".repeat(64), kind: "onnx" });

  it("zaehlt nur die NICHT gecachten Dateien — das ist der Unterschied zu totalBytes", () => {
    const files = [datei("a", 1000), datei("b", 200), datei("c", 30)];
    expect(missingBytes(files, ["a", "c"])).toBe(200);
    expect(totalBytes(files)).toBe(1230);
  });

  it("ist bei leerem Cache gleich totalBytes und bei vollstaendigem Cache 0", () => {
    const files = [datei("a", 1000), datei("b", 200)];
    expect(missingBytes(files, [])).toBe(totalBytes(files));
    expect(missingBytes(files, ["a", "b"])).toBe(0);
  });

  it("ignoriert gecachte Schluessel, die gar nicht angefragt sind", () => {
    // Der Cache traegt Dateien BEIDER Modelle. Wer die Differenz ueber die Cache-Groesse statt
    // ueber die angefragte Liste rechnete, bekaeme hier eine negative oder zu kleine Zahl.
    const files = [datei("sd/unet", 500)];
    expect(missingBytes(files, ["sdxl/unet", "sdxl/vae"])).toBe(500);
  });
});

describe("filesFor", () => {
  // Die Komposition „Modell-Dateien PLUS Runtime-WASM" stand an acht Stellen (Nachlese 0.9.0).
  // Getestet wird der VERTRAG, nicht die Zusammensetzung: `assetsFor` traegt die WASM
  // absichtlich NICHT (sie gehoert keinem Modell — davon haengt ab, dass `removeModel()` sie
  // stehen laesst und dass die Modell-Groessenzeile sie nicht mitzaehlt), `filesFor` traegt sie.
  it("ergaenzt die Modell-Dateien um die Runtime-WASM, die assetsFor bewusst nicht traegt", () => {
    for (const id of ["sd-turbo", "sdxl-turbo"] as const) {
      const modell = assetsFor(id);
      const alle = filesFor(id);
      expect(modell.some((f) => f.key === RUNTIME_WASM.key)).toBe(false);
      expect(alle.some((f) => f.key === RUNTIME_WASM.key)).toBe(true);
      expect(alle.length).toBe(modell.length + 1);
      expect(totalBytes(alle)).toBe(totalBytes(modell) + RUNTIME_WASM.bytes);
    }
  });

  it("liefert fuer jedes Modell dessen eigene Dateien, nicht die des Defaults", () => {
    expect(filesFor("sdxl-turbo").map((f) => f.key)).not.toEqual(filesFor("sd-turbo").map((f) => f.key));
  });
});

describe("Step-Grenzen der builtin-Modelle", () => {
  // Gemessen 2026-09-05 (84 Laeufe, siehe Cockpit _SDD/2026-09-05-messreihe-img2img):
  // 4 → 8 ist echter Detailgewinn, ab 12 kippt SD-Turbo in Ueberzeichnung. Die 8 ist
  // die belegbar sichere Seite, 12 die belegbar schlechte. Wer sie aendert, sieht sich
  // Bilder an — die naheliegenden Kennzahlen (Luma-Streuung, Farbzahl) steigen bis 20
  // weiter und tragen die Aussage NICHT.
  it.each(["sd-turbo", "sdxl-turbo"] as const)("%s erlaubt bis zu 8 Steps", (id) => {
    expect(modelById(id).steps.max).toBe(8);
  });

  it.each(["sd-turbo", "sdxl-turbo"] as const)("%s behaelt Default 4", (id) => {
    // Der Default bleibt bewusst bei 4: wer nichts tut, bekommt das bisherige Verhalten
    // und die bisherige Rechenzeit (~1,9 s statt ~3,0 s).
    expect(modelById(id).steps.default).toBe(4);
  });
});
