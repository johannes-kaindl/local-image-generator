import { describe, expect, it } from "vitest";
import { hardenParams } from "../src/core/params";
import { BUILTIN_MODEL } from "../src/core/model-manifest";
import { CFG, DEFAULT_SIZE, STEPS } from "../src/core/generation";

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

  // Ein Fremdplugin kann NaN/Infinity schicken (kaputte eigene Rechnung, JSON-Rundreise
  // ueber "NaN" o.ae.). Vor diesem Fix lief das durch Math.floor unveraendert durch und
  // machte aus einem Erfolg ein Bild mit params.steps: NaN.
  it("faengt NaN in steps auf einen gueltigen Wert im Bereich ab", () => {
    const s = hardenParams({ prompt: "x", steps: Number.NaN }, ctx("server")).steps;
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(STEPS.min);
    expect(s).toBeLessThanOrEqual(STEPS.max);
    expect(s).toBe(20); // faellt auf defaultSteps zurueck, wie eine fehlende Angabe
  });

  it("faengt Infinity in steps auf einen gueltigen Wert im Bereich ab", () => {
    const s = hardenParams({ prompt: "x", steps: Number.POSITIVE_INFINITY }, ctx("server")).steps;
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeLessThanOrEqual(STEPS.max);
  });

  it("faengt NaN/Infinity in steps auch im builtin-Modus innerhalb DES Backend-Bereichs ab", () => {
    // Der Fallback selbst muss geklemmt sein: defaultSteps (20) liegt ausserhalb des
    // builtin-Maximums (4) — ein ungeklemmter Fallback wuerde hier 20 zurueckgeben
    // (clampInt gibt seinen Fallback ungeprueft zurueck).
    const s = hardenParams({ prompt: "x", steps: Number.NaN }, ctx("builtin")).steps;
    expect(s).toBe(BUILTIN_MODEL.steps.max);
  });

  it("faengt NaN/Infinity in cfg, width, height und seed ab, statt sie durchzureichen", () => {
    const p = hardenParams(
      {
        prompt: "x",
        cfg: Number.NaN,
        width: Number.POSITIVE_INFINITY,
        height: Number.NaN,
        seed: Number.POSITIVE_INFINITY,
      },
      ctx("server"),
    );
    expect(p.cfg).toBe(CFG.default);
    expect(p.width).toBe(DEFAULT_SIZE.width);
    expect(p.height).toBe(DEFAULT_SIZE.height);
    expect(p.seed).toBe(4242); // faellt auf randomSeed() zurueck, wie ein fehlender Seed
  });

  it("nimmt im Server-Modus ohne cfg/width/height die dokumentierten Defaults", () => {
    const p = hardenParams({ prompt: "x" }, ctx("server"));
    expect(p.cfg).toBe(CFG.default);
    expect(p.width).toBe(DEFAULT_SIZE.width);
    expect(p.height).toBe(DEFAULT_SIZE.height);
  });
});

describe("eine Haertung, zwei Aufrufer", () => {
  // Das Panel uebergibt alle Reglerwerte, ein Fremdplugin oft nur den Prompt. Beide gehen
  // durch dieselbe Haertung — dieser Test haelt fest, dass der schmale Auftrag dieselben
  // Backend-Wahrheiten bekommt wie der volle, statt eigener Defaults.
  const c = { mode: "builtin" as const, defaultSteps: 20, model: BUILTIN_MODEL.id,
              now: new Date("2026-08-22T22:15:00"), randomSeed: () => 4242 };

  it("der schmale Auftrag erbt dieselben Backend-Wahrheiten wie der volle", () => {
    const voll = hardenParams(
      { prompt: "a cat", negativePrompt: "blurry", width: 1024, height: 1024, steps: 30, seed: 7, cfg: 9 },
      c,
    );
    const schmal = hardenParams({ prompt: "a cat", seed: 7 }, c);
    // Alles, was das Backend bestimmt, muss gleich sein — unabhaengig davon, wie viel
    // der Aufrufer gesagt hat.
    expect(schmal.cfg).toBe(voll.cfg);
    expect(schmal.negativePrompt).toBe(voll.negativePrompt);
    expect(schmal.width).toBe(voll.width);
    expect(schmal.height).toBe(voll.height);
    expect(schmal.model).toBe(voll.model);
    // und beide tragen die builtin-Wahrheit, nicht den Wunsch
    expect(voll).toMatchObject({ cfg: 1, negativePrompt: "", width: 512, height: 512, steps: 4 });
    // nur was der Aufrufer wirklich sagen darf, unterscheidet sich
    expect(schmal.steps).toBe(4);
  });
});
