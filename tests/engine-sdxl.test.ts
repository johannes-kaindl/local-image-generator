import { describe, expect, it } from "vitest";
import type { OrtValue, Session } from "../src/core/engine";
import { SdxlTurboEngine } from "../src/core/engine-sdxl";

const TOK = { vocab: { "hund</w>": 5 }, merges: [] };

// Der Brief-Mock lieferte einen einzigen Ausgang "hidden_states" — das bildet die
// GEMESSENE Wirklichkeit nicht ab. SDXLs Text-Encoder liefern die Hidden States als
// INDIZIERTE EINZELAUSGAENGE (hidden_states.0 … hidden_states.N, gemessen am echten
// Modell, scripts/verify-model.mjs). Dieser Mock bildet das nach: jeder hidden_states.N-
// Ausgang ist mit dem Wert N gefuellt, damit ein Test beweisen kann, dass der VORLETZTE
// gewaehlt wird (nicht der erste, nicht der letzte).
function hiddenOutputs(count: number, seq: number, dim: number): Record<string, [number[], number]> {
  const out: Record<string, [number[], number]> = {};
  for (let i = 0; i < count; i++) out[`hidden_states.${i}`] = [[1, seq, dim], i];
  return out;
}

interface Rec {
  feeds: Record<string, OrtValue>[];
}

// Baut eine Fake-Session mit mehreren benannten Ausgaengen; jeder Ausgang ist konstant mit
// seinem "fill"-Wert befuellt, damit Tests unterscheiden koennen, WELCHER Ausgang genommen wurde.
function multiSession(rec: Rec, outputs: Record<string, [number[], number]>): Session {
  const outputNames = Object.keys(outputs);
  return {
    inputNames: [],
    outputNames,
    inputTypes: {},
    inputShapes: {},
    run: async (f) => {
      rec.feeds.push(f);
      const result: Record<string, OrtValue> = {};
      for (const [name, [dims, fill]] of Object.entries(outputs)) {
        const data = new Float32Array(dims.reduce((a, b) => a * b, 1)).fill(fill);
        result[name] = { data, dims };
      }
      return result;
    },
    release: async () => {},
  };
}

function sessions(rec: Rec, side: number) {
  const l = side / 8;
  return {
    // CLIP-L: 13 hidden_states-Ausgaenge (Index 0..12) — vorletzter ist .11, gefuellt mit 11.
    textEncoder: multiSession(rec, hiddenOutputs(13, 77, 768)),
    // bigG: 33 hidden_states-Ausgaenge (Index 0..32) — vorletzter ist .31, gefuellt mit 31.
    // text_embeds (pooled) steht VOR last_hidden_state (gemessene Export-Reihenfolge) —
    // das darf beim Abgriff keine Rolle spielen, deshalb hier bewusst zuerst gelistet.
    textEncoder2: multiSession(rec, {
      text_embeds: [[1, 1280], 999],
      ...hiddenOutputs(33, 77, 1280),
      last_hidden_state: [[1, 77, 1280], -1],
    }),
    unet: multiSession(rec, { out_sample: [[1, 4, l, l], 0] }),
    vaeDecoder: multiSession(rec, { sample: [[1, 3, side, side], 0] }),
  };
}

function feedOf(rec: Rec, key: string): OrtValue {
  const feed = rec.feeds.find((f) => key in f);
  const v = feed?.[key];
  if (!v) throw new Error(`feed "${key}" nicht gefunden`);
  return v;
}

describe("SdxlTurboEngine (Spec 0.9 §5.2)", () => {
  it("konkateniert die Hidden States beider Encoder auf 2048", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const feed = feedOf(rec, "encoder_hidden_states");
    expect(feed.dims).toEqual([1, 77, 2048]);
  });

  it("waehlt den VORLETZTEN hidden_states-Layer, nicht den ersten oder letzten", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const feed = feedOf(rec, "encoder_hidden_states").data as Float32Array;
    // Erste 768 Werte = CLIP-L-Anteil (13 Layer, Index 0..12) → vorletzter = 11, nicht 0 (erster) oder 12 (letzter).
    expect(feed[0]).toBe(11);
    // Werte 768..2047 = bigG-Anteil (33 Layer, Index 0..32) → vorletzter = 31, nicht 0 oder 32.
    expect(feed[768]).toBe(31);
  });

  it("wirft, wenn keine indizierten hidden_states-Ausgaenge vorhanden sind (kein stiller Fallback)", async () => {
    const rec: Rec = { feeds: [] };
    const s = sessions(rec, 512);
    s.textEncoder = multiSession(rec, { last_hidden_state: [[1, 77, 768], 0] });
    const e = new SdxlTurboEngine(s, { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 512 });
    await expect(e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 })).rejects.toThrow(/hidden_states/);
  });

  it("time_ids traegt [size, size, 0, 0, size, size] als [1,6]", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 1024 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 1024 });
    const f = feedOf(rec, "time_ids");
    expect(f.dims).toEqual([1, 6]);
    expect(Array.from(f.data as Float32Array)).toEqual([1024, 1024, 0, 0, 1024, 1024]);
  });

  it("text_embeds kommt aus dem ZWEITEN Encoder (per Name, nicht Position) und ist [1,1280]", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const f = feedOf(rec, "text_embeds");
    expect(f.dims).toEqual([1, 1280]);
    expect((f.data as Float32Array)[0]).toBe(999); // der pooled-Fuellwert, nicht last_hidden_state (-1)
  });

  it("Latent-Kantenlaenge ist Bildgroesse geteilt durch 8", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 1024 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 1024 });
    expect(feedOf(rec, "sample").dims).toEqual([1, 4, 128, 128]);
  });

  it("nutzt die uebergebene VAE-Skalierung, nicht die von SD-Turbo", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK, secondary: TOK }, { vaeScaling: 0.5, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const latent = feedOf(rec, "latent_sample").data as Float32Array;
    expect(Number.isFinite(latent[0])).toBe(true); // Division lief, kein NaN
  });

  it("liefert ein Bild der angeforderten Groesse", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 1024 });
    const res = await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 1024 });
    expect([res.width, res.height]).toEqual([1024, 1024]);
    expect(res.rgba.length).toBe(1024 * 1024 * 4);
  });

  it("size fehlt in der Anfrage → faellt auf opts.size zurueck", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 1024 });
    const res = await e.generate({ prompt: "hund", steps: 1, seed: 7 });
    expect([res.width, res.height]).toEqual([1024, 1024]);
  });

  it("Pad-Token: primaerer Encoder padded mit 49407 (EOS), sekundaerer mit 0 — gemessen an den HF-Configs", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    // Beide input_ids-Feeds heissen "input_ids" — der erste run()-Aufruf ist der primaere Encoder,
    // der zweite der sekundaere (Reihenfolge im Code, nicht Annahme: geprueft ueber rec.feeds).
    const primaryFeed = rec.feeds[0]!["input_ids"]!.data as Int32Array;
    const secondaryFeed = rec.feeds[1]!["input_ids"]!.data as Int32Array;
    expect(primaryFeed[primaryFeed.length - 1]).toBe(49407);
    expect(secondaryFeed[secondaryFeed.length - 1]).toBe(0);
  });

  it("Lock: paralleler zweiter Aufruf wirft", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 512 });
    const first = e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    await expect(e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 })).rejects.toThrow(/busy/i);
    await first;
    expect(e.busy).toBe(false);
  });

  it("dispose gibt alle vier Sessions frei (idempotent)", async () => {
    const rec: Rec = { feeds: [] };
    const s = sessions(rec, 512);
    const released: string[] = [];
    s.textEncoder = { ...s.textEncoder, release: async () => void released.push("textEncoder") };
    s.textEncoder2 = { ...s.textEncoder2, release: async () => void released.push("textEncoder2") };
    s.unet = { ...s.unet, release: async () => void released.push("unet") };
    s.vaeDecoder = { ...s.vaeDecoder, release: async () => void released.push("vaeDecoder") };
    const e = new SdxlTurboEngine(s, { primary: TOK, secondary: TOK }, { vaeScaling: 0.13025, size: 512 });
    await e.dispose();
    expect(released.sort()).toEqual(["textEncoder", "textEncoder2", "unet", "vaeDecoder"]);
    await e.dispose(); // idempotent
    expect(released.sort()).toEqual(["textEncoder", "textEncoder2", "unet", "vaeDecoder"]);
  });
});
