// Dateinamens-Schema (Spec §7): lig-<YYYYMMDD-HHmmss>-s<seed>.png
export function buildImageFilename(d: Date, seed: number): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `lig-${stamp}-s${seed}.png`;
}

// Kollisions-Dedup für explizite Output-Ordner (Spec §7): hängt -2, -3, … vor
// `.png` an, bis `exists` einen freien Pfad meldet. Pure — der Vault-Lookup wird
// injiziert, damit die Funktion in Node testbar bleibt.
export function dedupeFilename(base: string, exists: (p: string) => boolean): string {
  if (!exists(base)) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "" : base.slice(dot);
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}
