// Katalog der eingebauten Modelle (Spec 0.6 §3) — die redaktionelle Seite (Kennung, Lizenz,
// Attribution, Regler-Bereich) steht hier; Pfade, Größen und SHA-256 kommen aus dem generierten
// Manifest (scripts/build-assets.mjs). Ein zweites Modell (LCM_Dreamshaper_v7, Spec §0) wird ein
// weiterer Eintrag hier plus ein Ordner in dist-assets/ — kein Umbau. Pure, obsidian-frei.
import { GENERATED_ASSETS, ORT_VERSION } from "./engine-manifest.generated";

export type AssetKey = keyof typeof GENERATED_ASSETS;

export interface AssetFile {
  key: AssetKey;
  /** Pfad relativ zur Basis-URL, z. B. "sd-turbo/unet/model.onnx". */
  path: string;
  bytes: number;
  sha256: string;
  kind: "onnx" | "json" | "text" | "wasm";
}

export interface BuiltinModel {
  id: string;
  label: string;
  license: { name: string; url: string };
  attribution: string;
  steps: { min: number; max: number; default: number };
  /** Kantenlänge des einzigen Ausgabeformats (SD-Turbo ist auf 512² destilliert). */
  size: number;
  files: AssetFile[];
}

/** Basis-URL der Assets — das eigene HF-Repo (Spike 2026-08-19: HF reflektiert die CORS-Origin,
 *  Streaming aus dem Renderer geht; ein GitHub-Release täte das nicht). Per Setting überschreibbar
 *  (Spiegel, lokaler Server für den GUI-Smoke). */
export const DEFAULT_ASSET_BASE_URL = "https://huggingface.co/v6t2b9/local-image-generator-models/resolve/main";

function file(key: AssetKey, kind: AssetFile["kind"]): AssetFile {
  const g = GENERATED_ASSETS[key];
  return { key, path: g.path, bytes: g.bytes, sha256: g.sha256, kind };
}

export const RUNTIME_WASM: AssetFile = file("ort_wasm", "wasm");
export { ORT_VERSION };

export const BUILTIN_MODEL: BuiltinModel = {
  id: "sd-turbo",
  label: "SD-Turbo",
  license: { name: "Stability AI Community License", url: "https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md" },
  attribution: "Powered by Stability AI",
  steps: { min: 1, max: 4, default: 4 },
  size: 512,
  files: [
    file("text_encoder", "onnx"),
    file("unet", "onnx"),
    file("vae_decoder", "onnx"),
    file("vocab", "json"),
    file("merges", "text"),
  ],
};

/** Basis + Pfad ohne doppelte oder fehlende Slashes. */
export function assetUrl(baseUrl: string, f: AssetFile): string {
  return `${baseUrl.replace(/\/+$/, "")}/${f.path}`;
}

/** Cache-Schlüssel — URL-unabhängig (Spiegel/lokaler Server verstecken nie einen vorhandenen
 *  Download) und hash-gebunden (eine neue Konversion bekommt neue Schlüssel, alte Einträge
 *  werden nie für gültig gehalten). Cache-API-Keys müssen URL-förmig sein. */
export function cacheKey(f: AssetFile): string {
  const base = f.path.split("/").pop() ?? f.path;
  return `https://lig-asset.invalid/${f.key}/${f.sha256.slice(0, 16)}/${base}`;
}

export function allAssets(): AssetFile[] {
  return [...BUILTIN_MODEL.files, RUNTIME_WASM];
}

export function totalBytes(files: readonly AssetFile[]): number {
  return files.reduce((s, f) => s + f.bytes, 0);
}
