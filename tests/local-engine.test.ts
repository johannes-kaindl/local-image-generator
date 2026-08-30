import { describe, expect, it, vi } from "vitest";
import { SdTurboEngine, type GenerateRequest, type GenerateResult, type Session } from "../src/core/engine";
import { BUILTIN_MODELS, RUNTIME_WASM, type AssetFile } from "../src/core/model-manifest";
import { LocalEngineBackend, SessionBuildTimeout, SESSION_BUILD_TIMEOUT_MS, type LocalEngineDeps } from "../src/obsidian/local-engine";
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

// SDXL-Fakes fuer Text-Encoder mit indizierten hidden_states.N-Ausgaengen (gemessen am echten
// Modell, s. tests/engine-sdxl.test.ts) — an dieser Stelle geteilt zwischen der C1-Regression
// (Groesse) und der vaeEncoder-Ladewege-Zaehlung (Spec 0.9 §4a), statt zweimal dasselbe
// Duplikat zu pflegen.
function hiddenOutputs(count: number, dim: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) out[`hidden_states.${i}`] = [1, 77, dim];
  return out;
}

function multiSessionOf(outputs: Record<string, unknown>): Session {
  const outputNames = Object.keys(outputs);
  return {
    inputNames: [],
    outputNames,
    inputTypes: {},
    run: async () => {
      const result: Record<string, { data: Float32Array; dims: number[] }> = {};
      for (const [name, dims] of Object.entries(outputs)) {
        const d = dims as number[];
        result[name] = { data: new Float32Array(d.reduce((a, b) => a * b, 1)).fill(1), dims: d };
      }
      return result;
    },
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
      // Vier Teile je sd-turbo-Ladelauf, in der Reihenfolge, in der load() sie anfragt:
      // textEncoder, unet, vaeDecoder, vaeEncoder (img2img, Spec 0.9 §4a).
      const idx = n % 4;
      const s =
        idx === 1 ? fakeSession(["input_ids"], "last_hidden_state", [1, 77, 1024], { input_ids: "int64" })
        : idx === 2 ? fakeSession(["sample", "timestep", "encoder_hidden_states"], "out_sample", [1, 4, 64, 64], { sample: "float32", timestep: "int64", encoder_hidden_states: "float32" })
        : idx === 3 ? fakeSession(["latent_sample"], "sample", [1, 3, 512, 512], { latent_sample: "float32" })
        : fakeSession(["sample"], "latent_parameters", [1, 8, 64, 64], { sample: "float32" });
      return { ...s, release: async () => { state.released++; } };
    },
    checkGpu: async () => "ok",
    encodePng: (rgba, w, h) => `data:image/png;base64,${w}x${h}:${rgba.length}`,
    // txt2img-Default fuer alle bestehenden Tests, die decodeImage nicht selbst setzen —
    // wird bei initImageData: null (der Regelfall hier) nie aufgerufen.
    decodeImage: async () => new Float32Array(3 * 512 * 512),
    // Node-Umgebung hat kein `window` — der Produktions-Default in local-engine.ts (`REAL_TIMERS`)
    // ruft `window.setTimeout`. Hier bewusst die globalen Timer statt `window.*`, damit alle
    // bestehenden Tests (die `timers` nicht selbst setzen) nicht an einem ReferenceError
    // scheitern, sobald `loadPart()` seinen Wachhund aufzieht.
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout) },
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
  it("erster generate lädt WASM, vier Sessions (inkl. vaeEncoder) und den Tokenizer genau einmal — der zweite nicht mehr", async () => {
    const log: string[] = [];
    const be = new LocalEngineBackend(makeDeps(log), BUILTIN_MODELS["sd-turbo"]);
    const phases: string[] = [];
    be.onPhase = (p, s, t) => phases.push(`${p}${s !== undefined ? `:${s}/${t}` : ""}`);
    await be.generate(req);
    expect(log.filter((l) => l === "initRuntime")).toHaveLength(1);
    expect(log.filter((l) => l.startsWith("session:"))).toHaveLength(4);
    expect(log).toContain(`buffer:${RUNTIME_WASM.key}`);
    expect(log).toContain("buffer:sd-turbo/vae_encoder");
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

  // Task 4 (Spec 0.9 §4a Fortsetzung): local-engine.ts reicht Base64→Pixel-Wandlung und
  // Denoise-Staerke an die pure Engine durch. `decodeImage` ist injiziert (wie encodePng) —
  // dieser Test spy'd direkt auf SdTurboEngine.prototype.generate, damit die REFERENZ des
  // Fake-decodeImage-Ergebnisses ueberprueft werden kann (kein Umweg ueber echte
  // Session-Feeds, die den Wert kopieren wuerden).
  it("initImageData/denoising: decodeImage wird mit (base64, Zielgroesse) gerufen, das Ergebnis geht referenzgleich als initPixels an die Engine", async () => {
    const decodeCalls: [string, number][] = [];
    const pixels = new Float32Array(3 * 512 * 512);
    const deps = makeDeps([]);
    deps.decodeImage = async (b64, size) => {
      decodeCalls.push([b64, size]);
      return pixels;
    };
    const seen: { initPixels?: Float32Array; denoising?: number }[] = [];
    const spy = vi.spyOn(SdTurboEngine.prototype, "generate").mockImplementation(async (r: GenerateRequest): Promise<GenerateResult> => {
      seen.push({ initPixels: r.initPixels, denoising: r.denoising });
      return { rgba: new Uint8ClampedArray(512 * 512 * 4), width: 512, height: 512, seed: r.seed };
    });
    try {
      const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
      await be.generate({ ...req, initImageData: "QUJD", denoising: 0.5 });
    } finally {
      spy.mockRestore();
    }
    expect(decodeCalls).toEqual([["QUJD", 512]]);
    expect(seen[0]!.initPixels).toBe(pixels);
    expect(seen[0]!.denoising).toBe(0.5);
  });

  it("txt2img (initImageData: null) ruft decodeImage nicht auf", async () => {
    let calls = 0;
    const deps = makeDeps([]);
    deps.decodeImage = async () => {
      calls++;
      return new Float32Array(3 * 512 * 512);
    };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
    await be.generate(req);
    expect(calls).toBe(0);
  });

  it("Steps werden auf den Modellbereich geklemmt, Größe ist immer 512 (Rezept-Ehrlichkeit)", async () => {
    const be = new LocalEngineBackend(makeDeps([]), BUILTIN_MODELS["sd-turbo"]);
    const steps: string[] = [];
    be.onPhase = (p, s, t) => { if (p === "generating") steps.push(`${s}/${t}`); };
    const png = await be.generate({ ...req, steps: 20, width: 1024, height: 768 });
    expect(steps).toHaveLength(BUILTIN_MODELS["sd-turbo"].steps.max);
    expect(steps[steps.length - 1]).toBe(`${BUILTIN_MODELS["sd-turbo"].steps.max}/${BUILTIN_MODELS["sd-turbo"].steps.max}`);
    // Die eigentliche Zusage im Titel: SD-Turbo kann nur 512² — eine Anfrage mit 1024×768
    // (kein gueltiger Eintrag in model.sizes) faellt auf die einzige erlaubte Groesse zurueck,
    // nicht auf einen ungeprueften Wert aus der Anfrage. Vorher pruefte dieser Test nur die
    // Steps-Klemmung und liess das Versprechen im eigenen Namen unbelegt (Final-Review-Fund C1).
    expect(png).toBe(`512x512:${512 * 512 * 4}`);
  });

  // C1 (Final-Review, 2026-08-24): local-engine.ts baute den Auftrag an die Engine bisher als
  // `{ prompt, steps, seed }` — `req.width`/`req.height` wurden nie uebergeben. SdxlTurboEngine
  // faellt dann IMMER auf `opts.size` zurueck (`model.sizes[0]!.width` = 512), egal was Panel,
  // Notiz, Dateiname oder Provider-API als Groesse behaupteten. Dieser Test laesst die ECHTE
  // SdxlTurboEngine ueber vier voll ausgestattete Fake-Sessions laufen (Encoder liefern
  // hidden_states.N + text_embeds, wie am echten Modell gemessen) und prueft die
  // zurueckgegebene Groesse — decodeLatents() setzt `width`/`height` direkt aus dem `size`-
  // Parameter, den `run()` uebergibt, nicht aus den (hier bedeutungslosen) VAE-Fake-Dims.
  // Gegen den Stand VOR diesem Fix schlaegt der Test fehl: `engine.generate()` bekam gar kein
  // `size`, SdxlTurboEngine haette 512×512 statt der angeforderten 1024×1024 geliefert.
  it("uebergibt die angeforderte Groesse an die Engine (SDXL-Turbo, C1-Regression)", async () => {
    const deps = makeDeps([]);
    const ROLE_BYTES = { textEncoder: 11, textEncoder2: 12, unet: 13, vaeDecoder: 14 } as const;
    const model = BUILTIN_MODELS["sdxl-turbo"];
    if (model.kind !== "sdxl") throw new Error("unreachable: sdxl-turbo ist immer kind sdxl");
    deps.store = {
      getBuffer: async (f: AssetFile) => {
        if (f.key === model.parts.textEncoder.file.key) return new ArrayBuffer(ROLE_BYTES.textEncoder);
        if (f.key === model.parts.textEncoder2.file.key) return new ArrayBuffer(ROLE_BYTES.textEncoder2);
        if (f.key === model.parts.unet.file.key) return new ArrayBuffer(ROLE_BYTES.unet);
        if (f.key === model.parts.vaeDecoder.file.key) return new ArrayBuffer(ROLE_BYTES.vaeDecoder);
        return new ArrayBuffer(1); // External-Data-Buckets: Inhalt hier irrelevant
      },
      getText: async (f: AssetFile) =>
        f.key.endsWith("/vocab") || f.key.endsWith("/vocab_2") ? JSON.stringify({ "hund</w>": 1 }) : "#version\n",
    } as unknown as ModelStore;
    const byRole: Record<string, Session> = {
      textEncoder: multiSessionOf(hiddenOutputs(13, 768)),
      textEncoder2: multiSessionOf({ ...hiddenOutputs(33, 1280), text_embeds: [1, 1280] }),
      unet: multiSessionOf({ out_sample: [1, 4, 4, 4] }),
      vaeDecoder: multiSessionOf({ sample: [1, 3, 8, 8] }),
    };
    deps.createSession = async (buf) => {
      const role = Object.entries(ROLE_BYTES).find(([, len]) => len === buf.byteLength)?.[0];
      const s = role ? byRole[role]! : byRole.vaeDecoder!; // Bucket-Aufrufe (unet.data.*) fallen hier nie an
      return s;
    };
    const be = new LocalEngineBackend(deps, model);
    const png = await be.generate({ ...req, width: 1024, height: 1024 });
    expect(png).toBe(`1024x1024:${1024 * 1024 * 4}`);
  });

  // Spec 0.9 §4a: vaeEncoder ist ein Pflichtteil, den auch der SDXL-Ladeweg mitlaedt — txt2img
  // ruft ihn nie auf (s. tests/engine-sdxl.test.ts), aber `load()` muss ihn als FUENFTE
  // ONNX-Session aufbauen, sonst wirft die Engine beim ersten img2img-Auftrag auf einen nie
  // geladenen Teil.
  it("laedt fuenf ONNX-Sessions fuer sdxl-turbo (inkl. vaeEncoder)", async () => {
    const sessionCalls: number[] = [];
    const deps = makeDeps([]);
    const ROLE_BYTES = { textEncoder: 11, textEncoder2: 12, unet: 13, vaeDecoder: 14, vaeEncoder: 15 } as const;
    const model = BUILTIN_MODELS["sdxl-turbo"];
    if (model.kind !== "sdxl") throw new Error("unreachable: sdxl-turbo ist immer kind sdxl");
    deps.store = {
      getBuffer: async (f: AssetFile) => {
        if (f.key === model.parts.textEncoder.file.key) return new ArrayBuffer(ROLE_BYTES.textEncoder);
        if (f.key === model.parts.textEncoder2.file.key) return new ArrayBuffer(ROLE_BYTES.textEncoder2);
        if (f.key === model.parts.unet.file.key) return new ArrayBuffer(ROLE_BYTES.unet);
        if (f.key === model.parts.vaeDecoder.file.key) return new ArrayBuffer(ROLE_BYTES.vaeDecoder);
        if (f.key === model.parts.vaeEncoder.file.key) return new ArrayBuffer(ROLE_BYTES.vaeEncoder);
        return new ArrayBuffer(1); // External-Data-Buckets: Inhalt hier irrelevant
      },
      getText: async (f: AssetFile) =>
        f.key.endsWith("/vocab") || f.key.endsWith("/vocab_2") ? JSON.stringify({ "hund</w>": 1 }) : "#version\n",
    } as unknown as ModelStore;
    const byRole: Record<string, Session> = {
      textEncoder: multiSessionOf(hiddenOutputs(13, 768)),
      textEncoder2: multiSessionOf({ ...hiddenOutputs(33, 1280), text_embeds: [1, 1280] }),
      unet: multiSessionOf({ out_sample: [1, 4, 4, 4] }),
      vaeDecoder: multiSessionOf({ sample: [1, 3, 8, 8] }),
      vaeEncoder: multiSessionOf({ latent_parameters: [1, 8, 4, 4] }),
    };
    deps.createSession = async (buf) => {
      sessionCalls.push(buf.byteLength);
      const role = Object.entries(ROLE_BYTES).find(([, len]) => len === buf.byteLength)?.[0];
      return role ? byRole[role]! : byRole.vaeDecoder!;
    };
    const be = new LocalEngineBackend(deps, model);
    await be.generate({ ...req, width: 1024, height: 1024 });
    expect(sessionCalls).toHaveLength(5);
    expect(sessionCalls).toContain(ROLE_BYTES.vaeEncoder);
  });

  it("dispose gibt die Sessions frei; danach lädt generate neu", async () => {
    const log: string[] = [];
    const deps = makeDeps(log);
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
    await be.generate(req);
    await be.dispose();
    expect(deps.released).toBe(4);
    expect(be.loaded).toBe(false);
    await be.dispose(); // idempotent
    expect(deps.released).toBe(4);
    await be.generate(req);
    expect(log.filter((l) => l.startsWith("session:"))).toHaveLength(8);
  });

  it("dispose während eines laufenden generate wartet das Ergebnis ab, statt die Sessions darunter wegzuziehen", async () => {
    const log: string[] = [];
    const deps = makeDeps(log);
    // UNet-Session mit Verzögerung und Protokoll: generate läuft messbar lange; release wird geloggt.
    const slowCreate = deps.createSession;
    deps.createSession = async (buf) => {
      const s = await slowCreate(buf);
      // "timestep" ist eindeutig fuer das UNet — seit dem vaeEncoder (Spec 0.9 §4a)
      // traegt auch dessen Fake-Session einen "sample"-Input, waere also mit der
      // alten Pruefung (`inputNames.includes("sample")`) faelschlich "unet" getaggt.
      const tag = s.inputNames.includes("timestep") ? "unet" : s.inputNames[0]!;
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
    expect(deps.released).toBe(4);
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
    expect(log.filter((l) => l.startsWith("session:"))).toHaveLength(4);
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

  // Spec §8 Punkt 2 — der Wachhund, den es im Code-Stand vor diesem Fix nicht gab (verloren
  // ueber zwei Engine-Umbauten). Der Punkt dieses Tests: ein Wachhund, den niemand hat feuern
  // sehen, ist ein Wachhund, von dem niemand weiss, ob er funktioniert. Echte 5 Minuten waeren
  // hier unbrauchbar — `timers` ist deshalb wie `StoreDeps.timer` injiziert, mit einer winzigen,
  // aber ECHTEN Frist (kein Fake-Timer-Mock), damit der Test dieselbe `withTimeout`-Race
  // durchlaeuft, die auch in Obsidian laeuft.
  it("meldet SessionBuildTimeout, wenn createSession niemals aufloest oder verwirft", async () => {
    const deps = makeDeps([]);
    deps.createSession = () => new Promise<Session>(() => { /* haengt absichtlich fuer immer */ });
    // Deadline fuer DIESEN Test winzig halten — nicht die Produktions-Konstante aendern:
    // loadPart() ruft `withTimeout(..., SESSION_BUILD_TIMEOUT_MS, this.timers)`, das die
    // angefragten 5 Minuten an `timers.setTimeout(fn, ms)` weiterreicht. Dieser Fake laesst die
    // Race real nach 20 ms feuern (statt echte 5 Minuten abzuwarten), zeichnet das angefragte
    // `ms` aber AUF — Review-Fund: ein Fake, der `ms` stillschweigend ignoriert, bliebe auch
    // gruen, wenn `SESSION_BUILD_TIMEOUT_MS` durch einen Tippfehler zu z.B. 5 statt 300000
    // wuerde. Die Assertion unten prueft die tatsaechlich angefragte Frist gegen die Konstante.
    const requestedMs: number[] = [];
    deps.timers = {
      setTimeout: (fn, ms) => { requestedMs.push(ms); return setTimeout(fn, 20) as unknown as number; },
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
    };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
    await expect(be.generate(reqOf("hund"))).rejects.toThrow(SessionBuildTimeout);
    expect(requestedMs).toContain(SESSION_BUILD_TIMEOUT_MS);
  });

  // Live-Smoke-Fund 2026-08-31 (Punkt 25): `load()` haengt fuer sdxl-turbo FUENF `loadPart()`-
  // Aufrufe an ein `Promise.all` — bis zu fuenf gleichzeitige `deps.createSession()`-Aufrufe.
  // Der WebGPU-EP von onnxruntime-web vertraegt aber nur EINE Session-Erzeugung zugleich:
  // `webgpuRegisterDevice` im Emscripten-Glue setzt ein Flag und wirft "another WebGPU EP
  // inference session is being created.", wenn eine zweite Erzeugung ueberlappt (Suche im
  // Bundle: node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs). Mit vier
  // Teilen ging das Rennen bisher zufaellig gut; mit dem fuenften (vaeEncoder, klein und
  // schnell erzeugt) ist es im Live-Smoke erstmals gerissen. Dieser Test zaehlt die
  // GLEICHZEITIG offenen `createSession`-Aufrufe eines echten sdxl-turbo-Ladelaufs (5 Teile)
  // und haelt fest, dass nie mehr als einer gleichzeitig offen ist. Vor dem Fix (Promise.all
  // ohne Serialisierung) steht hier 5 statt 1.
  it("serialisiert createSession-Aufrufe beim Laden — der WebGPU-EP vertraegt nur eine Erzeugung zugleich", async () => {
    const deps = makeDeps([]);
    let concurrent = 0;
    let maxConcurrent = 0;
    deps.createSession = async (buf) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // Mikro-/Makrotask-Verzoegerung: erzwingt echte Ueberlappung, falls die Aufrufe nicht
      // serialisiert werden — ohne sie koennte ein rein synchron aufloesender Fake eine
      // Race verdecken, die im echten ORT (asynchrones WASM/GPU-Setup) sehr wohl auftritt.
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return fakeSession(["sample"], "out_sample", [1, 4, 64, 64], {});
    };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sdxl-turbo"]);
    // Das generierte Bild selbst ist hier irrelevant (generische Fake-Sessions liefern keine
    // fuer SdxlTurboEngine gueltigen Ausgaben) — es geht ausschliesslich um die Reihenfolge
    // der createSession-Aufrufe waehrend load().
    await be.generate(reqOf("hund")).catch(() => undefined);
    expect(maxConcurrent).toBe(1);
  });

  // Fix-Runde 1 (Review-Fund, 2026-08-31): ein simpler Reject eines Teils darf die
  // Erzeugungs-Kette NICHT vergiften — anders als der Timeout-Fall unten haengt hier
  // `sessionPromise` nicht, sie verwirft nur. `enqueueCreate()`s eigener `.catch(() =>
  // undefined)` auf der WEITERGEREICHTEN Kette (nicht auf dem zurueckgegebenen Ergebnis) federt
  // das schon vor diesem Fix ab. Test haelt das als Regression fest: alle 5 Teile werden
  // trotz des Fehlschlags angefragt (keine der nachfolgenden Erzeugungen wird uebersprungen),
  // und ein ZWEITER load()-Versuch derselben Instanz ruft createSession erneut auf.
  it("ein fehlschlagender Teil vergiftet die Erzeugungs-Kette nicht — alle 5 Teile werden angefragt, ein zweiter Versuch startet erneut", async () => {
    const deps = makeDeps([]);
    let calls = 0;
    deps.createSession = async () => {
      calls++;
      if (calls === 2) throw new Error("Teil 2 von 5 schlaegt fehl");
      return fakeSession(["sample"], "out_sample", [1, 4, 64, 64], {});
    };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sdxl-turbo"]);
    await expect(be.generate(reqOf("hund"))).rejects.toThrow();
    expect(calls).toBe(5);
    // Zweiter Versuch derselben Instanz: keine vergiftete Kette, createSession wird erneut
    // angefragt (Zaehler waechst ueber die 5 des ersten Versuchs hinaus).
    await be.generate(reqOf("hund")).catch(() => undefined);
    expect(calls).toBeGreaterThan(5);
  });

  // Fix-Runde 1 (Critical-Review-Fund, 2026-08-31): der eigentliche Poisoning-Fall. Vor dem
  // Reset in `loadPart()`s `raced.timedOut`-Zweig blieb `this.createChain` fuer immer an das
  // NIE settelnde `sessionPromise` des historischen Ewig-Haenger-Falls gekettet — jeder
  // kuenftige `enqueueCreate()`-Aufruf auf derselben Instanz haette dann selbst nie wieder
  // einen echten `createSession()`-Aufruf ausgeloest, nur seinen eigenen Wachhund-Timer
  // ablaufen lassen. Da `main.ts` die Backend-Instanz cached (`ensureLocalEngine`), waere der
  // naheliegende Retry nach einem Timeout (Nutzer klickt erneut Generate) auf Dauer tot
  // gewesen, bis Modellwechsel oder Neustart. Ohne den Fix (Reset auskommentiert) haengt
  // dieser Test: der zweite Versuch wartet ebenfalls auf die nie settelnde erste Promise und
  // loest damit selbst wieder den (hier sehr kurzen) Wachhund aus — er wird rot mit
  // SessionBuildTimeout statt gruen mit einem fertigen Bild.
  it("nach SessionBuildTimeout ist die Erzeugungs-Kette NICHT vergiftet — ein zweiter Versuch ruft createSession erneut auf und gelingt", async () => {
    const log: string[] = [];
    const deps = makeDeps(log);
    const workingCreate = deps.createSession;
    // Erster Versuch: der historische Ewig-Haenger — `createSession` loest nie auf und
    // verwirft nie.
    deps.createSession = () => new Promise<Session>(() => { /* haengt absichtlich fuer immer */ });
    // Wie im Wachhund-Test oben: echte, aber winzige Frist statt der Produktions-Konstante.
    deps.timers = {
      setTimeout: (fn, ms) => setTimeout(fn, 20) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
    };
    const be = new LocalEngineBackend(deps, BUILTIN_MODELS["sd-turbo"]);
    await expect(be.generate(reqOf("hund"))).rejects.toThrow(SessionBuildTimeout);

    // Zweiter Versuch: funktionierender Fake. OHNE den Reset in loadPart() bliebe die Kette an
    // das haengende Promise von oben gekettet, und dieser Aufruf wuerde createSession nie
    // erreichen — der Test bliebe rot (Timeout statt Erfolg).
    deps.createSession = workingCreate;
    const before = log.filter((l) => l.startsWith("session:")).length;
    const png = await be.generate(reqOf("hund"));
    expect(png.startsWith("512x512")).toBe(true);
    expect(log.filter((l) => l.startsWith("session:")).length).toBeGreaterThan(before);
  });
});
