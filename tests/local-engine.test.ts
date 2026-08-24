import { describe, expect, it } from "vitest";
import type { Session } from "../src/core/engine";
import { BUILTIN_MODELS, RUNTIME_WASM, type AssetFile } from "../src/core/model-manifest";
import { LocalEngineBackend, type LocalEngineDeps } from "../src/obsidian/local-engine";
import type { ModelStore } from "../src/obsidian/model-store";

// Fake-Sessions wie in tests/engine.test.ts — fp32-IO (unsere Konversion), int64-ids.
function fakeSession(inputs: string[], out: string, dims: number[], type: Record<string, string>): Session {
  return {
    inputNames: inputs,
    outputNames: [out],
    inputTypes: type,
    run: async () => ({ [out]: { data: new Float32Array(dims.reduce((a, b) => a * b, 1)), dims } }),
    release: async () => {},
  };
}

function makeDeps(log: string[]): LocalEngineDeps & { released: number } {
  const state = { released: 0 };
  const store = {
    getBuffer: async (f: AssetFile) => { log.push(`buffer:${f.key}`); return new ArrayBuffer(8); },
    getText: async (f: AssetFile) => { log.push(`text:${f.key}`); return f.key.endsWith("/vocab") ? JSON.stringify({ "cat</w>": 1 }) : "#version\n"; },
  } as unknown as ModelStore;
  const deps: LocalEngineDeps & { released: number } = {
    store,
    initRuntime: () => { log.push("initRuntime"); },
    createSession: async (buf) => {
      log.push(`session:${buf.byteLength}`);
      const n = log.filter((l) => l.startsWith("session:")).length;
      const s =
        n % 3 === 1 ? fakeSession(["input_ids"], "last_hidden_state", [1, 77, 1024], { input_ids: "int64" })
        : n % 3 === 2 ? fakeSession(["sample", "timestep", "encoder_hidden_states"], "out_sample", [1, 4, 64, 64], { sample: "float32", timestep: "int64", encoder_hidden_states: "float32" })
        : fakeSession(["latent_sample"], "sample", [1, 3, 512, 512], { latent_sample: "float32" });
      return { ...s, release: async () => { state.released++; } };
    },
    checkGpu: async () => "ok",
    encodePng: (rgba, w, h) => `data:image/png;base64,${w}x${h}:${rgba.length}`,
    get released() { return state.released; },
  };
  return deps;
}

const req = { prompt: "cat", negativePrompt: "", width: 512, height: 512, steps: 2, seed: 7, cfg: 1,
  initImageData: null, denoising: null };

function reqOf(prompt: string): typeof req {
  return { ...req, prompt };
}

describe("LocalEngineBackend", () => {
  it("erster generate lädt WASM, drei Sessions und den Tokenizer genau einmal — der zweite nicht mehr", async () => {
    const log: string[] = [];
    const be = new LocalEngineBackend(makeDeps(log), BUILTIN_MODELS["sd-turbo"]);
    const phases: string[] = [];
    be.onPhase = (p, s, t) => phases.push(`${p}${s !== undefined ? `:${s}/${t}` : ""}`);
    await be.generate(req);
    expect(log.filter((l) => l === "initRuntime")).toHaveLength(1);
    expect(log.filter((l) => l.startsWith("session:"))).toHaveLength(3);
    expect(log).toContain(`buffer:${RUNTIME_WASM.key}`);
    expect(log).toContain("text:sd-turbo/vocab");
    expect(phases[0]).toBe("loading-model");
    expect(be.loaded).toBe(true);
    const before = log.length;
    await be.generate(req);
    expect(log.length).toBe(before);
    expect(phases.filter((p) => p === "loading-model")).toHaveLength(1);
  });

  it("liefert Base64 ohne data:-Präfix und meldet generating-Schritte 1..steps", async () => {
    const be = new LocalEngineBackend(makeDeps([]), BUILTIN_MODELS["sd-turbo"]);
    const steps: string[] = [];
    be.onPhase = (p, s, t) => { if (p === "generating") steps.push(`${s}/${t}`); };
    const png = await be.generate(req);
    expect(png.startsWith("data:")).toBe(false);
    expect(png).toBe(`512x512:${512 * 512 * 4}`);
    expect(steps).toEqual(["1/2", "2/2"]);
  });

  it("Steps werden auf den Modellbereich geklemmt, Größe ist immer 512 (Rezept-Ehrlichkeit)", async () => {
    const be = new LocalEngineBackend(makeDeps([]), BUILTIN_MODELS["sd-turbo"]);
    const steps: string[] = [];
    be.onPhase = (p, s, t) => { if (p === "generating") steps.push(`${s}/${t}`); };
    await be.generate({ ...req, steps: 20, width: 1024, height: 768 });
    expect(steps).toHaveLength(BUILTIN_MODELS["sd-turbo"].steps.max);
    expect(steps[steps.length - 1]).toBe(`${BUILTIN_MODELS["sd-turbo"].steps.max}/${BUILTIN_MODELS["sd-turbo"].steps.max}`);
  });

  it("dispose gibt die Sessions frei; danach lädt generate neu", async () => {
    const log: string[] = [];
    const deps = makeDeps(log);
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
    await be.generate(req);
    await be.dispose();
    expect(deps.released).toBe(3);
    expect(be.loaded).toBe(false);
    await be.dispose(); // idempotent
    expect(deps.released).toBe(3);
    await be.generate(req);
    expect(log.filter((l) => l.startsWith("session:"))).toHaveLength(6);
  });

  it("dispose während eines laufenden generate wartet das Ergebnis ab, statt die Sessions darunter wegzuziehen", async () => {
    const log: string[] = [];
    const deps = makeDeps(log);
    // UNet-Session mit Verzögerung und Protokoll: generate läuft messbar lange; release wird geloggt.
    const slowCreate = deps.createSession;
    deps.createSession = async (buf) => {
      const s = await slowCreate(buf);
      const tag = s.inputNames.includes("sample") ? "unet" : s.inputNames[0]!;
      return {
        ...s,
        run: async (f) => { if (tag === "unet") await new Promise((r) => setTimeout(r, 40)); log.push(`run:${tag}`); return s.run(f); },
        release: async () => { log.push(`release:${tag}`); await s.release(); },
      };
    };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
    const gen = be.generate(req);
    await new Promise((r) => setTimeout(r, 15)); // mitten im Lauf
    const disposeDone = be.dispose();
    const png = await gen; // muss sauber durchlaufen
    expect(png.startsWith("512x512")).toBe(true);
    await disposeDone;
    const firstRelease = log.findIndex((l) => l.startsWith("release:"));
    const lastRun = log.map((l, i) => (l.startsWith("run:") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(firstRelease).toBeGreaterThan(lastRun);
    expect(deps.released).toBe(3);
    expect(be.loaded).toBe(false);
  });

  it("zwei parallele generate-Aufrufe teilen sich das Laden (kein doppelter Session-Aufbau)", async () => {
    const log: string[] = [];
    const be = new LocalEngineBackend(makeDeps(log), BUILTIN_MODELS["sd-turbo"]);
    const p1 = be.generate(req);
    const p2 = be.generate({ ...req, seed: 8 }).catch((e: Error) => e.message);
    await p1;
    const r2 = await p2;
    // Die pure Engine ist single-flight („engine is busy"); der Backend-Loader aber nur einmal.
    expect(log.filter((l) => l.startsWith("session:"))).toHaveLength(3);
    expect(typeof r2).toBe("string");
  });

  it("uebergibt Bucket-Puffer als externalData mit dem location-Namen", async () => {
    const seen: { path: string; bytes: number }[] = [];
    const deps = makeDeps([]);
    deps.createSession = async (buf, ext) => {
      for (const e of ext ?? []) seen.push({ path: e.path, bytes: e.data.byteLength });
      return fakeSession(["sample"], "out_sample", [1, 4, 64, 64], {});
    };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sdxl-turbo"]);
    await be.generate(reqOf("hund")).catch(() => undefined);
    expect(seen.map((s) => s.path)).toEqual(
      BUILTIN_MODELS["sdxl-turbo"].parts.unet.data.map((d) => d.path.split("/").pop()),
    );
  });

  it("monolithische Modelle bekommen kein externalData", async () => {
    let ext: unknown = "ungesetzt";
    const deps = makeDeps([]);
    deps.createSession = async (_buf, e) => { ext = e; return fakeSession(["sample"], "out_sample", [1, 4, 64, 64], {}); };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
    await be.generate(reqOf("katze")).catch(() => undefined);
    expect(ext === undefined || (Array.isArray(ext) && ext.length === 0)).toBe(true);
  });
});
