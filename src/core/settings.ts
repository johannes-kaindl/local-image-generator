// Plugin-Settings — pure (Spec §5.1). Leerer outputFolder = Obsidians Attachment-Logik,
// leerer noteFolder = Notiz landet neben dem Bild.

/** Ein Stil-Baustein, der per Chip an den Prompt gehängt wird. */
export interface StylePreset {
  /** Stabil über Umbenennungen hinweg — identifiziert die Zeile im Editor. */
  id: string;
  /** Chip-Beschriftung. */
  label: string;
  /** Wird an den Prompt gehängt; darf selbst kommasepariert mehrteilig sein. */
  suffix: string;
}

/** Ein aufgezeichnetes Rezept in der Historie (volle Reproduktion). */
export interface HistoryEntry {
  prompt: string;
  seed: number;
  steps: number;
  model: string;
  /** Lokaler ISO-8601-Stempel, beim Generier-Erfolg eingefroren (siehe isoStamp). */
  created: string;
}

export interface LigSettings {
  outputFolder: string;
  noteFolder: string;
  /** Startwert des Steps-Sliders (1..4) — kein Zwang, wird nicht zurückgeschrieben. */
  defaultSteps: number;
  /** Was der Create-Button tut: nur Bild (0.1-Verhalten) oder Bild + Notiz. */
  createMode: "image" | "note";
  presets: StylePreset[];
  /** MRU, neueste zuerst — volle Rezepte. Zustand, kein Regler. */
  history: HistoryEntry[];
  /** Ansicht des Historie-Tabs. */
  historyView: "recent" | "grouped";
  /** Auf-/Zu-Zustand der Settings-Sektionen, Key → collapsed. */
  sectionsCollapsed: Record<string, boolean>;
}

export const DEFAULT_PRESETS: StylePreset[] = [
  { id: "sumi-e", label: "Sumi-e", suffix: "sumi-e painting, monochrome ink" },
  { id: "watercolor", label: "Watercolor", suffix: "watercolor painting, soft washes" },
  { id: "photo", label: "Photo", suffix: "photograph, natural light, sharp focus" },
  { id: "oil", label: "Oil", suffix: "oil painting, visible brush strokes" },
];

export const DEFAULT_SETTINGS: LigSettings = {
  outputFolder: "",
  noteFolder: "",
  defaultSteps: 4,
  createMode: "image",
  presets: DEFAULT_PRESETS,
  history: [],
  historyView: "recent",
  sectionsCollapsed: {},
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sanitizePresets(raw: unknown): StylePreset[] {
  if (!Array.isArray(raw)) return DEFAULT_PRESETS.map((p) => ({ ...p }));
  return raw.filter(
    (p): p is StylePreset =>
      isPlainObject(p) && typeof p["id"] === "string" && typeof p["label"] === "string" && typeof p["suffix"] === "string",
  );
}

function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (h): h is HistoryEntry =>
      isPlainObject(h) &&
      typeof h["prompt"] === "string" &&
      typeof h["seed"] === "number" &&
      typeof h["steps"] === "number" &&
      typeof h["model"] === "string" &&
      typeof h["created"] === "string",
  );
}

function sanitizeHistoryView(raw: unknown): "recent" | "grouped" {
  return raw === "grouped" ? "grouped" : "recent";
}

function sanitizeSectionsCollapsed(raw: unknown): Record<string, boolean> {
  return isPlainObject(raw) ? (raw as Record<string, boolean>) : {};
}

function sanitizeDefaultSteps(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 4 ? raw : DEFAULT_SETTINGS.defaultSteps;
}

function sanitizeCreateMode(raw: unknown): "image" | "note" {
  return raw === "note" ? "note" : "image";
}

function sanitizeFolder(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Bereinigt einen geladenen Settings-Stand (Spec §8): handeditierte oder korrupte
 *  `data.json` darf nicht in vier verschiedenen Renderstellen (Chips, Preset-Editor,
 *  Collapsible-Storage, Historie-Push) auf falsche Formannahmen treffen. Fällt Feld für
 *  Feld auf den Default zurück, statt das ganze Objekt zu verwerfen. Pure — einmal beim
 *  Laden aufgerufen, direkt nach `mergeSettings`. */
export function sanitizeSettings(raw: unknown): LigSettings {
  // Roh und untypisiert lesen: der Sinn dieser Funktion ist gerade, korruptem/handeditiertem
  // Input zu misstrauen — die Feld-Sanitizer erwarten daher alle `unknown`.
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    outputFolder: sanitizeFolder(s.outputFolder),
    noteFolder: sanitizeFolder(s.noteFolder),
    defaultSteps: sanitizeDefaultSteps(s.defaultSteps),
    createMode: sanitizeCreateMode(s.createMode),
    presets: sanitizePresets(s.presets),
    history: sanitizeHistory(s.history),
    historyView: sanitizeHistoryView(s.historyView),
    sectionsCollapsed: sanitizeSectionsCollapsed(s.sectionsCollapsed),
  };
}
