import { describe, expect, it } from "vitest";
import { makeSchedule, scaleInput, schedulerStep } from "../src/core/pipeline/scheduler";

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
