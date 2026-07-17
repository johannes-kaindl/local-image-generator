import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/vendor/kit/settings";
import { DEFAULT_SETTINGS, DEFAULT_PRESETS, sanitizeSettings, type LigSettings } from "../src/core/settings";

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
    expect(merged.history).toEqual([]);
    expect(merged.historyView).toBe("recent");
    expect(merged.presets).toHaveLength(DEFAULT_PRESETS.length);
    expect(merged.sectionsCollapsed).toEqual({});
  });

  it("liefert Presets mit eindeutigen IDs", () => {
    const ids = DEFAULT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sanitizeSettings (Spec §8)", () => {
  it("lässt einen gesunden Settings-Stand unverändert durch", () => {
    const healthy: LigSettings = {
      outputFolder: "Art",
      noteFolder: "Inbox",
      defaultSteps: 2,
      createMode: "note",
      presets: [{ id: "a", label: "A", suffix: "a-suffix" }],
      history: [{ prompt: "a prompt", seed: 1, steps: 4, model: "sd-turbo", created: "2026-07-17T10:00:00" }],
      historyView: "grouped",
      sectionsCollapsed: { model: true },
    };
    expect(sanitizeSettings(healthy)).toEqual(healthy);
  });

  it("presets: null wird zu DEFAULT_PRESETS", () => {
    const s = { ...DEFAULT_SETTINGS, presets: null as unknown as LigSettings["presets"] };
    expect(sanitizeSettings(s).presets).toEqual(DEFAULT_PRESETS);
  });

  it("presets: non-array wird zu DEFAULT_PRESETS", () => {
    const s = { ...DEFAULT_SETTINGS, presets: "nope" as unknown as LigSettings["presets"] };
    expect(sanitizeSettings(s).presets).toEqual(DEFAULT_PRESETS);
  });

  it("presets: non-array-Fallback teilt keine Referenzen mit DEFAULT_PRESETS", () => {
    const s = { ...DEFAULT_SETTINGS, presets: "nope" as unknown as LigSettings["presets"] };
    const sanitized = sanitizeSettings(s).presets;
    expect(sanitized).not.toBe(DEFAULT_PRESETS);
    sanitized.forEach((p, i) => expect(p).not.toBe(DEFAULT_PRESETS[i]));
  });

  it("ein Preset ohne suffix wird aus der Liste entfernt", () => {
    const s: LigSettings = {
      ...DEFAULT_SETTINGS,
      presets: [
        { id: "ok", label: "OK", suffix: "ok-suffix" },
        { id: "broken", label: "Broken" } as unknown as LigSettings["presets"][number],
      ],
    };
    expect(sanitizeSettings(s).presets).toEqual([{ id: "ok", label: "OK", suffix: "ok-suffix" }]);
  });

  it("ein null-Preset-Eintrag wird aus der Liste entfernt", () => {
    const s: LigSettings = {
      ...DEFAULT_SETTINGS,
      presets: [null, { id: "ok", label: "OK", suffix: "ok-suffix" }] as unknown as LigSettings["presets"],
    };
    expect(sanitizeSettings(s).presets).toEqual([{ id: "ok", label: "OK", suffix: "ok-suffix" }]);
  });

  it("sectionsCollapsed: null wird zu {}", () => {
    const s = { ...DEFAULT_SETTINGS, sectionsCollapsed: null as unknown as Record<string, boolean> };
    expect(sanitizeSettings(s).sectionsCollapsed).toEqual({});
  });

  it("sectionsCollapsed: Array wird zu {}", () => {
    const s = { ...DEFAULT_SETTINGS, sectionsCollapsed: [] as unknown as Record<string, boolean> };
    expect(sanitizeSettings(s).sectionsCollapsed).toEqual({});
  });

  it.each([
    [0, 4],
    [99, 4],
    ["3", 4],
    [2.5, 4],
    [1, 1],
    [4, 4],
  ])("defaultSteps %p wird zu %p", (input, expected) => {
    const s = { ...DEFAULT_SETTINGS, defaultSteps: input as unknown as number };
    expect(sanitizeSettings(s).defaultSteps).toBe(expected);
  });

  it("createMode: 'bogus' wird zu 'image'", () => {
    const s = { ...DEFAULT_SETTINGS, createMode: "bogus" as unknown as LigSettings["createMode"] };
    expect(sanitizeSettings(s).createMode).toBe("image");
  });

  it("createMode: 'note' bleibt 'note'", () => {
    const s = { ...DEFAULT_SETTINGS, createMode: "note" as const };
    expect(sanitizeSettings(s).createMode).toBe("note");
  });

  it("outputFolder/noteFolder: non-string wird zu \"\"", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      outputFolder: 5 as unknown as string,
      noteFolder: {} as unknown as string,
    };
    const sanitized = sanitizeSettings(s);
    expect(sanitized.outputFolder).toBe("");
    expect(sanitized.noteFolder).toBe("");
  });
});

describe("Historie-Migration", () => {
  it("verwirft eine alte promptHistory (string[]) und startet leer", () => {
    const s = sanitizeSettings({ promptHistory: ["a", "b", "c"] });
    expect(s.history).toEqual([]);
    expect((s as unknown as Record<string, unknown>)["promptHistory"]).toBeUndefined();
  });

  it("behält eine gültige history und defaultet historyView auf recent", () => {
    const entry = { prompt: "a", seed: 1, steps: 4, model: "sd-turbo", created: "2026-07-17T10:00:00" };
    const s = sanitizeSettings({ history: [entry] });
    expect(s.history).toEqual([entry]);
    expect(s.historyView).toBe("recent");
  });

  it("wirft kaputte history-Einträge weg", () => {
    const s = sanitizeSettings({ history: [{ prompt: "a" }, 42, null] });
    expect(s.history).toEqual([]);
  });

  it("übernimmt historyView='grouped'", () => {
    expect(sanitizeSettings({ historyView: "grouped" }).historyView).toBe("grouped");
    expect(sanitizeSettings({ historyView: "quatsch" }).historyView).toBe("recent");
  });
});
