import { describe, expect, it } from "vitest";
import { SdTurboEngine, type OrtValue, type Session } from "../src/core/engine";
import type { TokenizerData } from "../src/core/pipeline/tokenizer";

const tokData: TokenizerData = { vocab: { "cat</w>": 1 }, merges: [] };

// Default-Fakes deklarieren fp16-Inputs (wie ein fp16-Export mit f16-Graph-IO);
// der f32-Fall (realer schmuell-Export) hat unten einen eigenen Test.
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
  it("float32-Modell (realer schmuell-Export): Feeds als Float32Array, ids als int64", async () => {
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
    const engine = new SdTurboEngine({ textEncoder, unet, vaeDecoder }, tokData);
    const res = await engine.generate({ prompt: "cat", steps: 1, seed: 3 });
    expect(res.rgba.length).toBe(512 * 512 * 4);
  });
  it("dispose ruft release auf allen drei Sessions (idempotent)", async () => {
    const released: string[] = [];
    const s = fakeSessions([]);
    s.textEncoder = { ...s.textEncoder, release: async () => void released.push("text_encoder") };
    s.unet = { ...s.unet, release: async () => void released.push("unet") };
    s.vaeDecoder = { ...s.vaeDecoder, release: async () => void released.push("vae_decoder") };
    const engine = new SdTurboEngine(s, tokData);
    await engine.dispose();
    expect(released.sort()).toEqual(["text_encoder", "unet", "vae_decoder"]);
    await engine.dispose(); // idempotent: kein zweiter release-Aufruf
    expect(released.sort()).toEqual(["text_encoder", "unet", "vae_decoder"]);
  });
});
