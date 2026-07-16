# local-image-generator MVP 0.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obsidian-Plugin, das SD-Turbo-Bilder in-process via onnxruntime-web/WebGPU generiert — Sidebar-View mit Preview, Anlegen, Einfügen.

**Architecture:** `src/core/` = pure TS (Tokenizer, Scheduler, PRNG, Engine — Node-testbar, Sessions injiziert), `src/obsidian/` = Integrationsschicht (ORT-Host mit inline-gebundeltem WASM, Model-Store über Cache API, Hub-View, Settings). Spec: `docs/superpowers/specs/2026-07-16-local-image-generator-mvp-design.md`.

**Tech Stack:** TypeScript, esbuild (CJS-Bundle, `.wasm`-binary-Loader), vitest, onnxruntime-web (WebGPU EP), Modell `schmuell/sd-turbo-ort-web` (fp16).

## Global Constraints

- `manifest.json`: `"id": "local-image-generator"`, `"name": "Local image generator"`, `"isDesktopOnly": true`; `minAppVersion` identisch mit yijing-oracle (`cat ../yijing-oracle/manifest.json`).
- Lizenz **MIT** (Spec §10).
- `src/core/` und `src/vendor/kit/` importieren NIE `obsidian` (Gate `check:pure`).
- UI: nur `createEl`/`createDiv`/`createSpan`/`empty()`, kein `innerHTML`; CSS-Präfix `lig-`, nur Theme-Variablen, kein `!important`; UI-Texte Englisch sentence case; Buttons: Primär `mod-cta`, destruktiv `mod-warning`, sekundär klassenlos; Icon-only-Buttons mit `aria-label`.
- Genau EIN `registerView` (`VIEW_TYPE = "local-image-generator"`).
- Settings-Persistenz über vendored `mergeSettings`, nie Spread/Object.assign direkt.
- TDD: jeder Core-Task beginnt mit fehlschlagendem Test. Commits nach jedem Task, deutsch, Format `feat|test|chore(scope): …` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Nach jedem Task: `npm run typecheck && npm test` grün.

---

### Task 1: Scaffold & Build-Gerüst

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `manifest.json`, `.gitignore`, `styles.css`, `LICENSE`, `src/main.ts`, `src/core/strings.ts`

**Interfaces:**
- Produces: Build-Kommandos `npm run build`/`typecheck`/`test`/`check:pure`; `STRINGS`-Objekt für alle UI-Texte.

- [ ] **Step 1: Dateien schreiben**

`package.json`:
```json
{
  "name": "local-image-generator",
  "version": "0.1.0",
  "description": "Generate images locally inside Obsidian — SD-Turbo via WebGPU, no external software, no cloud.",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc --noEmit && node esbuild.config.mjs --production",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "check:pure": "sh -c \"! grep -rl \\\"from 'obsidian'\\\" src/core src/vendor/kit 2>/dev/null\"",
    "gate": "npm run typecheck && npm test && npm run check:pure && npm run build",
    "deploy": "npm run build && cp main.js manifest.json styles.css \"${OBSIDIAN_PLUGIN_DIR:?set OBSIDIAN_PLUGIN_DIR}\"/"
  },
  "author": "Johannes Kaindl",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20",
    "esbuild": "^0.23",
    "obsidian": "latest",
    "typescript": "^5.5",
    "vitest": "^2"
  },
  "dependencies": {
    "onnxruntime-web": "^1.22"
  }
}
```
(Bei `npm install` die tatsächlich aufgelöste onnxruntime-web-Version im Commit-Text notieren.)

`tsconfig.json` (Muster yijing-oracle, plus DOM für Canvas/Cache API):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`esbuild.config.mjs`:
```js
// Build → main.js. obsidian/electron extern; ORT-WASM wird base64-inline gebundelt
// (Store-Regel: kein Laufzeit-Nachladen von Code — Spec §3/§10).
import esbuild from "esbuild";

const prod = process.argv.includes("--production");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:*"],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  loader: { ".json": "json", ".wasm": "binary" },
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
  console.log("esbuild: watching…");
}
```

`manifest.json` (minAppVersion aus `cat ../yijing-oracle/manifest.json` übernehmen):
```json
{
  "id": "local-image-generator",
  "name": "Local image generator",
  "version": "0.1.0",
  "minAppVersion": "<WIE_YIJING>",
  "description": "Generate images locally inside Obsidian — SD-Turbo via WebGPU, no external software, no cloud.",
  "author": "Johannes Kaindl",
  "isDesktopOnly": true
}
```

`.gitignore`:
```
node_modules/
main.js
.DS_Store
```

`styles.css` (Skeleton, wird in Task 12 gefüllt):
```css
/* local-image-generator — Präfix: lig- · nur Obsidian-Theme-Variablen (UI-STANDARD §3) */
.lig-panel { padding: var(--size-4-4); background: var(--background-primary); }
.lig-row { display: flex; align-items: center; gap: var(--size-4-2); }
```

`LICENSE`: MIT-Standardtext, Copyright 2026 Johannes Kaindl.

`src/core/strings.ts`:
```ts
// Alle UI-Texte zentral (Spec §4) — Englisch, sentence case. i18n-Ausbau später.
export const STRINGS = {
  viewTitle: "Local image generator",
  openCommand: "Open generator",
  promptPlaceholder: "Describe the image…",
  generate: "Generate",
  regenerate: "Regenerate",
  create: "Create",
  insert: "Insert",
  steps: "Steps",
  seed: "Seed",
  randomSeed: "Randomize seed",
  statusChecking: "Checking GPU…",
  statusReady: "Ready",
  statusNoWebgpu: "WebGPU is not available. This plugin needs macOS or Windows with a supported GPU (Linux support depends on drivers).",
  statusNoF16: "This GPU lacks fp16 support (shader-f16), which the model requires.",
  statusDownloading: (pct: number) => `Downloading model… ${pct}%`,
  statusGenerating: (step: number, total: number) => `Generating… step ${step}/${total}`,
  statusError: (msg: string) => `Error: ${msg}`,
  emptyNoModel: "The model (~2.5 GB) is not downloaded yet.",
  emptyNoModelCta: "Download model (~2.5 GB)",
  emptyNoImage: "Enter a prompt and press Generate.",
  insertNeedsEditor: "Open a note to insert the image",
  oomHint: "Generation failed. Try closing other apps — the model needs roughly 4–7 GB of free memory.",
  settingsModelHeading: "Model",
  settingsModelDesc: "SD-Turbo (ONNX, fp16) is downloaded from Hugging Face after you explicitly start it. Stored in the local browser cache, outside your vault.",
  settingsDownload: "Download",
  settingsDelete: "Delete model",
  settingsDeleteConfirm: "Delete the downloaded model files (~2.5 GB)? You can download them again anytime.",
  settingsOutputHeading: "Output",
  settingsOutputFolder: "Image folder",
  settingsOutputFolderDesc: "Where generated images are saved. Leave empty to use Obsidian's attachment folder.",
  cancel: "Cancel",
  confirm: "Delete",
} as const;
```

`src/main.ts` (minimal, wird in Task 12 ausgebaut):
```ts
import { Plugin } from "obsidian";

export default class LocalImageGeneratorPlugin extends Plugin {
  async onload(): Promise<void> {
    // Wiring folgt in Task 12.
  }
}
```

- [ ] **Step 2: Install + Gate**

Run: `npm install && npm run typecheck && npm test && npm run check:pure && npm run build`
Expected: alles grün, `main.js` entsteht. Prüfen: `ls node_modules/onnxruntime-web/dist/ | grep jsep` → genauen WASM-Dateinamen notieren (erwartet `ort-wasm-simd-threaded.jsep.wasm`); falls abweichend, Pfad in Task 11 anpassen.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: Scaffold (esbuild, vitest, manifest, strings)"
```

---

### Task 2: Kit vendoren + Settings-Defaults

**Files:**
- Create: `src/vendor/kit/settings.ts` (Kopie), `src/core/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `mergeSettings<T>(defaults: T, raw: unknown): T` · `interface LigSettings { outputFolder: string }` · `DEFAULT_SETTINGS: LigSettings`

- [ ] **Step 1: Vendoring (verbatim, Kit-first)**

```bash
cp ../yijing-oracle/src/vendor/kit/settings.ts src/vendor/kit/settings.ts
```

- [ ] **Step 2: Fehlschlagenden Test schreiben**

`tests/settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/vendor/kit/settings";
import { DEFAULT_SETTINGS, type LigSettings } from "../src/core/settings";

describe("settings", () => {
  it("liefert Defaults bei null/undefined raw", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual({ outputFolder: "" });
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual({ outputFolder: "" });
  });
  it("übernimmt gespeicherte Werte und behält unbekannte Felder (Forward-Compat)", () => {
    const merged = mergeSettings<LigSettings>(DEFAULT_SETTINGS, { outputFolder: "Art", future: 1 } as unknown);
    expect(merged.outputFolder).toBe("Art");
    expect((merged as Record<string, unknown>)["future"]).toBe(1);
  });
  it("teilt keine Referenzen mit dem Defaults-Objekt", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {});
    expect(merged).not.toBe(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 3: Test läuft fehl** — Run: `npx vitest run tests/settings.test.ts` · Expected: FAIL (`src/core/settings` fehlt)

- [ ] **Step 4: Implementieren**

`src/core/settings.ts`:
```ts
// Plugin-Settings — pure (Spec §6/§7). Leerer outputFolder = Obsidians Attachment-Logik.
export interface LigSettings {
  outputFolder: string;
}

export const DEFAULT_SETTINGS: LigSettings = {
  outputFolder: "",
};
```

- [ ] **Step 5: Test grün** — Run: `npx vitest run tests/settings.test.ts` · Expected: PASS

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(core): Settings-Defaults + vendored mergeSettings"`

---

### Task 3: Numerik-Grundbausteine — f16 + geseedeter PRNG

**Files:**
- Create: `src/core/pipeline/f16.ts`, `src/core/pipeline/prng.ts`
- Test: `tests/f16.test.ts`, `tests/prng.test.ts`

**Interfaces:**
- Produces: `f32ToF16(x: number): number` · `f16ToF32(bits: number): number` · `f32ArrayToF16(a: Float32Array): Uint16Array` · `f16ArrayToF32(a: Uint16Array): Float32Array` · `mulberry32(seed: number): () => number` · `gaussianArray(seed: number, n: number): Float32Array`

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`tests/f16.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { f16ArrayToF32, f16ToF32, f32ArrayToF16, f32ToF16 } from "../src/core/pipeline/f16";

describe("f16", () => {
  it("Roundtrip exakter f16-Werte", () => {
    for (const v of [0, 1, -1, 0.5, -2, 1024, 65504, -65504]) {
      expect(f16ToF32(f32ToF16(v))).toBe(v);
    }
  });
  it("bekannte Bitmuster", () => {
    expect(f32ToF16(1)).toBe(0x3c00);
    expect(f32ToF16(-2)).toBe(0xc000);
    expect(f16ToF32(0x7bff)).toBe(65504); // max f16
  });
  it("Überlauf wird auf Infinity abgebildet", () => {
    expect(f16ToF32(f32ToF16(1e6))).toBe(Infinity);
  });
  it("Array-Roundtrip erhält Länge und Werte approx", () => {
    const src = new Float32Array([0.1, -0.9, 3.3, 14.6146]);
    const back = f16ArrayToF32(f32ArrayToF16(src));
    expect(back.length).toBe(4);
    for (let i = 0; i < 4; i++) expect(Math.abs(back[i]! - src[i]!)).toBeLessThan(0.01);
  });
});
```

`tests/prng.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { gaussianArray, mulberry32 } from "../src/core/pipeline/prng";

describe("prng", () => {
  it("mulberry32 ist deterministisch und in [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it("gaussianArray: gleicher Seed → identisch, anderer Seed → verschieden", () => {
    const g1 = gaussianArray(7, 64);
    const g2 = gaussianArray(7, 64);
    const g3 = gaussianArray(8, 64);
    expect(Array.from(g1)).toEqual(Array.from(g2));
    expect(Array.from(g1)).not.toEqual(Array.from(g3));
  });
  it("gaussianArray: Mittel ≈ 0, Std ≈ 1 (10k Samples)", () => {
    const g = gaussianArray(1, 10000);
    const mean = g.reduce((s, x) => s + x, 0) / g.length;
    const std = Math.sqrt(g.reduce((s, x) => s + (x - mean) ** 2, 0) / g.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(std - 1)).toBeLessThan(0.05);
  });
});
```

- [ ] **Step 2: Tests laufen fehl** — Run: `npx vitest run tests/f16.test.ts tests/prng.test.ts` · Expected: FAIL (Module fehlen)

- [ ] **Step 3: Implementieren**

`src/core/pipeline/f16.ts`:
```ts
// f32↔f16-Konvertierung über DataView-Bit-Tricks — die fp16-ONNX-Tensoren sind
// Uint16Array; JS-seitige Mathematik läuft in f32 (Spec §5).
const buf = new ArrayBuffer(4);
const dv = new DataView(buf);

export function f32ToF16(x: number): number {
  dv.setFloat32(0, x);
  const bits = dv.getUint32(0);
  const sign = (bits >>> 16) & 0x8000;
  let exp = (bits >>> 23) & 0xff;
  let mant = bits & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf/NaN
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // Überlauf → Inf
  if (e <= 0) {
    if (e < -10) return sign; // → 0
    mant |= 0x800000;
    const shift = 14 - e;
    const half = (mant >> shift) + ((mant >> (shift - 1)) & 1); // round-to-nearest
    return sign | half;
  }
  const half = (e << 10) | (mant >> 13);
  return half + ((mant >> 12) & 1); // round-to-nearest
}

export function f16ToF32(h: number): number {
  const sign = (h & 0x8000) << 16;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  let bits: number;
  if (exp === 0) {
    if (mant === 0) bits = sign;
    else {
      // subnormal → normalisieren
      let e = -1;
      let m = mant;
      do { e++; m <<= 1; } while ((m & 0x400) === 0);
      bits = sign | ((127 - 15 - e) << 23) | ((m & 0x3ff) << 13);
    }
  } else if (exp === 0x1f) {
    bits = sign | 0x7f800000 | (mant << 13);
  } else {
    bits = sign | ((exp - 15 + 127) << 23) | (mant << 13);
  }
  dv.setUint32(0, bits);
  return dv.getFloat32(0);
}

export function f32ArrayToF16(a: Float32Array): Uint16Array {
  const out = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f32ToF16(a[i]!);
  return out;
}

export function f16ArrayToF32(a: Uint16Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f16ToF32(a[i]!);
  return out;
}
```

`src/core/pipeline/prng.ts`:
```ts
// Geseedeter PRNG (mulberry32) + Box-Muller-Gauß — reproduzierbare Start-Latents
// und Ancestral-Noise (Spec §5: gleicher Seed+Steps → gleiches Bild).
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussianArray(seed: number, n: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}
```

- [ ] **Step 4: Tests grün** — Run: `npx vitest run tests/f16.test.ts tests/prng.test.ts` · Expected: PASS

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(pipeline): f16-Konvertierung + geseedeter Gauß-PRNG"`

---

### Task 4: Euler-Ancestral-Scheduler (sd-turbo)

**Files:**
- Create: `src/core/pipeline/scheduler.ts`
- Test: `tests/scheduler.test.ts`

**Interfaces:**
- Produces: `makeSchedule(steps: number): Schedule` mit `interface Schedule { timesteps: number[]; sigmas: number[]; initNoiseSigma: number }` · `scaleInput(latents: Float32Array, sigma: number): Float32Array` · `schedulerStep(modelOutput: Float32Array, sample: Float32Array, i: number, sigmas: number[], noise: Float32Array): Float32Array`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/scheduler.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { makeSchedule, scaleInput, schedulerStep } from "../src/core/pipeline/scheduler";

describe("scheduler (Euler-Ancestral, sd-turbo)", () => {
  it("initNoiseSigma ≈ 14.6146 (Golden-Wert aus dem MS-Demo)", () => {
    const s = makeSchedule(1);
    expect(Math.abs(s.initNoiseSigma - 14.6146)).toBeLessThan(0.01);
  });
  it("trailing timesteps: 1 Step → [999], 4 Steps → [999,749,499,249]", () => {
    expect(makeSchedule(1).timesteps).toEqual([999]);
    expect(makeSchedule(4).timesteps).toEqual([999, 749, 499, 249]);
  });
  it("sigmas fallen monoton und enden mit 0", () => {
    const s = makeSchedule(4);
    expect(s.sigmas.length).toBe(5);
    for (let i = 1; i < s.sigmas.length; i++) expect(s.sigmas[i]!).toBeLessThan(s.sigmas[i - 1]!);
    expect(s.sigmas[4]).toBe(0);
  });
  it("scaleInput teilt durch sqrt(sigma²+1)", () => {
    const out = scaleInput(new Float32Array([2]), Math.sqrt(3));
    expect(Math.abs(out[0]! - 1)).toBeLessThan(1e-6);
  });
  it("1-Step: Ergebnis = pred_original (sigma_to=0 ⇒ kein Noise, dt=-sigma)", () => {
    const s = makeSchedule(1);
    const sample = new Float32Array([1.0]);
    const modelOutput = new Float32Array([0.5]);
    const noise = new Float32Array([99]); // darf keine Wirkung haben
    const prev = schedulerStep(modelOutput, sample, 0, s.sigmas, noise);
    const predOriginal = 1.0 - s.sigmas[0]! * 0.5;
    expect(Math.abs(prev[0]! - predOriginal)).toBeLessThan(1e-4);
  });
});
```

- [ ] **Step 2: Test läuft fehl** — Run: `npx vitest run tests/scheduler.test.ts` · Expected: FAIL

- [ ] **Step 3: Implementieren**

`src/core/pipeline/scheduler.ts`:
```ts
// Euler-Ancestral-Scheduler für sd-turbo (Spec §5) — portiert nach dem Muster von
// microsoft/onnxruntime-inference-examples js/sd-turbo bzw. diffusers
// EulerAncestralDiscreteScheduler. Training: 1000 Steps, beta scaled_linear
// 0.00085→0.012, timestep-Spacing "trailing". Guidance fix 1.0 (keine CFG).
const TRAIN_STEPS = 1000;
const BETA_START = 0.00085;
const BETA_END = 0.012;

export interface Schedule {
  timesteps: number[];
  sigmas: number[]; // Länge steps+1, letzter Eintrag 0
  initNoiseSigma: number;
}

function alphasCumprod(): Float64Array {
  const out = new Float64Array(TRAIN_STEPS);
  let prod = 1;
  const s0 = Math.sqrt(BETA_START);
  const s1 = Math.sqrt(BETA_END);
  for (let t = 0; t < TRAIN_STEPS; t++) {
    const beta = (s0 + (t / (TRAIN_STEPS - 1)) * (s1 - s0)) ** 2;
    prod *= 1 - beta;
    out[t] = prod;
  }
  return out;
}

export function makeSchedule(steps: number): Schedule {
  const ac = alphasCumprod();
  const timesteps: number[] = [];
  const stepRatio = TRAIN_STEPS / steps; // trailing spacing
  for (let i = 0; i < steps; i++) {
    timesteps.push(Math.round(TRAIN_STEPS - i * stepRatio) - 1);
  }
  const sigmas = timesteps.map((t) => Math.sqrt((1 - ac[t]!) / ac[t]!));
  sigmas.push(0);
  return { timesteps, sigmas, initNoiseSigma: sigmas[0]! };
}

export function scaleInput(latents: Float32Array, sigma: number): Float32Array {
  const k = 1 / Math.sqrt(sigma * sigma + 1);
  const out = new Float32Array(latents.length);
  for (let i = 0; i < latents.length; i++) out[i] = latents[i]! * k;
  return out;
}

export function schedulerStep(
  modelOutput: Float32Array,
  sample: Float32Array,
  i: number,
  sigmas: number[],
  noise: Float32Array,
): Float32Array {
  const sigma = sigmas[i]!;
  const sigmaTo = sigmas[i + 1]!;
  const sigmaUp = Math.sqrt((sigmaTo * sigmaTo * (sigma * sigma - sigmaTo * sigmaTo)) / (sigma * sigma));
  const sigmaDown = Math.sqrt(sigmaTo * sigmaTo - sigmaUp * sigmaUp);
  const dt = sigmaDown - sigma;
  const out = new Float32Array(sample.length);
  for (let j = 0; j < sample.length; j++) {
    const predOriginal = sample[j]! - sigma * modelOutput[j]!; // epsilon-Prediction
    const derivative = (sample[j]! - predOriginal) / sigma;
    out[j] = sample[j]! + derivative * dt + noise[j]! * sigmaUp;
  }
  return out;
}
```

- [ ] **Step 4: Test grün** — Run: `npx vitest run tests/scheduler.test.ts` · Expected: PASS. Falls der Golden-Wert 14.6146 verfehlt wird: Beta-Schedule gegen die Referenz prüfen (`curl -sL https://raw.githubusercontent.com/microsoft/onnxruntime-inference-examples/main/js/sd-turbo/main.js` in den Scratchpad), NICHT den Test aufweichen.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(pipeline): Euler-Ancestral-Scheduler mit trailing timesteps"`

---

### Task 5: CLIP-BPE-Tokenizer

**Files:**
- Create: `src/core/pipeline/tokenizer.ts`
- Test: `tests/tokenizer.test.ts`

**Interfaces:**
- Consumes: nichts (pure).
- Produces: `interface TokenizerData { vocab: Record<string, number>; merges: string[] }` · `tokenize(text: string, data: TokenizerData, opts?: TokenizerOpts): Int32Array` (Länge immer 77, BOS/EOS/Pad enthalten) · `TOKEN_LEN = 77`, `BOS = 49406`, `EOS = 49407`. Vocab/Merges kommen zur Laufzeit aus dem Model-Store (Task 10 lädt `vocab.json`/`merges.txt` mit herunter — Daten, kein Code).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/tokenizer.test.ts` — synthetisches Mini-Vocab testet die BPE-Mechanik (Golden-Vektoren gegen das echte 49k-Vocab prüft der Smoke-Test):
```ts
import { describe, expect, it } from "vitest";
import { tokenize, type TokenizerData } from "../src/core/pipeline/tokenizer";

// Mini-Vocab: Einzelzeichen + ein Merge "ab". BOS/EOS wie CLIP (49406/49407)
// funktionieren unabhängig von der Vocab-Größe, weil sie als Opts übergeben werden.
const data: TokenizerData = {
  vocab: { "a": 1, "b": 2, "c": 3, "a</w>": 4, "b</w>": 5, "c</w>": 6, "ab": 7, "ab</w>": 8, "abc</w>": 9 },
  merges: ["a b", "ab c"],
};
const opts = { maxLen: 8, bos: 100, eos: 101, pad: 101 };

describe("CLIP-BPE-Tokenizer", () => {
  it("wendet Merges in Prioritätsreihenfolge an: 'abc' → ein Token", () => {
    const ids = tokenize("abc", data, opts);
    expect(Array.from(ids)).toEqual([100, 9, 101, 101, 101, 101, 101, 101]);
  });
  it("einzelnes Wortende bekommt </w>: 'c' → c</w>", () => {
    const ids = tokenize("c", data, opts);
    expect(ids[1]).toBe(6);
  });
  it("lowercase + Whitespace-Normalisierung", () => {
    expect(Array.from(tokenize("  ABC  ", data, opts))).toEqual(Array.from(tokenize("abc", data, opts)));
  });
  it("mehrere Wörter, truncation auf maxLen (EOS bleibt am Ende)", () => {
    const ids = tokenize("abc abc abc abc abc abc abc abc abc", data, opts);
    expect(ids.length).toBe(8);
    expect(ids[0]).toBe(100);
    expect(ids[7]).toBe(101);
  });
  it("liefert immer exakt maxLen Tokens (Padding)", () => {
    expect(tokenize("", data, opts).length).toBe(8);
  });
});
```

- [ ] **Step 2: Test läuft fehl** — Run: `npx vitest run tests/tokenizer.test.ts` · Expected: FAIL

- [ ] **Step 3: Implementieren**

`src/core/pipeline/tokenizer.ts`:
```ts
// CLIP-BPE-Tokenizer (Spec §5) — Algorithmus wie openai/CLIP simple_tokenizer:
// bytes_to_unicode (GPT-2-Tabelle), Wort-Regex, BPE-Merges nach Rang, "</w>"-Wortende.
// vocab.json/merges.txt werden zur Laufzeit geladen und hier injiziert (pure).
export interface TokenizerData {
  vocab: Record<string, number>;
  merges: string[]; // Zeilen wie "a b", Reihenfolge = Priorität
}

export interface TokenizerOpts {
  maxLen?: number;
  bos?: number;
  eos?: number;
  pad?: number;
}

export const TOKEN_LEN = 77;
export const BOS = 49406;
export const EOS = 49407;

function bytesToUnicode(): Map<number, string> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = new Map<number, string>();
  bs.forEach((b, i) => map.set(b, String.fromCodePoint(cs[i]!)));
  return map;
}

const BYTE_ENCODER = bytesToUnicode();
const WORD_RE = /'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;

function bpe(word: string, ranks: Map<string, number>, cache: Map<string, string[]>): string[] {
  const cached = cache.get(word);
  if (cached) return cached;
  let parts = [...word.slice(0, -4)]; // ohne "</w>"
  if (parts.length === 0) return [word];
  parts[parts.length - 1] += "</w>";
  for (;;) {
    let best = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < parts.length - 1; i++) {
      const rank = ranks.get(parts[i]! + " " + parts[i + 1]!);
      if (rank !== undefined && rank < best) {
        best = rank;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    parts = [...parts.slice(0, bestIdx), parts[bestIdx]! + parts[bestIdx + 1]!, ...parts.slice(bestIdx + 2)];
  }
  cache.set(word, parts);
  return parts;
}

export function tokenize(text: string, data: TokenizerData, opts: TokenizerOpts = {}): Int32Array {
  const maxLen = opts.maxLen ?? TOKEN_LEN;
  const bos = opts.bos ?? BOS;
  const eos = opts.eos ?? EOS;
  const pad = opts.pad ?? EOS; // sd-turbo/MS-Demo: Padding mit EOS
  const ranks = new Map<string, number>(data.merges.map((m, i) => [m, i]));
  const cache = new Map<string, string[]>();

  const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
  const ids: number[] = [bos];
  for (const match of clean.match(WORD_RE) ?? []) {
    const encoded = Array.from(new TextEncoder().encode(match), (b) => BYTE_ENCODER.get(b)!).join("");
    for (const tok of bpe(encoded + "</w>", ranks, cache)) {
      const id = data.vocab[tok];
      if (id !== undefined) ids.push(id);
    }
    if (ids.length >= maxLen - 1) break;
  }
  ids.length = Math.min(ids.length, maxLen - 1);
  ids.push(eos);
  const out = new Int32Array(maxLen).fill(pad);
  out.set(ids);
  return out;
}
```

- [ ] **Step 4: Test grün** — Run: `npx vitest run tests/tokenizer.test.ts` · Expected: PASS

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(pipeline): CLIP-BPE-Tokenizer (pure, Daten injiziert)"`

---

### Task 6: Bild-Umrechnung + Dateinamen

**Files:**
- Create: `src/core/pipeline/image.ts`, `src/core/filename.ts`
- Test: `tests/image.test.ts`, `tests/filename.test.ts`

**Interfaces:**
- Produces: `chwToRgba(data: Float32Array, w: number, h: number): Uint8ClampedArray` (Input: VAE-Output [1,3,h,w] CHW in [-1,1]) · `buildImageFilename(d: Date, seed: number): string` → `lig-YYYYMMDD-HHmmss-s<seed>.png`

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`tests/image.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { chwToRgba } from "../src/core/pipeline/image";

describe("chwToRgba", () => {
  it("mappt [-1,1] auf [0,255], interleaved RGBA, Alpha 255", () => {
    // 1x1-Bild: R=-1, G=0, B=1
    const rgba = chwToRgba(new Float32Array([-1, 0, 1]), 1, 1);
    expect(Array.from(rgba)).toEqual([0, 128, 255, 255]);
  });
  it("clampt Ausreißer", () => {
    const rgba = chwToRgba(new Float32Array([-5, 5, 0]), 1, 1);
    expect(rgba[0]).toBe(0);
    expect(rgba[1]).toBe(255);
  });
  it("CHW→HWC-Reihenfolge stimmt bei 2x1", () => {
    // R-Kanal: [r0,r1], G: [g0,g1], B: [b0,b1] → Pixel0=(r0,g0,b0)
    const rgba = chwToRgba(new Float32Array([-1, 1, 0, 0, 1, -1]), 2, 1);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 128, 255, 255]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([255, 128, 0, 255]);
  });
});
```

`tests/filename.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildImageFilename } from "../src/core/filename";

describe("buildImageFilename", () => {
  it("Schema lig-YYYYMMDD-HHmmss-s<seed>.png", () => {
    const d = new Date(2026, 6, 16, 14, 5, 9); // 16. Juli 2026, 14:05:09 lokal
    expect(buildImageFilename(d, 12345)).toBe("lig-20260716-140509-s12345.png");
  });
});
```

- [ ] **Step 2: Tests laufen fehl** — Run: `npx vitest run tests/image.test.ts tests/filename.test.ts` · Expected: FAIL

- [ ] **Step 3: Implementieren**

`src/core/pipeline/image.ts`:
```ts
// VAE-Output ([1,3,h,w] CHW, Werte in [-1,1]) → RGBA für Canvas/ImageData (Spec §5).
export function chwToRgba(data: Float32Array, w: number, h: number): Uint8ClampedArray {
  const px = w * h;
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    out[i * 4] = Math.round((Math.min(1, Math.max(-1, data[i]!)) / 2 + 0.5) * 255);
    out[i * 4 + 1] = Math.round((Math.min(1, Math.max(-1, data[px + i]!)) / 2 + 0.5) * 255);
    out[i * 4 + 2] = Math.round((Math.min(1, Math.max(-1, data[2 * px + i]!)) / 2 + 0.5) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
```

`src/core/filename.ts`:
```ts
// Dateinamens-Schema (Spec §7): lig-<YYYYMMDD-HHmmss>-s<seed>.png
export function buildImageFilename(d: Date, seed: number): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `lig-${stamp}-s${seed}.png`;
}
```

- [ ] **Step 4: Tests grün** — Run: `npx vitest run tests/image.test.ts tests/filename.test.ts` · Expected: PASS

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): CHW→RGBA-Umrechnung + Dateinamens-Schema"`

---

### Task 7: Modell-Manifest (pure Logik)

**Files:**
- Create: `src/core/model-manifest.ts`
- Test: `tests/model-manifest.test.ts`

**Interfaces:**
- Produces: `type ModelFileKey = "text_encoder" | "unet" | "vae_decoder" | "vocab" | "merges"` · `interface ModelFile { key: ModelFileKey; url: string; approxBytes: number; kind: "onnx" | "json" | "text" }` · `MODEL_FILES: ModelFile[]` · `missingFiles(cachedKeys: ModelFileKey[]): ModelFile[]` · `totalApproxBytes(files: ModelFile[]): number` · `isDownloadComplete(received: number, contentLength: number | null): boolean`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/model-manifest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isDownloadComplete, MODEL_FILES, missingFiles, totalApproxBytes } from "../src/core/model-manifest";

describe("model-manifest", () => {
  it("kennt genau 5 Dateien (3 ONNX + vocab + merges), alle auf huggingface.co", () => {
    expect(MODEL_FILES.length).toBe(5);
    for (const f of MODEL_FILES) expect(f.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+/);
    expect(MODEL_FILES.filter((f) => f.kind === "onnx").length).toBe(3);
  });
  it("missingFiles liefert nur nicht-gecachte Dateien", () => {
    const missing = missingFiles(["unet", "vocab"]);
    expect(missing.map((f) => f.key).sort()).toEqual(["merges", "text_encoder", "vae_decoder"]);
  });
  it("totalApproxBytes summiert (~2.5 GB Gesamtgröße)", () => {
    const total = totalApproxBytes(MODEL_FILES);
    expect(total).toBeGreaterThan(2.3e9);
    expect(total).toBeLessThan(2.8e9);
  });
  it("isDownloadComplete: exakt bei bekannter Länge, sonst >0", () => {
    expect(isDownloadComplete(100, 100)).toBe(true);
    expect(isDownloadComplete(99, 100)).toBe(false);
    expect(isDownloadComplete(1, null)).toBe(true);
    expect(isDownloadComplete(0, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Test läuft fehl** — Run: `npx vitest run tests/model-manifest.test.ts` · Expected: FAIL

- [ ] **Step 3: Implementieren**

`src/core/model-manifest.ts`:
```ts
// Das eine kuratierte Modell (Spec §2/§5): sd-turbo fp16-ONNX von
// schmuell/sd-turbo-ort-web (Referenzmodell des Microsoft-WebGPU-Demos) +
// Tokenizer-Daten von stabilityai/sd-turbo. approxBytes nur für UI-Anzeige;
// Integrität prüft isDownloadComplete gegen Content-Length (Spec §8).
export type ModelFileKey = "text_encoder" | "unet" | "vae_decoder" | "vocab" | "merges";

export interface ModelFile {
  key: ModelFileKey;
  url: string;
  approxBytes: number;
  kind: "onnx" | "json" | "text";
}

const SD_TURBO = "https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main";
const TOKENIZER = "https://huggingface.co/stabilityai/sd-turbo/resolve/main/tokenizer";

export const MODEL_FILES: ModelFile[] = [
  { key: "text_encoder", url: `${SD_TURBO}/text_encoder/model.onnx`, approxBytes: 681e6, kind: "onnx" },
  { key: "unet", url: `${SD_TURBO}/unet/model.onnx`, approxBytes: 1.73e9, kind: "onnx" },
  { key: "vae_decoder", url: `${SD_TURBO}/vae_decoder/model.onnx`, approxBytes: 99e6, kind: "onnx" },
  { key: "vocab", url: `${TOKENIZER}/vocab.json`, approxBytes: 1.1e6, kind: "json" },
  { key: "merges", url: `${TOKENIZER}/merges.txt`, approxBytes: 0.53e6, kind: "text" },
];

export function missingFiles(cachedKeys: ModelFileKey[]): ModelFile[] {
  return MODEL_FILES.filter((f) => !cachedKeys.includes(f.key));
}

export function totalApproxBytes(files: ModelFile[]): number {
  return files.reduce((s, f) => s + f.approxBytes, 0);
}

export function isDownloadComplete(received: number, contentLength: number | null): boolean {
  return contentLength === null ? received > 0 : received === contentLength;
}
```

- [ ] **Step 4: Test grün** — Run: `npx vitest run tests/model-manifest.test.ts` · Expected: PASS

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): Modell-Manifest sd-turbo (5 Dateien, HF-URLs)"`

---

### Task 8: Panel-ViewModel (pure UI-Logik)

**Files:**
- Create: `src/core/viewmodel.ts`
- Test: `tests/viewmodel.test.ts`

**Interfaces:**
- Consumes: `STRINGS` aus `src/core/strings.ts`.
- Produces:
```ts
type GpuState = "checking" | "ok" | "no-webgpu" | "no-f16";
type ModelState = { kind: "missing" } | { kind: "downloading"; pct: number } | { kind: "ready" };
type RunState = { kind: "idle" } | { kind: "running"; step: number; total: number } | { kind: "error"; message: string };
interface PanelState { gpu: GpuState; model: ModelState; run: RunState; image: { seed: number; dataUrl: string } | null; editorActive: boolean; prompt: string }
interface PanelViewModel {
  status: { icon: "loader" | "circle-check" | "circle-x"; text: string; cls: "is-checking" | "is-ok" | "is-error" };
  empty: { text: string; ctaLabel?: string } | null;   // ctaLabel gesetzt ⇒ CTA öffnet Settings
  generateEnabled: boolean; insertEnabled: boolean; showImage: boolean;
}
function buildViewModel(s: PanelState): PanelViewModel
```

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/viewmodel.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildViewModel, type PanelState } from "../src/core/viewmodel";

const base: PanelState = {
  gpu: "ok",
  model: { kind: "ready" },
  run: { kind: "idle" },
  image: null,
  editorActive: true,
  prompt: "a cat",
};

describe("buildViewModel", () => {
  it("bereit: Generate enabled, Empty-State 'kein Bild', Status ok", () => {
    const vm = buildViewModel(base);
    expect(vm.generateEnabled).toBe(true);
    expect(vm.status.cls).toBe("is-ok");
    expect(vm.empty?.ctaLabel).toBeUndefined();
    expect(vm.showImage).toBe(false);
  });
  it("kein WebGPU: Fehler-Status, kein CTA, Generate disabled", () => {
    const vm = buildViewModel({ ...base, gpu: "no-webgpu" });
    expect(vm.generateEnabled).toBe(false);
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.icon).toBe("circle-x");
    expect(vm.empty?.ctaLabel).toBeUndefined();
  });
  it("Modell fehlt: Empty-State MIT Download-CTA, Generate disabled", () => {
    const vm = buildViewModel({ ...base, model: { kind: "missing" } });
    expect(vm.generateEnabled).toBe(false);
    expect(vm.empty?.ctaLabel).toContain("2.5 GB");
  });
  it("Download läuft: Loader-Status mit Prozent, Generate disabled", () => {
    const vm = buildViewModel({ ...base, model: { kind: "downloading", pct: 42 } });
    expect(vm.status.icon).toBe("loader");
    expect(vm.status.text).toContain("42");
    expect(vm.generateEnabled).toBe(false);
  });
  it("Generierung läuft: Step-Anzeige, Generate disabled (Lock)", () => {
    const vm = buildViewModel({ ...base, run: { kind: "running", step: 2, total: 4 } });
    expect(vm.status.text).toContain("2/4");
    expect(vm.generateEnabled).toBe(false);
  });
  it("leerer Prompt: Generate disabled", () => {
    expect(buildViewModel({ ...base, prompt: "  " }).generateEnabled).toBe(false);
  });
  it("Bild da: showImage, Insert nur mit aktivem Editor", () => {
    const withImg = { ...base, image: { seed: 1, dataUrl: "data:" } };
    expect(buildViewModel(withImg).showImage).toBe(true);
    expect(buildViewModel(withImg).insertEnabled).toBe(true);
    expect(buildViewModel({ ...withImg, editorActive: false }).insertEnabled).toBe(false);
  });
  it("Fehler-Run: Fehlerstatus mit Message", () => {
    const vm = buildViewModel({ ...base, run: { kind: "error", message: "boom" } });
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.text).toContain("boom");
  });
});
```

- [ ] **Step 2: Test läuft fehl** — Run: `npx vitest run tests/viewmodel.test.ts` · Expected: FAIL

- [ ] **Step 3: Implementieren**

`src/core/viewmodel.ts`:
```ts
// State → ViewModel als pure Funktion (UI-STANDARD §6). Die View rendert nur das
// ViewModel, trifft keine Entscheidungen.
import { STRINGS } from "./strings";

export type GpuState = "checking" | "ok" | "no-webgpu" | "no-f16";
export type ModelState = { kind: "missing" } | { kind: "downloading"; pct: number } | { kind: "ready" };
export type RunState =
  | { kind: "idle" }
  | { kind: "running"; step: number; total: number }
  | { kind: "error"; message: string };

export interface PanelState {
  gpu: GpuState;
  model: ModelState;
  run: RunState;
  image: { seed: number; dataUrl: string } | null;
  editorActive: boolean;
  prompt: string;
}

export interface PanelViewModel {
  status: { icon: "loader" | "circle-check" | "circle-x"; text: string; cls: "is-checking" | "is-ok" | "is-error" };
  empty: { text: string; ctaLabel?: string } | null;
  generateEnabled: boolean;
  insertEnabled: boolean;
  showImage: boolean;
}

export function buildViewModel(s: PanelState): PanelViewModel {
  const gpuBlocked = s.gpu === "no-webgpu" || s.gpu === "no-f16";
  const busy = s.run.kind === "running" || s.model.kind === "downloading" || s.gpu === "checking";

  let status: PanelViewModel["status"];
  if (s.run.kind === "error") status = { icon: "circle-x", text: STRINGS.statusError(s.run.message), cls: "is-error" };
  else if (s.gpu === "no-webgpu") status = { icon: "circle-x", text: STRINGS.statusNoWebgpu, cls: "is-error" };
  else if (s.gpu === "no-f16") status = { icon: "circle-x", text: STRINGS.statusNoF16, cls: "is-error" };
  else if (s.gpu === "checking") status = { icon: "loader", text: STRINGS.statusChecking, cls: "is-checking" };
  else if (s.model.kind === "downloading")
    status = { icon: "loader", text: STRINGS.statusDownloading(s.model.pct), cls: "is-checking" };
  else if (s.run.kind === "running")
    status = { icon: "loader", text: STRINGS.statusGenerating(s.run.step, s.run.total), cls: "is-checking" };
  else status = { icon: "circle-check", text: STRINGS.statusReady, cls: "is-ok" };

  let empty: PanelViewModel["empty"] = null;
  if (gpuBlocked) empty = { text: s.gpu === "no-webgpu" ? STRINGS.statusNoWebgpu : STRINGS.statusNoF16 };
  else if (s.model.kind === "missing") empty = { text: STRINGS.emptyNoModel, ctaLabel: STRINGS.emptyNoModelCta };
  else if (!s.image && s.run.kind !== "running") empty = { text: STRINGS.emptyNoImage };

  return {
    status,
    empty,
    generateEnabled: !gpuBlocked && !busy && s.model.kind === "ready" && s.prompt.trim().length > 0,
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
}
```

- [ ] **Step 4: Test grün** — Run: `npx vitest run tests/viewmodel.test.ts` · Expected: PASS

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): Panel-ViewModel (pure State→UI-Abbildung)"`

---

### Task 9: Engine (sd-turbo-Pipeline über injizierte Sessions)

**Files:**
- Create: `src/core/engine.ts`
- Test: `tests/engine.test.ts`

**Interfaces:**
- Consumes: `tokenize`/`TokenizerData` (Task 5), `makeSchedule`/`scaleInput`/`schedulerStep` (Task 4), `gaussianArray` (Task 3), `f32ArrayToF16`/`f16ArrayToF32` (Task 3), `chwToRgba` (Task 6).
- Produces:
```ts
interface OrtValue { data: Float32Array | Uint16Array | Int32Array | BigInt64Array; dims: readonly number[] }
interface Session { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>> }
interface EngineSessions { textEncoder: Session; unet: Session; vaeDecoder: Session }
interface GenerateRequest { prompt: string; steps: number; seed: number }
interface GenerateResult { rgba: Uint8ClampedArray; width: 512; height: 512; seed: number }
type ProgressFn = (step: number, total: number) => void;
class SdTurboEngine {
  constructor(sessions: EngineSessions, tokenizerData: TokenizerData);
  readonly busy: boolean;
  generate(req: GenerateRequest, onProgress?: ProgressFn): Promise<GenerateResult>;
}
```
- Die OrtValue-Abstraktion ist bewusst strukturell kompatibel zu `ort.Tensor` (`data`+`dims`) — der ORT-Host (Task 10) reicht echte Tensoren durch, Tests faken sie.

- [ ] **Step 0: Referenz-Check (Feed-Namen/Konstanten verifizieren)**

Run: `curl -sL https://raw.githubusercontent.com/microsoft/onnxruntime-inference-examples/main/js/sd-turbo/main.js -o "$SCRATCHPAD/ms-sd-turbo-main.js" && grep -nE "feed|input_ids|encoder_hidden_states|latent_sample|timestep|49407|0.18215" "$SCRATCHPAD/ms-sd-turbo-main.js" | head -40`
($SCRATCHPAD = Session-Scratchpad-Verzeichnis.) Abgleichen und bei Abweichung die Konstanten unten anpassen (Feed-Namen, timestep-Dtype, Pad-Token, VAE-Skalierung). Defaults laut Recherche: text_encoder `input_ids` int32 → `last_hidden_state`; unet `sample` f16 [1,4,64,64], `timestep` int64 [1], `encoder_hidden_states` f16 → `out_sample`; vae_decoder `latent_sample` f16 → `sample`; Pad = EOS 49407; VAE-Faktor 0.18215.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/engine.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SdTurboEngine, type OrtValue, type Session } from "../src/core/engine";
import type { TokenizerData } from "../src/core/pipeline/tokenizer";

const tokData: TokenizerData = { vocab: { "cat</w>": 1 }, merges: [] };

function fakeSessions(log: string[]) {
  const textEncoder: Session = {
    inputNames: ["input_ids"],
    outputNames: ["last_hidden_state"],
    run: async (feeds) => {
      log.push("text_encoder");
      expect(feeds["input_ids"]!.dims).toEqual([1, 77]);
      expect(feeds["input_ids"]!.data).toBeInstanceOf(Int32Array);
      return { last_hidden_state: { data: new Uint16Array(77 * 1024), dims: [1, 77, 1024] } };
    },
  };
  const unet: Session = {
    inputNames: ["sample", "timestep", "encoder_hidden_states"],
    outputNames: ["out_sample"],
    run: async (feeds) => {
      log.push("unet");
      expect(feeds["sample"]!.dims).toEqual([1, 4, 64, 64]);
      expect(feeds["sample"]!.data).toBeInstanceOf(Uint16Array);
      expect(feeds["timestep"]!.data).toBeInstanceOf(BigInt64Array);
      expect(feeds["encoder_hidden_states"]!.dims).toEqual([1, 77, 1024]);
      return { out_sample: { data: new Uint16Array(4 * 64 * 64), dims: [1, 4, 64, 64] } };
    },
  };
  const vaeDecoder: Session = {
    inputNames: ["latent_sample"],
    outputNames: ["sample"],
    run: async (feeds) => {
      log.push("vae");
      expect(feeds["latent_sample"]!.dims).toEqual([1, 4, 64, 64]);
      return { sample: { data: new Uint16Array(3 * 512 * 512), dims: [1, 3, 512, 512] } };
    },
  };
  return { textEncoder, unet, vaeDecoder };
}

describe("SdTurboEngine", () => {
  it("ruft Sessions in Reihenfolge text_encoder → unet×steps → vae", async () => {
    const log: string[] = [];
    const engine = new SdTurboEngine(fakeSessions(log), tokData);
    const res = await engine.generate({ prompt: "cat", steps: 2, seed: 5 });
    expect(log).toEqual(["text_encoder", "unet", "unet", "vae"]);
    expect(res.rgba.length).toBe(512 * 512 * 4);
    expect(res.seed).toBe(5);
  });
  it("meldet Fortschritt pro UNet-Step", async () => {
    const engine = new SdTurboEngine(fakeSessions([]), tokData);
    const progress: Array<[number, number]> = [];
    await engine.generate({ prompt: "cat", steps: 4, seed: 1 }, (s, t) => progress.push([s, t]));
    expect(progress).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });
  it("Lock: paralleler zweiter Aufruf wirft", async () => {
    const engine = new SdTurboEngine(fakeSessions([]), tokData);
    const first = engine.generate({ prompt: "cat", steps: 1, seed: 1 });
    await expect(engine.generate({ prompt: "cat", steps: 1, seed: 1 })).rejects.toThrow(/busy/i);
    await first;
    expect(engine.busy).toBe(false);
  });
  it("Fehler in Session: busy wird zurückgesetzt, Fehler propagiert", async () => {
    const sessions = fakeSessions([]);
    sessions.unet = { inputNames: ["sample", "timestep", "encoder_hidden_states"], outputNames: ["out_sample"], run: async () => { throw new Error("OOM"); } };
    const engine = new SdTurboEngine(sessions, tokData);
    await expect(engine.generate({ prompt: "cat", steps: 1, seed: 1 })).rejects.toThrow("OOM");
    expect(engine.busy).toBe(false);
  });
  it("deterministisch: gleicher Seed → identische Latent-Feeds", async () => {
    const seen: number[][] = [];
    const capture = (): Session => ({
      inputNames: ["sample", "timestep", "encoder_hidden_states"],
      outputNames: ["out_sample"],
      run: async (feeds) => {
        seen.push(Array.from((feeds["sample"]!.data as Uint16Array).slice(0, 8)));
        return { out_sample: { data: new Uint16Array(4 * 64 * 64), dims: [1, 4, 64, 64] } };
      },
    });
    for (let i = 0; i < 2; i++) {
      const s = fakeSessions([]);
      s.unet = capture();
      await new SdTurboEngine(s, tokData).generate({ prompt: "cat", steps: 1, seed: 42 });
    }
    expect(seen[0]).toEqual(seen[1]);
  });
});
```

- [ ] **Step 2: Test läuft fehl** — Run: `npx vitest run tests/engine.test.ts` · Expected: FAIL

- [ ] **Step 3: Implementieren**

`src/core/engine.ts`:
```ts
// sd-turbo-Pipeline (Spec §5): tokenize → text_encoder → UNet-Loop (Euler-Ancestral,
// guidance 1.0) → VAE-Decode → RGBA. Sessions/Tensoren sind injiziert (OrtValue ist
// strukturell ort.Tensor-kompatibel) — die Engine bleibt pure und Node-testbar.
import { f16ArrayToF32, f32ArrayToF16 } from "./pipeline/f16";
import { chwToRgba } from "./pipeline/image";
import { gaussianArray } from "./pipeline/prng";
import { makeSchedule, scaleInput, schedulerStep } from "./pipeline/scheduler";
import { tokenize, type TokenizerData } from "./pipeline/tokenizer";

export interface OrtValue {
  data: Float32Array | Uint16Array | Int32Array | BigInt64Array;
  dims: readonly number[];
}

export interface Session {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>>;
}

export interface EngineSessions {
  textEncoder: Session;
  unet: Session;
  vaeDecoder: Session;
}

export interface GenerateRequest {
  prompt: string;
  steps: number;
  seed: number;
}

export interface GenerateResult {
  rgba: Uint8ClampedArray;
  width: 512;
  height: 512;
  seed: number;
}

export type ProgressFn = (step: number, total: number) => void;

const LATENT = { c: 4, h: 64, w: 64 } as const;
const IMAGE_SIZE = 512;
const VAE_SCALING = 0.18215;

function toF32(v: OrtValue): Float32Array {
  if (v.data instanceof Uint16Array) return f16ArrayToF32(v.data);
  if (v.data instanceof Float32Array) return v.data;
  throw new Error(`unexpected tensor dtype for ${v.dims.join("x")}`);
}

function firstOutput(session: Session, outputs: Record<string, OrtValue>): OrtValue {
  const name = session.outputNames[0];
  const out = name !== undefined ? outputs[name] : undefined;
  if (!out) throw new Error("session returned no output");
  return out;
}

export class SdTurboEngine {
  private _busy = false;

  constructor(
    private readonly sessions: EngineSessions,
    private readonly tokenizerData: TokenizerData,
  ) {}

  get busy(): boolean {
    return this._busy;
  }

  async generate(req: GenerateRequest, onProgress?: ProgressFn): Promise<GenerateResult> {
    if (this._busy) throw new Error("engine is busy");
    this._busy = true;
    try {
      const ids = tokenize(req.prompt, this.tokenizerData);
      const encOut = await this.sessions.textEncoder.run({
        input_ids: { data: new Int32Array(ids), dims: [1, ids.length] },
      });
      const hidden = firstOutput(this.sessions.textEncoder, encOut);
      const hiddenF16: Uint16Array =
        hidden.data instanceof Uint16Array ? hidden.data : f32ArrayToF16(hidden.data as Float32Array);

      const n = LATENT.c * LATENT.h * LATENT.w;
      const schedule = makeSchedule(req.steps);
      let latents = gaussianArray(req.seed, n);
      for (let i = 0; i < n; i++) latents[i] = latents[i]! * schedule.initNoiseSigma;

      for (let i = 0; i < schedule.timesteps.length; i++) {
        const sigma = schedule.sigmas[i]!;
        const scaled = scaleInput(latents, sigma);
        const unetOut = await this.sessions.unet.run({
          sample: { data: f32ArrayToF16(scaled), dims: [1, LATENT.c, LATENT.h, LATENT.w] },
          timestep: { data: new BigInt64Array([BigInt(schedule.timesteps[i]!)]), dims: [1] },
          encoder_hidden_states: { data: hiddenF16, dims: hidden.dims },
        });
        const noisePred = toF32(firstOutput(this.sessions.unet, unetOut));
        const stepNoise = gaussianArray(req.seed + 1000 + i, n); // Ancestral-Noise, seed-abgeleitet
        latents = schedulerStep(noisePred, latents, i, schedule.sigmas, stepNoise);
        onProgress?.(i + 1, schedule.timesteps.length);
      }

      const scaledLatents = new Float32Array(n);
      for (let i = 0; i < n; i++) scaledLatents[i] = latents[i]! / VAE_SCALING;
      const vaeOut = await this.sessions.vaeDecoder.run({
        latent_sample: { data: f32ArrayToF16(scaledLatents), dims: [1, LATENT.c, LATENT.h, LATENT.w] },
      });
      const imageChw = toF32(firstOutput(this.sessions.vaeDecoder, vaeOut));
      return { rgba: chwToRgba(imageChw, IMAGE_SIZE, IMAGE_SIZE), width: IMAGE_SIZE, height: IMAGE_SIZE, seed: req.seed };
    } finally {
      this._busy = false;
    }
  }
}
```

- [ ] **Step 4: Tests grün** — Run: `npx vitest run tests/engine.test.ts` · Expected: PASS

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): SdTurboEngine — Pipeline über injizierte ONNX-Sessions"`

---

### Task 10: Model-Store (Cache API, injizierte Deps)

**Files:**
- Create: `src/obsidian/model-store.ts` (KEIN obsidian-Import — liegt nur wegen Browser-APIs in `obsidian/`, bleibt testbar)
- Test: `tests/model-store.test.ts`

**Interfaces:**
- Consumes: `MODEL_FILES`, `missingFiles`, `isDownloadComplete`, `totalApproxBytes`, `ModelFileKey` (Task 7).
- Produces:
```ts
interface CacheLike { match(url: string): Promise<Response | undefined>; put(url: string, res: Response): Promise<void>; delete(url: string): Promise<boolean> }
interface StoreDeps { openCache: () => Promise<CacheLike>; fetchFn: (url: string) => Promise<Response> }
class ModelStore {
  constructor(deps?: StoreDeps); // Default: echte caches/fetch
  cachedKeys(): Promise<ModelFileKey[]>;
  isComplete(): Promise<boolean>;
  download(onProgress: (pct: number) => void): Promise<void>; // lädt nur fehlende Dateien
  getBuffer(key: ModelFileKey): Promise<ArrayBuffer>;
  getText(key: ModelFileKey): Promise<string>;
  deleteAll(): Promise<void>;
}
const MODEL_CACHE_NAME = "local-image-generator-models";
```

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/model-store.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MODEL_FILES } from "../src/core/model-manifest";
import { ModelStore, type CacheLike } from "../src/obsidian/model-store";

function fakeCache(): { cache: CacheLike; store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    cache: {
      match: async (url) => store.get(url)?.clone(),
      put: async (url, res) => {
        // Konsumieren wie die echte Cache API (streamt den Body)
        const buf = await res.arrayBuffer();
        store.set(url, new Response(buf, { headers: res.headers }));
      },
      delete: async (url) => store.delete(url),
    },
  };
}

function okResponse(body: string, contentLength?: number): Response {
  return new Response(body, {
    status: 200,
    headers: contentLength !== undefined ? { "content-length": String(contentLength) } : {},
  });
}

describe("ModelStore", () => {
  it("download lädt nur fehlende Dateien und meldet Fortschritt bis 100", async () => {
    const { cache, store } = fakeCache();
    const fetched: string[] = [];
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async (url) => {
        fetched.push(url);
        return okResponse("x".repeat(10), 10);
      },
    });
    // eine Datei vor-cachen
    store.set(MODEL_FILES[0]!.url, okResponse("cached", 6));
    const pcts: number[] = [];
    await s.download((p) => pcts.push(p));
    expect(fetched.length).toBe(MODEL_FILES.length - 1);
    expect(pcts[pcts.length - 1]).toBe(100);
    expect(await s.isComplete()).toBe(true);
  });
  it("Größen-Mismatch: Datei wird verworfen und Fehler geworfen (Spec §8)", async () => {
    const { cache, store } = fakeCache();
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async () => okResponse("short", 999), // content-length passt nicht
    });
    await expect(s.download(() => {})).rejects.toThrow(/incomplete/i);
    expect(store.size).toBe(0);
  });
  it("HTTP-Fehler wirft mit Status", async () => {
    const { cache } = fakeCache();
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async () => new Response("nope", { status: 503 }),
    });
    await expect(s.download(() => {})).rejects.toThrow(/503/);
  });
  it("getText/getBuffer liefern Inhalte, deleteAll räumt auf", async () => {
    const { cache } = fakeCache();
    const s = new ModelStore({ openCache: async () => cache, fetchFn: async () => okResponse("hello", 5) });
    await s.download(() => {});
    expect(await s.getText("vocab")).toBe("hello");
    expect((await s.getBuffer("unet")).byteLength).toBe(5);
    await s.deleteAll();
    expect(await s.cachedKeys()).toEqual([]);
    await expect(s.getBuffer("unet")).rejects.toThrow(/not downloaded/i);
  });
});
```

- [ ] **Step 2: Test läuft fehl** — Run: `npx vitest run tests/model-store.test.ts` · Expected: FAIL

- [ ] **Step 3: Implementieren**

`src/obsidian/model-store.ts`:
```ts
// Modell-Ablage über die Cache API (Spec §4/§8): liegt im Electron-Profil AUSSERHALB
// des Vaults (wird nie gesynct), überlebt Neustarts, Datei-Granularität beim Retry.
// Deps injizierbar → in Node testbar. Kein obsidian-Import.
import {
  isDownloadComplete,
  MODEL_FILES,
  missingFiles,
  totalApproxBytes,
  type ModelFile,
  type ModelFileKey,
} from "../core/model-manifest";

export const MODEL_CACHE_NAME = "local-image-generator-models";

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

export interface StoreDeps {
  openCache: () => Promise<CacheLike>;
  fetchFn: (url: string) => Promise<Response>;
}

const realDeps: StoreDeps = {
  openCache: () => caches.open(MODEL_CACHE_NAME) as Promise<CacheLike>,
  fetchFn: (url) => fetch(url),
};

export class ModelStore {
  constructor(private readonly deps: StoreDeps = realDeps) {}

  async cachedKeys(): Promise<ModelFileKey[]> {
    const cache = await this.deps.openCache();
    const keys: ModelFileKey[] = [];
    for (const f of MODEL_FILES) if (await cache.match(f.url)) keys.push(f.key);
    return keys;
  }

  async isComplete(): Promise<boolean> {
    return (await this.cachedKeys()).length === MODEL_FILES.length;
  }

  async download(onProgress: (pct: number) => void): Promise<void> {
    const cache = await this.deps.openCache();
    const todo = missingFiles(await this.cachedKeys());
    const grandTotal = totalApproxBytes(todo);
    let receivedTotal = 0;
    for (const file of todo) {
      const res = await this.deps.fetchFn(file.url);
      if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${file.key}`);
      const contentLength = res.headers.get("content-length");
      const expected = contentLength === null ? null : Number(contentLength);
      const [progressBranch, cacheBranch] = res.body.tee();
      const putDone = cache.put(file.url, new Response(cacheBranch, { headers: res.headers }));
      let received = 0;
      const reader = progressBranch.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        receivedTotal += value.byteLength;
        onProgress(Math.min(99, Math.round((receivedTotal / grandTotal) * 100)));
      }
      await putDone;
      if (!isDownloadComplete(received, expected)) {
        await cache.delete(file.url);
        throw new Error(`download incomplete for ${file.key} (${received}/${expected ?? "?"} bytes)`);
      }
    }
    onProgress(100);
  }

  private fileFor(key: ModelFileKey): ModelFile {
    const f = MODEL_FILES.find((m) => m.key === key);
    if (!f) throw new Error(`unknown model file: ${key}`);
    return f;
  }

  private async matchOrThrow(key: ModelFileKey): Promise<Response> {
    const cache = await this.deps.openCache();
    const res = await cache.match(this.fileFor(key).url);
    if (!res) throw new Error(`model file not downloaded: ${key}`);
    return res;
  }

  async getBuffer(key: ModelFileKey): Promise<ArrayBuffer> {
    return (await this.matchOrThrow(key)).arrayBuffer();
  }

  async getText(key: ModelFileKey): Promise<string> {
    return (await this.matchOrThrow(key)).text();
  }

  async deleteAll(): Promise<void> {
    const cache = await this.deps.openCache();
    for (const f of MODEL_FILES) await cache.delete(f.url);
  }
}
```

- [ ] **Step 4: Tests grün** — Run: `npx vitest run tests/model-store.test.ts` · Expected: PASS

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(obsidian): ModelStore — Cache-API-Download mit Datei-Retry"`

---

### Task 11: ORT-Host (WASM inline, WebGPU-Sessions)

**Files:**
- Create: `src/obsidian/ort-host.ts`, `src/types/wasm.d.ts`

**Interfaces:**
- Consumes: `Session`, `OrtValue` (Task 9).
- Produces: `checkGpu(): Promise<"ok" | "no-webgpu" | "no-f16">` · `createOrtSession(buf: ArrayBuffer): Promise<Session>` (registriert beim ersten Aufruf das Inline-WASM).
- Kein Unit-Test (dünner Adapter, GPU-gebunden) — Gate: `typecheck` + `build` + Smoke-Test (Task 14).

- [ ] **Step 1: WASM-Dateinamen verifizieren**

Run: `ls node_modules/onnxruntime-web/dist/*.wasm`
Expected: enthält `ort-wasm-simd-threaded.jsep.wasm` (JSEP = WebGPU-Build). Abweichenden Namen unten einsetzen. Prüfe auch `node -e "console.log(Object.keys(require('onnxruntime-web/package.json').exports))"` — existiert der Export `./webgpu`? Falls nein (neuere Versionen bündeln WebGPU im Haupt-Export): unten `onnxruntime-web` statt `onnxruntime-web/webgpu` importieren.

- [ ] **Step 2: Implementieren**

`src/types/wasm.d.ts`:
```ts
declare module "*.wasm" {
  const binary: Uint8Array;
  export default binary;
}
```

`src/obsidian/ort-host.ts`:
```ts
// Adapter zu onnxruntime-web (Spec §4): WASM base64-inline (Store-Regel: kein
// Laufzeit-Nachladen von Code), WebGPU-EP, Sessions als schmales Session-Interface.
import * as ort from "onnxruntime-web/webgpu";
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm";
import type { OrtValue, Session } from "../core/engine";

let initialized = false;

function initOrt(): void {
  if (initialized) return;
  ort.env.wasm.wasmBinary = ortWasm.buffer.slice(
    ortWasm.byteOffset,
    ortWasm.byteOffset + ortWasm.byteLength,
  ) as ArrayBuffer;
  ort.env.wasm.numThreads = 1; // keine Worker-Spawns aus Blob-URLs (Electron-CSP)
  initialized = true;
}

export async function checkGpu(): Promise<"ok" | "no-webgpu" | "no-f16"> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return "no-webgpu";
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return "no-webgpu";
  return adapter.features.has("shader-f16") ? "ok" : "no-f16";
}

function dtypeOf(v: OrtValue): "float32" | "float16" | "int32" | "int64" {
  if (v.data instanceof Float32Array) return "float32";
  if (v.data instanceof Uint16Array) return "float16";
  if (v.data instanceof Int32Array) return "int32";
  return "int64";
}

export async function createOrtSession(buf: ArrayBuffer): Promise<Session> {
  initOrt();
  const session = await ort.InferenceSession.create(buf, { executionProviders: ["webgpu"] });
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>> {
      const ortFeeds: Record<string, ort.Tensor> = {};
      for (const [name, v] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor(dtypeOf(v), v.data, v.dims as number[]);
      }
      const out = await session.run(ortFeeds);
      const result: Record<string, OrtValue> = {};
      for (const [name, t] of Object.entries(out)) {
        result[name] = { data: t.data as OrtValue["data"], dims: t.dims };
      }
      return result;
    },
  };
}
```

- [ ] **Step 3: Gate** — Run: `npm run typecheck && npm run build`
Expected: grün; `main.js` wächst um ~20–27 MB (Inline-WASM — erwartet, Spec §3). `grep -c "wasmBinary" main.js` ≥ 1.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(obsidian): ORT-Host — Inline-WASM + WebGPU-Sessions"`

---

### Task 12: Hub-View, Settings-Tab, Wiring, Styles

**Files:**
- Create: `src/obsidian/png.ts`, `src/obsidian/view.ts`, `src/obsidian/confirm-modal.ts`, `src/obsidian/settings-tab.ts`
- Modify: `src/main.ts`, `styles.css`

**Interfaces:**
- Consumes: `buildViewModel`/`PanelState` (Task 8), `SdTurboEngine` (Task 9), `ModelStore` (Task 10), `checkGpu`/`createOrtSession` (Task 11), `STRINGS`, `buildImageFilename`, `mergeSettings`/`DEFAULT_SETTINGS`.
- Produces: `VIEW_TYPE = "local-image-generator"` · `interface ViewHost { getPanelState(): PanelState; setPrompt(p: string): void; generate(steps: number, seed: number): void; saveImage(mode: "create" | "insert"): void; openSettings(): void }` · `GeneratorView.refresh()` (Host ruft sie nach jeder State-Änderung).

- [ ] **Step 1: PNG-Helper**

`src/obsidian/png.ts`:
```ts
// RGBA → PNG über den nativen Canvas (Spec §5: keine Encoder-Dependency).
export function rgbaToDataUrl(rgba: Uint8ClampedArray, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.toDataURL("image/png");
}

export function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
```

- [ ] **Step 2: Confirm-Modal (UI-STANDARD §2: nativ, Cancel links, destruktiv `mod-warning`)**

`src/obsidian/confirm-modal.ts`:
```ts
import { App, Modal } from "obsidian";
import { STRINGS } from "../core/strings";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: STRINGS.cancel }).addEventListener("click", () => this.close());
    const confirm = buttons.createEl("button", { text: this.confirmLabel, cls: "mod-warning" });
    confirm.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 3: Hub-View (Mount-once, rendert nur das ViewModel)**

`src/obsidian/view.ts`:
```ts
// Die EINE View des Plugins (UI-STANDARD §1/§4, Mount-once: Prompt/Preview überleben
// Refreshes). Kennt weder Plugin noch Engine — nur den schmalen ViewHost.
import { ItemView, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import { STRINGS } from "../core/strings";
import { buildViewModel, type PanelState } from "../core/viewmodel";

export const VIEW_TYPE = "local-image-generator";

export interface ViewHost {
  getPanelState(): PanelState;
  setPrompt(p: string): void;
  generate(steps: number, seed: number): void;
  saveImage(mode: "create" | "insert"): void;
  openSettings(): void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export class GeneratorView extends ItemView {
  private promptEl!: HTMLTextAreaElement;
  private stepsEl!: HTMLInputElement;
  private stepsValueEl!: HTMLElement;
  private seedEl!: HTMLInputElement;
  private generateBtn!: HTMLButtonElement;
  private emptyEl!: HTMLElement;
  private emptyTextEl!: HTMLElement;
  private emptyCtaEl!: HTMLButtonElement;
  private imageCard!: HTMLElement;
  private imgEl!: HTMLImageElement;
  private regenBtn!: HTMLButtonElement;
  private createBtn!: HTMLButtonElement;
  private insertBtn!: HTMLButtonElement;
  private statusIconEl!: HTMLElement;
  private statusTextEl!: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: ViewHost,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return STRINGS.viewTitle;
  }

  getIcon(): string {
    return "image-plus";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl.createDiv({ cls: "lig-panel" });

    this.promptEl = root.createEl("textarea", {
      cls: "lig-prompt",
      attr: { placeholder: STRINGS.promptPlaceholder, rows: "3" },
    });
    this.promptEl.addEventListener("input", () => {
      this.host.setPrompt(this.promptEl.value);
      this.refresh();
    });

    const controls = root.createDiv({ cls: "lig-row" });
    controls.createSpan({ text: STRINGS.steps, cls: "lig-label" });
    this.stepsEl = controls.createEl("input", {
      cls: "lig-steps",
      attr: { type: "range", min: "1", max: "4", step: "1", value: "1" },
    });
    this.stepsValueEl = controls.createSpan({ text: "1", cls: "lig-steps-value" });
    this.stepsEl.addEventListener("input", () => {
      this.stepsValueEl.setText(this.stepsEl.value);
    });
    controls.createSpan({ text: STRINGS.seed, cls: "lig-label" });
    this.seedEl = controls.createEl("input", {
      cls: "lig-seed",
      attr: { type: "number", value: String(randomSeed()) },
    });
    const dice = controls.createEl("button", { cls: "clickable-icon" });
    setIcon(dice, "dices");
    setTooltip(dice, STRINGS.randomSeed);
    dice.setAttribute("aria-label", STRINGS.randomSeed);
    dice.addEventListener("click", () => {
      this.seedEl.value = String(randomSeed());
    });

    this.generateBtn = root.createEl("button", { text: STRINGS.generate, cls: "mod-cta lig-generate" });
    this.generateBtn.addEventListener("click", () => {
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value));
    });

    this.emptyEl = root.createDiv({ cls: "lig-empty" });
    this.emptyTextEl = this.emptyEl.createDiv();
    this.emptyCtaEl = this.emptyEl.createEl("button", { cls: "mod-cta" });
    this.emptyCtaEl.addEventListener("click", () => this.host.openSettings());

    this.imageCard = root.createDiv({ cls: "lig-card" });
    this.imgEl = this.imageCard.createEl("img", { cls: "lig-image" });
    const actions = this.imageCard.createDiv({ cls: "lig-row lig-actions" });
    this.regenBtn = actions.createEl("button", { text: STRINGS.regenerate });
    this.regenBtn.addEventListener("click", () => {
      this.seedEl.value = String(randomSeed());
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value));
    });
    this.createBtn = actions.createEl("button", { text: STRINGS.create, cls: "mod-cta" });
    this.createBtn.addEventListener("click", () => this.host.saveImage("create"));
    this.insertBtn = actions.createEl("button", { text: STRINGS.insert, cls: "mod-cta" });
    this.insertBtn.addEventListener("click", () => this.host.saveImage("insert"));

    const status = root.createDiv({ cls: "lig-row lig-status" });
    this.statusIconEl = status.createSpan({ cls: "lig-status-icon" });
    this.statusTextEl = status.createSpan({ cls: "lig-status-text" });

    this.refresh();
  }

  refresh(): void {
    const state = this.host.getPanelState();
    const vm = buildViewModel(state);

    this.generateBtn.disabled = !vm.generateEnabled;
    this.emptyEl.toggleClass("is-hidden", vm.empty === null);
    if (vm.empty) {
      this.emptyTextEl.setText(vm.empty.text);
      this.emptyCtaEl.toggleClass("is-hidden", vm.empty.ctaLabel === undefined);
      if (vm.empty.ctaLabel) this.emptyCtaEl.setText(vm.empty.ctaLabel);
    }
    this.imageCard.toggleClass("is-hidden", !vm.showImage);
    if (state.image) this.imgEl.src = state.image.dataUrl;
    this.insertBtn.disabled = !vm.insertEnabled;
    setTooltip(this.insertBtn, vm.insertEnabled ? "" : STRINGS.insertNeedsEditor);

    this.statusIconEl.className = `lig-status-icon ${vm.status.cls}`;
    setIcon(this.statusIconEl, vm.status.icon);
    this.statusIconEl.setAttribute("aria-label", vm.status.text);
    this.statusTextEl.setText(vm.status.text);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 4: Settings-Tab**

`src/obsidian/settings-tab.ts`:
```ts
// Settings (UI-STANDARD §5): Modell zuerst, Ausgabe, Gefährliches (Löschen) ans Ende.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { totalApproxBytes, MODEL_FILES } from "../core/model-manifest";
import { STRINGS } from "../core/strings";
import { ConfirmModal } from "./confirm-modal";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(STRINGS.settingsModelHeading).setHeading();

    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const modelSetting = new Setting(containerEl)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(STRINGS.settingsModelDesc);
    void this.plugin.modelStore.isComplete().then((complete) => {
      if (complete) {
        modelSetting.addExtraButton((b) =>
          b.setIcon("circle-check").setTooltip("Downloaded"),
        );
      } else {
        modelSetting.addButton((b) =>
          b
            .setButtonText(`${STRINGS.settingsDownload} (~${gb} GB)`)
            .setCta()
            .onClick(async () => {
              b.setDisabled(true);
              try {
                await this.plugin.downloadModel((pct) => b.setButtonText(`${pct}%`));
                new Notice("Model downloaded");
              } catch (e) {
                new Notice(String(e instanceof Error ? e.message : e));
              }
              this.display();
            }),
        );
      }
    });

    new Setting(containerEl).setName(STRINGS.settingsOutputHeading).setHeading();
    new Setting(containerEl)
      .setName(STRINGS.settingsOutputFolder)
      .setDesc(STRINGS.settingsOutputFolderDesc)
      .addText((t) =>
        t.setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
          this.plugin.settings.outputFolder = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    // Gefährliches ans Ende (§5)
    new Setting(containerEl)
      .setName(STRINGS.settingsDelete)
      .addButton((b) =>
        b.setButtonText(STRINGS.settingsDelete).setWarning().onClick(() => {
          new ConfirmModal(this.app, STRINGS.settingsDeleteConfirm, STRINGS.confirm, async () => {
            await this.plugin.modelStore.deleteAll();
            this.plugin.onModelDeleted();
            this.display();
          }).open();
        }),
      );
  }
}
```

- [ ] **Step 5: main.ts — Wiring & Host**

`src/main.ts` (ersetzt den Task-1-Stub):
```ts
// Wiring (Spec §4): EIN registerView, Command + Ribbon, Host-Implementierung für die
// View, Lazy-Init der Engine (GPU-Check → Cache-Buffers → ORT-Sessions).
import { MarkdownView, normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { SdTurboEngine } from "./core/engine";
import { buildImageFilename } from "./core/filename";
import { DEFAULT_SETTINGS, type LigSettings } from "./core/settings";
import { STRINGS } from "./core/strings";
import type { PanelState } from "./core/viewmodel";
import { ModelStore } from "./obsidian/model-store";
import { checkGpu, createOrtSession } from "./obsidian/ort-host";
import { dataUrlToBytes, rgbaToDataUrl } from "./obsidian/png";
import { LigSettingTab } from "./obsidian/settings-tab";
import { GeneratorView, VIEW_TYPE, type ViewHost } from "./obsidian/view";
import { mergeSettings } from "./vendor/kit/settings";

export default class LocalImageGeneratorPlugin extends Plugin {
  settings: LigSettings = DEFAULT_SETTINGS;
  modelStore = new ModelStore();
  private engine: SdTurboEngine | null = null;
  private state: PanelState = {
    gpu: "checking",
    model: { kind: "missing" },
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "",
  };

  async onload(): Promise<void> {
    this.settings = mergeSettings(DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new LigSettingTab(this.app, this));

    const host: ViewHost = {
      getPanelState: () => {
        this.state.editorActive = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor !== undefined;
        return this.state;
      },
      setPrompt: (p) => {
        this.state.prompt = p;
      },
      generate: (steps, seed) => void this.generate(steps, seed),
      saveImage: (mode) => void this.saveImage(mode),
      openSettings: () => {
        const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
        setting.open();
        setting.openTabById("local-image-generator");
      },
    };

    this.registerView(VIEW_TYPE, (leaf) => new GeneratorView(leaf, host));
    this.addRibbonIcon("image-plus", STRINGS.viewTitle, () => void this.activateView());
    this.addCommand({ id: "open", name: STRINGS.openCommand, callback: () => void this.activateView() });

    void this.initStatus();
  }

  private async initStatus(): Promise<void> {
    this.state.gpu = await checkGpu();
    this.state.model = (await this.modelStore.isComplete()) ? { kind: "ready" } : { kind: "missing" };
    this.refreshView();
  }

  private refreshView(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof GeneratorView) view.refresh();
    }
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
    }
  }

  async downloadModel(onProgress: (pct: number) => void): Promise<void> {
    this.state.model = { kind: "downloading", pct: 0 };
    this.refreshView();
    try {
      await this.modelStore.download((pct) => {
        this.state.model = { kind: "downloading", pct };
        onProgress(pct);
        this.refreshView();
      });
      this.state.model = { kind: "ready" };
    } catch (e) {
      this.state.model = { kind: "missing" };
      throw e;
    } finally {
      this.refreshView();
    }
  }

  onModelDeleted(): void {
    this.engine = null;
    this.state.model = { kind: "missing" };
    this.refreshView();
  }

  private async ensureEngine(): Promise<SdTurboEngine> {
    if (this.engine) return this.engine;
    const [textEncoder, unet, vaeDecoder] = await Promise.all([
      this.modelStore.getBuffer("text_encoder").then(createOrtSession),
      this.modelStore.getBuffer("unet").then(createOrtSession),
      this.modelStore.getBuffer("vae_decoder").then(createOrtSession),
    ]);
    const vocab = JSON.parse(await this.modelStore.getText("vocab")) as Record<string, number>;
    const merges = (await this.modelStore.getText("merges"))
      .split("\n")
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    this.engine = new SdTurboEngine({ textEncoder, unet, vaeDecoder }, { vocab, merges });
    return this.engine;
  }

  private async generate(steps: number, seed: number): Promise<void> {
    if (this.state.run.kind === "running") return;
    this.state.run = { kind: "running", step: 0, total: steps };
    this.refreshView();
    try {
      const engine = await this.ensureEngine();
      const result = await engine.generate({ prompt: this.state.prompt, steps, seed }, (step, total) => {
        this.state.run = { kind: "running", step, total };
        this.refreshView();
      });
      this.state.image = { seed: result.seed, dataUrl: rgbaToDataUrl(result.rgba, result.width, result.height) };
      this.state.run = { kind: "idle" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.run = { kind: "error", message: msg };
      this.engine = null; // Sessions verwerfen, nächster Lauf lädt neu (Spec §8)
      new Notice(STRINGS.oomHint);
    } finally {
      this.refreshView();
    }
  }

  private async resolveImagePath(filename: string): Promise<string> {
    if (this.settings.outputFolder === "") {
      const fm = this.app.fileManager as unknown as {
        getAvailablePathForAttachment(name: string): Promise<string>;
      };
      return fm.getAvailablePathForAttachment(filename);
    }
    const folder = normalizePath(this.settings.outputFolder);
    if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    return normalizePath(`${folder}/${filename}`);
  }

  private async saveImage(mode: "create" | "insert"): Promise<void> {
    const img = this.state.image;
    if (!img) return;
    const path = await this.resolveImagePath(buildImageFilename(new Date(), img.seed));
    const file = await this.app.vault.createBinary(path, dataUrlToBytes(img.dataUrl));
    if (mode === "insert") {
      const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
      if (editor) editor.replaceSelection(`![[${file.path}]]`);
      else new Notice(STRINGS.insertNeedsEditor);
    } else if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }
    new Notice(`Saved: ${file.path}`);
  }
}
```

- [ ] **Step 6: styles.css füllen**

```css
/* local-image-generator — Präfix: lig- · nur Obsidian-Theme-Variablen (UI-STANDARD §3) */
.lig-panel { padding: var(--size-4-4); background: var(--background-primary); display: flex; flex-direction: column; gap: var(--size-4-3); }
.lig-row { display: flex; align-items: center; gap: var(--size-4-2); flex-wrap: wrap; }
.lig-prompt { width: 100%; resize: vertical; }
.lig-label { color: var(--text-muted); font-size: var(--font-ui-small); }
.lig-steps { flex: 1 1 60px; }
.lig-steps-value { min-width: 1.5em; text-align: center; }
.lig-seed { width: 8em; }
.lig-empty { color: var(--text-faint); padding: var(--size-4-4); text-align: center; display: flex; flex-direction: column; gap: var(--size-4-2); align-items: center; }
.lig-card { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m); padding: var(--size-4-2); display: flex; flex-direction: column; gap: var(--size-4-2); }
.lig-image { max-width: 100%; border-radius: var(--radius-s); }
.lig-status { border-top: 1px solid var(--background-modifier-border); padding-top: var(--size-4-2); font-size: var(--font-ui-smaller); color: var(--text-muted); }
.lig-status-icon.is-ok { color: var(--text-success); }
.lig-status-icon.is-error { color: var(--text-error); }
.lig-status-icon.is-checking { color: var(--text-muted); }
.lig-status-icon.is-checking svg { animation: lig-spin 1.5s linear infinite; }
@keyframes lig-spin { to { transform: rotate(360deg); } }
.is-hidden { display: none; }
```

- [ ] **Step 7: Gate** — Run: `npm run typecheck && npm test && npm run check:pure && npm run build` · Expected: alles grün

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(obsidian): Hub-View, Settings-Tab, Wiring, Styles"`

---

### Task 13: README (Store-Offenlegung) + Gate

**Files:**
- Create: `README.md`

- [ ] **Step 1: README schreiben** — Muss enthalten (Spec §10): Was das Plugin tut; **Network use**: die 5 HuggingFace-URLs aus `src/core/model-manifest.ts` mit Größen, Download NUR nach explizitem Klick; **Storage**: Browser-Cache (Electron-Profil), außerhalb des Vaults, Löschen über Settings; **No telemetry**; Desktop-only + WebGPU-Voraussetzungen (macOS/Windows, Linux treiberabhängig); Kurzanleitung (Settings → Download, Sidebar → Prompt → Generate → Create/Insert); MIT-Lizenz-Hinweis; Model-Credits (stabilityai/sd-turbo, ONNX-Export schmuell/sd-turbo-ort-web).

- [ ] **Step 2: Voll-Gate** — Run: `npm run gate` · Expected: typecheck + tests + check:pure + build grün

- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs: README mit Store-Offenlegung (Netzwerk, Speicherort, Telemetrie)"`

---

### Task 14: Deploy-Vorbereitung Smoke-Test

- [ ] **Step 1:** `manifest.json`/`package.json`-Versionen konsistent (`0.1.0`), minAppVersion gesetzt (nicht `<WIE_YIJING>`-Platzhalter!).
- [ ] **Step 2:** `npm run gate` final grün; `ls -lh main.js` dokumentieren (erwartet ~20–30 MB).
- [ ] **Step 3:** Commit + Abschlussbericht: was gebaut wurde, welche Konstanten aus dem Referenz-Check (Task 9 Step 0) abweichen, offene Risiken für den Smoke-Test (Apple-Silicon-Performance unbekannt; Pad-Token-Wahl; Feed-Namen erst gegen echte Modelle verifiziert, wenn der Smoke-Test läuft).

---

## Self-Review (gegen Spec geprüft)

- **Spec-Abdeckung:** §4 Komponenten → Tasks 2–12 · §5 Pipeline → 3–6, 9 · §6 UI → 8, 12 · §7 Ausgabe → 6, 12 · §8 Fehler → 8 (ViewModel), 9 (Lock/busy-Reset), 10 (Retry/Mismatch), 12 (Engine-Verwurf, OOM-Hint) · §9 Tests → in jedem Core-Task · §10 Compliance → 1 (manifest), 11 (Inline-WASM), 13 (README). Smoke-Test (§9) = nach Plan-Ende (user-handover).
- **Bewusste Abweichung:** Statt Golden-Vektoren gegen das echte 49k-Vocab (Spec §9) testet Task 5 die BPE-Mechanik mit synthetischem Vocab — die echten Daten sind 1,6 MB groß und erst nach Download da; der Smoke-Test validiert end-to-end.
- **Typ-Konsistenz:** `OrtValue`/`Session` (Task 9) = Producer für Task 10/11/12; `PanelState` (Task 8) = Producer für Task 12; `ModelFileKey` (Task 7) für Task 10. Namen quergeprüft.



