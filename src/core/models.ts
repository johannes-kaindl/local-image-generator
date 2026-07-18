// Modell-Katalog (Spec §3): die UI rendert Regler AUS diesem Katalog, kein Modell-if/else
// in Panels. CFG/Negative-Prompt existieren bewusst nicht als Felder — beide Modelle sind
// guidance-distilliert (Keine-Attrappen-Linie, Spec §2).
export interface SizeOption {
  width: number;
  height: number;
}

export interface ModelSpec {
  id: "sd-turbo" | "flux2-klein-4b";
  /** Anzeige im Dropdown — Eigenname, unübersetzt. */
  label: string;
  engine: "ort" | "mflux";
  steps: { min: number; max: number; default: number };
  /** length 1 → Größen-Regler unsichtbar. Alle Werte Vielfache von 16. */
  sizes: readonly SizeOption[];
  /** Stufe A: überall 0. Stufe B setzt FLUX auf 4 (Spec §12). */
  maxReferences: number;
  /** Nur für engine "mflux": CLI-Modellname + HF-Repo (Gewichte-Erkennung). */
  mflux?: { modelArg: string; hfRepo: string };
}

export const DEFAULT_MODEL_ID = "sd-turbo";

export const MODELS: readonly ModelSpec[] = [
  {
    id: "sd-turbo",
    label: "SD-Turbo",
    engine: "ort",
    steps: { min: 1, max: 4, default: 4 },
    sizes: [{ width: 512, height: 512 }],
    maxReferences: 0,
  },
  {
    id: "flux2-klein-4b",
    label: "FLUX.2 klein 4B",
    engine: "mflux",
    steps: { min: 1, max: 8, default: 4 },
    sizes: [
      { width: 512, height: 512 },
      { width: 768, height: 768 },
      { width: 1024, height: 1024 },
      { width: 768, height: 512 },
      { width: 512, height: 768 },
      { width: 1024, height: 576 },
      { width: 576, height: 1024 },
    ],
    maxReferences: 0,
    mflux: { modelArg: "flux2-klein-4b", hfRepo: "black-forest-labs/FLUX.2-klein-4B" },
  },
];

/** Fallback sd-turbo: unbekannte IDs (handeditierte data.json, Alt-Rezepte) dürfen
 *  nirgends crashen — Sanitizing-Muster wie sanitizeSettings (Spec 0.2 §8). */
export function getModel(id: string): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}
