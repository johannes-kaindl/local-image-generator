import type { Crop } from "../vendor/kit/crop";
import { drawCroppedImage } from "../vendor/kit-obsidian/image-crop";
// zurueckgeholt aus local-image-generator@0.4.4, 2026-08-19 (rgbaToDataUrl)
// RGBA → PNG über den nativen Canvas (keine Encoder-Dependency) für die eingebaute Engine;
// der Server liefert fertiges PNG, dort bleibt nur der Decode nötig.
export function rgbaToDataUrl(rgba: Uint8ClampedArray, w: number, h: number): string {
  const canvas = createEl("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  // Frische Kopie: garantiert einen plain-ArrayBuffer-Puffer (ImageData akzeptiert
  // unter TS' generischem ArrayBuffer-Typing kein Uint8ClampedArray<ArrayBufferLike>).
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return canvas.toDataURL("image/png");
}

/** Der Base64-Teil einer dataUrl, ohne `data:<mime>;base64,`-Praefix — genau die Form, die
 *  die A1111-API in `init_images` erwartet und die die Provider-API als `initImage` nimmt. */
export function base64OfDataUrl(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** Nackte Base64 (PNG/JPEG/WebP) → CHW-Float32 [-1,1] in Zielgroesse. Ohne `crop` zentriertes
 *  Quadrat der kuerzeren Seite (Center-Crop-Cover, kein Verzerren), mit `crop` der gewaehlte
 *  Bereich (quadratisch in Bildpunkten, siehe `vendor/kit/crop.ts`). Gezeichnet wird ueber das Kit-Modul `image-crop` (createImageBitmap statt
 *  <img src=data:...>: der Blob wird am INHALT erkannt, nicht an einem behaupteten MIME-Typ — initImageData traegt keinen). */
export async function decodeInitImage(base64: string, size: number, crop: Crop | null = null): Promise<Float32Array> {
  // Ausschnitt zeichnen (Kit `image-crop`: Base64 → Bitmap am Inhalt erkannt → Canvas `size`×`size`); hier bleibt die Tensor-Umwandlung.
  const canvas = await drawCroppedImage(base64, crop, size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const { data } = ctx.getImageData(0, 0, size, size);
  const px = size * size;
  const out = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    out[i] = (data[i * 4]! / 255) * 2 - 1;
    out[px + i] = (data[i * 4 + 1]! / 255) * 2 - 1;
    out[2 * px + i] = (data[i * 4 + 2]! / 255) * 2 - 1;
  }
  return out;
}
