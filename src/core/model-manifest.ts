// Katalog der eingebauten Modelle (Spec 0.9 §3.3) — die redaktionelle Seite (Kennung, Lizenz,
// Attribution, Regler-Bereich) steht hier; Pfade, Größen und SHA-256 kommen aus dem generierten
// Manifest (scripts/build-assets.mjs). Zwei Modelle (SD-Turbo, SDXL-Turbo) sind benannte Teile
// (`ModelPart`) über `assetsFor()` aufgelöst — kein Umbau für ein drittes Modell. Pure, obsidian-frei.
import { GENERATED_ASSETS, ORT_VERSION } from "./engine-manifest.generated";
import type { SizeOption } from "./generation";

export type AssetKey = string;

export interface AssetFile {
  key: AssetKey;
  /** Pfad relativ zur Basis-URL, z. B. "sd-turbo/unet/model.onnx". Traegt den Modellordner
   *  bereits (aus GENERATED_ASSETS) — hier NICHT nochmal praefigieren. */
  path: string;
  bytes: number;
  sha256: string;
  kind: "onnx" | "json" | "text" | "wasm" | "data";
}

export type BuiltinModelId = "sd-turbo" | "sdxl-turbo";

/** Ein benannter Modellteil: die Hauptdatei plus optionale External-Data-Buckets
 *  (SDXL-Turbos UNet ist ueber 2 GiB und deshalb gestueckelt, s. AGENTS.md-Gotchas). */
export interface ModelPart {
  file: AssetFile;
  data: readonly AssetFile[];
}

export interface TokenizerFiles {
  vocab: AssetFile;
  merges: AssetFile;
}

interface BuiltinModelBase {
  id: BuiltinModelId;
  label: string;
  license: { name: string; url: string };
  attribution: string;
  steps: { min: number; max: number; default: number };
  /** Ausgabeformate, die dieses Modell beherrscht (SD-Turbo: nur 512², SDXL-Turbo: auch 1024²). */
  sizes: readonly SizeOption[];
  vaeScaling: number;
}

export type BuiltinModel =
  | (BuiltinModelBase & {
      kind: "sd";
      parts: {
        textEncoder: ModelPart;
        unet: ModelPart;
        vaeDecoder: ModelPart;
        tokenizer: TokenizerFiles;
      };
    })
  | (BuiltinModelBase & {
      kind: "sdxl";
      parts: {
        textEncoder: ModelPart;
        textEncoder2: ModelPart;
        unet: ModelPart;
        vaeDecoder: ModelPart;
        tokenizer: TokenizerFiles;
        tokenizer2: TokenizerFiles;
      };
    });

/** Basis-URL der Assets — das eigene HF-Repo (Spike 2026-08-19: HF reflektiert die CORS-Origin,
 *  Streaming aus dem Renderer geht; ein GitHub-Release täte das nicht). Per Setting überschreibbar
 *  (Spiegel, lokaler Server für den GUI-Smoke).
 *
 *  Der Namespace ist Teil der Vertrauenszusage, nicht Kosmetik: die URL steht als Platzhalter
 *  der Settings-Zeile „Download source" im Bild, und wer 2,5 GB lädt, gleicht den Namen mit dem
 *  Plugin-Autor ab. Er ist deshalb seit 2026-08-21 identisch mit dem GitHub-Profil, auf das
 *  `authorUrl` zeigt. Das alte Repo `v6t2b9/local-image-generator-models` bleibt bestehen —
 *  Installationen von 0.6.0 tragen die alte URL in ihren Settings und lüden sonst ins Leere. */
export const DEFAULT_ASSET_BASE_URL =
  "https://huggingface.co/johannes-kaindl/local-image-generator-models/resolve/main";

type GeneratedEntry = {
  path: string;
  bytes: number;
  sha256: string;
  data?: readonly { path: string; bytes: number; sha256: string }[];
};

/** Cache-Key eines generierten Katalogeintrags modell-qualifizieren — beide Modelle haben
 *  z. B. einen "unet". `g.path` traegt den Modellordner bereits (Ruling Task 5: kein zweites
 *  Praefix, sonst laeuft der Download in einen 404). */
function asset(modelId: BuiltinModelId, key: string, g: { path: string; bytes: number; sha256: string }, kind: AssetFile["kind"]): AssetFile {
  return { key: `${modelId}/${key}`, path: g.path, bytes: g.bytes, sha256: g.sha256, kind };
}

function part(modelId: BuiltinModelId, key: string, g: GeneratedEntry, kind: AssetFile["kind"]): ModelPart {
  const data = (g.data ?? []).map((d, i) => asset(modelId, `${key}.data.${String(i).padStart(3, "0")}`, d, "data"));
  return { file: asset(modelId, key, g, kind), data };
}

export const RUNTIME_WASM: AssetFile = (() => {
  const g = GENERATED_ASSETS.runtime.ort_wasm;
  return { key: "ort_wasm", path: g.path, bytes: g.bytes, sha256: g.sha256, kind: "wasm" };
})();
export { ORT_VERSION };

const sdTurboAssets = GENERATED_ASSETS.models["sd-turbo"];
const sdTurbo: BuiltinModel = {
  kind: "sd",
  id: "sd-turbo",
  label: "SD-Turbo",
  license: { name: "Stability AI Community License", url: "https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md" },
  attribution: "Powered by Stability AI",
  steps: { min: 1, max: 4, default: 4 },
  sizes: [{ width: 512, height: 512 }],
  vaeScaling: 0.18215,
  parts: {
    textEncoder: part("sd-turbo", "text_encoder", sdTurboAssets.text_encoder, "onnx"),
    unet: part("sd-turbo", "unet", sdTurboAssets.unet, "onnx"),
    vaeDecoder: part("sd-turbo", "vae_decoder", sdTurboAssets.vae_decoder, "onnx"),
    tokenizer: {
      vocab: asset("sd-turbo", "vocab", sdTurboAssets.vocab, "json"),
      merges: asset("sd-turbo", "merges", sdTurboAssets.merges, "text"),
    },
  },
};

const sdxlTurboAssets = GENERATED_ASSETS.models["sdxl-turbo"];
const sdxlTurbo: BuiltinModel = {
  kind: "sdxl",
  id: "sdxl-turbo",
  label: "SDXL-Turbo",
  license: { name: "Stability AI Community License", url: "https://huggingface.co/stabilityai/sdxl-turbo/blob/main/LICENSE.md" },
  attribution: "Powered by Stability AI",
  steps: { min: 1, max: 4, default: 4 },
  sizes: [
    { width: 512, height: 512 },
    { width: 1024, height: 1024 },
  ],
  vaeScaling: 0.13025,
  parts: {
    textEncoder: part("sdxl-turbo", "text_encoder", sdxlTurboAssets.text_encoder, "onnx"),
    textEncoder2: part("sdxl-turbo", "text_encoder_2", sdxlTurboAssets.text_encoder_2, "onnx"),
    unet: part("sdxl-turbo", "unet", sdxlTurboAssets.unet, "onnx"),
    vaeDecoder: part("sdxl-turbo", "vae_decoder", sdxlTurboAssets.vae_decoder, "onnx"),
    tokenizer: {
      vocab: asset("sdxl-turbo", "vocab", sdxlTurboAssets.vocab, "json"),
      merges: asset("sdxl-turbo", "merges", sdxlTurboAssets.merges, "text"),
    },
    tokenizer2: {
      vocab: asset("sdxl-turbo", "vocab_2", sdxlTurboAssets.vocab_2, "json"),
      merges: asset("sdxl-turbo", "merges_2", sdxlTurboAssets.merges_2, "text"),
    },
  },
};

export const BUILTIN_MODELS: Record<BuiltinModelId, BuiltinModel> = {
  "sd-turbo": sdTurbo,
  "sdxl-turbo": sdxlTurbo,
};

export const DEFAULT_BUILTIN_MODEL_ID: BuiltinModelId = "sd-turbo";

export function modelById(id: BuiltinModelId): BuiltinModel {
  return BUILTIN_MODELS[id];
}

export function isBuiltinModelId(v: unknown): v is BuiltinModelId {
  return v === "sd-turbo" || v === "sdxl-turbo";
}

/** Alle Dateien eines Modells (Hauptdateien + External-Data-Buckets + Tokenizer) — OHNE die
 *  Runtime-WASM, die Aufrufer haengen sie separat an (`allAssets()`, `LocalEngineBackend`). */
export function assetsFor(id: BuiltinModelId): AssetFile[] {
  const m = BUILTIN_MODELS[id];
  const parts: ModelPart[] =
    m.kind === "sd"
      ? [m.parts.textEncoder, m.parts.unet, m.parts.vaeDecoder]
      : [m.parts.textEncoder, m.parts.textEncoder2, m.parts.unet, m.parts.vaeDecoder];
  const tokenizers: TokenizerFiles[] = m.kind === "sd" ? [m.parts.tokenizer] : [m.parts.tokenizer, m.parts.tokenizer2];

  const files: AssetFile[] = [];
  for (const p of parts) files.push(p.file, ...p.data);
  for (const t of tokenizers) files.push(t.vocab, t.merges);
  return files;
}

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

/** Der Cache-Schluessel vor der Modell-Qualifizierung von `asset()` (Ruling Task 5,
 *  2026-08-24 — `key` bekam das `${modelId}/`-Praefix). NUR fuer die Einmal-Migration
 *  bestehender SD-Turbo-Downloads gedacht (`ModelStore.migrateLegacyKeys`, C2-Fix): ohne sie
 *  faende `isComplete()` die ~2,5 GB jeder Bestandsinstallation nie wieder, und das Panel
 *  boete einen unnoetigen Neudownload an, waehrend die alten Bytes fuer immer im Cache
 *  liegen blieben. Fuer Dateien ohne Modell-Praefix (aktuell nur `ort_wasm`) liefert diese
 *  Funktion denselben Schluessel wie `cacheKey()` — dort ist nichts zu migrieren. NICHT fuer
 *  neue Downloads verwenden. */
export function legacyCacheKey(f: AssetFile): string {
  const base = f.path.split("/").pop() ?? f.path;
  const legacyPart = f.key.startsWith("sd-turbo/") ? f.key.slice("sd-turbo/".length) : f.key;
  return `https://lig-asset.invalid/${legacyPart}/${f.sha256.slice(0, 16)}/${base}`;
}

export function allAssets(): AssetFile[] {
  return [...assetsFor(DEFAULT_BUILTIN_MODEL_ID), RUNTIME_WASM];
}

export function totalBytes(files: readonly AssetFile[]): number {
  return files.reduce((s, f) => s + f.bytes, 0);
}
