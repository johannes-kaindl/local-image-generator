// Dateinamens-Schema (Spec §7): lig-<YYYYMMDD-HHmmss>-s<seed>.png
export function buildImageFilename(d: Date, seed: number): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `lig-${stamp}-s${seed}.png`;
}
