# Multi-Modell-Support (FLUX.2 klein 4B via mflux) — Implementierungsplan 0.4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zweites Modell FLUX.2 klein 4B als mflux-Kindprozess, hinter einem Modell-Katalog mit Capabilities; SD-Turbo bleibt unverändert.

**Architecture:** Statischer Modell-Katalog (`src/core/models.ts`) treibt UI-Regler und Engine-Dispatch. Neue `MfluxEngine` (ein `spawn` pro Generierung, stdout/stderr-Parser → bestehende Statusphasen, Stall-Watchdog). Settings um `selectedModel`/`mfluxPath`/`modelsDir` erweitert; Rezepte/Notizen um `width`/`height`.

**Tech Stack:** TypeScript · Obsidian-Plugin · `node:child_process`/`node:fs`/`node:os` (nur `src/obsidian/`) · vitest · mflux (extern, vom User installiert)

**Spec:** `docs/superpowers/specs/2026-07-18-multi-modell-flux2-design.md`

## Global Constraints

- **Gate vor jedem Commit grün:** `npm run gate` (typecheck + vitest + check:pure + build).
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren NIE `obsidian` und NIE Node-Builtins. Alles mit IO-Bedarf (fs/spawn/os) lebt in `src/obsidian/`; pure Logik bekommt Funktionen injiziert.
- **i18n:** Jeder neue UI-String läuft über `t("key", …)` und wird in BEIDEN Dicts (`src/i18n/strings.ts`, EN und DE) ergänzt — im selben Task wie seine Verwendung. Modellnamen (`SD-Turbo`, `FLUX.2 klein 4B`) sind Eigennamen und bleiben unübersetzt.
- **Commit style:** Conventional Commits (deutsch), Co-Authored-By-Trailer.
- **mflux-CLI (verifiziert gegen installierte Version 2026-07-18):** Kommando `mflux-generate-flux2`; Flags `--model flux2-klein-4b`, `--quantize 8` (erlaubt: 3,4,5,6,8), `--prompt`, `--seed` (nargs, wir übergeben genau einen), `--steps`, `--width`, `--height`, `--output <pfad>`. `HF_HOME` wird respektiert. HF-Repo: `black-forest-labs/FLUX.2-klein-4B`.
- **tqdm schreibt auf stderr und trennt mit `\r`:** Der Zeilen-Splitter im Engine-Adapter MUSS auf `\r` UND `\n` splitten und stdout+stderr durch DENSELBEN Parser schicken.
- **Nebenläufigkeits-Lesson (2026-07-18):** Tasks 8 und 10 enthalten Prozess-Lebenszyklus-/Watchdog-Logik — der Task-Reviewer rechnet konkrete Interleaving-Szenarien Schritt für Schritt durch (View-Close während Lauf · Watchdog feuert nach Prozess-Ende · zweiter Generate während Kill · Unload während Download); 2–3 Review-Runden sind eingeplant, nicht Scheitern.

---

### Task 1: Modell-Katalog

**Files:**
- Create: `src/core/models.ts`
- Test: `tests/models.test.ts`

**Interfaces:**
- Produces: `ModelSpec`, `SizeOption`, `MODELS`, `getModel(id: string): ModelSpec`, `DEFAULT_MODEL_ID = "sd-turbo"` — von fast allen Folge-Tasks konsumiert.

- [ ] **Step 1: Failing Test schreiben**

```ts
// tests/models.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, getModel, MODELS } from "../src/core/models";

describe("model catalog", () => {
  it("kennt genau sd-turbo und flux2-klein-4b", () => {
    expect(MODELS.map((m) => m.id)).toEqual(["sd-turbo", "flux2-klein-4b"]);
  });
  it("sd-turbo: ORT, nur 512², Steps 1–4", () => {
    const m = getModel("sd-turbo");
    expect(m.engine).toBe("ort");
    expect(m.sizes).toEqual([{ width: 512, height: 512 }]);
    expect(m.steps).toEqual({ min: 1, max: 4, default: 4 });
    expect(m.mflux).toBeUndefined();
  });
  it("flux2-klein-4b: mflux, 7 Größen (alle 16er-Vielfache), Steps 1–8", () => {
    const m = getModel("flux2-klein-4b");
    expect(m.engine).toBe("mflux");
    expect(m.steps).toEqual({ min: 1, max: 8, default: 4 });
    expect(m.sizes).toHaveLength(7);
    for (const s of m.sizes) {
      expect(s.width % 16).toBe(0);
      expect(s.height % 16).toBe(0);
    }
    expect(m.mflux).toEqual({ modelArg: "flux2-klein-4b", hfRepo: "black-forest-labs/FLUX.2-klein-4B" });
  });
  it("getModel fällt bei unbekannter ID auf sd-turbo zurück (Sanitizing-Pfad)", () => {
    expect(getModel("garbage").id).toBe(DEFAULT_MODEL_ID);
    expect(getModel("").id).toBe(DEFAULT_MODEL_ID);
  });
});
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

Run: `npx vitest run tests/models.test.ts`
Expected: FAIL („Cannot find module …/src/core/models")

- [ ] **Step 3: Implementierung**

```ts
// src/core/models.ts
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
```

- [ ] **Step 4: Test laufen lassen — erwartet PASS**

Run: `npx vitest run tests/models.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 5: Gate + Commit**

```bash
npm run gate
git add src/core/models.ts tests/models.test.ts
git commit -m "feat(core): Modell-Katalog mit Capabilities (sd-turbo, flux2-klein-4b)"
```

---

### Task 2: Settings-Felder `selectedModel`, `mfluxPath`, `modelsDir`

**Files:**
- Modify: `src/core/settings.ts`
- Test: bestehende Settings-Tests ergänzen (`tests/settings.test.ts` — Datei existiert; neue describe-Blöcke anhängen)

**Interfaces:**
- Consumes: `DEFAULT_MODEL_ID`, `getModel` aus Task 1.
- Produces: `LigSettings.selectedModel: string`, `LigSettings.mfluxPath: string`, `LigSettings.modelsDir: string` (beide Pfade: `""` = Auto-Detect bzw. HF-Default), sanitisiert in `sanitizeSettings`.

- [ ] **Step 1: Failing Tests schreiben** (an `tests/settings.test.ts` anhängen)

```ts
describe("sanitizeSettings 0.4 (multi-model)", () => {
  it("Defaults: selectedModel sd-turbo, Pfade leer", () => {
    const s = sanitizeSettings({});
    expect(s.selectedModel).toBe("sd-turbo");
    expect(s.mfluxPath).toBe("");
    expect(s.modelsDir).toBe("");
  });
  it("unbekannte selectedModel fällt auf sd-turbo zurück", () => {
    expect(sanitizeSettings({ selectedModel: "flux99" }).selectedModel).toBe("sd-turbo");
    expect(sanitizeSettings({ selectedModel: 7 }).selectedModel).toBe("sd-turbo");
  });
  it("gültige selectedModel bleibt erhalten", () => {
    expect(sanitizeSettings({ selectedModel: "flux2-klein-4b" }).selectedModel).toBe("flux2-klein-4b");
  });
  it("Nicht-String-Pfade werden leer", () => {
    const s = sanitizeSettings({ mfluxPath: 42, modelsDir: null });
    expect(s.mfluxPath).toBe("");
    expect(s.modelsDir).toBe("");
  });
});
```

- [ ] **Step 2: Run — FAIL** (`npx vitest run tests/settings.test.ts`; Felder existieren nicht)

- [ ] **Step 3: Implementierung** in `src/core/settings.ts`:

`LigSettings` erweitern (nach `historyView`):

```ts
  /** Zuletzt gewähltes Modell (Generate-Tab-Dropdown, Spec §5). */
  selectedModel: string;
  /** Pfad zum mflux-generate-flux2-Binary; "" = Auto-Detect (Spec §6). */
  mfluxPath: string;
  /** HF_HOME für den Kindprozess; "" = HF-Standard-Cache (Spec §6). */
  modelsDir: string;
```

`DEFAULT_SETTINGS` ergänzen: `selectedModel: DEFAULT_MODEL_ID, mfluxPath: "", modelsDir: "",` (Import `DEFAULT_MODEL_ID, MODELS` aus `./models`).

Sanitizer ergänzen und in `sanitizeSettings` verdrahten:

```ts
function sanitizeSelectedModel(raw: unknown): string {
  return typeof raw === "string" && MODELS.some((m) => m.id === raw) ? raw : DEFAULT_MODEL_ID;
}
```

`mfluxPath`/`modelsDir` nutzen das bestehende `sanitizeFolder` (String oder `""`).

- [ ] **Step 4: Run — PASS** (`npx vitest run tests/settings.test.ts`)

- [ ] **Step 5: Gate + Commit**

```bash
npm run gate
git add src/core/settings.ts tests/settings.test.ts
git commit -m "feat(core): Settings-Felder selectedModel/mfluxPath/modelsDir"
```

---

### Task 3: Rezepte & Notiz um Größe erweitern

**Files:**
- Modify: `src/core/settings.ts` (HistoryEntry + sanitizeHistory), `src/core/history.ts` (recipeKey, deleteEntry), `src/core/viewmodel.ts` (GenParams), `src/core/note.ts` (FM_ORDER + Felder)
- Test: `tests/history.test.ts`, `tests/note.test.ts` (bestehende Dateien ergänzen)

**Interfaces:**
- Produces: `HistoryEntry` += `width: number; height: number` · `GenParams` += `width: number; height: number` · Frontmatter-Reihenfolge `prompt, seed, steps, model, width, height, created, image`.
- **Migration:** `sanitizeHistory` setzt fehlende `width`/`height` auf `512` (alle Alt-Einträge sind SD-Turbo-512er) statt den Eintrag zu verwerfen.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// tests/history.test.ts — ergänzen
describe("recipes 0.4 (model + size im Schlüssel)", () => {
  const base = { prompt: "apple", seed: 1, steps: 4, model: "sd-turbo", width: 512, height: 512, created: "2026-07-18T10:00:00" };
  it("gleiches Rezept auf anderem Modell kollabiert NICHT", () => {
    const list = pushHistory(pushHistory([], base), { ...base, model: "flux2-klein-4b", created: "2026-07-18T10:01:00" });
    expect(list).toHaveLength(2);
  });
  it("gleiches Rezept in anderer Größe kollabiert NICHT", () => {
    const list = pushHistory(pushHistory([], base), { ...base, width: 1024, height: 1024, created: "2026-07-18T10:01:00" });
    expect(list).toHaveLength(2);
  });
  it("identisches Rezept (inkl. model+size) kollabiert weiterhin", () => {
    const list = pushHistory(pushHistory([], base), { ...base, created: "2026-07-18T10:01:00" });
    expect(list).toHaveLength(1);
  });
  it("deleteEntry matcht über model+size mit", () => {
    const other = { ...base, model: "flux2-klein-4b" };
    expect(deleteEntry([base, other], base)).toEqual([other]);
  });
});

// tests/settings.test.ts — ergänzen
it("sanitizeHistory migriert Alt-Einträge ohne width/height auf 512", () => {
  const s = sanitizeSettings({ history: [{ prompt: "a", seed: 1, steps: 2, model: "sd-turbo", created: "x" }] });
  expect(s.history[0]).toMatchObject({ width: 512, height: 512 });
});

// tests/note.test.ts — ergänzen
it("Frontmatter enthält width/height zwischen model und created", () => {
  const note = buildImageNote(
    { prompt: "a", seed: 1, steps: 2, model: "flux2-klein-4b", width: 1024, height: 576, date: "2026-07-18T10:00:00" },
    "img.png",
  );
  expect(note).toMatch(/model: flux2-klein-4b\nwidth: 1024\nheight: 576\ncreated:/);
});
```

- [ ] **Step 2: Run — FAIL** (`npx vitest run tests/history.test.ts tests/note.test.ts tests/settings.test.ts`)

- [ ] **Step 3: Implementierung**

`settings.ts` — `HistoryEntry` nach `model: string;`:

```ts
  width: number;
  height: number;
```

`sanitizeHistory`: Filter-Prädikat bleibt (prompt/seed/steps/model/created), danach map:

```ts
function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (h): h is Omit<HistoryEntry, "width" | "height"> & { width?: unknown; height?: unknown } =>
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
    }));
}
```

`history.ts` — `recipeKey` und `deleteEntry`:

```ts
function recipeKey(e: HistoryEntry): string {
  // Seit 0.4 mehrmodellig: model + Größe gehören zum Rezept — dasselbe Prompt-Tupel auf
  // anderem Modell/Format ist ein anderes Ergebnis und darf nicht kollabieren (Spec §8).
  // JSON-Tupel als Schlüssel, damit ein Prompt mit Ziffern/Leerzeichen keine falsche
  // Kollision mit Seed/Steps erzeugt.
  return JSON.stringify([e.prompt.trim(), e.seed, e.steps, e.model, e.width, e.height]);
}

export function deleteEntry(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return list.filter(
    (e) =>
      !(
        e.prompt === entry.prompt &&
        e.seed === entry.seed &&
        e.steps === entry.steps &&
        e.model === entry.model &&
        e.width === entry.width &&
        e.height === entry.height &&
        e.created === entry.created
      ),
  );
}
```

`viewmodel.ts` — `GenParams` nach `model: string;`: `width: number; height: number;`

`note.ts`:

```ts
const FM_ORDER = ["prompt", "seed", "steps", "model", "width", "height", "created", "image"];
```

und im `data`-Objekt nach `model`: `width: params.width, height: params.height,`

- [ ] **Step 4: Run — PASS** (alle drei Testdateien; danach `npx vitest run` komplett — TypeScript-Folgefehler in main.ts sind hier NOCH erwartbar: `GenParams`-Bau in main.ts:296 und `pushHistory` in main.ts:319 brauchen width/height. Übergangsfix in diesem Task: an beiden Stellen `width: 512, height: 512` bzw. `width: p.width, height: p.height` hart ergänzen — Task 10 ersetzt das durch die echten Werte aus dem Request.)

- [ ] **Step 5: Gate + Commit**

```bash
npm run gate
git add src/core/settings.ts src/core/history.ts src/core/viewmodel.ts src/core/note.ts src/main.ts tests/
git commit -m "feat(core): Rezepte, GenParams und Notiz-Frontmatter tragen width/height (inkl. 0.3-Migration)"
```

---

### Task 4: mflux-Args/Env-Builder

**Files:**
- Create: `src/core/mflux-args.ts`
- Test: `tests/mflux-args.test.ts`

**Interfaces:**
- Consumes: `ModelSpec` (Task 1).
- Produces: `buildMfluxArgs(spec: ModelSpec, req: { prompt: string; seed: number; steps: number; width: number; height: number }, outputPath: string): string[]` · `buildMfluxEnv(modelsDir: string): Record<string, string>` (leeres Objekt wenn `modelsDir === ""`).

- [ ] **Step 1: Failing Tests**

```ts
// tests/mflux-args.test.ts
import { describe, expect, it } from "vitest";
import { buildMfluxArgs, buildMfluxEnv } from "../src/core/mflux-args";
import { getModel } from "../src/core/models";

describe("buildMfluxArgs", () => {
  it("baut die verifizierte Flag-Liste (Global Constraints)", () => {
    const args = buildMfluxArgs(
      getModel("flux2-klein-4b"),
      { prompt: "an apple", seed: 7, steps: 4, width: 1024, height: 576 },
      "/tmp/out.png",
    );
    expect(args).toEqual([
      "--model", "flux2-klein-4b",
      "--quantize", "8",
      "--prompt", "an apple",
      "--seed", "7",
      "--steps", "4",
      "--width", "1024",
      "--height", "576",
      "--output", "/tmp/out.png",
    ]);
  });
  it("wirft für Modelle ohne mflux-Block (sd-turbo)", () => {
    expect(() =>
      buildMfluxArgs(getModel("sd-turbo"), { prompt: "x", seed: 1, steps: 1, width: 512, height: 512 }, "/t.png"),
    ).toThrow(/mflux/);
  });
});

describe("buildMfluxEnv", () => {
  it("leerer modelsDir → keine Overrides", () => {
    expect(buildMfluxEnv("")).toEqual({});
  });
  it("gesetzter modelsDir → HF_HOME", () => {
    expect(buildMfluxEnv("/Volumes/ssd/models")).toEqual({ HF_HOME: "/Volumes/ssd/models" });
  });
});
```

- [ ] **Step 2: Run — FAIL** (`npx vitest run tests/mflux-args.test.ts`)

- [ ] **Step 3: Implementierung**

```ts
// src/core/mflux-args.ts
// CLI-Aufbau für mflux-generate-flux2 (Spec §4.3). Flags 2026-07-18 gegen die installierte
// mflux-Version verifiziert (--help), nicht geraten. Quantisierung fest 8-bit (Spec §2).
import type { ModelSpec } from "./models";

export interface MfluxRequest {
  prompt: string;
  seed: number;
  steps: number;
  width: number;
  height: number;
}

export function buildMfluxArgs(spec: ModelSpec, req: MfluxRequest, outputPath: string): string[] {
  if (!spec.mflux) throw new Error(`model ${spec.id} has no mflux runtime`);
  return [
    "--model", spec.mflux.modelArg,
    "--quantize", "8",
    "--prompt", req.prompt,
    "--seed", String(req.seed),
    "--steps", String(req.steps),
    "--width", String(req.width),
    "--height", String(req.height),
    "--output", outputPath,
  ];
}

/** HF_HOME nur setzen, wenn der User einen Speicherort gewählt hat — sonst erbt der
 *  Kindprozess den HF-Standard-Cache (~/.cache/huggingface), geteilt mit anderen Tools. */
export function buildMfluxEnv(modelsDir: string): Record<string, string> {
  return modelsDir === "" ? {} : { HF_HOME: modelsDir };
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Gate + Commit**

```bash
npm run gate
git add src/core/mflux-args.ts tests/mflux-args.test.ts
git commit -m "feat(core): mflux-CLI-Args- und Env-Builder (verifizierte Flags, HF_HOME)"
```

---

### Task 5: mflux-Output-Parser

**Files:**
- Create: `src/core/mflux-output.ts`
- Test: `tests/mflux-output.test.ts`

**Interfaces:**
- Produces: `type MfluxEvent = { kind: "download"; file: string; pct: number } | { kind: "step"; step: number; total: number } | null` · `parseMfluxLine(line: string): MfluxEvent`.
- **Heuristik (Spec §4.3, tolerant):** tqdm-Zeilen tragen `NN%|`. Enthält die Zeile Byte-Einheiten (`G`/`GB`/`M`/`MB` hinter den Zahlen) → Download (Dateiname = Text vor dem `:`; fehlt er → `"model"`). Sonst, wenn `X/Y` mit `Y ≤ 64` → Generierungs-Step. Alles andere → `null` (unbekannte Zeilen sind kein Fehler — Forward-Kompatibilität). Das echte Format wird im Smoke-Test verifiziert; der Parser ist bewusst heuristisch und über Fixtures getestet.

- [ ] **Step 1: Failing Tests**

```ts
// tests/mflux-output.test.ts
import { describe, expect, it } from "vitest";
import { parseMfluxLine } from "../src/core/mflux-output";

describe("parseMfluxLine", () => {
  it("HF-Download-Zeile (tqdm mit Byte-Einheiten und Datei-Prefix)", () => {
    expect(
      parseMfluxLine("model-00001-of-00002.safetensors:  45%|████      | 2.25G/5.00G [01:00<01:10, 39.2MB/s]"),
    ).toEqual({ kind: "download", file: "model-00001-of-00002.safetensors", pct: 45 });
  });
  it("Download-Zeile ohne Datei-Prefix → file 'model'", () => {
    expect(parseMfluxLine("Fetching 12 files:  30%|███       | 3.60G/12.0G [00:40<01:30, 95MB/s]")).toEqual({
      kind: "download",
      file: "Fetching 12 files",
      pct: 30,
    });
  });
  it("Generierungs-Step (kleine Totale, keine Byte-Einheiten)", () => {
    expect(parseMfluxLine(" 50%|█████     | 2/4 [00:05<00:05,  2.50s/it]")).toEqual({ kind: "step", step: 2, total: 4 });
  });
  it("unbekannte Zeilen → null (kein Fehler)", () => {
    expect(parseMfluxLine("Loading transformer weights…")).toBeNull();
    expect(parseMfluxLine("")).toBeNull();
    expect(parseMfluxLine("100 things happened")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implementierung**

```ts
// src/core/mflux-output.ts
// Zeilenparser für mflux-stdout/stderr (Spec §4.3). tqdm rendert "NN%|…| X/Y [rate]".
// BEWUSST heuristisch: Downloads erkennt man an Byte-Einheiten (G/M), Steps an kleiner
// Totale ohne Einheit. Unbekannte Zeilen sind null — mflux-Updates dürfen den Parser
// nicht brechen (Forward-Kompatibilität); der Smoke-Test verifiziert das echte Format.
export type MfluxEvent =
  | { kind: "download"; file: string; pct: number }
  | { kind: "step"; step: number; total: number }
  | null;

const PCT = /(\d{1,3})%\|/;
const BYTES = /\|\s*[\d.]+\s*[GM]i?B?\/[\d.]+\s*[GM]i?B?/;
const STEP = /\|\s*(\d+)\/(\d+)\s*\[/;

export function parseMfluxLine(line: string): MfluxEvent {
  const pctMatch = PCT.exec(line);
  if (!pctMatch) return null;
  const pct = Math.min(100, Number(pctMatch[1]));
  if (BYTES.test(line)) {
    const prefix = line.slice(0, line.indexOf(pctMatch[0])).replace(/:\s*$/, "").trim();
    return { kind: "download", file: prefix === "" ? "model" : prefix, pct };
  }
  const stepMatch = STEP.exec(line);
  if (stepMatch) {
    const total = Number(stepMatch[2]);
    if (total >= 1 && total <= 64) return { kind: "step", step: Number(stepMatch[1]), total };
  }
  return null;
}

/** Chunk-Splitter: tqdm trennt mit \r (Progress-Rewrite), normale Logs mit \n.
 *  Liefert vollständige Zeilen und den Rest-Puffer zurück (Streaming-tauglich). */
export function splitChunks(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split(/[\r\n]+/);
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim() !== ""), rest };
}
```

Zusätzliche Tests für `splitChunks` (an dieselbe Testdatei anhängen, Teil von Step 1 wenn möglich):

```ts
describe("splitChunks", () => {
  it("trennt an \\r und \\n und puffert Unvollständiges", () => {
    const a = splitChunks("", " 25%|██| 1/4 [\r 50%|███");
    expect(a.lines).toEqual([" 25%|██| 1/4 ["]);
    expect(a.rest).toBe(" 50%|███");
    const b = splitChunks(a.rest, "██| 2/4 [\n");
    expect(b.lines).toEqual([" 50%|█████| 2/4 ["]);
    expect(b.rest).toBe("");
  });
});
```

- [ ] **Step 4: Run — PASS** (`npx vitest run tests/mflux-output.test.ts`)

- [ ] **Step 5: Gate + Commit**

```bash
npm run gate
git add src/core/mflux-output.ts tests/mflux-output.test.ts
git commit -m "feat(core): mflux-stdout-Parser (Download/Step-Heuristik, \\r-tauglicher Splitter)"
```

---

### Task 6: mflux- und Gewichte-Erkennung (pure + dünner IO-Wrapper)

**Files:**
- Create: `src/core/mflux-detect.ts`
- Create: `src/obsidian/mflux-host.ts`
- Test: `tests/mflux-detect.test.ts`

**Interfaces:**
- Consumes: `ModelSpec.mflux.hfRepo` (Task 1), `LigSettings.mfluxPath`/`modelsDir` (Task 2).
- Produces (pure): `resolveMfluxBinary(configuredPath: string, home: string, exists: (p: string) => boolean): string | null` · `hfSnapshotDir(modelsDir: string, home: string, hfRepo: string): string` (Pfad `<base>/hub/models--black-forest-labs--FLUX.2-klein-4B/snapshots`, base = modelsDir oder `<home>/.cache/huggingface`).
- Produces (IO, `src/obsidian/mflux-host.ts`): `detectMflux(settings): string | null` und `fluxWeightsReady(settings): boolean` — binden `node:fs`/`node:os` an die puren Funktionen (`existsSync`, non-empty-Check des snapshots-Ordners via `readdirSync`).

- [ ] **Step 1: Failing Tests (nur die puren Funktionen)**

```ts
// tests/mflux-detect.test.ts
import { describe, expect, it } from "vitest";
import { hfSnapshotDir, resolveMfluxBinary } from "../src/core/mflux-detect";

describe("resolveMfluxBinary", () => {
  const HOME = "/Users/jay";
  it("konfigurierter Pfad gewinnt, wenn er existiert", () => {
    expect(resolveMfluxBinary("/custom/mflux-generate-flux2", HOME, (p) => p === "/custom/mflux-generate-flux2")).toBe(
      "/custom/mflux-generate-flux2",
    );
  });
  it("konfigurierter Pfad, der nicht existiert → null (KEIN stiller Fallback auf Auto-Detect)", () => {
    expect(resolveMfluxBinary("/custom/missing", HOME, () => false)).toBeNull();
  });
  it("Auto-Detect probiert ~/.local/bin, /opt/homebrew/bin, /usr/local/bin (in dieser Reihenfolge)", () => {
    const tried: string[] = [];
    const r = resolveMfluxBinary("", HOME, (p) => {
      tried.push(p);
      return p === "/opt/homebrew/bin/mflux-generate-flux2";
    });
    expect(r).toBe("/opt/homebrew/bin/mflux-generate-flux2");
    expect(tried[0]).toBe("/Users/jay/.local/bin/mflux-generate-flux2");
  });
  it("nichts gefunden → null", () => {
    expect(resolveMfluxBinary("", HOME, () => false)).toBeNull();
  });
});

describe("hfSnapshotDir", () => {
  it("Default-Cache unter <home>/.cache/huggingface", () => {
    expect(hfSnapshotDir("", "/Users/jay", "black-forest-labs/FLUX.2-klein-4B")).toBe(
      "/Users/jay/.cache/huggingface/hub/models--black-forest-labs--FLUX.2-klein-4B/snapshots",
    );
  });
  it("modelsDir überschreibt die Basis (HF_HOME-Semantik)", () => {
    expect(hfSnapshotDir("/Volumes/ssd/hf", "/Users/jay", "black-forest-labs/FLUX.2-klein-4B")).toBe(
      "/Volumes/ssd/hf/hub/models--black-forest-labs--FLUX.2-klein-4B/snapshots",
    );
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implementierung**

```ts
// src/core/mflux-detect.ts
// Erkennung ohne IO (Spec §6): exists wird injiziert, damit der Kern node-frei testbar
// bleibt (Pure-Core-Schnitt). Electron erbt den Shell-PATH nicht — deshalb eine feste
// Kandidatenliste statt `which`.
export const MFLUX_BINARY = "mflux-generate-flux2";

const CANDIDATE_DIRS = [".local/bin", "/opt/homebrew/bin", "/usr/local/bin"];

export function resolveMfluxBinary(
  configuredPath: string,
  home: string,
  exists: (p: string) => boolean,
): string | null {
  if (configuredPath !== "") {
    // Ein explizit konfigurierter, aber kaputter Pfad fällt NICHT still auf Auto-Detect
    // zurück — sonst benutzt das Plugin heimlich ein anderes Binary als das gewählte.
    return exists(configuredPath) ? configuredPath : null;
  }
  for (const dir of CANDIDATE_DIRS) {
    const base = dir.startsWith("/") ? dir : `${home}/${dir}`;
    const p = `${base}/${MFLUX_BINARY}`;
    if (exists(p)) return p;
  }
  return null;
}

/** huggingface_hub-Layout: <HF_HOME>/hub/models--<org>--<name>/snapshots.
 *  Existiert der snapshots-Ordner und ist nicht leer, gelten die Gewichte als vorhanden
 *  (Heuristik, Spec §6 — abgebrochene Downloads liegen unter blobs/*.incomplete und
 *  erzeugen keinen vollständigen Snapshot-Eintrag). */
export function hfSnapshotDir(modelsDir: string, home: string, hfRepo: string): string {
  const base = modelsDir === "" ? `${home}/.cache/huggingface` : modelsDir;
  return `${base}/hub/models--${hfRepo.replace("/", "--")}/snapshots`;
}
```

```ts
// src/obsidian/mflux-host.ts
// Dünne IO-Bindung der puren Erkennung (Spec §6). Desktop-only — node:fs/os sind da.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { hfSnapshotDir, resolveMfluxBinary } from "../core/mflux-detect";
import { getModel } from "../core/models";
import type { LigSettings } from "../core/settings";

export function detectMflux(settings: LigSettings): string | null {
  return resolveMfluxBinary(settings.mfluxPath.trim(), homedir(), existsSync);
}

export function fluxWeightsReady(settings: LigSettings): boolean {
  const spec = getModel("flux2-klein-4b");
  if (!spec.mflux) return false;
  const dir = hfSnapshotDir(settings.modelsDir.trim(), homedir(), spec.mflux.hfRepo);
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run — PASS** (`npx vitest run tests/mflux-detect.test.ts`)

- [ ] **Step 5: Gate + Commit** (check:pure muss grün bleiben — `mflux-detect.ts` importiert kein fs/os!)

```bash
npm run gate
git add src/core/mflux-detect.ts src/obsidian/mflux-host.ts tests/mflux-detect.test.ts
git commit -m "feat: mflux-Binary- und Gewichte-Erkennung (pure Kern, IO injiziert)"
```

### Task 7: ViewModel — Modellwahl + mflux-Zustand

**Files:**
- Modify: `src/core/viewmodel.ts`
- Test: `tests/viewmodel.test.ts` (bestehende Datei ergänzen; bestehende Tests bekommen die neuen Pflichtfelder in ihren State-Fixtures — mechanisch: `selectedModel: "sd-turbo", mflux: MFLUX_OK` ergänzen)

**Interfaces:**
- Consumes: `getModel` (Task 1).
- Produces:

```ts
export interface MfluxPanelState {
  binary: string | null;                       // Pfad oder null = nicht gefunden
  weights: "missing" | "downloading" | "ready";
  download: { file: string; pct: number } | null;  // nur während weights === "downloading"
}
// PanelState += selectedModel: string; mflux: MfluxPanelState;
// ModelState "downloading": fileKey wird string (statt ModelFileKey) — der Import
// ModelFileKey aus model-manifest bleibt für den SD-Turbo-Pfad in main.ts erhalten.
```

- **Regeln (Spec §5/§7):** Für `engine === "mflux"` gilt: GPU-Zustand irrelevant (kein WebGPU nötig); `generateEnabled` erfordert `binary !== null && weights === "ready"`; Empty-State bei fehlendem Binary → `t("empty.fluxNeedsMflux")` + CTA Settings, bei fehlenden Gewichten → `t("empty.fluxNoModel")` + CTA Settings. `busy` schließt `mflux.weights === "downloading"` ein (beide Engines: während irgendein Download läuft, kein Generate). Statuszeile: mflux-Download nutzt `status.downloading` mit `mflux.download.pct`.

- [ ] **Step 1: Failing Tests** (Auszug — Fixtures-Helfer oben in der Testdatei anlegen)

```ts
const MFLUX_OK: MfluxPanelState = { binary: "/x/mflux-generate-flux2", weights: "ready", download: null };
function fluxState(over: Partial<PanelState> = {}): PanelState {
  return {
    gpu: "no-webgpu", // absichtlich kaputt: darf FLUX nicht blocken
    model: { kind: "missing" }, // SD-Turbo-Gewichte fehlen: darf FLUX nicht blocken
    run: { kind: "idle" }, image: null, editorActive: false, prompt: "an apple",
    selectedModel: "flux2-klein-4b", mflux: MFLUX_OK, ...over,
  };
}

it("FLUX generierbar trotz fehlendem WebGPU und fehlenden SD-Turbo-Gewichten", () => {
  expect(buildViewModel(fluxState()).generateEnabled).toBe(true);
});
it("FLUX ohne Binary → Setup-Empty mit CTA, generate disabled", () => {
  const vm = buildViewModel(fluxState({ mflux: { ...MFLUX_OK, binary: null } }));
  expect(vm.generateEnabled).toBe(false);
  expect(vm.empty?.ctaLabel).toBeDefined();
});
it("FLUX ohne Gewichte → Empty mit CTA, kein Auto-Download", () => {
  const vm = buildViewModel(fluxState({ mflux: { ...MFLUX_OK, weights: "missing" } }));
  expect(vm.generateEnabled).toBe(false);
  expect(vm.empty?.ctaLabel).toBeDefined();
});
it("mflux-Download blockt Generate und zeigt Prozent-Status", () => {
  const vm = buildViewModel(fluxState({ mflux: { ...MFLUX_OK, weights: "downloading", download: { file: "x", pct: 40 } } }));
  expect(vm.generateEnabled).toBe(false);
  expect(vm.status.text).toContain("40");
});
it("sd-turbo-Verhalten unverändert: no-webgpu blockt", () => {
  expect(buildViewModel(fluxState({ selectedModel: "sd-turbo" })).generateEnabled).toBe(false);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implementierung** — `buildViewModel` verzweigt einmal am Anfang:

```ts
export function buildViewModel(s: PanelState): PanelViewModel {
  const spec = getModel(s.selectedModel);
  return spec.engine === "mflux" ? buildMfluxViewModel(s) : buildOrtViewModel(s);
}
```

`buildOrtViewModel` = bisheriger Funktionskörper unverändert (nur umbenannt). Neu:

```ts
function buildMfluxViewModel(s: PanelState): PanelViewModel {
  const m = s.mflux;
  const busy = s.run.kind === "running" || s.run.kind === "loading" || m.weights === "downloading";

  let status: PanelViewModel["status"];
  if (s.run.kind === "error") status = { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  else if (m.weights === "downloading")
    status = { icon: "loader", text: t("status.downloading", m.download?.pct ?? 0), cls: "is-checking" };
  else if (s.run.kind === "loading")
    status = { icon: "loader", text: t("status.loadingMflux", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
  else if (s.run.kind === "running")
    status = { icon: "loader", text: t("status.generating", s.run.step, s.run.total), cls: "is-checking" };
  else if (m.binary === null) status = { icon: "circle-x", text: t("status.mfluxMissing"), cls: "is-error" };
  else status = { icon: "circle-check", text: t("status.ready"), cls: "is-ok" };

  let empty: PanelViewModel["empty"] = null;
  if (m.binary === null) empty = { text: t("empty.fluxNeedsMflux"), ctaLabel: t("empty.fluxNeedsMfluxCta") };
  else if (m.weights === "missing") empty = { text: t("empty.fluxNoModel"), ctaLabel: t("empty.fluxNoModelCta") };
  else if (!s.image && s.run.kind !== "running" && s.run.kind !== "loading") empty = { text: t("empty.noImage") };

  return {
    status,
    empty,
    generateEnabled: !busy && m.binary !== null && m.weights === "ready" && s.prompt.trim().length > 0,
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
}
```

Neue i18n-Keys (EN/DE): `status.loadingMflux` („Loading FLUX model… ({0})" / „Lade FLUX-Modell… ({0})"), `status.mfluxMissing` („mflux is not set up yet" / „mflux ist noch nicht eingerichtet"), `empty.fluxNeedsMflux` („FLUX.2 runs via the local mflux tool, which is not installed or not found." / „FLUX.2 läuft über das lokale Tool mflux, das nicht installiert oder nicht auffindbar ist."), `empty.fluxNeedsMfluxCta` („Open setup" / „Einrichtung öffnen"), `empty.fluxNoModel` („The FLUX.2 weights (~8 GB) are not downloaded yet." / „Die FLUX.2-Gewichte (~8 GB) sind noch nicht heruntergeladen."), `empty.fluxNoModelCta` („Open settings" / „Einstellungen öffnen").

- [ ] **Step 4: Run — PASS** (`npx vitest run tests/viewmodel.test.ts`; danach kompletter Lauf — Fixture-Anpassungen in anderen Testdateien mechanisch nachziehen)

- [ ] **Step 5: Gate + Commit**

```bash
npm run gate
git add src/core/viewmodel.ts src/i18n/strings.ts tests/
git commit -m "feat(core): ViewModel kennt Modellwahl und mflux-Setup-/Download-Zustände"
```

---

### Task 8: MfluxEngine (Kindprozess-Adapter mit Stall-Watchdog)

**Files:**
- Create: `src/obsidian/mflux-engine.ts`
- Test: `tests/mflux-engine.test.ts` (testbar OHNE Obsidian-Mock: die Datei importiert kein `obsidian`, alle IO-Abhängigkeiten sind injiziert)

**Interfaces:**
- Consumes: `buildMfluxArgs`, `buildMfluxEnv` (Task 4), `parseMfluxLine`, `splitChunks` (Task 5), `ModelSpec` (Task 1).
- Produces:

```ts
export interface MfluxDeps {           // Default: echte node-Implementierungen
  spawnFn: typeof spawn;               // node:child_process
  mkdtemp(prefix: string): string;     // node:fs mkdtempSync(join(tmpdir(), prefix))
  readFile(p: string): Uint8Array;     // node:fs readFileSync
  rmrf(p: string): void;               // node:fs rmSync(p, {recursive:true, force:true})
}
export interface MfluxCallbacks {
  onDownload(file: string, pct: number): void;
  onStep(step: number, total: number): void;
}
export const MFLUX_STALL_MS = 5 * 60_000;
export class MfluxEngine {
  constructor(deps?: Partial<MfluxDeps>);
  get busy(): boolean;
  run(binary: string, spec: ModelSpec, req: MfluxRequest, modelsDir: string, cb: MfluxCallbacks): Promise<Uint8Array>; // PNG-Bytes
  kill(): void;                        // idempotent; no-op wenn kein Prozess läuft
}
```

**Verhalten (Spec §4.3/§4.4) — der Reviewer rechnet diese Interleavings durch (Global Constraints):**
1. stdout UND stderr laufen durch `splitChunks` (eigener Puffer je Stream) → `parseMfluxLine` → Callbacks.
2. **Stall-Watchdog:** Timer `MFLUX_STALL_MS`, resettet bei JEDEM Daten-Chunk (nicht nur geparsten). Feuert er → `child.kill("SIGKILL")` + reject `new Error(t-frei: "mflux stalled (no output for 5 minutes)")`. Der anschließende close-Event darf NICHT noch einmal settlen (settled-Flag).
3. **`kill()`** (View-Close/Unload): killt den Prozess, reject „cancelled". Erneutes `run()` danach muss funktionieren (kein hängender busy-Zustand).
4. **Exit ≠ 0** → reject mit letzter nicht-leerer stderr-Zeile im Fehlertext. **spawn-error** (ENOENT — Binary zwischen Detect und Run gelöscht) → reject, kein Hänger.
5. Temp-Verzeichnis wird IMMER entfernt (`finally`), auch bei reject; Watchdog-Timer wird IMMER gecleart.
6. `busy` ist von Aufruf bis Settlement true; paralleler `run()` wirft sofort („engine is busy").

- [ ] **Step 1: Failing Tests** — Fake-ChildProcess auf `EventEmitter`-Basis:

```ts
// tests/mflux-engine.test.ts
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MFLUX_STALL_MS, MfluxEngine } from "../src/obsidian/mflux-engine";
import { getModel } from "../src/core/models";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(_sig?: string): boolean { this.killed = true; return true; }
}

const REQ = { prompt: "a", seed: 1, steps: 4, width: 512, height: 512 };
const SPEC = getModel("flux2-klein-4b");
const PNG = new Uint8Array([137, 80, 78, 71]);

function makeEngine(child: FakeChild) {
  const removed: string[] = [];
  const engine = new MfluxEngine({
    spawnFn: (() => child) as never,
    mkdtemp: () => "/tmp/lig-test",
    readFile: () => PNG,
    rmrf: (p) => removed.push(p),
  });
  return { engine, removed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("MfluxEngine", () => {
  it("Erfolgsfall: Steps gemeldet, PNG gelesen, Temp entfernt", async () => {
    const child = new FakeChild();
    const { engine, removed } = makeEngine(child);
    const steps: number[] = [];
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: (s) => steps.push(s) });
    child.stderr.emit("data", Buffer.from(" 50%|███| 2/4 [00:05<00:05]\r"));
    child.emit("close", 0);
    await expect(p).resolves.toEqual(PNG);
    expect(steps).toEqual([2]);
    expect(removed).toEqual(["/tmp/lig-test"]);
    expect(engine.busy).toBe(false);
  });

  it("Watchdog: 5 min ohne Output → SIGKILL + reject; späterer close settelt NICHT erneut", async () => {
    const child = new FakeChild();
    const { engine, removed } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    const guard = p.catch((e: Error) => e); // Rejection sofort beobachten (kein unhandled)
    vi.advanceTimersByTime(MFLUX_STALL_MS + 1);
    expect(child.killed).toBe(true);
    child.emit("close", 137); // der Kill schlägt als close durch — darf nicht doppelt settlen
    expect((await guard).message).toMatch(/stalled/);
    expect(removed).toEqual(["/tmp/lig-test"]);
    expect(engine.busy).toBe(false);
  });

  it("Output resettet den Watchdog", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    vi.advanceTimersByTime(MFLUX_STALL_MS - 1000);
    child.stderr.emit("data", Buffer.from("still alive\n"));
    vi.advanceTimersByTime(MFLUX_STALL_MS - 1000);
    expect(child.killed).toBe(false);
    child.emit("close", 0);
    await p;
  });

  it("Exit ≠ 0 → reject mit letzter stderr-Zeile", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    child.stderr.emit("data", Buffer.from("Traceback…\nValueError: bad prompt\n"));
    child.emit("close", 1);
    await expect(p).rejects.toThrow(/ValueError: bad prompt/);
  });

  it("kill(): reject 'cancelled', danach ist ein neuer run möglich (busy hängt nicht)", async () => {
    const children = [new FakeChild(), new FakeChild()];
    let i = 0;
    const engine = new MfluxEngine({
      spawnFn: (() => children[i++]) as never,
      mkdtemp: () => "/tmp/lig-test",
      readFile: () => PNG,
      rmrf: () => {},
    });
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    const guard = p.catch((e: Error) => e);
    engine.kill();
    children[0]!.emit("close", 137);
    expect((await guard).message).toMatch(/cancelled/);
    expect(engine.busy).toBe(false);
    // Regressionsschutz gegen hängenden busy-Zustand: ein ZWEITER run startet normal…
    const p2 = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    children[1]!.emit("close", 0);
    await expect(p2).resolves.toEqual(PNG); // …und das cancelled-Flag von run 1 klebt nicht an run 2.
  });

  it("paralleler run wirft 'engine is busy'", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} });
    await expect(
      engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: () => {}, onStep: () => {} }),
    ).rejects.toThrow(/busy/);
    child.emit("close", 0);
    await p;
  });

  it("Download-Events erreichen onDownload", async () => {
    const child = new FakeChild();
    const { engine } = makeEngine(child);
    const dl: number[] = [];
    const p = engine.run("/bin/mflux", SPEC, REQ, "", { onDownload: (_f, pct) => dl.push(pct), onStep: () => {} });
    child.stderr.emit("data", Buffer.from("model.safetensors:  45%|██| 2.25G/5.00G [01:00]\r"));
    child.emit("close", 0);
    await p;
    expect(dl).toEqual([45]);
  });
});
```

> **Hinweis an den Implementer:** Der fünfte Test („kill → neuer run möglich") ist im Fake-Setup
> umständlich — er darf umgebaut werden, solange die Aussage erhalten bleibt: nach `kill()` +
> close ist `busy === false` und ein weiterer `run()`-Aufruf wirft NICHT „engine is busy".
> Genau diese Aussage ist der Regressionsschutz gegen einen hängenden busy-Zustand.

- [ ] **Step 2: Run — FAIL** (`npx vitest run tests/mflux-engine.test.ts`)

- [ ] **Step 3: Implementierung**

```ts
// src/obsidian/mflux-engine.ts
// Kindprozess-Adapter für mflux (Spec §4.3/§4.4). Kein obsidian-Import — nur node.
// Ein spawn pro Generierung (mflux hat keinen Server-Modus); Abbruch ist deshalb ein
// simples SIGKILL, deterministischer als der WebGPU-Fall. IO ist injizierbar (Tests).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMfluxArgs, buildMfluxEnv, type MfluxRequest } from "../core/mflux-args";
import { parseMfluxLine, splitChunks } from "../core/mflux-output";
import type { ModelSpec } from "../core/models";

export const MFLUX_STALL_MS = 5 * 60_000;

export interface MfluxDeps {
  spawnFn: typeof spawn;
  mkdtemp(prefix: string): string;
  readFile(p: string): Uint8Array;
  rmrf(p: string): void;
}

export interface MfluxCallbacks {
  onDownload(file: string, pct: number): void;
  onStep(step: number, total: number): void;
}

const DEFAULT_DEPS: MfluxDeps = {
  spawnFn: spawn,
  mkdtemp: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
  readFile: (p) => readFileSync(p),
  rmrf: (p) => rmSync(p, { recursive: true, force: true }),
};

export class MfluxEngine {
  private readonly deps: MfluxDeps;
  private child: ReturnType<typeof spawn> | null = null;
  private cancelled = false;
  private _busy = false;

  constructor(deps?: Partial<MfluxDeps>) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  get busy(): boolean {
    return this._busy;
  }

  /** Laufenden Prozess abbrechen (View-Close/Unload). Idempotent, no-op ohne Prozess. */
  kill(): void {
    if (this.child) {
      this.cancelled = true;
      this.child.kill("SIGKILL");
    }
  }

  async run(binary: string, spec: ModelSpec, req: MfluxRequest, modelsDir: string, cb: MfluxCallbacks): Promise<Uint8Array> {
    if (this._busy) throw new Error("engine is busy");
    this._busy = true;
    this.cancelled = false;
    const tmp = this.deps.mkdtemp("lig-mflux-");
    const outPath = join(tmp, "out.png");
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        // Nur die ERSTE Auflösung zählt: Watchdog-Kill und kill() führen beide später zu
        // einem close-Event — settled verhindert, dass der den Fehler überschreibt.
        let settled = false;
        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          fn();
        };
        let watchdog: ReturnType<typeof setTimeout>;
        const armWatchdog = (): void => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            this.child?.kill("SIGKILL");
            settle(() => reject(new Error("mflux stalled (no output for 5 minutes)")));
          }, MFLUX_STALL_MS);
        };

        const child = this.deps.spawnFn(binary, buildMfluxArgs(spec, req, outPath), {
          env: { ...process.env, ...buildMfluxEnv(modelsDir) },
        });
        this.child = child;
        armWatchdog();

        let lastErrLine = "";
        const buffers = { out: "", err: "" };
        const onData = (which: "out" | "err") => (chunk: Buffer) => {
          armWatchdog(); // JEDER Output ist ein Lebenszeichen, auch ungeparster
          const r = splitChunks(buffers[which], chunk.toString());
          buffers[which] = r.rest;
          for (const line of r.lines) {
            if (which === "err") lastErrLine = line;
            const ev = parseMfluxLine(line);
            if (ev?.kind === "download") cb.onDownload(ev.file, ev.pct);
            else if (ev?.kind === "step") cb.onStep(ev.step, ev.total);
          }
        };
        child.stdout?.on("data", onData("out"));
        child.stderr?.on("data", onData("err"));

        child.on("error", (e) => settle(() => reject(e))); // ENOENT etc.
        child.on("close", (code) =>
          settle(() => {
            if (this.cancelled) return reject(new Error("cancelled"));
            if (code !== 0) return reject(new Error(`mflux exited with code ${code}${lastErrLine ? `: ${lastErrLine}` : ""}`));
            try {
              resolve(this.deps.readFile(outPath));
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          }),
        );
      });
    } finally {
      this.child = null;
      this._busy = false;
      try {
        this.deps.rmrf(tmp);
      } catch {
        // Temp-Cleanup ist Best-Effort — ein voller /tmp darf kein Ergebnis entwerten.
      }
    }
  }
}
```

- [ ] **Step 4: Run — PASS** (`npx vitest run tests/mflux-engine.test.ts`)

- [ ] **Step 5: Gate + Commit**

```bash
npm run gate
git add src/obsidian/mflux-engine.ts tests/mflux-engine.test.ts
git commit -m "feat(obsidian): MfluxEngine — spawn pro Generierung, Stall-Watchdog, injizierbare IO"
```

---

### Task 9: Generate-Panel — Modell-/Größen-Dropdown, Katalog-getriebene Regler

**Files:**
- Modify: `src/obsidian/generate-panel.ts`, `src/obsidian/view.ts` (ViewHost-Interface + applyRecipe-Signatur), `src/i18n/strings.ts`

**Interfaces:**
- Consumes: `getModel`, `MODELS` (Task 1), `HistoryEntry` mit width/height (Task 3).
- Produces (ViewHost-Änderungen, Task 10 implementiert die Host-Seite):
  - `generate(steps: number, seed: number, width: number, height: number): void`
  - `setSelectedModel(id: string): void` (persistiert + refreshViews)
  - `GeneratorView.applyRecipe(entry: HistoryEntry)` / `GeneratePanel.applyRecipe(entry: HistoryEntry)` — Aufrufer in `main.ts` (`restoreRecipe`) übergibt das ganze Entry.
- **UI (Spec §5):** Modell-Dropdown in eigener Zeile OBERHALB des Prompts (`lig-row lig-model-row`, Label `t("generate.model")`). Größen-Dropdown in der bestehenden `controls`-Zeile vor Steps, nur wenn `sizes.length > 1` (Anzeige `1024 × 576`, value `"1024x576"`). Steps-Slider bekommt `min`/`max` aus dem Katalog; bei Modellwechsel: Slider auf `spec.steps.default`, Größen-Dropdown neu aufbauen (erste Option gewählt), `host.setSelectedModel(id)`.

- [ ] **Step 1: Implementierung** (kein pure-Test — DOM-Verhalten, Repo-Muster: Panels sind mock-frei ungetestet; die Regler-Logik ist über den Katalog in Task 1 getestet)

Kernänderungen in `generate-panel.ts` (vollständige neue/geänderte Blöcke):

```ts
// Felder ergänzen:
private modelEl!: HTMLSelectElement;
private sizeRowEl!: HTMLElement;   // Container in der controls-Zeile
private sizeEl: HTMLSelectElement | null = null;

// mount(): VOR promptRow einfügen:
const modelRow = root.createDiv({ cls: "lig-row lig-model-row" });
modelRow.createSpan({ text: t("generate.model"), cls: "lig-label" });
this.modelEl = modelRow.createEl("select", { cls: "dropdown lig-model" });
for (const m of MODELS) this.modelEl.createEl("option", { text: m.label, attr: { value: m.id } });
this.modelEl.value = this.host.getSettings().selectedModel;
this.modelEl.addEventListener("change", () => {
  this.applyModel(this.modelEl.value);
  this.host.setSelectedModel(this.modelEl.value);
});

// in mount(), controls-Zeile: VOR dem Steps-Label:
this.sizeRowEl = controls.createSpan({ cls: "lig-size-slot" });

// Steps-Slider: min/max NICHT mehr hart "1"/"4", sondern aus dem aktiven Modell:
const startSpec = getModel(this.host.getSettings().selectedModel);
// … attr: { type: "range", min: String(startSpec.steps.min), max: String(startSpec.steps.max), step: "1", value: startSteps }
// startSteps: bei sd-turbo weiterhin settings.defaultSteps, sonst Katalog-Default:
const startSteps = String(
  startSpec.id === "sd-turbo" ? this.host.getSettings().defaultSteps : startSpec.steps.default,
);

// mount()-Ende, vor refresh(): Größen-Dropdown initial aufbauen
this.rebuildSizeDropdown(startSpec, null);

// Generate/Reroll-Klicks übergeben die Größe:
this.generateBtn.addEventListener("click", () => {
  const { width, height } = this.currentSize();
  this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value), width, height);
});
// (Reroll analog: erst Seed würfeln, dann derselbe Aufruf)

// Neue Methoden:
/** Größen-Dropdown zum Modell aufbauen; preferred (aus applyRecipe) wird vorausgewählt,
 *  wenn das Modell die Größe kennt. Bei nur einer Größe: kein Dropdown (Spec §5). */
private rebuildSizeDropdown(spec: ModelSpec, preferred: SizeOption | null): void {
  this.sizeRowEl.empty();
  this.sizeEl = null;
  if (spec.sizes.length <= 1) return;
  this.sizeRowEl.createSpan({ text: t("generate.size"), cls: "lig-label" });
  this.sizeEl = this.sizeRowEl.createEl("select", { cls: "dropdown lig-size" });
  for (const s of spec.sizes)
    this.sizeEl.createEl("option", { text: `${s.width} × ${s.height}`, attr: { value: `${s.width}x${s.height}` } });
  if (preferred && spec.sizes.some((s) => s.width === preferred.width && s.height === preferred.height))
    this.sizeEl.value = `${preferred.width}x${preferred.height}`;
}

/** Aktive Größe: Dropdown-Wert oder die einzige Katalog-Größe. */
private currentSize(): SizeOption {
  const spec = getModel(this.modelEl.value);
  if (this.sizeEl) {
    const [w, h] = this.sizeEl.value.split("x").map(Number);
    return { width: w!, height: h! };
  }
  return spec.sizes[0]!;
}

/** Regler an ein Modell anpassen (Modellwechsel + applyRecipe). */
private applyModel(id: string, preferredSize: SizeOption | null = null): void {
  const spec = getModel(id);
  this.stepsEl.min = String(spec.steps.min);
  this.stepsEl.max = String(spec.steps.max);
  this.stepsEl.value = String(spec.steps.default);
  this.stepsValueEl.setText(this.stepsEl.value);
  this.rebuildSizeDropdown(spec, preferredSize);
  this.refresh();
}

// applyRecipe — neue Signatur (view.ts + main.ts-Aufrufer ziehen nach):
applyRecipe(entry: HistoryEntry): void {
  this.modelEl.value = getModel(entry.model).id; // getModel-Fallback fängt Alt-/Fremd-IDs
  this.applyModel(this.modelEl.value, { width: entry.width, height: entry.height });
  this.host.setSelectedModel(this.modelEl.value);
  this.promptEl.value = entry.prompt;
  this.host.setPrompt(entry.prompt);
  this.seedEl.value = String(entry.seed);
  // Steps NACH applyModel setzen (applyModel hat sie auf den Default gestellt), geclampt:
  const spec = getModel(this.modelEl.value);
  const steps = Math.min(spec.steps.max, Math.max(spec.steps.min, entry.steps));
  this.stepsEl.value = String(steps);
  this.stepsValueEl.setText(String(steps));
  this.refresh();
}
```

`view.ts`: `ViewHost` — `generate(steps, seed, width, height)`, neu `setSelectedModel(id: string): void`; `applyRecipe(entry: HistoryEntry)` durchreichen. i18n-Keys: `generate.model` („Model" / „Modell"), `generate.size` („Size" / „Größe").

- [ ] **Step 2: Kompilieren** — `npx tsc --noEmit` zeigt jetzt GEZIELT die offenen Aufrufer (main.ts host.generate / restoreRecipe): in `main.ts` minimal nachziehen — `generate: (steps, seed, width, height) => void this.generate(steps, seed, width, height)` (private generate-Signatur erweitern, Werte vorerst bis Task 10 nur in GenParams/History durchreichen statt 512-Hardcode aus Task 3), `setSelectedModel: (id) => { this.settings.selectedModel = id; void this.saveSettings(); this.refreshViews(); }`, `restoreRecipe: (entry) => { … view.applyRecipe(entry); … }`.

- [ ] **Step 3: Gate + Commit**

```bash
npm run gate
git add src/obsidian/generate-panel.ts src/obsidian/view.ts src/main.ts src/i18n/strings.ts
git commit -m "feat(obsidian): Modell- und Größen-Dropdown, Katalog-getriebene Regler im Generate-Tab"
```

---

### Task 10: main.ts — Engine-Router, FLUX-Download, Lebenszyklus

**Files:**
- Modify: `src/main.ts`, `src/core/engine.ts` (nur Typ-Kommentar/optionale Felder, s.u.)

**Interfaces:**
- Consumes: alles aus Tasks 1–9.
- Produces: `downloadFluxModel(): Promise<void>` und `refreshMfluxStatus(): void` (vom Settings-Tab in Task 11 aufgerufen), PanelState initialisiert `selectedModel`/`mflux`.

- [ ] **Step 1: Implementierung**

**PanelState-Init** (Konstruktor-Feld `state`): `selectedModel: DEFAULT_MODEL_ID, mflux: { binary: null, weights: "missing", download: null }` ergänzen; in `onload` NACH dem Settings-Laden: `this.state.selectedModel = this.settings.selectedModel;` und `this.refreshMfluxStatus()` (vor `initStatus`-Aufruf einsortieren, synchron).

```ts
/** mflux-Erkennung + Gewichte-Check in den State spiegeln (onload, Settings-Änderungen). */
refreshMfluxStatus(): void {
  this.state.mflux = {
    binary: detectMflux(this.settings),
    weights: fluxWeightsReady(this.settings) ? "ready" : "missing",
    download: null,
  };
  this.refreshViews();
}
```

**Engine-Router** — `generate` wird zur Weiche, der bisherige Körper wandert unverändert nach `generateOrt`:

```ts
private mfluxEngine = new MfluxEngine();

private async generate(steps: number, seed: number, width: number, height: number): Promise<void> {
  if (this.state.run.kind === "running" || this.state.run.kind === "loading") return;
  const spec = getModel(this.settings.selectedModel);
  const prompt = this.state.prompt;
  if (spec.engine === "mflux") return this.generateMflux(spec, prompt, steps, seed, width, height);
  return this.generateOrt(prompt, steps, seed); // Katalog garantiert 512² für sd-turbo
}

private async generateMflux(spec: ModelSpec, prompt: string, steps: number, seed: number, width: number, height: number): Promise<void> {
  const binary = this.state.mflux.binary;
  if (binary === null || this.state.mflux.weights !== "ready" || this.mfluxEngine.busy) return; // ViewModel gated das bereits — Defensive
  // Ladephase mit Sekundenzähler (wie ensureEngine): mflux lädt das Modell bei jedem
  // Aufruf neu in den Speicher; der erste Step-Callback beendet die Phase.
  this.state.run = { kind: "loading", elapsedSec: 0 };
  this.refreshViews();
  const tick = window.setInterval(() => {
    if (this.state.run.kind === "loading") {
      this.state.run = { kind: "loading", elapsedSec: this.state.run.elapsedSec + 1 };
      this.refreshViews();
    }
  }, 1000);
  let succeeded = false;
  try {
    const png = await this.mfluxEngine.run(binary, spec, { prompt, seed, steps, width, height }, this.settings.modelsDir.trim(), {
      onDownload: (file, pct) => {
        // Sollte im Normalfall nie feuern (Gewichte-Gate oben) — falls doch (Cache extern
        // gelöscht), ehrlich als Download anzeigen statt minutenlang "Loading".
        this.state.mflux = { ...this.state.mflux, weights: "downloading", download: { file, pct } };
        this.refreshViews();
      },
      onStep: (step, total) => {
        this.state.run = { kind: "running", step, total };
        this.refreshViews();
      },
    });
    this.state.image = {
      dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      params: { prompt, seed, steps, model: spec.id, width, height, date: isoStamp(new Date()) },
    };
    this.state.run = { kind: "idle" };
    this.state.mflux = { ...this.state.mflux, weights: "ready", download: null };
    succeeded = true;
  } catch (e) {
    // "cancelled" (View-Close/Unload hat gekillt) ist kein Fehler — UI still auf idle.
    const msg = e instanceof Error ? e.message : String(e);
    this.state.run = msg === "cancelled" ? { kind: "idle" } : { kind: "error", message: msg };
  } finally {
    window.clearInterval(tick);
    this.refreshViews();
  }
  if (succeeded && this.state.image) {
    const p = this.state.image.params;
    this.settings.history = pushHistory(this.settings.history, {
      prompt: p.prompt, seed: p.seed, steps: p.steps, model: p.model,
      width: p.width, height: p.height, created: p.date,
    });
    void this.saveSettings();
  }
}
```

`generateOrt` = bisheriger `generate`-Körper; im Erfolgs-Params-Objekt `width: 512, height: 512` (ersetzt den Übergangsfix aus Task 3), History-Push ebenso.

**FLUX-Download (Vorbereitungslauf, Spec §6):**

```ts
async downloadFluxModel(): Promise<void> {
  const spec = getModel("flux2-klein-4b");
  const binary = this.state.mflux.binary;
  if (binary === null || this.mfluxEngine.busy) return;
  this.state.mflux = { ...this.state.mflux, weights: "downloading", download: { file: "…", pct: 0 } };
  this.refreshViews();
  try {
    // Vorbereitungslauf: 1 Step / 512² / Seed 0 — mflux lädt dabei die Gewichte; das
    // Mini-Bild wird verworfen (Temp-Cleanup der Engine). Ein reiner Download-Befehl
    // existiert in der verifizierten mflux-Version nicht.
    await this.mfluxEngine.run(binary, spec, { prompt: "warmup", seed: 0, steps: 1, width: 512, height: 512 },
      this.settings.modelsDir.trim(), {
        onDownload: (file, pct) => {
          this.state.mflux = { ...this.state.mflux, weights: "downloading", download: { file, pct } };
          this.refreshViews();
        },
        onStep: () => {},
      });
    this.state.mflux = { ...this.state.mflux, weights: "ready", download: null };
  } catch (e) {
    this.state.mflux = { ...this.state.mflux, weights: fluxWeightsReady(this.settings) ? "ready" : "missing", download: null };
    throw e;
  } finally {
    this.refreshViews();
  }
}
```

**Lebenszyklus:** `onunload()` += `this.mfluxEngine.kill();` (vor dem ORT-dispose). `saveImage`/`createNote`/`buildImageNote` funktionieren unverändert (GenParams trägt width/height seit Task 3).

**Typ-Anpassung (Spec §4.1):** In `src/core/engine.ts` wird `GenerateResult.width/height`
von den Literaltypen `512` auf `number` verbreitert (der SdTurboEngine-Code bleibt
unverändert — er liefert weiterhin 512).

**Provider-API (Spec §10):** In `src/core/engine.ts` über `GenerateRequest` dokumentieren:

```ts
/** Provider-Sicht (yijing-oracle, Spec 0.4 §10): model/width/height sind dort OPTIONAL
 *  mit Default sd-turbo/512² — unabhängig vom UI-Dropdown. Die interne Pipeline hier
 *  bleibt bewusst schmal (prompt/steps/seed); der Router in main.ts füllt die Defaults. */
```

- [ ] **Step 2: Voller Testlauf + Gate**

Run: `npm run gate`
Expected: PASS (alle bestehenden Tests grün; keine neuen — dieser Task ist Wiring, die Logik dahinter ist in Tasks 1–8 getestet)

- [ ] **Step 3: Commit**

```bash
git add src/main.ts src/core/engine.ts
git commit -m "feat(obsidian): Engine-Router, FLUX-Generierung und Gewichte-Download über mflux"
```

---

### Task 11: Settings-Sektion „FLUX.2 klein 4B (mflux)"

**Files:**
- Modify: `src/obsidian/settings-tab.ts`, `src/i18n/strings.ts`

**Interfaces:**
- Consumes: `detectMflux` (Task 6, indirekt via `plugin.refreshMfluxStatus()`), `downloadFluxModel`, `getState().mflux` (Task 10).

- [ ] **Step 1: Implementierung** — Sektion zwischen „Model" und „Output" einhängen, Muster = state-getriebene Model-Sektion (Robustheits-Block):

```ts
// display(): nach renderModel-Block
this.fluxSectionEl = collapsibleSection(containerEl, {
  title: "FLUX.2 klein 4B (mflux)", // Eigenname + Toolname — unübersetzt
  key: "mflux",
  defaultCollapsed: false,
  storage: this.storage,
});
this.renderFlux(this.fluxSectionEl);

// refreshModel() erweitern (Aufrufer main.refreshViews bleibt unverändert):
refreshModel(): void {
  const el = this.modelSectionEl;
  if (el?.isConnected) { el.empty(); this.renderModel(el); }
  const fx = this.fluxSectionEl;
  if (fx?.isConnected) { fx.empty(); this.renderFlux(fx); }
}

private renderFlux(el: HTMLElement): void {
  const mflux = this.plugin.getState().mflux;

  // 1) Binary-Status + Pfad-Feld
  const status = new Setting(el).setName(t("settings.mflux.binary"));
  status.setDesc(
    mflux.binary !== null ? t("settings.mflux.found", mflux.binary) : t("settings.mflux.notFound"),
  );
  status.addText((tf) => {
    tf.setPlaceholder(t("settings.mflux.binaryPlaceholder"))
      .setValue(this.plugin.settings.mfluxPath)
      .onChange(async (v) => {
        this.plugin.settings.mfluxPath = v.trim();
        await this.plugin.saveSettings();
        this.plugin.refreshMfluxStatus(); // re-detect → refreshViews → refreshModel
      });
  });

  // 2) Speicherort (Systempfad — bewusst KEIN FolderSuggest, der kennt nur Vault-Ordner)
  new Setting(el)
    .setName(t("settings.mflux.modelsDir"))
    .setDesc(t("settings.mflux.modelsDirDesc"))
    .addText((tf) => {
      tf.setPlaceholder("~/.cache/huggingface")
        .setValue(this.plugin.settings.modelsDir)
        .onChange(async (v) => {
          this.plugin.settings.modelsDir = v.trim();
          await this.plugin.saveSettings();
          this.plugin.refreshMfluxStatus(); // Gewichte-Check gegen neuen Ort
        });
    });

  // 3) Gewichte: ready → Häkchen · downloading → Prozent + Detail · missing → Download-Button
  const weights = new Setting(el).setName(t("settings.mflux.weights")).setDesc(t("settings.mflux.weightsDesc"));
  if (mflux.weights === "ready") {
    weights.addExtraButton((b) => b.setIcon("circle-check").setTooltip(t("settings.model.downloadedTooltip")));
    return;
  }
  if (mflux.weights === "downloading") {
    weights.addButton((b) => b.setButtonText(`${mflux.download?.pct ?? 0}%`).setDisabled(true));
    el.createEl("p", {
      text: `${mflux.download?.file ?? "…"} — ${mflux.download?.pct ?? 0}%`,
      cls: "setting-item-description",
    });
    return;
  }
  weights.addButton((b) =>
    b.setButtonText(t("settings.mflux.download"))
      .setCta()
      .setDisabled(mflux.binary === null) // ohne Binary kein Vorbereitungslauf
      .onClick(async () => {
        try {
          await this.plugin.downloadFluxModel();
          new Notice(t("notice.fluxDownloaded"));
        } catch (e) {
          new Notice(String(e instanceof Error ? e.message : e));
        }
      }),
  );
}
```

Neue i18n-Keys (EN/DE, Wortlaut verbindlich): `settings.mflux.binary` („mflux runtime" / „mflux-Runtime"), `settings.mflux.found` („Found: {0}" / „Gefunden: {0}"), `settings.mflux.notFound` („Not found. Install with `uv tool install mflux`, then reopen this tab — or enter the path to mflux-generate-flux2 below." / „Nicht gefunden. Mit `uv tool install mflux` installieren und diesen Tab neu öffnen — oder unten den Pfad zu mflux-generate-flux2 eintragen."), `settings.mflux.binaryPlaceholder` („Path to mflux-generate-flux2 (optional)" / „Pfad zu mflux-generate-flux2 (optional)"), `settings.mflux.modelsDir` („Model storage location" / „Modell-Speicherort"), `settings.mflux.modelsDirDesc` („Uses the shared Hugging Face cache — models already downloaded via Hugging Face are reused. ComfyUI checkpoints are a different format and cannot be linked. Empty = default (~/.cache/huggingface). Weights: ~8 GB." / „Nutzt den geteilten Hugging-Face-Cache — bereits via Hugging Face geladene Modelle werden wiederverwendet. ComfyUI-Checkpoints sind ein anderes Format und können nicht eingebunden werden. Leer = Standard (~/.cache/huggingface). Gewichte: ~8 GB."), `settings.mflux.weights` („FLUX.2 weights" / „FLUX.2-Gewichte"), `settings.mflux.weightsDesc` („Downloaded on first use or explicitly here (~8 GB, from Hugging Face)." / „Werden beim expliziten Download hier geladen (~8 GB, von Hugging Face)."), `settings.mflux.download` („Download (~8 GB)" / „Herunterladen (~8 GB)"), `notice.fluxDownloaded` („FLUX.2 weights downloaded" / „FLUX.2-Gewichte heruntergeladen").

> **Konsistenz-Hinweis:** `settings.mflux.weightsDesc` sagt bewusst NICHT „beim ersten
> Generieren" — Generate startet nie einen Download (Spec §6); der Weg ist der Button hier.

- [ ] **Step 2: Gate + Commit**

```bash
npm run gate
git add src/obsidian/settings-tab.ts src/i18n/strings.ts
git commit -m "feat(obsidian): Settings-Sektion für mflux — Erkennung, Speicherort, Gewichte-Download"
```

---

### Task 12: README-Offenlegung + AGENTS-Gotcha

**Files:**
- Modify: `README.md` (Abschnitt „Network use" / Offenlegung), `AGENTS.md` (Architecture notes)

- [ ] **Step 1: README ergänzen** (beim bestehenden Offenlegungs-Block; EN, Stil des Bestands):

```markdown
### FLUX.2 klein 4B (optional second model)

- Runs via [mflux](https://github.com/filipstrand/mflux), a local CLI tool **you install
  yourself** (`uv tool install mflux`). The plugin never downloads or executes code on
  its own — it only detects and runs the tool you installed, as a local child process.
- Model weights (~8 GB, `black-forest-labs/FLUX.2-klein-4B`) are downloaded from
  Hugging Face only after you explicitly start the download in the settings. They are
  stored in the Hugging Face cache (`~/.cache/huggingface` or a folder you choose),
  outside your vault, and are shared with other Hugging Face tools.
- No telemetry, no other network use.
```

- [ ] **Step 2: AGENTS.md ergänzen** (unter „Architecture notes / Gotchas"):

```markdown
- **mflux-Kindprozess (0.4):** FLUX.2 klein läuft über `mflux-generate-flux2` (User-
  installiert, Auto-Detect in mflux-host.ts — Electron erbt keinen Shell-PATH). tqdm
  schreibt Fortschritt auf **stderr mit `\r`** — splitChunks/parseMfluxLine (core) sind
  die einzige Stelle, die das Format kennt. Quantisierung fest `--quantize 8`.
```

- [ ] **Step 3: Gate + Commit**

```bash
npm run gate
git add README.md AGENTS.md
git commit -m "docs: Store-Offenlegung und Architektur-Notizen für mflux/FLUX.2"
```

---

## Smoke-Test (nach Merge, als user-handover)

Nicht Teil der Tasks, aber der Plan endet erst hier (Spec §11): mflux ist auf Jays Mac
bereits installiert (`~/.local/bin/mflux-generate-flux2`, 2026-07-18 in der Plan-Session).
Zu verifizieren: (1) Settings zeigen „Gefunden", (2) Download-Button lädt mit sichtbarem
Fortschritt (~8 GB!), (3) FLUX-Generierung 512² und 1024×576 inkl. Statusphasen,
(4) History-Restore stellt Modell+Größe wieder her, (5) Ergebnis-Notiz trägt width/height,
(6) SD-Turbo-Pfad unverändert. **Dabei das echte tqdm-Zeilenformat gegen den Parser
prüfen** (Heuristik aus Task 5) — Abweichungen als Fix-Task, nicht als Überraschung.

