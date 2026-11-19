// vendored from code-kit@0.80.0, src/ts/pure/crop.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The frame of a crop on an image: a square in pixels, stored relative to the size of the original, with the arithmetic to move it,
 *  resize it and cut it out. Pure — no DOM, no canvas; the modal that draws and drags the frame lives in obsidian-kit.
 *
 *  Origin: local-image-generator `src/core/crop.ts` (2969530, blob ca6dbe89), taken over **unchanged** — names, signatures and
 *  behaviour are the same, shown by `tests/crop.test.ts` against a verbatim reference copy of the original on a grid of image sizes,
 *  frames and moves; only the comments are rewritten (English). Built there first ("Bibliothek ab Eins": no other plugin held a crop).
 *
 *  The frame is square **in pixels** (the engine computes square; a rectangle would distort) but stored **normalised** to [0,1] of the
 *  original, so one recipe means the same part of the image for a 512² and a 1024² model. `null` where a frame is carried means "not
 *  chosen": the built-in engine takes the centred square, a server decides on its own. */

/** Part of an image, normalised to [0,1]. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shortest side of the frame, in pixels of the original. */
export const MIN_CROP_PX = 32;

const EPS = 1e-9;

export function cropEquals(a: Crop | null, b: Crop | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** A crop from unchecked data (settings file, foreign plugin). Anything unreasonable is `null`: finite numbers, position and size
 *  positive, the frame inside the image. Never throws. */
export function parseCrop(v: unknown): Crop | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { x, y, w, h } = o;
  if (typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") return null;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 + EPS || y + h > 1 + EPS) return null;
  return { x, y, w, h };
}

/** The source rectangle in pixels. `null` is the behaviour before frames existed: the centred square of the shorter side
 *  (centre-crop cover). */
export function cropSourceRect(imgW: number, imgH: number, crop: Crop | null): { sx: number; sy: number; sw: number; sh: number } {
  if (crop === null) {
    const s = Math.min(imgW, imgH);
    // Not rounded: this is exactly the source the built-in engine used before frames, and recipes saved then are measured against it.
    return { sx: (imgW - s) / 2, sy: (imgH - s) / 2, sw: s, sh: s };
  }
  const sx = Math.min(Math.round(crop.x * imgW), imgW - 1);
  const sy = Math.min(Math.round(crop.y * imgH), imgH - 1);
  const sw = Math.max(1, Math.min(Math.round(crop.w * imgW), imgW - sx));
  const sh = Math.max(1, Math.min(Math.round(crop.h * imgH), imgH - sy));
  return { sx, sy, sw, sh };
}

/** The source rectangle that fills a `width` × `height` target completely ("cover"): the part of the source (the frame `crop`, or the
 *  whole image where it is `null`) that keeps the aspect ratio of the target, centred in the source, so the drawing is cut and never
 *  stretched. Same four names as `cropSourceRect` and drawn the same way — `drawImage(bmp, sx, sy, sw, sh, 0, 0, width, height)`.
 *
 *  **`null` is not the centred square here.** `cropSourceRect(…, null)` is the square of the shorter side because the built-in engine
 *  draws a square; a target that is not square would lose the rest of the image for nothing, so the source of a cover with no frame is
 *  the whole image. A frame is read exactly as `cropSourceRect` reads it (rounded, clamped).
 *
 *  The rectangle is NOT rounded (`sw`, `sh`, `sx`, `sy` can be fractions): the canvas takes fractions and a rounded edge would make the
 *  aspect ratio drift by up to a pixel. One side always equals the source side, the other is shorter or equal.
 *
 *  Origin: local-image-generator `fitInitImageToSize` (Welle 36, order over width), whose Draw Things server refuses an init image of
 *  other size with HTTP 422. Throws `RangeError` where the target is no positive integer (a canvas has whole pixels) or the image has
 *  no positive finite size — the same error obsidian-kit's `drawCroppedImage` raises for its target. */
export function coverSourceRect(
  imgW: number, imgH: number, crop: Crop | null, width: number, height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  for (const [name, v] of [["width", width], ["height", height]] as const) {
    if (!(Number.isInteger(v) && v > 0)) throw new RangeError(`${name} must be a positive integer`);
  }
  for (const [name, v] of [["imgW", imgW], ["imgH", imgH]] as const) {
    if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`${name} must be a positive finite number`);
  }
  const src = crop === null ? { sx: 0, sy: 0, sw: imgW, sh: imgH } : cropSourceRect(imgW, imgH, crop);
  // Which side of the target needs the larger factor decides which side of the source is used whole. Computed per side (not as
  // `width / scale`) so the whole side comes out exactly, not one ulp off.
  const byWidth = width / src.sw >= height / src.sh;
  const sw = byWidth ? src.sw : (width * src.sh) / height;
  const sh = byWidth ? (height * src.sw) / width : src.sh;
  return { sx: src.sx + (src.sw - sw) / 2, sy: src.sy + (src.sh - sh) / 2, sw, sh };
}

/** The largest centred square — the starting frame, equal to the centre crop. */
export function defaultCrop(imgW: number, imgH: number): Crop {
  const s = Math.min(imgW, imgH);
  return { x: (imgW - s) / 2 / imgW, y: (imgH - s) / 2 / imgH, w: s / imgW, h: s / imgH };
}

/** Moves the frame by (dx, dy) pixels; it stays inside the image. */
export function moveCrop(c: Crop, imgW: number, imgH: number, dx: number, dy: number): Crop {
  const x = Math.min(Math.max(c.x + dx / imgW, 0), 1 - c.w);
  const y = Math.min(Math.max(c.y + dy / imgH, 0), 1 - c.h);
  return { x, y, w: c.w, h: c.h };
}

/** Changes the side of the frame by `deltaPx` pixels, anchored at the top left, square in pixels. Clamped to
 *  [MIN_CROP_PX, what fits up to the edge of the image]. */
export function resizeCrop(c: Crop, imgW: number, imgH: number, deltaPx: number): Crop {
  const side = c.w * imgW;
  const maxSide = Math.min((1 - c.x) * imgW, (1 - c.y) * imgH);
  const next = Math.min(Math.max(side + deltaPx, Math.min(MIN_CROP_PX, maxSide)), maxSide);
  return { x: c.x, y: c.y, w: next / imgW, h: next / imgH };
}

/** The frame as text for a result note: `x=0.125 y=0 w=0.75 h=1`, rounded to four decimals (one pixel of a 10 000-pixel image is
 *  0.0001). */
export function formatCrop(c: Crop): string {
  const r = (v: number): string => String(Math.round(v * 10000) / 10000);
  return `x=${r(c.x)} y=${r(c.y)} w=${r(c.w)} h=${r(c.h)}`;
}
