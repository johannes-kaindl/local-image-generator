# Robustheits-Block (Backlog 4/5/6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download-Fortschritt mit Datei-Detail + strukturell re-render-sicher machen, eine sichtbare "Modell lädt auf GPU"-Phase zwischen Download und Generieren einführen, und `InferenceSession.create` mit einem Watchdog + `unhandledrejection`-Erkennung gegen stille Ewig-Hänger absichern.

**Architecture:** Bestehendes State-Objekt (`main.ts`s `PanelState`) wird erweitert, nicht durch einen neuen Mechanismus ersetzt — "State mutieren → `refreshViews()`" ist das etablierte Muster im Repo. Settings-Tab wird von Closure-getrieben auf state-getrieben umgestellt (behebt den Re-Render-Bug strukturell). Ein Generation-Counter in `ensureEngine()` verwirft verwaiste, spät resolvende Ladeversuche (ORT kennt kein `AbortSignal`).

**Tech Stack:** TypeScript, Vitest, onnxruntime-web (WebGPU), Obsidian Plugin API.

## Global Constraints

- **Gate:** `npm run gate` (typecheck + vitest + check:pure + build) muss vor jedem Commit grün sein.
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren NIE `obsidian` (durchgesetzt von `npm run check:pure`).
- **Commit style:** Conventional Commits (deutsch), Trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Watchdog-Timeout:** exakt 5 Minuten (`5 * 60_000` ms) — deutlich über der als normal dokumentierten "minutenlang"-Ladezeit auf Apple Silicon.
- **Kein `retryable`-Flag:** jeder `RunState.error`-Zustand ist über den bestehenden Generate-Button erneut anstoßbar — kein neues UI-Element.
- **DE-Stil:** unpersönliche Befehlsform, "du" nur in Beschreibungstexten wo nötig (siehe `docs/superpowers/specs/2026-07-17-i18n-design.md` §4, Stil-Konvention-Absatz).
- **Referenz-Spec:** `docs/superpowers/specs/2026-07-18-robustheits-block-design.md` — bei Unklarheiten dort nachschlagen.

---

### Task 1: `raceTimeout` Pure-Core-Timeout-Utility

**Files:**
- Create: `src/core/timeout.ts`
- Test: `tests/timeout.test.ts`

**Interfaces:**
- Produces: `raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T>` — löst wie `p` auf, wirft `new Error(message)` wenn `p` nicht innerhalb von `ms` Millisekunden settled.

- [ ] **Step 1: Write the failing test**

Create `tests/timeout.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { raceTimeout } from "../src/core/timeout";

describe("raceTimeout", () => {
  it("löst normal auf, wenn die Promise vor dem Timeout resolved", async () => {
    const result = await raceTimeout(Promise.resolve("done"), 1000, "too slow");
    expect(result).toBe("done");
  });

  it("wirft mit der übergebenen Message, wenn das Timeout zuerst feuert", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const raced = raceTimeout(never, 1000, "too slow");
    const assertion = expect(raced).rejects.toThrow("too slow");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });

  it("räumt den Timer auf, wenn die Promise VOR dem Timeout ablehnt", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearTimeout");
    await expect(raceTimeout(Promise.reject(new Error("boom")), 1000, "too slow")).rejects.toThrow("boom");
    expect(clearSpy).toHaveBeenCalled();
    vi.useRealTimers();
    clearSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeout.test.ts`
Expected: FAIL — `Cannot find module '../src/core/timeout'`

- [ ] **Step 3: Write minimal implementation**

Create `src/core/timeout.ts`:

```ts
// Vierte Instanz des Musters "Promise.race + setTimeout, weil die Ziel-API kein Timeout/
// Abort kennt" — yijing-oracle hat es bereits dreimal für requestUrl gebaut
// (src/obsidian/http.ts: httpPostJson/probeEndpoint/probeImageEndpoint). Regel-der-Drei
// erreicht — Kit-Extraktion läuft separat über /drift-audit (siehe Spec
// 2026-07-18-robustheits-block-design.md §4), hier nur die vierte, noch unabhängige Kopie.
export async function raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/timeout.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/timeout.ts tests/timeout.test.ts
git commit -m "$(cat <<'EOF'
feat(core): raceTimeout-Utility für Promise-Timeouts ohne native Abort-Unterstützung

Vierte Instanz des in yijing-oracle dreifach vorhandenen Musters (Regel-der-
Drei erreicht) — Kit-Extraktion bewusst separat über /drift-audit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `viewmodel.ts` — Datenmodell, Ladephase, `formatElapsed`/`formatBytes`, i18n-Keys

**Files:**
- Modify: `src/core/viewmodel.ts`
- Modify: `src/i18n/strings.ts`
- Modify: `tests/viewmodel.test.ts`

**Interfaces:**
- Consumes: nichts aus anderen Tasks.
- Produces:
  - `export type ModelState = { kind: "missing" } | { kind: "downloading"; overallPct: number; fileKey: ModelFileKey; fileIndex: number; totalFiles: number; receivedBytes: number; totalBytes: number } | { kind: "ready" }`
  - `export type RunState = { kind: "idle" } | { kind: "loading"; elapsedSec: number } | { kind: "running"; step: number; total: number } | { kind: "error"; message: string }`
  - `export function formatElapsed(totalSec: number): string`
  - `export function formatBytes(bytes: number): string`
  - i18n-Keys `status.loadingGpu` (EN/DE), `status.engineLoadFailed` (EN/DE) — für Task 4/5.

- [ ] **Step 1: Write the failing tests**

Replace `tests/viewmodel.test.ts` in voller Länge:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { registerI18n } from "../src/i18n/strings";
import { setLang } from "../src/vendor/kit/i18n";
import { buildViewModel, formatBytes, formatElapsed, type PanelState } from "../src/core/viewmodel";

beforeEach(() => {
  registerI18n();
  setLang("en");
});

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
  it("Download läuft: Loader-Status mit Prozent + Datei-Detail, Generate disabled", () => {
    const vm = buildViewModel({
      ...base,
      model: {
        kind: "downloading",
        overallPct: 42,
        fileKey: "unet",
        fileIndex: 2,
        totalFiles: 5,
        receivedBytes: 100,
        totalBytes: 200,
      },
    });
    expect(vm.status.icon).toBe("loader");
    expect(vm.status.text).toContain("42");
    expect(vm.generateEnabled).toBe(false);
  });
  it("GPU-Laden läuft: Loader-Status mit verstrichener Zeit, Generate disabled", () => {
    const vm = buildViewModel({ ...base, run: { kind: "loading", elapsedSec: 65 } });
    expect(vm.status.icon).toBe("loader");
    expect(vm.status.text).toContain("1:05");
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
    const withImg = {
      ...base,
      image: {
        dataUrl: "data:",
        params: { prompt: "p", seed: 1, steps: 4, model: "sd-turbo", date: "2026-07-16T21:52:43" },
      },
    };
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

describe("formatElapsed", () => {
  it("formatiert Sekunden als m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(5)).toBe("0:05");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(3661)).toBe("61:01");
  });
});

describe("formatBytes", () => {
  it("zeigt MB unter 1 GB, GB mit einer Nachkommastelle darüber", () => {
    expect(formatBytes(500_000)).toBe("1 MB");
    expect(formatBytes(99_000_000)).toBe("99 MB");
    expect(formatBytes(1_730_000_000)).toBe("1.7 GB");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/viewmodel.test.ts`
Expected: FAIL — `formatBytes`/`formatElapsed` nicht exportiert, `ModelState`-Shape-Mismatch (TS-Fehler bei `fileKey`/`overallPct` etc.), `status.loadingGpu`/`status.engineLoadFailed` fehlen noch nicht relevant für diese Datei (kommt erst in Step 3).

- [ ] **Step 3: Write minimal implementation**

Replace `src/core/viewmodel.ts` in voller Länge:

```ts
// State → ViewModel als pure Funktion (UI-STANDARD §6). Die View rendert nur das
// ViewModel, trifft keine Entscheidungen.
import { t } from "../vendor/kit/i18n";
import type { ModelFileKey } from "./model-manifest";

export type GpuState = "checking" | "ok" | "no-webgpu" | "no-f16";
export type ModelState =
  | { kind: "missing" }
  | {
      kind: "downloading";
      overallPct: number;
      fileKey: ModelFileKey;
      fileIndex: number;
      totalFiles: number;
      receivedBytes: number;
      totalBytes: number;
    }
  | { kind: "ready" };
export type RunState =
  | { kind: "idle" }
  | { kind: "loading"; elapsedSec: number }
  | { kind: "running"; step: number; total: number }
  | { kind: "error"; message: string };

/** Die Parameter, aus denen ein Bild entstanden ist — beim Generieren eingefroren, damit
 *  die Ergebnis-Notiz das Bild beschreibt, das man sieht (und nicht den inzwischen
 *  weitergetippten Prompt). */
export interface GenParams {
  prompt: string;
  seed: number;
  steps: number;
  model: string;
  /** Lokaler ISO-8601-Stempel, siehe isoStamp() in filename.ts. */
  date: string;
}

export interface PanelState {
  gpu: GpuState;
  model: ModelState;
  run: RunState;
  image: { dataUrl: string; params: GenParams } | null;
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

/** Sekunden als "m:ss" (kein echter Fortschritt — nur ein Lebensbeweis während der
 *  GPU-Ladephase, siehe Spec 2026-07-18-robustheits-block-design.md §2.3). */
export function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Bytes als MB (< 1 GB) oder GB mit einer Nachkommastelle (>= 1 GB), für die
 *  Download-Detailzeile im Settings-Tab. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export function buildViewModel(s: PanelState): PanelViewModel {
  const gpuBlocked = s.gpu === "no-webgpu" || s.gpu === "no-f16";
  const busy =
    s.run.kind === "running" ||
    s.run.kind === "loading" ||
    s.model.kind === "downloading" ||
    s.gpu === "checking";

  let status: PanelViewModel["status"];
  if (s.run.kind === "error") status = { icon: "circle-x", text: t("status.error", s.run.message), cls: "is-error" };
  else if (s.gpu === "no-webgpu") status = { icon: "circle-x", text: t("status.noWebgpu"), cls: "is-error" };
  else if (s.gpu === "no-f16") status = { icon: "circle-x", text: t("status.noF16"), cls: "is-error" };
  else if (s.gpu === "checking") status = { icon: "loader", text: t("status.checking"), cls: "is-checking" };
  else if (s.model.kind === "downloading")
    status = { icon: "loader", text: t("status.downloading", s.model.overallPct), cls: "is-checking" };
  else if (s.run.kind === "loading")
    status = { icon: "loader", text: t("status.loadingGpu", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
  else if (s.run.kind === "running")
    status = { icon: "loader", text: t("status.generating", s.run.step, s.run.total), cls: "is-checking" };
  else status = { icon: "circle-check", text: t("status.ready"), cls: "is-ok" };

  let empty: PanelViewModel["empty"] = null;
  if (gpuBlocked) empty = { text: s.gpu === "no-webgpu" ? t("status.noWebgpu") : t("status.noF16") };
  else if (s.model.kind === "missing") empty = { text: t("empty.noModel"), ctaLabel: t("empty.noModelCta") };
  else if (!s.image && s.run.kind !== "running") empty = { text: t("empty.noImage") };

  return {
    status,
    empty,
    generateEnabled: !gpuBlocked && !busy && s.model.kind === "ready" && s.prompt.trim().length > 0,
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
}
```

In `src/i18n/strings.ts`: füge in `EN` (nach `"status.error": "Error: {0}",`) ein:

```ts
  "status.loadingGpu": "Loading model into GPU… ({0})",
  "status.engineLoadFailed":
    "Loading the model into the GPU is taking unusually long or failed silently. Click Generate to try again.",
```

und in `DE` (nach `"status.error": "Fehler: {0}",`) ein:

```ts
  "status.loadingGpu": "Lädt Modell auf GPU… ({0})",
  "status.engineLoadFailed":
    "Das Laden des Modells auf die GPU dauert ungewöhnlich lange oder ist lautlos fehlgeschlagen. Klicke auf Generieren, um es erneut zu versuchen.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/viewmodel.test.ts`
Expected: PASS (alle Tests in `buildViewModel`, `formatElapsed`, `formatBytes`)

- [ ] **Step 5: Typecheck (andere Dateien referenzieren die alten Shapes noch — erwartete Fehler außerhalb dieses Tasks)**

Run: `npx tsc --noEmit`
Expected: Fehler in `src/main.ts` (`downloadModel`, `ensureEngine`) und `src/obsidian/settings-tab.ts` (`renderModel`) — diese werden in Task 3–5 behoben. Kein Fehler in `src/core/viewmodel.ts`, `src/i18n/strings.ts`, `tests/viewmodel.test.ts` selbst.

- [ ] **Step 6: Commit**

```bash
git add src/core/viewmodel.ts src/i18n/strings.ts tests/viewmodel.test.ts
git commit -m "$(cat <<'EOF'
feat(core): ModelState/RunState um Datei-Detail + Ladephase erweitert

RunState bekommt einen neuen "loading"-Zweig für die GPU-Session-
Aufbauphase (mit Sekundenzähler statt echtem Fortschritt — ORT liefert
hier keinen). ModelState.downloading trägt jetzt Datei-Detail statt nur
Gesamt-%. Folgefehler in main.ts/settings-tab.ts werden in den nächsten
Tasks behoben.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `model-store.ts` — `DownloadProgress` mit Datei-Detail

**Files:**
- Modify: `src/obsidian/model-store.ts`
- Modify: `tests/model-store.test.ts`

**Interfaces:**
- Consumes: `ModelFileKey` aus `../core/model-manifest` (bereits vorhanden).
- Produces: `export interface DownloadProgress { overallPct: number; fileKey: ModelFileKey; fileIndex: number; totalFiles: number; receivedBytes: number; totalBytes: number }`, `ModelStore.download(onProgress: (p: DownloadProgress) => void): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/model-store.test.ts` in voller Länge:

```ts
import { describe, expect, it } from "vitest";
import { MODEL_FILES } from "../src/core/model-manifest";
import { ModelStore, type CacheLike, type DownloadProgress } from "../src/obsidian/model-store";

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
    const progress: DownloadProgress[] = [];
    await s.download((p) => progress.push(p));
    expect(fetched.length).toBe(MODEL_FILES.length - 1);
    const last = progress[progress.length - 1]!;
    expect(last.overallPct).toBe(100);
    expect(last.fileKey).toBe(MODEL_FILES[MODEL_FILES.length - 1]!.key);
    expect(last.totalFiles).toBe(MODEL_FILES.length - 1);
    expect(await s.isComplete()).toBe(true);
  });
  it("meldet Datei-Index/Gesamtzahl/Bytes pro Chunk korrekt", async () => {
    const { cache, store } = fakeCache();
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async () => okResponse("x".repeat(10), 10),
    });
    store.set(MODEL_FILES[0]!.url, okResponse("cached", 6));
    const progress: DownloadProgress[] = [];
    await s.download((p) => progress.push(p));
    const first = progress[0]!;
    expect(first.fileIndex).toBe(1);
    expect(first.totalFiles).toBe(MODEL_FILES.length - 1);
    expect(first.receivedBytes).toBe(10);
    expect(first.totalBytes).toBe(10);
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/model-store.test.ts`
Expected: FAIL — `DownloadProgress` nicht exportiert, `progress.push` erhält aktuell nur `number`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/obsidian/model-store.ts` in voller Länge:

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

/** Fortschritt eines download()-Aufrufs — Datei-Detail (Spec 2026-07-18-robustheits-
 *  block-design.md §2.2) plus der bisherige Gesamt-%-Wert. */
export interface DownloadProgress {
  overallPct: number;
  fileKey: ModelFileKey;
  fileIndex: number;
  totalFiles: number;
  receivedBytes: number;
  totalBytes: number;
}

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

  async download(onProgress: (p: DownloadProgress) => void): Promise<void> {
    const cache = await this.deps.openCache();
    const todo = missingFiles(await this.cachedKeys());
    const grandTotal = totalApproxBytes(todo);
    const totalFiles = todo.length;
    let receivedTotal = 0;
    let fileIndex = 0;
    let lastFileTotalBytes = 0;
    for (const file of todo) {
      fileIndex += 1;
      const res = await this.deps.fetchFn(file.url);
      if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${file.key}`);
      const contentLength = res.headers.get("content-length");
      const expected = contentLength === null ? null : Number(contentLength);
      const totalBytes = expected ?? file.approxBytes;
      lastFileTotalBytes = totalBytes;
      const [progressBranch, cacheBranch] = res.body.tee();
      const putDone = cache.put(file.url, new Response(cacheBranch, { headers: res.headers }));
      // Separater No-op-Catch: putDone läuft NEBEN der Leseschleife an; scheitert
      // der cacheBranch-Reader mitten im Stream, während noch niemand putDone
      // awaited, gäbe es sonst eine unhandledrejection. Das echte Ergebnis wird
      // weiterhin unten via `await putDone` gesehen (dieser Catch ändert es nicht).
      putDone.catch(() => {});
      let received = 0;
      const reader = progressBranch.getReader();
      // WICHTIG: reader.read()-Schleife läuft NEBEN putDone, nicht danach.
      // Kein Deadlock-Risiko (tee()-Branches puffern unabhängig — verifiziert:
      // `await putDone` vor der Leseschleife löst sich ebenfalls auf), aber
      // bei Multi-Gigabyte-Modelldateien (unet ~1.7GB) würde `await putDone`
      // zuerst den kompletten progressBranch ungelesen im Speicher aufstauen,
      // bevor überhaupt ein Fortschritt gemeldet wird — das Streaming-Ziel
      // (konstanter Speicherbedarf, laufendes onProgress) wäre dahin.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        receivedTotal += value.byteLength;
        onProgress({
          overallPct: Math.min(99, Math.round((receivedTotal / grandTotal) * 100)),
          fileKey: file.key,
          fileIndex,
          totalFiles,
          receivedBytes: received,
          totalBytes,
        });
      }
      await putDone;
      if (!isDownloadComplete(received, expected)) {
        await cache.delete(file.url);
        throw new Error(`download incomplete for ${file.key} (${received}/${expected ?? "?"} bytes)`);
      }
    }
    // Garantierter Abschluss-Callback bei genau 100%: die approxBytes-Schätzungen im
    // Manifest können von echten content-length-Werten abweichen, receivedTotal/
    // grandTotal würde daher nicht zuverlässig exakt 100 erreichen (Math.min-Deckel
    // oben verhindert das sogar bewusst vor Abschluss). Nur wenn wirklich etwas
    // geladen wurde (todo nicht leer) — sonst gibt es kein "letztes" File zu melden.
    const lastFile = todo[todo.length - 1];
    if (lastFile) {
      onProgress({
        overallPct: 100,
        fileKey: lastFile.key,
        fileIndex: totalFiles,
        totalFiles,
        receivedBytes: lastFileTotalBytes,
        totalBytes: lastFileTotalBytes,
      });
    }
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/model-store.test.ts`
Expected: PASS (6 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/model-store.ts tests/model-store.test.ts
git commit -m "$(cat <<'EOF'
feat(obsidian): ModelStore.download meldet Datei-Detail statt nur Gesamt-%

DownloadProgress trägt jetzt fileKey/fileIndex/totalFiles/receivedBytes/
totalBytes zusätzlich zum bisherigen overallPct — Grundlage für die
Datei-Detailzeile im Settings-Tab (Task 4).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Download-Wiring in `main.ts` + state-getriebener Settings-Tab (Re-Render-Fix)

**Files:**
- Modify: `src/main.ts`
- Modify: `src/obsidian/settings-tab.ts`

**Interfaces:**
- Consumes: `DownloadProgress` (Task 3), `ModelState`/`formatBytes` (Task 2), `MODEL_FILES`/`totalApproxBytes` aus `../core/model-manifest` (bereits vorhanden).
- Produces: `LocalImageGeneratorPlugin.getState(): Readonly<PanelState>`, `LocalImageGeneratorPlugin.downloadModel(): Promise<void>` (Signatur ohne Parameter — Breaking Change ggü. Task davor, einziger Aufrufer ist `settings-tab.ts`), `LigSettingTab.refreshModel(): void`.

Kein automatisierter Test möglich (obsidian-Layer, kein Obsidian-Mock im Repo — konsistent mit dem restlichen `main.ts`/`settings-tab.ts`). Verifikation über `npm run gate` (Typecheck + Build) und den finalen manuellen Smoke-Test am Ende des Plans.

- [ ] **Step 1: `main.ts` — `MODEL_FILES`-Import ergänzen**

In `src/main.ts`, Zeile 11 (`import { MODEL_ID } from "./core/model-manifest";`) ersetzen durch:

```ts
import { MODEL_FILES, MODEL_ID } from "./core/model-manifest";
```

- [ ] **Step 2: `main.ts` — `settingTab`-Feld + `getState()`**

In `src/main.ts`, nach dem Feld `private engine: SdTurboEngine | null = null;` (Zeile 27) eine neue Zeile einfügen:

```ts
  private engine: SdTurboEngine | null = null;
  private settingTab!: LigSettingTab;
```

Nach der `saveSettings()`-Methode (Zeile 104-106) eine neue Methode einfügen:

```ts
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Read-only-Zugriff für Consumer außerhalb der ViewHost-Fassade (aktuell nur
   *  LigSettingTab, siehe Spec 2026-07-18-robustheits-block-design.md §2.2). */
  getState(): Readonly<PanelState> {
    return this.state;
  }
```

- [ ] **Step 3: `main.ts` — `addSettingTab`-Aufruf auf gespeicherte Instanz umstellen**

In `src/main.ts`, Zeile 43 (`this.addSettingTab(new LigSettingTab(this.app, this));`) ersetzen durch:

```ts
    this.settingTab = new LigSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
```

- [ ] **Step 4: `main.ts` — `refreshViews()` ruft auch die Settings-Tab-Sektion**

In `src/main.ts`, `refreshViews()` (Zeile 114-119) ersetzen durch:

```ts
  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof GeneratorView) view.refresh();
    }
    this.settingTab.refreshModel();
  }
```

- [ ] **Step 5: `main.ts` — `downloadModel()` ohne Parameter, schreibt volles `DownloadProgress`**

In `src/main.ts`, `downloadModel()` (Zeile 134-150) ersetzen durch:

```ts
  async downloadModel(): Promise<void> {
    // Optimistischer Platzhalter, bis der erste echte Fortschritts-Callback aus
    // modelStore.download() eintrifft (Netzwerk-Round-Trip, meist < 1s) — wird sofort
    // überschrieben. Ohne diesen Zwischenschritt bliebe state.model kurz auf "missing",
    // während der Button in Wahrheit schon lädt.
    this.state.model = {
      kind: "downloading",
      overallPct: 0,
      fileKey: MODEL_FILES[0]!.key,
      fileIndex: 1,
      totalFiles: MODEL_FILES.length,
      receivedBytes: 0,
      totalBytes: MODEL_FILES[0]!.approxBytes,
    };
    this.refreshViews();
    try {
      await this.modelStore.download((p) => {
        this.state.model = { kind: "downloading", ...p };
        this.refreshViews();
      });
      this.state.model = { kind: "ready" };
    } catch (e) {
      this.state.model = { kind: "missing" };
      throw e;
    } finally {
      this.refreshViews();
    }
  }
```

- [ ] **Step 6: `settings-tab.ts` — state-getriebener `renderModel()` + `refreshModel()`**

Replace `src/obsidian/settings-tab.ts` in voller Länge:

```ts
// Settings (UI-STANDARD §5): Modell zuerst, Ausgabe, Presets, Gefährliches ans Ende.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { totalApproxBytes, MODEL_FILES } from "../core/model-manifest";
import { formatBytes } from "../core/viewmodel";
import { t } from "../vendor/kit/i18n";
import { collapsibleSection, type CollapsibleStorage } from "./collapsible";
import { ConfirmModal } from "./confirm-modal";
import { FolderSuggest } from "./folder-suggest";
import { renderPresetEditor } from "./preset-editor";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
  private modelSectionEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
  }

  // Auf-/Zu-Zustand landet in data.json (der Kit-Baustein bleibt storage-agnostisch).
  private storage: CollapsibleStorage = {
    getCollapsed: (key) => this.plugin.settings.sectionsCollapsed[key],
    setCollapsed: (key, collapsed) => {
      this.plugin.settings.sectionsCollapsed[key] = collapsed;
      void this.plugin.saveSettings();
    },
  };

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.modelSectionEl = collapsibleSection(containerEl, {
      title: t("settings.model.heading"),
      key: "model",
      defaultCollapsed: false,
      storage: this.storage,
    });
    this.renderModel(this.modelSectionEl);

    this.renderOutput(collapsibleSection(containerEl, {
      title: t("settings.output.heading"),
      key: "output",
      defaultCollapsed: false,
      storage: this.storage,
    }));

    const presets = collapsibleSection(containerEl, {
      title: t("settings.presets.heading"),
      key: "presets",
      defaultCollapsed: true,
      storage: this.storage,
    });
    presets.createEl("p", { text: t("settings.presets.desc"), cls: "setting-item-description" });
    renderPresetEditor(presets, {
      getPresets: () => this.plugin.settings.presets,
      setPresets: async (next) => {
        this.plugin.settings.presets = next;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      },
      rerender: () => this.display(),
    });

    this.renderDanger(collapsibleSection(containerEl, {
      title: t("settings.danger.heading"),
      key: "danger",
      defaultCollapsed: true,
      storage: this.storage,
    }));
  }

  /** Zeichnet NUR die Modell-Sektion neu — state-getrieben (this.plugin.getState().model
   *  ist die einzige Wahrheit), überlebt Re-Renders anderer Sektionen strukturell, weil
   *  sie nie eigenen Zustand hält. Wird von main.ts.refreshViews() bei jeder
   *  Download-Fortschritts-Änderung aufgerufen — der isConnected-Check verhindert, dass
   *  ein Aufruf nach einem kompletten display()-Rebuild (z.B. presets.rerender()) einen
   *  bereits aus dem DOM entfernten Container beschreibt (Spec 2026-07-18-robustheits-
   *  block-design.md §2.2). */
  refreshModel(): void {
    const el = this.modelSectionEl;
    if (!el || !el.isConnected) return;
    el.empty();
    this.renderModel(el);
  }

  private renderModel(el: HTMLElement): void {
    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const model = this.plugin.getState().model;
    const modelSetting = new Setting(el)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(t("settings.model.desc"));

    if (model.kind === "ready") {
      modelSetting.addExtraButton((b) => b.setIcon("circle-check").setTooltip(t("settings.model.downloadedTooltip")));
      return;
    }

    if (model.kind === "downloading") {
      modelSetting.addButton((b) => b.setButtonText(`${model.overallPct}%`).setDisabled(true));
      el.createEl("p", {
        text: `${model.fileKey} (${model.fileIndex}/${model.totalFiles}) — ${formatBytes(model.receivedBytes)} / ${formatBytes(model.totalBytes)}`,
        cls: "setting-item-description",
      });
      return;
    }

    modelSetting.addButton((b) =>
      b
        .setButtonText(t("settings.model.download", gb))
        .setCta()
        .onClick(async () => {
          try {
            await this.plugin.downloadModel();
            new Notice(t("notice.modelDownloaded"));
          } catch (e) {
            new Notice(String(e instanceof Error ? e.message : e));
          }
        }),
    );
  }

  private renderOutput(el: HTMLElement): void {
    new Setting(el)
      .setName(t("settings.output.folder"))
      .setDesc(t("settings.output.folderDesc"))
      .addText((tf) => {
        new FolderSuggest(this.app, tf.inputEl);
        tf.setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
          this.plugin.settings.outputFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(t("settings.noteFolder"))
      .setDesc(t("settings.noteFolderDesc"))
      .addText((tf) => {
        new FolderSuggest(this.app, tf.inputEl);
        tf.setValue(this.plugin.settings.noteFolder).onChange(async (v) => {
          this.plugin.settings.noteFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(t("settings.createMode"))
      .setDesc(t("settings.createModeDesc"))
      .addDropdown((d) => {
        d.addOption("image", t("settings.createModeImage"));
        d.addOption("note", t("settings.createModeNote"));
        d.setValue(this.plugin.settings.createMode).onChange(async (v) => {
          this.plugin.settings.createMode = v === "note" ? "note" : "image";
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(t("settings.defaultSteps"))
      .setDesc(t("settings.defaultStepsDesc"))
      .addSlider((s) =>
        s
          .setLimits(1, 4, 1)
          .setValue(this.plugin.settings.defaultSteps)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.defaultSteps = v;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderDanger(el: HTMLElement): void {
    new Setting(el).setName(t("settings.model.delete")).addButton((b) =>
      b
        .setButtonText(t("settings.model.delete"))
        .setWarning()
        .onClick(() => {
          new ConfirmModal(this.app, t("settings.model.deleteConfirm"), t("modal.confirm"), async () => {
            await this.plugin.modelStore.deleteAll();
            this.plugin.onModelDeleted();
            this.display();
          }).open();
        }),
    );
  }
}
```

- [ ] **Step 7: Typecheck — Download-Pfad muss jetzt fehlerfrei sein (main.ts/ensureEngine-Fehler kommen erst in Task 5)**

Run: `npx tsc --noEmit`
Expected: verbleibende Fehler NUR noch in `ensureEngine()`/`generate()` (`main.ts`) — `RunState`/`ModelState` dort betreffend `"loading"`/Guard, wird in Task 5 behoben. Keine Fehler mehr in `settings-tab.ts` oder im Download-Teil von `main.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/obsidian/settings-tab.ts
git commit -m "$(cat <<'EOF'
fix(obsidian): Download-Fortschritt state-getrieben statt Button-Closure

Behebt den live bestätigten Re-Render-Bug (Kreisel ohne Zahlen) strukturell:
renderModel() leitet Button-Text/Balken/Datei-Detailzeile bei jedem Aufruf
aus this.plugin.getState().model ab statt aus einer Closure, die einen
Re-Render nicht übersteht. refreshViews() aktualisiert jetzt zusätzlich
die Settings-Tab-Modellsektion (isConnected-Guard gegen verwaiste Container).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Ladephase + Watchdog + `unhandledrejection` in `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `raceTimeout` (Task 1), `RunState` mit `"loading"`-Zweig (Task 2).
- Produces: `LocalImageGeneratorPlugin.loadEngine(): Promise<SdTurboEngine>` (privat), `ensureEngine()` mit Generation-Counter + Watchdog, `generate()`-Guard erweitert um `"loading"`.

Kein automatisierter Test möglich (obsidian-Layer, ORT-abhängig). Verifikation über `npm run gate` + finaler manueller Smoke-Test.

- [ ] **Step 1: `main.ts` — `raceTimeout`-Import ergänzen**

In `src/main.ts`, nach `import { SdTurboEngine } from "./core/engine";` (Zeile 7) eine neue Zeile einfügen:

```ts
import { SdTurboEngine } from "./core/engine";
import { raceTimeout } from "./core/timeout";
```

- [ ] **Step 2: `main.ts` — Generation-Counter-Feld**

Nach `private settingTab!: LigSettingTab;` (aus Task 4, Schritt 2) eine neue Zeile einfügen:

```ts
  private settingTab!: LigSettingTab;
  private engineLoadGeneration = 0;
```

- [ ] **Step 3: `main.ts` — `ensureEngine()` in `loadEngine()` + Watchdog-`ensureEngine()` aufteilen**

In `src/main.ts`, die bisherige `ensureEngine()`-Methode (Zeile 167-180) vollständig ersetzen durch:

```ts
  // Die bisherige reine Ladelogik — unverändert, nur aus ensureEngine() extrahiert,
  // damit raceTimeout() genau diese eine Promise umschließen kann.
  private async loadEngine(): Promise<SdTurboEngine> {
    const [textEncoder, unet, vaeDecoder] = await Promise.all([
      this.modelStore.getBuffer("text_encoder").then(createOrtSession),
      this.modelStore.getBuffer("unet").then(createOrtSession),
      this.modelStore.getBuffer("vae_decoder").then(createOrtSession),
    ]);
    const vocab = JSON.parse(await this.modelStore.getText("vocab")) as Record<string, number>;
    const merges = (await this.modelStore.getText("merges"))
      .split("\n")
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    return new SdTurboEngine({ textEncoder, unet, vaeDecoder }, { vocab, merges });
  }

  // Watchdog + Ladephasen-Status um loadEngine() (Spec 2026-07-18-robustheits-block-
  // design.md §2.4): ORT bietet kein AbortSignal für InferenceSession.create, ein
  // Timeout kann den Aufruf also nicht wirklich abbrechen — nur der UI melden und die
  // Promise im Hintergrund verwaisen lassen. Die Generation-ID erkennt genau das: löst
  // ein verwaister alter Ladeversuch später doch noch auf, wird die Session sofort
  // freigegeben statt geleakt (bekannter GPU-Leak-Bug aus 0.1).
  private async ensureEngine(): Promise<SdTurboEngine> {
    if (this.engine) return this.engine;
    const myGeneration = ++this.engineLoadGeneration;
    this.state.run = { kind: "loading", elapsedSec: 0 };
    this.refreshViews();
    const tick = window.setInterval(() => {
      if (this.state.run.kind === "loading") {
        this.state.run = { kind: "loading", elapsedSec: this.state.run.elapsedSec + 1 };
        this.refreshViews();
      }
    }, 1000);
    try {
      const engine = await raceTimeout(this.loadEngine(), 5 * 60_000, "engine load timed out");
      if (myGeneration !== this.engineLoadGeneration) {
        // Ein neuerer Ladeversuch läuft bereits (Retry nach Timeout/unhandledrejection) —
        // dieser hier ist verwaist. Sofort freigeben statt GPU-Speicher zu leaken.
        void engine.dispose().catch(() => {});
        throw new Error("stale engine load result");
      }
      this.engine = engine;
      return engine;
    } catch (e) {
      if (myGeneration === this.engineLoadGeneration) {
        this.state.run = { kind: "error", message: t("status.engineLoadFailed") };
        this.refreshViews();
      }
      throw e;
    } finally {
      window.clearInterval(tick);
    }
  }
```

- [ ] **Step 4: `main.ts` — `generate()`-Guard erweitern + `run`-Zuweisung nach `ensureEngine()` verschieben**

In `src/main.ts`, die bisherige `generate()`-Methode (Zeile 182-230) vollständig ersetzen durch:

```ts
  private async generate(steps: number, seed: number): Promise<void> {
    if (this.state.run.kind === "running" || this.state.run.kind === "loading") return;
    // Prompt HIER festhalten: zwischen Start und Ende kann der Nutzer weitertippen,
    // und die Ergebnis-Notiz muss das Bild beschreiben, das entstanden ist.
    const prompt = this.state.prompt;
    let engine: SdTurboEngine;
    try {
      engine = await this.ensureEngine();
    } catch {
      // ensureEngine() hat state.run bereits auf status.engineLoadFailed gesetzt und
      // selbst refreshViews() aufgerufen (Watchdog- oder Generation-Mismatch-Fall) —
      // hier nichts weiter zu tun, der Generate-Button ist bereits wieder aktiv.
      return;
    }
    this.state.run = { kind: "running", step: 0, total: steps };
    this.refreshViews();
    let succeeded = false;
    try {
      const result = await engine.generate({ prompt, steps, seed }, (step, total) => {
        this.state.run = { kind: "running", step, total };
        this.refreshViews();
      });
      this.state.image = {
        dataUrl: rgbaToDataUrl(result.rgba, result.width, result.height),
        params: { prompt, seed: result.seed, steps, model: MODEL_ID, date: isoStamp(new Date()) },
      };
      this.state.run = { kind: "idle" };
      succeeded = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.run = { kind: "error", message: msg };
      // Sessions freigeben und verwerfen, nächster Lauf lädt neu (Spec §8).
      // Fire-and-forget: der Fehlerpfad soll den UI-Refresh nicht blockieren.
      void this.engine?.dispose().catch(() => {});
      this.engine = null;
      new Notice(t("notice.oomHint"));
    } finally {
      this.refreshViews();
    }
    // Bewusst AUSSERHALB des try/catch der Generierung: ein Fehler hier (z.B. defekte
    // Historie) darf weder als Generierungsfehler gemeldet werden noch die bereits
    // erfolgreich befüllte Engine verwerfen. Erst bei Erfolg aufnehmen — sonst füllt
    // sich die Liste mit Halbsätzen und Fehlversuchen. saveSettings bewusst
    // fire-and-forget: ein langsamer Schreibvorgang darf das fertige Bild nicht aufhalten.
    if (succeeded && this.state.image) {
      // Volles Rezept aus dem beim Erfolg eingefrorenen img.params (kein "jetzt"-Nachziehen).
      const p = this.state.image.params;
      this.settings.history = pushHistory(this.settings.history, {
        prompt: p.prompt,
        seed: p.seed,
        steps: p.steps,
        model: p.model,
        created: p.date,
      });
      void this.saveSettings();
    }
  }
```

- [ ] **Step 5: `main.ts` — `unhandledrejection`-Listener in `onload()`**

In `src/main.ts`, `onload()`: nach der Zeile `this.addCommand({ id: "open", name: t("cmd.open"), callback: () => void this.activateView() });` (Zeile 99) und vor `void this.initStatus();` (Zeile 101) eine neue Zeile einfügen:

```ts
    this.addCommand({ id: "open", name: t("cmd.open"), callback: () => void this.activateView() });

    // Fängt die verschluckte ORT-Init-Rejection ab, die den dokumentierten jsep/asyncify-
    // Hänger (Fix 7673961) verursacht hat: ORTs eigene interne Promise rejected, ohne dass
    // unser eigenes await in loadEngine()/ensureEngine() das je erreicht (Spec 2026-07-18-
    // robustheits-block-design.md §2.4). Bewusst kein event.reason-Auswerten (fragil) —
    // die Korrelation läuft rein über den State: nur während der Ladephase reagieren, um
    // fremde Rejections (andere Plugins, Obsidian selbst) nicht fälschlich zu kapern.
    // Kein preventDefault() — Standard-Konsolen-Logging bleibt erhalten.
    this.registerDomEvent(window, "unhandledrejection", () => {
      if (this.state.run.kind === "loading") {
        this.state.run = { kind: "error", message: t("status.engineLoadFailed") };
        this.refreshViews();
      }
    });

    void this.initStatus();
```

- [ ] **Step 6: Vollständigen Gate-Lauf ausführen**

Run: `npm run gate`
Expected: PASS — `tsc --noEmit` fehlerfrei, alle Vitest-Suiten grün (inkl. der in Task 1-3 neu/geänderten), `check:pure` fehlerfrei (kein `obsidian`-Import in `src/core/`/`src/vendor/kit/` — `timeout.ts`/`viewmodel.ts` bleiben pur), `esbuild`-Production-Build erfolgreich.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(obsidian): Ladephasen-Status + Watchdog + unhandledrejection um InferenceSession.create

Neue "loading"-Statuszeile mit Sekundenzähler zwischen Download und
Generieren (bisher unsichtbare Phase — wirkte wie ein Hänger). 5-Minuten-
Watchdog via raceTimeout, Generation-Counter verwirft verwaiste späte
Session-Resolves (kein GPU-Leak). unhandledrejection-Listener fängt den
dokumentierten jsep/asyncify-Vorfall (ORTs verschluckte Init-Rejection)
zukünftig als Fehlermeldung statt Ewig-Spinner ab. Retry ist der
bestehende Generate-Button (generateEnabled wird bei "error" automatisch
wieder true) — kein neues UI-Element.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Cockpit + REGISTRY nachziehen

**Files:**
- Modify: `/Users/Shared/10_ObsidianVaults/10_Pallas/25_Coding/local-image-generator/local-image-generator.md`
- Modify: `/Users/Shared/code/obsidian-plugins/REGISTRY.md`

**Interfaces:** keine (Dokumentation).

- [ ] **Step 1: Cockpit-Abschnitt "🧭 Warum & Entscheidungen" ergänzen**

In `local-image-generator.md`, nach dem letzten Eintrag im Abschnitt `## 🧭 Warum & Entscheidungen` (endet aktuell mit dem i18n-Absatz "Carryover-Klärung: …") einen neuen Absatz anfügen:

```markdown

- **Robustheits-Block gemergt (2026-07-18):** Backlog 4/5/6 umgesetzt — Download-Fortschritt
  mit Datei-Detail (state-getrieben statt Button-Closure, behebt den live bestätigten
  Re-Render-Bug strukturell), neue "Loading model into GPU…"-Statuszeile mit Sekundenzähler
  zwischen Download und Generieren, 5-Minuten-Watchdog + `unhandledrejection`-Listener um
  `InferenceSession.create` (Generation-Counter verwirft verwaiste späte Session-Resolves,
  kein GPU-Leak). Retry ist bewusst der bestehende Generate-Button (kein neues UI-Element) —
  `generateEnabled` wird bei jedem `error`-Zustand automatisch wieder `true`. Spec+Plan in
  `docs/superpowers/`.
  - **Kit-first-Befund:** `raceTimeout` (Promise.race+setTimeout um `InferenceSession.create`)
    ist die vierte Instanz desselben Musters, das yijing-oracle bereits dreifach für
    `requestUrl` nutzt (Regel-der-Drei erreicht) — Kit-Extraktion bewusst zurückgestellt,
    läuft separat über `/drift-audit`.
```

Frontmatter-Felder `letzter_commit`, `letzte_session`, `fokus` NICHT von Hand anfassen — die pflegt der SessionEnd-Hook automatisch beim nächsten `/clean-shutdown`.

- [ ] **Step 2: REGISTRY.md — Kit-Kandidat vermerken**

In `/Users/Shared/code/obsidian-plugins/REGISTRY.md` unter dem Themenblock, der yijing-oracles `httpPostJson`/`probeEndpoint`-Timeout-Muster referenziert (grep nach `probeImageEndpoint` oder `httpPostJson` um die Zeile zu finden), eine neue Zeile im selben Tabellen-/Listenformat wie die Nachbareinträge ergänzen, die auf `local-image-generator/src/core/timeout.ts` als vierte Instanz verweist (exakte Formatierung an die unmittelbar umgebenden Zeilen der Datei anpassen — nicht blind eine neue Struktur einführen).

- [ ] **Step 3: Committen**

```bash
git add /Users/Shared/10_ObsidianVaults/10_Pallas/25_Coding/local-image-generator/local-image-generator.md /Users/Shared/code/obsidian-plugins/REGISTRY.md
git commit -m "$(cat <<'EOF'
docs(cockpit,registry): Robustheits-Block dokumentiert, raceTimeout als 4. Kit-Kandidat vermerkt

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**Hinweis:** Dieser Task committet in ZWEI verschiedenen Repos (Vault + `obsidian-plugins`) — der `git add`/`git commit`-Befehl oben muss mit dem jeweils passenden Working Directory ausgeführt werden (zwei separate Commits, nicht einer über beide Repos hinweg).

---

## Self-Review (durchgeführt beim Schreiben dieses Plans)

**Spec-Abdeckung:**
- §2.1 Datenmodell → Task 2 ✓
- §2.2 Download-Fortschritt (Punkt 4) → Task 3 (model-store.ts) + Task 4 (main.ts/settings-tab.ts) ✓
- §2.3 Ladephasen-Status (Punkt 5) → Task 2 (Status-Zweig/i18n) + Task 5 (main.ts) ✓
- §2.4 Watchdog + unhandledrejection (Punkt 6) → Task 1 (raceTimeout) + Task 5 (main.ts) ✓
- §3 Sonderfälle (kein retryable-Flag, totalFiles bei Teil-Downloads, kein Pseudo-Fortschritt) → jeweils in Task 2/3/5 durch die konkrete Implementierung abgedeckt, keine offenen Punkte ✓
- §4 Kit-first-Befund → Task 1 Kommentar + Task 6 REGISTRY-Eintrag ✓
- §6 Tests → Task 1/2/3 automatisiert, Task 4/5 bewusst nur Gate+Smoke (wie im Spec festgelegt) ✓

**Platzhalter-Scan:** keine "TBD"/"TODO"/"handle edge cases" — jeder Code-Schritt enthält vollständigen, direkt lauffähigen Code.

**Typ-Konsistenz geprüft:** `DownloadProgress` (Task 3) und `ModelState`s `downloading`-Variante (Task 2) haben identische Feldnamen/-typen (spreadbar via `{ kind: "downloading", ...p }` in Task 4). `formatBytes`/`formatElapsed` werden in Task 2 exportiert und in Task 4 (`settings-tab.ts`) bzw. intern in Task 2 selbst (`buildViewModel`) konsumiert — keine Namensabweichung. `raceTimeout<T>` (Task 1) wird in Task 5 mit `T = SdTurboEngine` instanziiert — Signatur passt.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-robustheits-block.md`. Zwei Ausführungsoptionen:

**1. Subagent-Driven (empfohlen)** — frischer Subagent pro Task, Review zwischen den Tasks, schnelle Iteration.

**2. Inline Execution** — Tasks in dieser Session per executing-plans abarbeiten, Batch-Ausführung mit Checkpoints.

Welcher Ansatz?
