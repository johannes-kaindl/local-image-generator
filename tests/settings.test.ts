import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/vendor/kit/settings";
import { DEFAULT_SETTINGS, DEFAULT_PRESETS, type LigSettings } from "../src/core/settings";

describe("settings", () => {
  it("liefert Defaults bei null/undefined raw", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("übernimmt gespeicherte Werte und behält unbekannte Felder (Forward-Compat)", () => {
    const merged = mergeSettings<LigSettings>(DEFAULT_SETTINGS, { outputFolder: "Art", future: 1 } as unknown);
    expect(merged.outputFolder).toBe("Art");
    expect((merged as unknown as Record<string, unknown>)["future"]).toBe(1);
  });

  it("teilt keine Referenzen mit dem Defaults-Objekt", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {});
    expect(merged).not.toBe(DEFAULT_SETTINGS);
    expect(merged.presets).not.toBe(DEFAULT_SETTINGS.presets);
  });

  it("migriert eine 0.1-data.json ohne Migrationscode (fehlende Felder aus Defaults)", () => {
    const merged = mergeSettings<LigSettings>(DEFAULT_SETTINGS, { outputFolder: "Art" });
    expect(merged.noteFolder).toBe("");
    expect(merged.defaultSteps).toBe(4);
    expect(merged.createMode).toBe("image");
    expect(merged.promptHistory).toEqual([]);
    expect(merged.presets).toHaveLength(DEFAULT_PRESETS.length);
    expect(merged.sectionsCollapsed).toEqual({});
  });

  it("liefert Presets mit eindeutigen IDs", () => {
    const ids = DEFAULT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
