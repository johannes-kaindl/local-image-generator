import { describe, expect, it } from "vitest";
import { SdTurboEngine, type OrtValue, type Session } from "../src/core/engine";
import { f16ArrayToF32 } from "../src/core/pipeline/f16";
import { denoiseRaster } from "../src/core/params";
import { gaussianArray } from "../src/core/pipeline/prng";
import { makeSchedule, scaleInput } from "../src/core/pipeline/scheduler";
import type { TokenizerData } from "../src/core/pipeline/tokenizer";

const tokData: TokenizerData = { vocab: { "cat</w>": 1 }, merges: [] };

// Default-Fakes deklarieren fp16-Inputs (wie ein fp16-Export mit f16-Graph-IO);
// der f32-Fall (unsere Konversion: fp16-Gewichte, fp32-IO) hat unten einen eigenen Test.
function fakeSessions(log: string[]) {
  const textEncoder: Session = {
    inputNames: ["input_ids"],
    outputNames: ["last_hidden_state"],
    inputTypes: { input_ids: "int32" },
    run: async (feeds) => {
      log.push("text_encoder");
      expect(feeds["input_ids"]!.dims).toEqual([1, 77]);
      expect(feeds["input_ids"]!.data).toBeInstanceOf(Int32Array);
      return { last_hidden_state: { data: new Uint16Array(77 * 1024), dims: [1, 77, 1024] } };
    },
    release: async () => {},
  };
  const unet: Session = {
    inputNames: ["sample", "timestep", "encoder_hidden_states"],
    outputNames: ["out_sample"],
    inputTypes: { sample: "float16", timestep: "int64", encoder_hidden_states: "float16" },
    run: async (feeds) => {
      log.push("unet");
      expect(feeds["sample"]!.dims).toEqual([1, 4, 64, 64]);
      expect(feeds["sample"]!.data).toBeInstanceOf(Uint16Array);
      expect(feeds["timestep"]!.data).toBeInstanceOf(BigInt64Array);
      expect(feeds["encoder_hidden_states"]!.dims).toEqual([1, 77, 1024]);
      return { out_sample: { data: new Uint16Array(4 * 64 * 64), dims: [1, 4, 64, 64] } };
    },
    release: async () => {},
  };
  const vaeDecoder: Session = {
    inputNames: ["latent_sample"],
    outputNames: ["sample"],
    inputTypes: { latent_sample: "float16" },
    run: async (feeds) => {
      log.push("vae");
      expect(feeds["latent_sample"]!.dims).toEqual([1, 4, 64, 64]);
      return { sample: { data: new Uint16Array(3 * 512 * 512), dims: [1, 3, 512, 512] } };
    },
    release: async () => {},
  };
  const vaeEncoder: Session = {
    inputNames: ["sample"],
    outputNames: ["latent_parameters"],
    inputTypes: { sample: "float32" },
    run: async (feeds) => {
      log.push("vae_encoder");
      expect(feeds["sample"]!.dims).toEqual([1, 3, 512, 512]);
      // mean-Kanaele (0..3) konstant 2, logvar (4..7) konstant -20
      const p = new Float32Array(8 * 64 * 64);
      p.fill(2, 0, 4 * 64 * 64);
      p.fill(-20, 4 * 64 * 64);
      return { latent_parameters: { data: p, dims: [1, 8, 64, 64] } };
    },
    release: async () => {},
  };
  return { textEncoder, unet, vaeDecoder, vaeEncoder };
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
  it("txt2img (kein initPixels) ruft den vae_encoder NICHT auf", async () => {
    const log: string[] = [];
    const engine = new SdTurboEngine(fakeSessions(log), tokData);
    await engine.generate({ prompt: "cat", steps: 2, seed: 5 });
    expect(log).not.toContain("vae_encoder");
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
    sessions.unet = { inputNames: ["sample", "timestep", "encoder_hidden_states"], outputNames: ["out_sample"], inputTypes: {}, run: async () => { throw new Error("OOM"); }, release: async () => {} };
    const engine = new SdTurboEngine(sessions, tokData);
    await expect(engine.generate({ prompt: "cat", steps: 1, seed: 1 })).rejects.toThrow("OOM");
    expect(engine.busy).toBe(false);
  });
  it("deterministisch: gleicher Seed → identische Latent-Feeds", async () => {
    const seen: number[][] = [];
    const capture = (): Session => ({
      inputNames: ["sample", "timestep", "encoder_hidden_states"],
      outputNames: ["out_sample"],
      inputTypes: { sample: "float16", timestep: "int64", encoder_hidden_states: "float16" },
      run: async (feeds) => {
        seen.push(Array.from((feeds["sample"]!.data as Uint16Array).slice(0, 8)));
        return { out_sample: { data: new Uint16Array(4 * 64 * 64), dims: [1, 4, 64, 64] } };
      },
      release: async () => {},
    });
    for (let i = 0; i < 2; i++) {
      const s = fakeSessions([]);
      s.unet = capture();
      await new SdTurboEngine(s, tokData).generate({ prompt: "cat", steps: 1, seed: 42 });
    }
    expect(seen[0]).toEqual(seen[1]);
  });
  it("deterministisch über den Ancestral-Pfad: 2. Step-Sample gleich bei gleichem Seed", async () => {
    // Pinnt gaussianArray(seed+1000+i)-Determinismus DURCH den Scheduler: der
    // sample-Feed des ZWEITEN Steps hängt vom Ancestral-Noise des ersten ab.
    const secondStepFeeds: number[][] = [];
    const capture = (): Session => {
      let step = 0;
      return {
        inputNames: ["sample", "timestep", "encoder_hidden_states"],
        outputNames: ["out_sample"],
        inputTypes: { sample: "float16", timestep: "int64", encoder_hidden_states: "float16" },
        run: async (feeds) => {
          if (step === 1) secondStepFeeds.push(Array.from(feeds["sample"]!.data as Uint16Array));
          step++;
          return { out_sample: { data: new Uint16Array(4 * 64 * 64), dims: [1, 4, 64, 64] } };
        },
        release: async () => {},
      };
    };
    for (let i = 0; i < 2; i++) {
      const s = fakeSessions([]);
      s.unet = capture();
      await new SdTurboEngine(s, tokData).generate({ prompt: "cat", steps: 2, seed: 7 });
    }
    expect(secondStepFeeds).toHaveLength(2);
    expect(secondStepFeeds[0]).toEqual(secondStepFeeds[1]);
  });
  it("float32-IO-Modell (eigene Konversion, keep_io_types): Feeds als Float32Array, ids als int64", async () => {
    // Regressionstest für den Smoke-Test-Fehler 2026-07-16: "Unexpected input
    // data type. Actual: (tensor(float16)), expected: (tensor(float))" — die
    // Engine muss sich nach den deklarierten Input-Typen richten.
    const textEncoder: Session = {
      inputNames: ["input_ids"],
      outputNames: ["last_hidden_state"],
      inputTypes: { input_ids: "int64" },
      run: async (feeds) => {
        expect(feeds["input_ids"]!.data).toBeInstanceOf(BigInt64Array);
        return { last_hidden_state: { data: new Float32Array(77 * 1024), dims: [1, 77, 1024] } };
      },
      release: async () => {},
    };
    const unet: Session = {
      inputNames: ["sample", "timestep", "encoder_hidden_states"],
      outputNames: ["out_sample"],
      inputTypes: { sample: "float32", timestep: "int64", encoder_hidden_states: "float32" },
      run: async (feeds) => {
        expect(feeds["sample"]!.data).toBeInstanceOf(Float32Array);
        expect(feeds["encoder_hidden_states"]!.data).toBeInstanceOf(Float32Array);
        expect(feeds["timestep"]!.data).toBeInstanceOf(BigInt64Array);
        return { out_sample: { data: new Float32Array(4 * 64 * 64), dims: [1, 4, 64, 64] } };
      },
      release: async () => {},
    };
    const vaeDecoder: Session = {
      inputNames: ["latent_sample"],
      outputNames: ["sample"],
      inputTypes: { latent_sample: "float32" },
      run: async (feeds) => {
        expect(feeds["latent_sample"]!.data).toBeInstanceOf(Float32Array);
        return { sample: { data: new Float32Array(3 * 512 * 512), dims: [1, 3, 512, 512] } };
      },
      release: async () => {},
    };
    const vaeEncoder: Session = {
      inputNames: ["sample"],
      outputNames: ["latent_parameters"],
      inputTypes: { sample: "float32" },
      run: async () => ({ latent_parameters: { data: new Float32Array(8 * 64 * 64), dims: [1, 8, 64, 64] } }),
      release: async () => {},
    };
    const engine = new SdTurboEngine({ textEncoder, unet, vaeDecoder, vaeEncoder }, tokData);
    const res = await engine.generate({ prompt: "cat", steps: 1, seed: 3 });
    expect(res.rgba.length).toBe(512 * 512 * 4);
  });
  it("img2img (initPixels+denoising) ruft den vae_encoder GENAU EINMAL und das UNet nur ab dem Einstiegspunkt", async () => {
    const log: string[] = [];
    const engine = new SdTurboEngine(fakeSessions(log), tokData);
    const steps = 4;
    const denoising = 0.5;
    await engine.generate({
      prompt: "cat",
      steps,
      seed: 9,
      initPixels: new Float32Array(3 * 512 * 512),
      denoising,
    });
    expect(log.filter((l) => l === "vae_encoder")).toHaveLength(1);
    const { tStart } = denoiseRaster(steps, denoising);
    expect(tStart).toBe(2); // gemessen: denoiseRaster(4, 0.5) → Einstieg beim 3. von 4 Schritten
    expect(log.filter((l) => l === "unet")).toHaveLength(steps - tStart);
  });
  it("img2img: Start-Latents entsprechen dem verrauschten Vorlagen-Latent am Einstiegspunkt (f16-Toleranz)", async () => {
    const seenFirstSample: Float32Array[] = [];
    const s = fakeSessions([]);
    const baseUnetRun = s.unet.run;
    s.unet = {
      ...s.unet,
      run: async (feeds) => {
        seenFirstSample.push(f16ArrayToF32(feeds["sample"]!.data as Uint16Array));
        return baseUnetRun(feeds);
      },
    };
    const engine = new SdTurboEngine(s, tokData);
    const steps = 4;
    const denoising = 0.5;
    const seed = 9;
    await engine.generate({
      prompt: "cat",
      steps,
      seed,
      initPixels: new Float32Array(3 * 512 * 512),
      denoising,
    });
    const { tStart } = denoiseRaster(steps, denoising);
    const schedule = makeSchedule(steps);
    const sigma = schedule.sigmas[tStart]!;
    const noise0 = gaussianArray(seed, 1)[0]!;
    const expected = scaleInput(new Float32Array([2 * 0.18215 + noise0 * sigma]), sigma)[0]!;
    expect(seenFirstSample[0]![0]).toBeCloseTo(expected, 2);
  });
  it("dispose ruft release auf allen vier Sessions auf (idempotent)", async () => {
    const released: string[] = [];
    const s = fakeSessions([]);
    s.textEncoder = { ...s.textEncoder, release: async () => void released.push("text_encoder") };
    s.unet = { ...s.unet, release: async () => void released.push("unet") };
    s.vaeDecoder = { ...s.vaeDecoder, release: async () => void released.push("vae_decoder") };
    s.vaeEncoder = { ...s.vaeEncoder, release: async () => void released.push("vae_encoder") };
    const engine = new SdTurboEngine(s, tokData);
    await engine.dispose();
    expect(released.sort()).toEqual(["text_encoder", "unet", "vae_decoder", "vae_encoder"]);
    await engine.dispose(); // idempotent: kein zweiter release-Aufruf
    expect(released.sort()).toEqual(["text_encoder", "unet", "vae_decoder", "vae_encoder"]);
  });
  it("skalarer timestep (shape [] im Export, eigene Konversion 2026-08-19): dims [] und float32", async () => {
    const seen: { dims: readonly number[]; data: unknown }[] = [];
    const base = fakeSessions([]);
    const unet: Session = {
      ...base.unet,
      inputTypes: { sample: "float32", timestep: "float32", encoder_hidden_states: "float32" },
      inputShapes: { sample: ["batch_size", 4, "height", "width"], timestep: [], encoder_hidden_states: ["batch_size", "sequence_length", 1024] },
      run: async (feeds) => {
        seen.push({ dims: feeds["timestep"]!.dims, data: feeds["timestep"]!.data });
        return { out_sample: { data: new Float32Array(4 * 64 * 64), dims: [1, 4, 64, 64] } };
      },
    };
    const engine = new SdTurboEngine({ ...base, unet }, tokData);
    await engine.generate({ prompt: "cat", steps: 1, seed: 1 });
    expect(seen[0]!.dims).toEqual([]);
    expect(seen[0]!.data).toBeInstanceOf(Float32Array);
    expect((seen[0]!.data as Float32Array).length).toBe(1);
  });
  it("ohne inputShapes bleibt timestep dims [1] (0.4-Exporte)", async () => {
    const seen: (readonly number[])[] = [];
    const base = fakeSessions([]);
    const unet: Session = { ...base.unet, run: async (feeds) => { seen.push(feeds["timestep"]!.dims); return { out_sample: { data: new Uint16Array(4 * 64 * 64), dims: [1, 4, 64, 64] } }; } };
    await new SdTurboEngine({ ...base, unet }, tokData).generate({ prompt: "cat", steps: 1, seed: 1 });
    expect(seen[0]).toEqual([1]);
  });
});
