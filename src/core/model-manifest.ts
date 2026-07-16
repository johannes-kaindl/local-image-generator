// Das eine kuratierte Modell (Spec §2/§5): sd-turbo fp16-ONNX von
// schmuell/sd-turbo-ort-web (Referenzmodell des Microsoft-WebGPU-Demos) +
// Tokenizer-Daten von stabilityai/sd-turbo. approxBytes nur für UI-Anzeige;
// Integrität prüft isDownloadComplete gegen Content-Length (Spec §8).
export type ModelFileKey = "text_encoder" | "unet" | "vae_decoder" | "vocab" | "merges";

export interface ModelFile {
  key: ModelFileKey;
  url: string;
  approxBytes: number;
  kind: "onnx" | "json" | "text";
}

const SD_TURBO = "https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main";
const TOKENIZER = "https://huggingface.co/stabilityai/sd-turbo/resolve/main/tokenizer";

export const MODEL_FILES: ModelFile[] = [
  { key: "text_encoder", url: `${SD_TURBO}/text_encoder/model.onnx`, approxBytes: 681e6, kind: "onnx" },
  { key: "unet", url: `${SD_TURBO}/unet/model.onnx`, approxBytes: 1.73e9, kind: "onnx" },
  { key: "vae_decoder", url: `${SD_TURBO}/vae_decoder/model.onnx`, approxBytes: 99e6, kind: "onnx" },
  { key: "vocab", url: `${TOKENIZER}/vocab.json`, approxBytes: 1.1e6, kind: "json" },
  { key: "merges", url: `${TOKENIZER}/merges.txt`, approxBytes: 0.53e6, kind: "text" },
];

export function missingFiles(cachedKeys: ModelFileKey[]): ModelFile[] {
  return MODEL_FILES.filter((f) => !cachedKeys.includes(f.key));
}

export function totalApproxBytes(files: ModelFile[]): number {
  return files.reduce((s, f) => s + f.approxBytes, 0);
}

export function isDownloadComplete(received: number, contentLength: number | null): boolean {
  return contentLength === null ? received > 0 : received === contentLength;
}
