import { localFileStamp, localIso } from "../vendor/kit/local-stamp";
import { baseName, splitFileName } from "../vendor/kit/rel-path";
import type { GenParams } from "./viewmodel";
// Dateinamens-Schema: lig-<YYYYMMDD-HHmmss>-s<seed>.png
export function buildImageFilename(d: Date, seed: number): string {
  return `lig-${localFileStamp(d, { compact: true, seconds: true })}-s${seed}.png`;
}

// Kollisions-Dedup für explizite Output-Ordner: hängt -2, -3, … vor
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

// Notiz-Dateiname: "<Prompt-Slug, max 60> - <seed>.md", nach Jays
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
  return localIso(d, { seconds: true, offset: false });
}

/** Stamm der Quelldatei fuer ein Hochskalieren, oder null ohne benennbare Quelle (API-Bytes). */
function upscaleStem(p: GenParams): string | null {
  if (p.initImage === null) return null;
  const stem = splitFileName(baseName(p.initImage)).stem.replace(FORBIDDEN, " ").trim();
  return stem === "" ? null : `${stem}-upscale`;
}

/** Dateiname des Ergebnisbildes. Hochskalieren hat keinen Seed: es heisst nach der Quelle (`turm-upscale.png`), ohne
 *  Quelle nach dem Zeitstempel. Erzeugen und Bearbeiten behalten `lig-<Stempel>-s<seed>.png`. */
export function imageFilenameFor(p: GenParams): string {
  if (p.task !== "upscale") return buildImageFilename(new Date(p.date), p.seed);
  return `${upscaleStem(p) ?? `lig-${localFileStamp(new Date(p.date), { compact: true, seconds: true })}-upscale`}.png`;
}

/** Dateiname der Ergebnis-Notiz, nach derselben Regel wie `imageFilenameFor`. */
export function noteFilenameFor(p: GenParams): string {
  if (p.task !== "upscale") return buildNoteFilename(p.prompt, p.seed);
  return `${upscaleStem(p) ?? `lig-${localFileStamp(new Date(p.date), { compact: true, seconds: true })}-upscale`}.md`;
}
