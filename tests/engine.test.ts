import { describe, expect, it } from "vitest";
import { runDiffusion, SdTurboEngine, type OrtValue, type Session } from "../src/core/engine";
import { f16ArrayToF32 } from "../src/core/pipeline/f16";
import { gaussianArray } from "../src/core/pipeline/prng";
import { denoiseEntry, makeSchedule, scaleInput } from "../src/core/pipeline/scheduler";
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
  it("img2img: Fortschritt ist RELATIV zum Einstiegspunkt, nicht zur vollen Schrittzahl", async () => {
    // Review-Fund F1: (i - startAt + 1, timesteps.length - startAt) war ungetestet — die
    // Mutation zu (i + 1, timesteps.length) liess alle bisherigen Tests gruen, weil sie nur
    // txt2img (startAt immer 0) melden. Bei denoiseEntry(4, 0.5, …) → startAt 2 laufen nur 2
    // von 4 UNet-Schritten; die Meldung muss [1,2],[2,2] sein, NICHT [3,4],[4,4].
    // (Bis 0.11 stand hier `denoiseRaster(4, 0.5) → tStart 2` — die Funktion gibt es seit dem
    // Umbau nicht mehr, der Einstiegspunkt kommt aus `denoiseEntry`. Bei d=0.5 und steps=4
    // faellt er exakt auf einen Anker, die Zahl 2 gilt also unveraendert weiter.)
    const engine = new SdTurboEngine(fakeSessions([]), tokData);
    const progress: Array<[number, number]> = [];
    await engine.generate(
      { prompt: "cat", steps: 4, seed: 9, initPixels: new Float32Array(3 * 512 * 512), denoising: 0.5 },
      (s, t) => progress.push([s, t]),
    );
    expect(progress).toEqual([[1, 2], [2, 2]]);
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
    const sched = makeSchedule(steps);
    const { startAt } = denoiseEntry(steps, denoising, sched.sigmas, sched.timesteps);
    expect(startAt).toBe(2); // gemessen: denoiseEntry(4, 0.5) → Einstieg beim 3. von 4 Schritten
    expect(log.filter((l) => l === "unet")).toHaveLength(steps - startAt);
  });
  // ⚠️ Paar-Test mit „img2img ersetzt den Folgen-Eintrag" weiter unten: dieser misst das
  // SIGMA, jener den TIMESTEP. Begruendung dort.
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
    const schedule = makeSchedule(steps);
    const { sigma } = denoiseEntry(steps, denoising, schedule.sigmas, schedule.timesteps);
    const noise0 = gaussianArray(seed, 1)[0]!;
    const expected = scaleInput(new Float32Array([2 * 0.18215 + noise0 * sigma]), sigma)[0]!;
    expect(seenFirstSample[0]![0]).toBeCloseTo(expected, 2);
  });
  it("img2img ersetzt den Folgen-Eintrag, nicht nur das Init-Latent", async () => {
    // Der Kern des Umbaus: schedulerStep liest sein Start-Sigma SELBST aus dem Array
    // (scheduler.ts). Wuerde die Engine nur das Latent verrauschen, rechnete der erste
    // Euler-Schritt weiter mit dem alten Wert — ein leise falsches Bild, kein Fehler.
    //
    // Gemessen wird das ueber den TIMESTEP, den das UNet als Feed bekommt: bei einem
    // Zwischenwert darf er NICHT einem der Anker entsprechen.
    //
    // ⚠️ **Paar-Test.** Der Einstiegspunkt hat ZWEI Haelften, und jeder der beiden Tests deckt
    // nur eine: „Start-Latents entsprechen dem verrauschten Vorlagen-Latent" (oben) misst das
    // SIGMA, dieser hier den TIMESTEP. Wer einen von beiden umbaut oder streicht, laesst die
    // andere Haelfte ungeprueft — und ein falscher Timestep bei richtigem Sigma ergibt kein
    // Fehlerbild, sondern ein leise schlechteres Ergebnis (das UNet bekaeme die
    // Konditionierung des Ankers).
    const steps = 4;
    const denoising = 0.625; // zwischen zwei Stufen
    const sched = makeSchedule(steps);
    const erwartet = denoiseEntry(steps, denoising, sched.sigmas, sched.timesteps);

    // Muster der Datei uebernehmen: fakeSessions bauen, dann NUR den unet-Fake umhuellen
    // und den Original-run weiterrufen. Nicht neu erfinden — der Fake prueft im run()
    // selbst Dims und Dtypes und traegt damit halbe Zusagen.
    const gesehen: number[] = [];
    const s = fakeSessions([]);
    const baseUnetRun = s.unet.run;
    s.unet = {
      ...s.unet,
      run: async (feeds) => {
        // Der Fake deklariert timestep als int64 → BigInt64Array. Number() traegt den Wert.
        gesehen.push(Number((feeds["timestep"]!.data as BigInt64Array)[0]));
        return baseUnetRun(feeds);
      },
    };
    const engine = new SdTurboEngine(s, tokData);
    await engine.generate({
      prompt: "cat", steps, seed: 9,
      initPixels: new Float32Array(3 * 512 * 512), denoising,
    });

    expect(gesehen[0]).toBe(erwartet.timestep);
    expect(gesehen[0]).not.toBe(sched.timesteps[erwartet.startAt]);
    expect(gesehen).toHaveLength(steps - erwartet.startAt);
  });
  it("denoising 0: kein UNet-Schritt, keine NaN — die Vorlage wird direkt dekodiert", async () => {
    // K1 (Final-Review 2026-09-05). `denoiseEntry(steps, 0, …)` liefert per Formel Sigma 0
    // (der linke Regler-Anschlag, DENOISING.min). Genau dieses Sigma teilt `schedulerStep`
    // zweimal durch sich selbst — `sigmaUp = sqrt((0·(0−0))/0)` und `derivative = 0/0` sind
    // beide NaN, und `chwToRgba` schreibt NaN in ein Uint8ClampedArray, was 0 ergibt: ein
    // komplett schwarzes Bild OHNE jeden Fehler. Bis 0.11 gab es den Fall nicht (der alte
    // `denoiseRaster` klemmte auf tStart = steps−1); der Umbau hat ihn eingefuehrt.
    //
    // „denoising 0 heisst nichts veraendern" bleibt die Zusage — sie wird nur wirklich
    // eingeloest: der Diffusions-Lauf entfaellt, das encodierte Vorlagen-Latent geht direkt
    // in den VAE-Decoder. Gemessen wird das ERGEBNIS (Decoder-Feed ohne NaN, Bild nicht
    // schwarz), nicht der Rueckgabetyp — ein `Uint8ClampedArray` kann gar kein NaN tragen.
    const log: string[] = [];
    const s = fakeSessions(log);
    // Echo-Decoder statt des konstanten Fakes: er reicht die Latents in die Bildkanaele
    // durch, damit ein NaN-Latent auch als schwarzes Bild ankommt (float32-IO, damit der
    // Feed ohne f16-Umweg pruefbar bleibt).
    const latentFeeds: Float32Array[] = [];
    s.vaeDecoder = {
      inputNames: ["latent_sample"],
      outputNames: ["sample"],
      inputTypes: { latent_sample: "float32" },
      run: async (feeds) => {
        log.push("vae");
        const lat = feeds["latent_sample"]!.data as Float32Array;
        latentFeeds.push(lat);
        const out = new Float32Array(3 * 512 * 512);
        for (let i = 0; i < out.length; i++) out[i] = lat[i % lat.length]!;
        return { sample: { data: out, dims: [1, 3, 512, 512] } };
      },
      release: async () => {},
    };
    const engine = new SdTurboEngine(s, tokData);
    const progress: Array<[number, number]> = [];
    const res = await engine.generate(
      { prompt: "cat", steps: 4, seed: 9, initPixels: new Float32Array(3 * 512 * 512), denoising: 0 },
      (step, total) => progress.push([step, total]),
    );

    expect(log).toContain("vae_encoder");
    expect(log).not.toContain("unet"); // ohne den Fix laeuft genau ein Schritt — und der macht NaN
    const lat = latentFeeds[0]!;
    expect(lat.length).toBeGreaterThan(0);
    expect(Array.from(lat).some((v) => Number.isNaN(v))).toBe(false);
    // Das BILD, nicht nur der Typ: NaN-Latents ergaeben ueberall 0 (schwarz), gesunde
    // Latents von 0 dagegen mittelgrau (128). ⚠️ Der ALPHA-Kanal muss raus: `chwToRgba`
    // schreibt in jedes vierte Byte konstant 255, ein `some(v => v !== 0)` ueber die rohen
    // RGBA-Bytes besteht deshalb auch ein vollstaendig schwarzes NaN-Bild — die Zusicherung
    // haette nie rot werden koennen (Nachlese-Befund N1, 2026-09-05).
    expect(
      Array.from(res.rgba.subarray(0, 4 * 64))
        .filter((_, i) => i % 4 !== 3)
        .some((v) => v !== 0),
    ).toBe(true);
    // Der Fortschritt darf nicht auf halbem Wege stehenbleiben — der Aufrufer sieht
    // dieselbe Form wie am Ende eines echten Laufs (letzter Ruf: total/total).
    expect(progress.at(-1)).toEqual([1, 1]);
  });
  it("signal: bricht die Diffusionsschleife ZWISCHEN zwei Schritten ab, statt zu Ende zu rechnen", async () => {
    // Die Zusage der Provider-API fuer den builtin-Modus: `signal` ist dort ein ECHTER
    // Abbruch, kein blosses Wegsehen. Gemessen an der Zahl der UNet-Laeufe — der
    // Rueckgabewert allein wuerde nicht unterscheiden, ob die GPU weitergerechnet hat.
    const log: string[] = [];
    const s = fakeSessions(log);
    const ctl = new AbortController();
    const baseUnetRun = s.unet.run;
    s.unet = {
      ...s.unet,
      run: async (feeds) => {
        // Nach dem ERSTEN Schritt abbrechen: danach darf kein weiterer folgen.
        ctl.abort();
        return baseUnetRun(feeds);
      },
    };
    const engine = new SdTurboEngine(s, tokData);
    await expect(
      engine.generate({ prompt: "cat", steps: 4, seed: 9, signal: ctl.signal }),
    ).rejects.toThrow(/abgebrochen|aborted/i);
    expect(log.filter((l) => l === "unet")).toHaveLength(1);
    // Und der Decoder darf gar nicht erst laufen — ein halbes Latent ergaebe ein Bild,
    // das wie ein misslungener Lauf aussieht statt wie ein abgebrochener.
    expect(log).not.toContain("vae");
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

describe("runDiffusion — Feed-Konstruktion", () => {
  // Nachlese 0.9.0: `extraFeeds` wurde NACH `sample`/`timestep` gespreadet. Kein heutiger
  // Aufrufer trägt diese Schlüssel — aber wer es täte, überschriebe still die gemeinsame
  // Feed-Konstruktion samt der 0-d-`timestep`-Regel (AGENTS-Gotcha: `dims [1]` bricht das UNet
  // mit „Gemm: must be 2 dimensional"). Der Fehler wäre ein Modellabbruch weit weg von seiner
  // Ursache. Dieser Test nagelt die Reihenfolge fest.
  it("laesst extraFeeds die Kern-Feeds sample/timestep NICHT ueberschreiben", async () => {
    const gesehen: Record<string, OrtValue | undefined> = {};
    const dims = [1, 4, 8, 8];
    const n = 4 * 8 * 8;
    const unet: Session = {
      inputNames: ["sample", "timestep", "encoder_hidden_states"],
      outputNames: ["out_sample"],
      inputTypes: { sample: "float32", timestep: "int64", encoder_hidden_states: "float32" },
      inputShapes: { timestep: [] },
      run: async (feeds) => {
        gesehen["sample"] = feeds["sample"];
        gesehen["timestep"] = feeds["timestep"];
        return { out_sample: { data: new Float32Array(n), dims } };
      },
      release: async () => {},
    };
    const gift: OrtValue = { data: new Float32Array([42]), dims: [1] };
    await runDiffusion(unet, makeSchedule(1), 7, dims, {
      encoder_hidden_states: { data: new Float32Array(77 * 8), dims: [1, 77, 8] },
      // Ein Aufrufer, der es falsch macht — die Schleife muss ihn ignorieren:
      sample: gift,
      timestep: gift,
    });
    expect(gesehen["sample"]).not.toBe(gift);
    expect(gesehen["sample"]!.dims).toEqual(dims);
    expect(gesehen["timestep"]).not.toBe(gift);
    expect(gesehen["timestep"]!.data).toBeInstanceOf(BigInt64Array);
  });
});
