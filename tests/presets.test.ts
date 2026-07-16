import { describe, expect, it } from "vitest";
import { presetActive, togglePresetInPrompt } from "../src/core/presets";

const SUMI = "sumi-e painting, monochrome ink";

describe("presetActive", () => {
  it("ist inaktiv im leeren Prompt", () => {
    expect(presetActive("", SUMI)).toBe(false);
  });

  it("ist aktiv, wenn alle Bausteine des Suffix im Prompt stehen", () => {
    expect(presetActive("an apple, sumi-e painting, monochrome ink", SUMI)).toBe(true);
  });

  it("ist inaktiv, wenn nur ein Teil der Bausteine dasteht", () => {
    expect(presetActive("an apple, sumi-e painting", SUMI)).toBe(false);
  });

  it("zählt Teilstring-Treffer nicht als aktiv", () => {
    expect(presetActive("an apple, oil painting", "oil")).toBe(false);
  });

  it("ignoriert Whitespace um die Bausteine", () => {
    expect(presetActive("an apple ,  sumi-e painting ,monochrome ink", SUMI)).toBe(true);
  });

  it("ist bei leerem Suffix inaktiv (kein Allquantor auf der leeren Menge)", () => {
    expect(presetActive("an apple", "")).toBe(false);
    expect(presetActive("an apple", "  ,  ")).toBe(false);
  });
});

describe("togglePresetInPrompt", () => {
  it("hängt den Suffix an einen befüllten Prompt", () => {
    expect(togglePresetInPrompt("an apple", SUMI)).toBe("an apple, sumi-e painting, monochrome ink");
  });

  it("setzt den Suffix allein in einen leeren Prompt", () => {
    expect(togglePresetInPrompt("", SUMI)).toBe("sumi-e painting, monochrome ink");
  });

  it("entfernt den Suffix beim zweiten Klick", () => {
    const on = togglePresetInPrompt("an apple", SUMI);
    expect(togglePresetInPrompt(on, SUMI)).toBe("an apple");
  });

  it("ergänzt fehlende Bausteine, statt vorhandene zu doppeln", () => {
    expect(togglePresetInPrompt("an apple, sumi-e painting", SUMI)).toBe(
      "an apple, sumi-e painting, monochrome ink",
    );
  });

  it("normalisiert die Trennung auf ', '", () => {
    expect(togglePresetInPrompt("an apple ,pears", "oil")).toBe("an apple, pears, oil");
  });

  it("lässt den Prompt bei leerem Suffix unangetastet", () => {
    expect(togglePresetInPrompt("an apple", "   ")).toBe("an apple");
  });

  it("hinterlässt einen leeren Prompt, wenn nur der Suffix drin war", () => {
    expect(togglePresetInPrompt(SUMI, SUMI)).toBe("");
  });
});
