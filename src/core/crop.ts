// Ausschnitt der Vorlage (img2img): reine Geometrie ohne DOM. Der Rahmen ist in BILDPUNKTEN
// quadratisch (die Engine rechnet quadratisch, ein Rechteck wuerde verzerren), gespeichert
// aber NORMALISIERT auf [0,1] relativ zur Originalgroesse — dasselbe Rezept meint damit fuer
// SD-Turbo (512²) und SDXL-Turbo (1024²) denselben Bildbereich (Spec img2img-Steuerung §4.2).

/** Bildbereich der Vorlage, normalisiert auf [0,1]. `null` an den Stellen, die ihn tragen,
 *  heisst „nicht gewaehlt": builtin rechnet zentriert, der Server entscheidet selbst. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kleinste Seite des Rahmens in Bildpunkten des Originals. */
export const MIN_CROP_PX = 32;

const EPS = 1e-9;

export function cropEquals(a: Crop | null, b: Crop | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Ein Crop aus ungeprueften Daten (data.json, Fremdplugin). Alles Unsinnige ergibt `null`:
 *  endliche Zahlen, Position und Groesse positiv, Rahmen liegt im Bild. Wirft nie. */
export function parseCrop(v: unknown): Crop | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { x, y, w, h } = o;
  if (typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") return null;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 + EPS || y + h > 1 + EPS) return null;
  return { x, y, w, h };
}

/** Quellrechteck in Bildpunkten. `null` = das bisherige Verhalten der eingebauten Engine:
 *  zentriertes Quadrat der kuerzeren Seite (Center-Crop-Cover). */
export function cropSourceRect(imgW: number, imgH: number, crop: Crop | null): { sx: number; sy: number; sw: number; sh: number } {
  if (crop === null) {
    const s = Math.min(imgW, imgH);
    // Nicht runden: das ist exakt die Quelle, die die eingebaute Engine bis 0.19 benutzt hat
    // (Bestandsrezepte und Smoke-Punkte 26/27 messen daran).
    return { sx: (imgW - s) / 2, sy: (imgH - s) / 2, sw: s, sh: s };
  }
  const sx = Math.min(Math.round(crop.x * imgW), imgW - 1);
  const sy = Math.min(Math.round(crop.y * imgH), imgH - 1);
  const sw = Math.max(1, Math.min(Math.round(crop.w * imgW), imgW - sx));
  const sh = Math.max(1, Math.min(Math.round(crop.h * imgH), imgH - sy));
  return { sx, sy, sw, sh };
}

/** Das groesste zentrierte Quadrat — Startwert des Rahmens, entspricht dem Center-Crop. */
export function defaultCrop(imgW: number, imgH: number): Crop {
  const s = Math.min(imgW, imgH);
  return { x: (imgW - s) / 2 / imgW, y: (imgH - s) / 2 / imgH, w: s / imgW, h: s / imgH };
}

/** Rahmen um (dx, dy) Bildpunkte verschieben; er bleibt im Bild. */
export function moveCrop(c: Crop, imgW: number, imgH: number, dx: number, dy: number): Crop {
  const x = Math.min(Math.max(c.x + dx / imgW, 0), 1 - c.w);
  const y = Math.min(Math.max(c.y + dy / imgH, 0), 1 - c.h);
  return { x, y, w: c.w, h: c.h };
}

/** Seitenlaenge des Rahmens um `deltaPx` Bildpunkte aendern, links oben verankert, quadratisch
 *  in Bildpunkten. Klemmt auf [MIN_CROP_PX, was bis zum Bildrand passt]. */
export function resizeCrop(c: Crop, imgW: number, imgH: number, deltaPx: number): Crop {
  const side = c.w * imgW;
  const maxSide = Math.min((1 - c.x) * imgW, (1 - c.y) * imgH);
  const next = Math.min(Math.max(side + deltaPx, Math.min(MIN_CROP_PX, maxSide)), maxSide);
  return { x: c.x, y: c.y, w: next / imgW, h: next / imgH };
}

/** Der Ausschnitt als Text fuer die Ergebnis-Notiz: `x=0.125 y=0 w=0.75 h=1`, auf vier
 *  Nachkommastellen gerundet (ein Bildpunkt eines 10 000-Pixel-Bildes ist 0.0001). */
export function formatCrop(c: Crop): string {
  const r = (v: number): string => String(Math.round(v * 10000) / 10000);
  return `x=${r(c.x)} y=${r(c.y)} w=${r(c.w)} h=${r(c.h)}`;
}
