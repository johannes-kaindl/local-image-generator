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
