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

export function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
