// VAE-Output ([1,3,h,w] CHW, Werte in [-1,1]) → RGBA für Canvas/ImageData (Spec §5).
export function chwToRgba(data: Float32Array, w: number, h: number): Uint8ClampedArray {
  const px = w * h;
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    out[i * 4] = Math.round((Math.min(1, Math.max(-1, data[i]!)) / 2 + 0.5) * 255);
    out[i * 4 + 1] = Math.round((Math.min(1, Math.max(-1, data[px + i]!)) / 2 + 0.5) * 255);
    out[i * 4 + 2] = Math.round((Math.min(1, Math.max(-1, data[2 * px + i]!)) / 2 + 0.5) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
