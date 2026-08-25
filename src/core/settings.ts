// Plugin-Settings — pure (Spec §5.1). Leerer outputFolder = Obsidians Attachment-Logik,
// leerer noteFolder = Notiz landet neben dem Bild.

import { STEPS } from "./generation";
import { DEFAULT_ASSET_BASE_URL, type BuiltinModelId } from "./model-manifest";
import {
  arrayOf,
  arrayThen,
  check,
  isPlainObject,
  nonEmptyString,
  oneOf,
  type SettingsSchema,
} from "../vendor/kit/settings_schema";

export type EngineChoice = "builtin" | "server";

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
  /** Negativ-Prompt (A1111-kompatibel) — leerer String heißt "nicht gesetzt" (Spec §5). */
  negativePrompt: string;
  seed: number;
  steps: number;
  /** Classifier-Free-Guidance-Wert (A1111-kompatibel, Spec §5). */
  cfg: number;
  model: string;
  width: number;
  height: number;
  /** Lokaler ISO-8601-Stempel, beim Generier-Erfolg eingefroren (siehe isoStamp). */
  created: string;
  /** Nicht-null ⇔ der Eintrag war ein img2img-Lauf (Spec 0.8 §1/§7). */
  denoising: number | null;
  /** Vault-Pfad der Vorlage, nicht ihre Bytes — die Historie liegt in data.json. null heisst
   *  „keine benennbare Herkunft": txt2img, oder ein API-Lauf ohne Vault-Datei. */
  initImage: string | null;
}

export interface LigSettings {
  /** Welches Backend Bilder erzeugt (Spec 0.6 §2/§6): die eingebaute SD-Turbo-Engine (WebGPU,
   *  Modell per Klick nachgeladen — Default, zero-setup) oder ein lokaler A1111-kompatibler
   *  Server (Draw Things, A1111, Forge, SD.Next). Bestandsnutzer mit Endpunkt landen per
   *  migrateSettings() im Server-Modus. */
  engine: EngineChoice;
  /** Basis-URL der Modell-/Runtime-Assets für den Download (Spec 0.6 §3). Default ist das
   *  eigene HF-Repo; änderbar für Spiegel oder einen lokalen Server (GUI-Smoke). Der Cache
   *  hängt nicht an der URL (cacheKey ist hash-gebunden). */
  assetBaseUrl: string;
  outputFolder: string;
  noteFolder: string;
  /** URL des lokalen Bild-Servers (A1111-kompatibel), z. B. "http://127.0.0.1:7860". */
  endpoint: string;
  /** Startwert des Steps-Sliders (1..50) — kein Zwang, wird nicht zurückgeschrieben. */
  defaultSteps: number;
  /** Was der Create-Button tut: nur Bild (0.1-Verhalten) oder Bild + Notiz. */
  createMode: "image" | "note";
  presets: StylePreset[];
  /** MRU, neueste zuerst — volle Rezepte. Zustand, kein Regler. */
  history: HistoryEntry[];
  /** Ansicht des Historie-Tabs. */
  historyView: "recent" | "grouped";
  /** Legacy: totes Feld seit 0.5 (Thin-Client). Der Modell-Katalog wurde durch den
   *  externen Server ersetzt (Spec §4/§5); kein Codepfad liest diesen Wert mehr. Das
   *  Feld bleibt, damit gespeicherte Konfigurationen ohne Migration laden. */
  selectedModel: string;
  /** Legacy: totes Feld seit 0.5 (Thin-Client). mflux lief in-process (Spec §6, bis 0.4);
   *  seit dem Umbau auf einen externen A1111-kompatiblen Server (Spec §4/§5) liest kein
   *  Codepfad diesen Wert mehr. Das Feld bleibt, damit gespeicherte Konfigurationen ohne
   *  Migration laden. */
  mfluxPath: string;
  /** Legacy: totes Feld seit 0.5 (Thin-Client). HF_HOME galt nur für den früheren
   *  in-process-mflux-Kindprozess (Spec §6, bis 0.4); seit dem Umbau auf einen externen
   *  A1111-kompatiblen Server (Spec §4/§5) liest kein Codepfad diesen Wert mehr. Das Feld
   *  bleibt, damit gespeicherte Konfigurationen ohne Migration laden. */
  modelsDir: string;
  /** Legacy: Auf-/Zu-Zustand der früher einklappbaren Settings-Sektionen. Seit deren
   *  Wegfall (2026-07-20) liest den Wert kein Codepfad mehr; das Feld bleibt, damit
   *  gespeicherte Konfigurationen ohne Migration laden. */
  sectionsCollapsed: Record<string, boolean>;
  /** Welche eingebaute Modellstufe die Engine laedt (Spec 0.9 §6.1): SD-Turbo (Default,
   *  512 px, ~2,5 GB) oder SDXL-Turbo (groesser, hoehere Aufloesung). Nur relevant im
   *  builtin-Modus; bindet nicht in die Provider-API. */
  builtinModel: BuiltinModelId;
  /** Ob die Settings ueberhaupt eine Modellwahl anzeigen (Spec 0.9 §6.1). Default aus:
   *  bis zur zweiten Stufe gab es keine Wahl zu treffen. */
  showModelPicker: boolean;
}

export const DEFAULT_PRESETS: StylePreset[] = [
  { id: "sumi-e", label: "Sumi-e", suffix: "sumi-e painting, monochrome ink" },
  { id: "watercolor", label: "Watercolor", suffix: "watercolor painting, soft washes" },
  { id: "photo", label: "Photo", suffix: "photograph, natural light, sharp focus" },
  { id: "oil", label: "Oil", suffix: "oil painting, visible brush strokes" },
];

export const DEFAULT_SETTINGS: LigSettings = {
  engine: "builtin",
  assetBaseUrl: DEFAULT_ASSET_BASE_URL,
  outputFolder: "",
  noteFolder: "",
  endpoint: "",
  defaultSteps: STEPS.default,
  createMode: "image",
  presets: DEFAULT_PRESETS,
  history: [],
  historyView: "recent",
  selectedModel: "",
  mfluxPath: "",
  modelsDir: "",
  sectionsCollapsed: {},
  builtinModel: "sd-turbo",
  showModelPicker: false,
};

/** Filter + Backfill der Historie — Migration 0.3→0.4 (width/height) und 0.4→0.5
 *  (negativePrompt/cfg). Bekommt aus `arrayThen` den rohen Array-Inhalt und ist selbst
 *  dafür zuständig, kaputte Einträge zu verwerfen: sie ist die einzige Stelle, die die
 *  Alt-Form kennt. Ein kaputter Eintrag kostet nicht die ganze Liste. */
function migrateHistory(raw: unknown[]): HistoryEntry[] {
  return raw
    .filter(
      (
        h,
      ): h is Omit<HistoryEntry, "width" | "height" | "negativePrompt" | "cfg" | "denoising" | "initImage"> & {
        width?: unknown;
        height?: unknown;
        negativePrompt?: unknown;
        cfg?: unknown;
        denoising?: unknown;
        initImage?: unknown;
      } =>
        isPlainObject(h) &&
        typeof h["prompt"] === "string" &&
        typeof h["seed"] === "number" &&
        typeof h["steps"] === "number" &&
        typeof h["model"] === "string" &&
        typeof h["created"] === "string",
    )
    .map((h) => ({
      ...h,
      // Migration 0.3→0.4: Alt-Einträge sind alle SD-Turbo-512er (Spec §8).
      width: typeof h.width === "number" ? h.width : 512,
      height: typeof h.height === "number" ? h.height : 512,
      // Migration 0.4→0.5: Alt-Einträge kannten weder negativePrompt noch cfg (Spec §5/§8).
      negativePrompt: typeof h.negativePrompt === "string" ? h.negativePrompt : "",
      cfg: typeof h.cfg === "number" ? h.cfg : 7,
      // Migration 0.7→0.8: img2img ist neu. null heisst „war keins" — ein Vorgabewert waere
      // eine Angabe ueber einen Lauf, der nie stattgefunden hat (Spec §1).
      denoising: typeof h.denoising === "number" ? h.denoising : null,
      initImage: typeof h.initImage === "string" ? h.initImage : null,
    }));
}

/** 0.5 → 0.6 (Spec 0.6 §8): das Feld `engine` ist neu. Fehlt es, bleibt ein Nutzer mit
 *  eingetragenem Endpunkt im Server-Modus — niemand verliert seine Konfiguration; alle anderen
 *  bekommen die eingebaute Engine (Zero-Setup-Default). Läuft VOR mergeSettings, sonst hätte
 *  der Default "builtin" die Entscheidung schon getroffen. Pure. */
export function migrateSettings(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const s = raw as Record<string, unknown>;
  if (s["engine"] !== undefined) return raw;
  const endpoint = typeof s["endpoint"] === "string" ? s["endpoint"].trim() : "";
  return { ...s, engine: endpoint !== "" ? "server" : "builtin" };
}

/** Feldprüfer für `validateSettings` (Kit `pure/settings_schema.ts`, Schicht 2 — geschlossene
 *  Welt). Eine handeditierte oder von einem Sync-Konflikt zerlegte `data.json` darf nicht in
 *  vier verschiedenen Renderstellen (Chips, Preset-Editor, Collapsible-Storage, Historie-Push)
 *  auf falsche Formannahmen treffen; jedes Feld fällt einzeln auf seinen Default zurück, statt
 *  das ganze Objekt zu verwerfen.
 *
 *  Zwei Aufrufstellen, beide mit diesem Schema: das Laden (`main.ts::onload`) und der
 *  Schreibpfad des Settings-Tabs (`validateSettings(D, { ...settings, [key]: value })`) —
 *  die Funktion ist idempotent.
 *
 *  **Ohne Eintrag bleiben absichtlich** `outputFolder`, `noteFolder`, `endpoint`,
 *  `selectedModel`, `mfluxPath`, `modelsDir` und `sectionsCollapsed`: für sie leistet die
 *  generische Bauform-Prüfung gegen den Default (`""` bzw. `{}`) exakt dasselbe wie die
 *  früheren Feld-Sanitizer. Ein leerer String ist hier kein Fehler, sondern eine Aussage
 *  (leerer outputFolder = Obsidians Attachment-Logik). */
export const SETTINGS_SCHEMA: SettingsSchema<LigSettings> = {
  engine: oneOf<EngineChoice>(["builtin", "server"]),
  assetBaseUrl: nonEmptyString({ trim: true }),
  // check(...), NICHT clampIntField(1, 50): der Kombinator ist String-tolerant und trunct
  // Floats ("3" → 3, 2.5 → 2). Hier gilt ein Wert, der kein ganzzahliger Schritt im Bereich
  // ist, als kaputt und fällt auf den Default zurück (gepinnt in tests/settings.test.ts).
  defaultSteps: check<number>(
    (v) => typeof v === "number" && Number.isInteger(v) && v >= STEPS.min && v <= STEPS.max,
  ),
  createMode: oneOf<LigSettings["createMode"]>(["image", "note"]),
  presets: arrayOf<StylePreset>(
    (p) =>
      isPlainObject(p) && typeof p["id"] === "string" && typeof p["label"] === "string" && typeof p["suffix"] === "string",
  ),
  history: arrayThen<HistoryEntry>(migrateHistory),
  historyView: oneOf<LigSettings["historyView"]>(["recent", "grouped"]),
  builtinModel: oneOf<BuiltinModelId>(["sd-turbo", "sdxl-turbo"]),
  showModelPicker: check<boolean>((v) => typeof v === "boolean"),
};
