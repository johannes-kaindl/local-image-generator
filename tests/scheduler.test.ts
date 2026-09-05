import { describe, expect, it } from "vitest";
import { denoiseEntry, makeSchedule, scaleInput, schedulerStep } from "../src/core/pipeline/scheduler";

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

describe("denoiseEntry — Einstiegspunkt fuer Teil-Denoising", () => {
  const sched = (steps: number) => makeSchedule(steps);

  // ---- R1 aus der Spec: Rasterwerte muessen EXAKT bleiben. Ohne diesen Test ist die
  // Zusage „alte Rezepte reproduzieren sich unveraendert" eine Behauptung.
  it.each([
    [4, 0.25, 3], [4, 0.5, 2], [4, 0.75, 1], [4, 1.0, 0],
    [8, 0.125, 7], [8, 0.5, 4], [8, 0.625, 3], [8, 1.0, 0],
  ])("steps=%i d=%f trifft Index %i exakt (kein Bruchteil)", (steps, d, erwartet) => {
    const s = sched(steps);
    const e = denoiseEntry(steps, d, s.sigmas, s.timesteps);
    expect(e.startAt).toBe(erwartet);
    expect(e.sigma).toBe(s.sigmas[erwartet]);      // identisch, nicht nur nah
    expect(e.timestep).toBe(s.timesteps[erwartet]);
  });

  // ---- Der eigentliche Zugewinn: Zwischenwerte
  it("interpoliert zwischen zwei Sigma-Stufen", () => {
    const s = sched(4);
    // d = 0.625 → t = (1-0.625)*4 = 1.5 → Anker 1, Bruchteil 0.5
    const e = denoiseEntry(4, 0.625, s.sigmas, s.timesteps);
    expect(e.startAt).toBe(1);
    expect(e.sigma).toBeCloseTo((s.sigmas[1]! + s.sigmas[2]!) / 2, 10);
    expect(e.sigma).not.toBe(s.sigmas[1]);
    expect(e.sigma).not.toBe(s.sigmas[2]);
  });

  it("interpoliert den Timestep mit, nicht nur die Sigma", () => {
    // Sonst bekommt das UNet den Timestep des Ankers, waehrend der Rauschpegel
    // dazwischen liegt — ein Konditionierungsfehler von bis zu einem halben Schritt.
    const s = sched(4);
    const e = denoiseEntry(4, 0.625, s.sigmas, s.timesteps);
    expect(e.timestep).toBe(Math.round((s.timesteps[1]! + s.timesteps[2]!) / 2));
  });

  it("ist monoton: mehr denoising heisst hoehere Sigma", () => {
    const s = sched(8);
    const werte = [0.2, 0.3, 0.45, 0.6, 0.8, 1.0]
      .map((d) => denoiseEntry(8, d, s.sigmas, s.timesteps).sigma);
    for (let i = 1; i < werte.length; i++) expect(werte[i]!).toBeGreaterThan(werte[i - 1]!);
  });

  // ---- Raender
  it("klemmt den Anker auf steps-1, damit der Rest-Zeitplan nie leer ist", () => {
    const s = sched(4);
    // d = 0 hiesse t = 4, also Index 4 — dort gibt es keinen timestep mehr.
    const e = denoiseEntry(4, 0, s.sigmas, s.timesteps);
    expect(e.startAt).toBe(3);
  });

  it("liefert bei denoising 0 Sigma 0 — den Fall faengt die ENGINE ab, nicht diese Formel", () => {
    // Was diese Zusicherung sagt und was nicht: die FORMEL liefert bei d=0 Sigma 0, das ist
    // die korrekte Interpolation bis ans Folgen-Ende. Sie sagt NICHT, dass ein Lauf mit
    // diesem Wert rechenbar waere — eine frueherer Fassung dieses Kommentars behauptete
    // „der Lauf rechnet einen Schritt ohne Wirkung", und genau das ist falsch:
    // `schedulerStep` teilt bei Sigma 0 zweimal durch null (`sigmaUp`, `derivative`), die
    // Latents werden NaN und `chwToRgba` macht daraus ein komplett schwarzes Bild ohne
    // Fehlermeldung (K1, Final-Review 2026-09-05).
    //
    // „denoising 0 heisst nichts veraendern" bleibt die Semantik (A1111, Server-Modus) und
    // ist gegenueber denoiseRaster (bis 0.11, dort blieb Restrauschen bei gemeldetem Wert 0)
    // weiterhin die ehrlichere. Eingeloest wird sie in den ENGINES: bei Sigma 0 entfaellt der
    // Diffusions-Lauf, das encodierte Vorlagen-Latent geht direkt in den Decoder — gedeckt von
    // „denoising 0: kein UNet-Schritt, keine NaN" in tests/engine.test.ts UND
    // tests/engine-sdxl.test.ts.
    const s = sched(4);
    const e = denoiseEntry(4, 0, s.sigmas, s.timesteps);
    expect(e.startAt).toBe(3);
    expect(e.sigma).toBe(0);
    expect(e.timestep).toBe(0);
  });

  it("denoising ausserhalb [0,1]: negativ landet auf demselben Sigma 0, ueber 1 auf dem vollen Rauschen", () => {
    // Vorgezogener Kleinbefund (Final-Review): `hardenParams` klemmt auf [0,1], aber
    // `denoiseEntry` ist eine pure Funktion und wird von den Engines direkt gefuettert
    // (`req.denoising ?? 1`) — ein Aufrufer ohne Haertung ist also denkbar. Die beiden
    // `frac`-/`startAt`-Klemmen fangen das ab, und zwar so, dass d<0 in DENSELBEN Sigma-0-Fall
    // laeuft wie d=0: damit deckt der Engine-Fix aus K1 auch ihn.
    const s = sched(4);
    const negativ = denoiseEntry(4, -0.5, s.sigmas, s.timesteps);
    expect(negativ.startAt).toBe(3);
    expect(negativ.sigma).toBe(0);
    expect(negativ.timestep).toBe(0);

    const ueberEins = denoiseEntry(4, 1.5, s.sigmas, s.timesteps);
    const voll = denoiseEntry(4, 1, s.sigmas, s.timesteps);
    expect(ueberEins).toEqual(voll);
    expect(ueberEins.sigma).toBe(s.sigmas[0]);
  });

  it("interpoliert am letzten Anker gegen sigma 0 und timestep 0", () => {
    const s = sched(4);
    // d = 0.125 → t = 3.5 → Anker 3, Bruchteil 0.5, Nachfolger ist das Folgen-Ende.
    const e = denoiseEntry(4, 0.125, s.sigmas, s.timesteps);
    expect(e.startAt).toBe(3);
    expect(e.sigma).toBeCloseTo(s.sigmas[3]! / 2, 10);   // gegen sigmas[4] === 0
    expect(e.timestep).toBe(Math.round(s.timesteps[3]! / 2));
  });

  it("steps=1 macht den Regler echt statt einpositionig", () => {
    const s = sched(1);
    const voll = denoiseEntry(1, 1.0, s.sigmas, s.timesteps);
    const halb = denoiseEntry(1, 0.5, s.sigmas, s.timesteps);
    expect(voll.startAt).toBe(0);
    expect(halb.startAt).toBe(0);
    expect(halb.sigma).toBeLessThan(voll.sigma);   // frueher identisch
  });
});
