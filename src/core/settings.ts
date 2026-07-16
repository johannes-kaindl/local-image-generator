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

export interface LigSettings {
  outputFolder: string;
  noteFolder: string;
  /** Startwert des Steps-Sliders (1..4) — kein Zwang, wird nicht zurückgeschrieben. */
  defaultSteps: number;
  /** Was der Create-Button tut: nur Bild (0.1-Verhalten) oder Bild + Notiz. */
  createMode: "image" | "note";
  presets: StylePreset[];
  /** MRU, neueste zuerst. Zustand, kein Regler — data.json ist der einzige Speicher. */
  promptHistory: string[];
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
  promptHistory: [],
  sectionsCollapsed: {},
};
