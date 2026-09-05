import { describe, expect, it } from "vitest";
import type { OrtValue, Session } from "../src/core/engine";
import { SdxlTurboEngine } from "../src/core/engine-sdxl";
import { denoiseRaster } from "../src/core/params";
import { gaussianArray } from "../src/core/pipeline/prng";
import { denoiseEntry, makeSchedule, scaleInput } from "../src/core/pipeline/scheduler";

// Zwei UNTERSCHIEDLICHE Vokabulare statt eines geteilten TOK-Objekts (Review-Finding): mit
// einem einzigen Objekt fuer primary/secondary wuerde nichts auffallen, wenn die beiden
// TokenizerData vertauscht an die Encoder gehen. "hund" zerlegt sich ohne Merges in die
// Zeichen h/u/n/d</w> (BPE-Fallback ohne Merge-Regeln) — jedes Vokabular bildet ALLE vier
// auf denselben, aber vokabular-eigenen Wert ab, damit ein Test unabhaengig vom Pad-Wert
// pruefen kann, welcher Encoder welches Vokabular bekam.
const TOK_PRIMARY = { vocab: { h: 501, u: 501, n: 501, "d</w>": 501, "hund</w>": 5 }, merges: [] };
const TOK_SECONDARY = { vocab: { h: 902, u: 902, n: 902, "d</w>": 902, "hund</w>": 9 }, merges: [] };

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

// img2img (Spec 0.9 §4a): Encoder-Fake mit size/8-Dims — analog zum SD-Turbo-Fake in
// tests/engine.test.ts, aber mit der pro `side` skalierten Latent-Kantenlaenge.
function vaeEncoderSession(rec: Rec, side: number, log?: string[]): Session {
  const l = side / 8;
  return {
    inputNames: ["sample"],
    outputNames: ["latent_parameters"],
    inputTypes: { sample: "float32" },
    run: async (feeds) => {
      log?.push("vae_encoder");
      rec.feeds.push(feeds);
      expect(feeds["sample"]!.dims).toEqual([1, 3, side, side]);
      // mean-Kanaele (0..3) konstant 2, logvar (4..7) konstant -20
      const p = new Float32Array(8 * l * l);
      p.fill(2, 0, 4 * l * l);
      p.fill(-20, 4 * l * l);
      return { latent_parameters: { data: p, dims: [1, 8, l, l] } };
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
    // text_embeds (pooled) steht NICHT an erster Stelle (Review-Finding: ein Mock mit
    // text_embeds als erstem Key wuerde eine Positions-Implementierung
    // `outputs[outputNames[0]]` faelschlich bestehen lassen) — hier bewusst NACH allen
    // hidden_states.N und VOR last_hidden_state gelistet, exakt wie am echten Modell
    // gemessen (text_embeds vor last_hidden_state, aber nicht an Position 0).
    textEncoder2: multiSession(rec, {
      ...hiddenOutputs(33, 77, 1280),
      text_embeds: [[1, 1280], 999],
      last_hidden_state: [[1, 77, 1280], -1],
    }),
    unet: multiSession(rec, { out_sample: [[1, 4, l, l], 0] }),
    vaeDecoder: multiSession(rec, { sample: [[1, 3, side, side], 0] }),
    vaeEncoder: vaeEncoderSession(rec, side),
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
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const feed = feedOf(rec, "encoder_hidden_states");
    expect(feed.dims).toEqual([1, 77, 2048]);
  });

  it("waehlt den VORLETZTEN hidden_states-Layer, nicht den ersten oder letzten", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
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
    const e = new SdxlTurboEngine(s, { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await expect(e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 })).rejects.toThrow(/hidden_states/);
  });

  it("time_ids traegt [size, size, 0, 0, size, size] als [1,6]", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 1024 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 1024 });
    const f = feedOf(rec, "time_ids");
    expect(f.dims).toEqual([1, 6]);
    expect(Array.from(f.data as Float32Array)).toEqual([1024, 1024, 0, 0, 1024, 1024]);
  });

  it("text_embeds kommt aus dem ZWEITEN Encoder (per Name, nicht Position) und ist [1,1280]", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const f = feedOf(rec, "text_embeds");
    expect(f.dims).toEqual([1, 1280]);
    expect((f.data as Float32Array)[0]).toBe(999); // der pooled-Fuellwert, nicht last_hidden_state (-1)
  });

  it("Latent-Kantenlaenge ist Bildgroesse geteilt durch 8", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 1024 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 1024 });
    expect(feedOf(rec, "sample").dims).toEqual([1, 4, 128, 128]);
  });

  it("nutzt die uebergebene VAE-Skalierung, nicht die von SD-Turbo — pinnt Parameter UND Richtung", async () => {
    // Der vorherige Test pruefte nur Number.isFinite(latent[0]) — das bleibt gruen, wenn
    // opts.vaeScaling ignoriert, 0.18215 hartcodiert oder MULTIPLIZIERT statt dividiert
    // wird (Review-Finding). Diese Fassung laesst denselben Prompt/Seed durch zwei
    // Engines mit unterschiedlicher vaeScaling laufen: latent_sample = latents / vaeScaling
    // — eine Halbierung von vaeScaling (0.5 → 0.25) muss den Feed-Wert exakt VERDOPPELN.
    // Ohne Zutun eines Zufallsseeds sind die latents vor der VAE-Skalierung bei gleichem
    // Prompt/Seed/UNet-Mock bit-identisch — der Faktor 2 kommt einzig aus vaeScaling.
    const recHalf: Rec = { feeds: [] };
    const recQuarter: Rec = { feeds: [] };
    const eHalf = new SdxlTurboEngine(sessions(recHalf, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.5, size: 512 });
    const eQuarter = new SdxlTurboEngine(sessions(recQuarter, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.25, size: 512 });
    await eHalf.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    await eQuarter.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const latentHalf = feedOf(recHalf, "latent_sample").data as Float32Array;
    const latentQuarter = feedOf(recQuarter, "latent_sample").data as Float32Array;
    expect(latentHalf.length).toBe(latentQuarter.length);
    expect(latentHalf.length).toBeGreaterThan(0);
    for (let i = 0; i < latentHalf.length; i++) {
      expect(latentQuarter[i]).toBeCloseTo(latentHalf[i]! * 2, 5);
    }
  });

  it("liefert ein Bild der angeforderten Groesse", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 1024 });
    const res = await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 1024 });
    expect([res.width, res.height]).toEqual([1024, 1024]);
    expect(res.rgba.length).toBe(1024 * 1024 * 4);
  });

  it("size fehlt in der Anfrage → faellt auf opts.size zurueck", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 1024 });
    const res = await e.generate({ prompt: "hund", steps: 1, seed: 7 });
    expect([res.width, res.height]).toEqual([1024, 1024]);
  });

  it("Pad-Token: primaerer Encoder padded mit 49407 (EOS), sekundaerer mit 0 — gemessen an den HF-Configs", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    // Beide input_ids-Feeds heissen "input_ids" — der erste run()-Aufruf ist der primaere Encoder,
    // der zweite der sekundaere (Reihenfolge im Code, nicht Annahme: geprueft ueber rec.feeds).
    const primaryFeed = rec.feeds[0]!["input_ids"]!.data as Int32Array;
    const secondaryFeed = rec.feeds[1]!["input_ids"]!.data as Int32Array;
    expect(primaryFeed[primaryFeed.length - 1]).toBe(49407);
    expect(secondaryFeed[secondaryFeed.length - 1]).toBe(0);
  });

  it("jeder Encoder bekommt sein EIGENES Vokabular — vertauschte TokenizerData faellt auf", async () => {
    // Der Pad-Token-Test oben unterscheidet die Encoder nur ueber die hartcodierten
    // Pad-Konstanten der Engine (49407/0) — die haengen NICHT von den uebergebenen
    // TokenizerData ab, ein Vertauschen von primary/secondary wuerde also unbemerkt
    // bleiben (Review-Finding). Dieser Test prueft den tatsaechlichen VOKABULAR-Inhalt:
    // TOK_PRIMARY bildet "hund" auf 501 ab, TOK_SECONDARY auf 902 (siehe Modul-Kommentar).
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    const primaryIds = Array.from(rec.feeds[0]!["input_ids"]!.data as Int32Array);
    const secondaryIds = Array.from(rec.feeds[1]!["input_ids"]!.data as Int32Array);
    expect(primaryIds).toContain(501);
    expect(primaryIds).not.toContain(902);
    expect(secondaryIds).toContain(902);
    expect(secondaryIds).not.toContain(501);
  });

  it("Lock: paralleler zweiter Aufruf wirft", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    const first = e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    await expect(e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 })).rejects.toThrow(/busy/i);
    await first;
    expect(e.busy).toBe(false);
  });

  it("dispose gibt alle fuenf Sessions frei, inkl. vaeEncoder (idempotent)", async () => {
    const rec: Rec = { feeds: [] };
    const s = sessions(rec, 512);
    const released: string[] = [];
    s.textEncoder = { ...s.textEncoder, release: async () => void released.push("textEncoder") };
    s.textEncoder2 = { ...s.textEncoder2, release: async () => void released.push("textEncoder2") };
    s.unet = { ...s.unet, release: async () => void released.push("unet") };
    s.vaeDecoder = { ...s.vaeDecoder, release: async () => void released.push("vaeDecoder") };
    s.vaeEncoder = { ...s.vaeEncoder, release: async () => void released.push("vaeEncoder") };
    const e = new SdxlTurboEngine(s, { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await e.dispose();
    expect(released.sort()).toEqual(["textEncoder", "textEncoder2", "unet", "vaeDecoder", "vaeEncoder"].sort());
    await e.dispose(); // idempotent
    expect(released.sort()).toEqual(["textEncoder", "textEncoder2", "unet", "vaeDecoder", "vaeEncoder"].sort());
  });

  it("txt2img (kein initPixels) ruft den vaeEncoder NICHT auf", async () => {
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 512), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await e.generate({ prompt: "hund", steps: 1, seed: 7, size: 512 });
    // vaeEncoder-Feed traegt NUR "sample" (kein "timestep") — eindeutig vom UNet-Feed
    // unterscheidbar, das zusaetzlich "timestep" traegt (runDiffusion).
    const encoderCalls = rec.feeds.filter((f) => "sample" in f && !("timestep" in f));
    expect(encoderCalls).toHaveLength(0);
  });

  it("img2img (initPixels+denoising, Groesse 1024) ruft den vaeEncoder GENAU EINMAL mit der ANGEFORDERTEN Groesse und das UNet nur ab dem Einstiegspunkt", async () => {
    // Review-Fund F2 (Teil a): size=512 in der urspruenglichen Fassung dieses Tests deckte
    // sich zufaellig mit SdTurboEngine's fest verdrahteter IMAGE_SIZE-Konstante — eine
    // Mutation von encodeInitImage(..., size, vaeScaling) zu (..., 512, 0.18215) waere HIER
    // unbemerkt geblieben. Mit size=1024 prueft der vaeEncoder-Fake (`vaeEncoderSession`)
    // die Feed-Dims [1,3,1024,1024] und liefert latent_parameters in [1,8,128,128] — eine
    // hartcodierte 512 in engine-sdxl.ts wuerde die Dims-Assertion im Fake sofort verfehlen.
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(sessions(rec, 1024), { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 1024 });
    const steps = 4;
    const denoising = 0.5;
    await e.generate({
      prompt: "hund",
      steps,
      seed: 7,
      size: 1024,
      initPixels: new Float32Array(3 * 1024 * 1024),
      denoising,
    });
    // vaeEncoder-Feed traegt NUR "sample" (kein "timestep") — eindeutig vom UNet-Feed
    // unterscheidbar, das zusaetzlich "timestep" traegt (runDiffusion).
    const encoderCalls = rec.feeds.filter((f) => "sample" in f && !("timestep" in f));
    expect(encoderCalls).toHaveLength(1);
    expect(encoderCalls[0]!["sample"]!.dims).toEqual([1, 3, 1024, 1024]);
    const unetCalls = rec.feeds.filter((f) => "timestep" in f);
    const { tStart } = denoiseRaster(steps, denoising);
    expect(unetCalls).toHaveLength(steps - tStart);
  });

  it("img2img: Start-Latents tragen SDXLs EIGENE vaeScaling (0.13025), nicht SD-Turbos 0.18215 (F2, Teil b)", async () => {
    // Review-Fund F2 (Teil b): eine Mutation von encodeInitImage(vaeEncoder, pixels, size,
    // this.opts.vaeScaling) zu (..., 0.18215) hardcodiert liesse alle bisherigen sdxl-Tests
    // gruen — keiner rechnet die Start-Latent-Mathematik unabhaengig nach. Diese Erwartung ist
    // bewusst OHNE Bezug auf engine-sdxl.ts komponiert (kein Aufruf von encodeInitImage/
    // noisedInitLatents aus dem Produktionscode): mean (2, aus dem Fake) * vaeScaling (0.13025,
    // NICHT SD-Turbos 0.18215) + Ancestral-Noise * sigma am Einstiegspunkt.
    const rec: Rec = { feeds: [] };
    const side = 512;
    const s = sessions(rec, side);
    const seenFirstSample: Float32Array[] = [];
    const baseUnetRun = s.unet.run;
    s.unet = {
      ...s.unet,
      run: async (feeds) => {
        seenFirstSample.push(new Float32Array(feeds["sample"]!.data as Float32Array));
        return baseUnetRun(feeds);
      },
    };
    const steps = 4;
    const denoising = 0.5;
    const seed = 9;
    const vaeScaling = 0.13025;
    const e = new SdxlTurboEngine(s, { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling, size: side });
    await e.generate({
      prompt: "hund",
      steps,
      seed,
      size: side,
      initPixels: new Float32Array(3 * side * side),
      denoising,
    });
    const { tStart } = denoiseRaster(steps, denoising);
    const schedule = makeSchedule(steps);
    const sigma = schedule.sigmas[tStart]!;
    const noise0 = gaussianArray(seed, 1)[0]!;
    const expected = scaleInput(new Float32Array([2 * vaeScaling + noise0 * sigma]), sigma)[0]!;
    expect(seenFirstSample[0]![0]).toBeCloseTo(expected, 4);
  });

  // Nachlese 0.9.0: beide Wuerfe waren ungetestet. Sie sind die Umsetzung der
  // Wirf-nicht-verschlechtere-Doktrin dieses Moduls (wie `pickHidden`): ein falscher Rang oder
  // zwei ungleiche seq-Laengen wuerden sonst still ein schlechteres Bild erzeugen statt eines
  // Fehlers — und ein stiller Qualitaetsverlust ist genau das, was hier niemand merken wuerde.
  it("wirft, wenn ein hidden_states-Ausgang nicht Rang 3 hat, statt still 0 zu ergaenzen", async () => {
    const rec: Rec = { feeds: [] };
    const s = sessions(rec, 512);
    // Rang 2 statt 3 — der vorletzte Ausgang des ERSTEN Encoders, also genau der genommene.
    s.textEncoder = multiSession(rec, { ...hiddenOutputs(13, 77, 768), "hidden_states.11": [[77, 768], 11] });
    const e = new SdxlTurboEngine(s, { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await expect(e.generate({ prompt: "hund", steps: 1, seed: 1, size: 512 })).rejects.toThrow(/Rang 3/);
  });

  it("wirft, wenn die seq-Laengen der beiden Encoder auseinanderlaufen", async () => {
    const rec: Rec = { feeds: [] };
    const s = sessions(rec, 512);
    // 64 statt 77 beim ZWEITEN Encoder: `concatLastDim` bekaeme sonst zwei unvereinbare
    // Laengen und liefe ueber den kuerzeren — ein halb gefuellter Kontext ohne Fehlerbild.
    s.textEncoder2 = multiSession(rec, {
      ...hiddenOutputs(33, 64, 1280),
      text_embeds: [[1, 1280], 999],
      last_hidden_state: [[1, 64, 1280], -1],
    });
    const e = new SdxlTurboEngine(s, { primary: TOK_PRIMARY, secondary: TOK_SECONDARY }, { vaeScaling: 0.13025, size: 512 });
    await expect(e.generate({ prompt: "hund", steps: 1, seed: 1, size: 512 })).rejects.toThrow(/seq-Laenge weicht/);
  });

  it("img2img ersetzt den Folgen-Eintrag, nicht nur das Init-Latent", async () => {
    const steps = 4;
    const denoising = 0.625;
    const sched = makeSchedule(steps);
    const erwartet = denoiseEntry(steps, denoising, sched.sigmas, sched.timesteps);

    // Muster der SDXL-Testdatei: `sessions(rec, side)` zeichnet alle Feeds in `rec.feeds`
    // auf, `feedOf(rec, key)` holt den ERSTEN Feed mit diesem Namen — also genau den des
    // ersten UNet-Aufrufs. Kein eigener Spion noetig.
    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(
      sessions(rec, 512),
      { primary: TOK_PRIMARY, secondary: TOK_SECONDARY },
      { vaeScaling: 0.13025, size: 512 },
    );
    await e.generate({
      prompt: "cat", steps, seed: 9, size: 512,
      initPixels: new Float32Array(3 * 512 * 512), denoising,
    });

    const gesehen = Number((feedOf(rec, "timestep").data as BigInt64Array)[0]);
    expect(gesehen).toBe(erwartet.timestep);
    expect(gesehen).not.toBe(sched.timesteps[erwartet.startAt]);
  });

  it("img2img ersetzt auch das SIGMA im Zeitplan, nicht nur den Timestep — sonst waere die Umsetzung nur zur Haelfte fertig", async () => {
    // Fix-Runde 1 (Review-Befund): die urspruengliche Fassung dieses Tests verglich zwei
    // Laeufe mit verschiedenem Bruchteil und erwartete unterschiedliche Feeds. Das belegt
    // nichts: `noisedInitLatents(encoded, seed, entry.sigma)` bekommt `entry.sigma` als
    // PARAMETER, unabhaengig davon, ob `schedule.sigmas[entry.startAt]` je gesetzt wurde —
    // die beiden Laeufe waeren also so oder so verschieden, auch im Halb-Bug (nur
    // `timesteps` ersetzt, `sigmas` nicht: `scaleInput` skaliert dann mit dem
    // Anker-Sigma, aber das ist bei den beiden gewaehlten Bruchteilen ebenfalls
    // verschieden von `entry.sigma`, also bleiben die Feeds ungleich). Der Test zeigte nur,
    // dass IRGENDWO interpoliert wird, nicht WO.
    //
    // Diese Fassung rechnet den erwarteten Feed-Wert stattdessen EXAKT nach — Muster aus
    // tests/engine.test.ts:225 ("Start-Latents entsprechen dem verrauschten Vorlagen-Latent
    // am Einstiegspunkt"), hier mit einem echten Bruchteil (frac=0.5, nicht 0 wie dort) und
    // ohne die dortige f16-Rundung (SDXLs Fake rechnet in float32).
    //
    // Erwartungswert: scaleInput(noisedInitLatents(encoded, seed, entry.sigma), entry.sigma).
    // `encoded[0]` ist bekannt (der vaeEncoder-Fake liefert konstant 2 in den Mean-Kanaelen,
    // `encodeInitImage` multipliziert nur mit vaeScaling — Muster aus dem F2b-Test oben,
    // Zeile ~296, dort ebenfalls ohne Aufruf von encodeInitImage komponiert).
    //
    // Warum das den Halb-Bug faengt: die Engine liefert den Feed als
    // `scaleInput(latents, schedule.sigmas[startAt])`. Fehlt die Zeitplan-Ersetzung, ist
    // dieser Divisor der ANKER-Sigma, waehrend die Erwartung hier mit `entry.sigma`
    // (interpoliert) rechnet — bei frac=0.5 laufen beide Werte auseinander, der Test wird rot.
    const steps = 8;
    const denoising = 0.5625; // Anker 3, frac 0.5 — kein Randfall (frac != 0)
    const seed = 9;
    const vaeScaling = 0.13025;
    const sched = makeSchedule(steps);
    const entry = denoiseEntry(steps, denoising, sched.sigmas, sched.timesteps);
    expect(entry.startAt).toBe(3);

    const rec: Rec = { feeds: [] };
    const e = new SdxlTurboEngine(
      sessions(rec, 512),
      { primary: TOK_PRIMARY, secondary: TOK_SECONDARY },
      { vaeScaling, size: 512 },
    );
    await e.generate({
      prompt: "cat", steps, seed, size: 512,
      initPixels: new Float32Array(3 * 512 * 512), denoising,
    });

    // vaeEncoder-Feed traegt NUR "sample" (kein "timestep") — dieselbe Unterscheidung wie
    // in den umliegenden Tests dieser Datei, nicht neu erfunden.
    const unetCalls = rec.feeds.filter((f) => "timestep" in f);
    const firstSample = unetCalls[0]!["sample"]!.data as Float32Array;

    const encoded0 = 2 * vaeScaling; // Fake-Mean 2, wie encodeInitImage() sie multipliziert
    const noise0 = gaussianArray(seed, 1)[0]!;
    const noised0 = encoded0 + noise0 * entry.sigma; // noisedInitLatents() fuer den 0. Eintrag
    const expected = scaleInput(new Float32Array([noised0]), entry.sigma)[0]!;
    expect(firstSample[0]).toBeCloseTo(expected, 4);
  });
});
