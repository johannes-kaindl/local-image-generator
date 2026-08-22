import { describe, expect, it } from "vitest";
import { hardenParams } from "../src/core/params";
import { BUILTIN_MODEL } from "../src/core/model-manifest";

const ctx = (mode: "builtin" | "server") => ({
  mode,
  defaultSteps: 20,
  model: mode === "builtin" ? BUILTIN_MODEL.id : "someModel.safetensors",
  now: new Date("2026-08-22T22:15:00"),
  randomSeed: () => 4242,
});

describe("hardenParams", () => {
  it("uebernimmt im Server-Modus, was der Aufrufer will", () => {
    const p = hardenParams(
      { prompt: "a cat", negativePrompt: "blurry", width: 768, height: 512, steps: 30, seed: 7, cfg: 9 },
      ctx("server"),
    );
    expect(p).toEqual({
      prompt: "a cat", negativePrompt: "blurry", width: 768, height: 512,
      steps: 30, seed: 7, cfg: 9, model: "someModel.safetensors", date: "2026-08-22T22:15:00",
    });
  });

  it("ueberschreibt im builtin-Modus still: kein Negativ, cfg 1, feste Groesse", () => {
    const p = hardenParams(
      { prompt: "a cat", negativePrompt: "blurry", width: 1024, height: 1024, steps: 30, seed: 7, cfg: 9 },
      ctx("builtin"),
    );
    expect(p.negativePrompt).toBe("");
    expect(p.cfg).toBe(1);
    expect(p.width).toBe(BUILTIN_MODEL.size);
    expect(p.height).toBe(BUILTIN_MODEL.size);
    // Steps werden auf das Backend-Maximum geklemmt, nicht abgelehnt: ein Konsument, der 30
    // schickt, bekommt ein Bild mit 4 Schritten und erfaehrt das im Rueckgabewert.
    expect(p.steps).toBe(BUILTIN_MODEL.steps.max);
  });

  it("wuerfelt den Seed, wenn keiner mitkommt", () => {
    expect(hardenParams({ prompt: "x" }, ctx("server")).seed).toBe(4242);
  });

  it("nimmt fehlende Steps aus den Einstellungen", () => {
    expect(hardenParams({ prompt: "x" }, ctx("server")).steps).toBe(20);
  });

  it("klemmt auch nach unten und akzeptiert keine gebrochenen Steps", () => {
    expect(hardenParams({ prompt: "x", steps: 0 }, ctx("server")).steps).toBe(1);
    expect(hardenParams({ prompt: "x", steps: 3.7 }, ctx("server")).steps).toBe(3);
  });
});
