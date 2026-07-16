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

// Notiz-Dateiname (Spec §7.4): "<Prompt-Slug, max 60> - <seed>.md", nach Jays
// handgebautem Vorbild aus dem Smoke-Test ("Apple - Sumi-e painting - 199801046.md").
const FORBIDDEN = /[[\]#^|/\\:*?"<>]/g;
const SLUG_MAX = 60;

export function buildNoteFilename(prompt: string, seed: number): string {
  const slug = prompt
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SLUG_MAX)
    .replace(/^\.+/, "") // führender Punkt = versteckte Datei
    .trim();
  return slug === "" ? `lig-${seed}.md` : `${slug} - ${seed}.md`;
}

// Verzeichnis eines Vault-Pfads; "" im Root. Pure — kein Vault-Zugriff.
export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// Lokaler ISO-8601-Zeitstempel ohne Zeitzone für das Frontmatter-Feld `created`.
// Bewusst lokal, nicht UTC: die Notiz dokumentiert, wann JAY das Bild gemacht hat.
export function isoStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
