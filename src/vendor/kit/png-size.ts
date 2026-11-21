// vendored from code-kit@0.87.0, src/ts/pure/png-size.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: first use local-image-generator (the size of a ComfyUI result goes into the result note as measured, not as
// requested — an edit workflow resizes to about one megapixel, an upscaler multiplies by four; 2026-11-22). No PNG
// header reader existed in code-kit, obsidian-kit or the plugins (searched 2026-11-22).

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function u32(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) * 0x1000000) + (((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0));
}

/** Width and height from a PNG's IHDR chunk, or `null` when `bytes` is not a PNG: wrong signature, fewer than 24
 *  bytes, a first chunk other than `IHDR` (the PNG spec requires it first), or a zero dimension. Reads the header
 *  only; the CRC and the image data are not checked. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  // Bytes 8–11 are the chunk length, 12–15 its type.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}
