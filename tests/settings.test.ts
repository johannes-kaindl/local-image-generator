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
    expect(merged.defaultSteps).toBe(20);
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
      history: [
        {
          prompt: "a prompt",
          seed: 1,
          steps: 4,
          model: "sd-turbo",
          width: 512,
          height: 512,
          created: "2026-07-17T10:00:00",
          negativePrompt: "blurry, low quality",
          cfg: 8,
        },
      ],
      historyView: "grouped",
      endpoint: "http://127.0.0.1:7860",
      selectedModel: "sd-turbo",
      mfluxPath: "/path/to/mflux",
      modelsDir: "/path/to/models",
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
    [0, 20],
    [51, 20],
    ["3", 20],
    [2.5, 20],
    [1, 1],
    [50, 50],
    [20, 20],
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

  it("endpoint: fehlt in {} → \"\"", () => {
    expect(sanitizeSettings({}).endpoint).toBe("");
  });

  it("endpoint: non-string wird zu \"\"", () => {
    expect(sanitizeSettings({ endpoint: 42 }).endpoint).toBe("");
  });

  it("endpoint: gültiger String bleibt erhalten", () => {
    expect(sanitizeSettings({ endpoint: "http://127.0.0.1:7860" }).endpoint).toBe("http://127.0.0.1:7860");
  });
});

describe("Historie-Migration", () => {
  it("verwirft eine alte promptHistory (string[]) und startet leer", () => {
    const s = sanitizeSettings({ promptHistory: ["a", "b", "c"] });
    expect(s.history).toEqual([]);
    expect((s as unknown as Record<string, unknown>)["promptHistory"]).toBeUndefined();
  });

  it("behält eine gültige history und defaultet historyView auf recent", () => {
    const entry = {
      prompt: "a",
      seed: 1,
      steps: 4,
      model: "sd-turbo",
      width: 512,
      height: 512,
      created: "2026-07-17T10:00:00",
      negativePrompt: "",
      cfg: 7,
    };
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

describe("sanitizeSettings — tote Keys mfluxPath/modelsDir/selectedModel (seit 0.5)", () => {
  it("Defaults: alle drei leer", () => {
    const s = sanitizeSettings({});
    expect(s.selectedModel).toBe("");
    expect(s.mfluxPath).toBe("");
    expect(s.modelsDir).toBe("");
  });

  it("überleben als Strings — kein MODELS-Katalog-Bezug mehr (Muster sectionsCollapsed)", () => {
    const s = sanitizeSettings({ selectedModel: "flux99", mfluxPath: "/old/mflux", modelsDir: "/old/models" });
    expect(s.selectedModel).toBe("flux99");
    expect(s.mfluxPath).toBe("/old/mflux");
    expect(s.modelsDir).toBe("/old/models");
  });

  it("Nicht-String-Werte werden leer", () => {
    const s = sanitizeSettings({ selectedModel: 7, mfluxPath: 42, modelsDir: null });
    expect(s.selectedModel).toBe("");
    expect(s.mfluxPath).toBe("");
    expect(s.modelsDir).toBe("");
  });
});

describe("Historie-Migration 0.4 (width/height)", () => {
  it("sanitizeHistory migriert Alt-Einträge ohne width/height auf 512", () => {
    const s = sanitizeSettings({ history: [{ prompt: "a", seed: 1, steps: 2, model: "sd-turbo", created: "x" }] });
    expect(s.history[0]).toMatchObject({ width: 512, height: 512 });
  });
});

describe("Historie-Migration 0.5 (negativePrompt/cfg)", () => {
  it("sanitizeHistory migriert Alt-Einträge ohne negativePrompt/cfg auf '' / 7", () => {
    const s = sanitizeSettings({
      history: [{ prompt: "a", seed: 1, steps: 2, model: "sd-turbo", width: 512, height: 512, created: "x" }],
    });
    expect(s.history[0]).toMatchObject({ negativePrompt: "", cfg: 7 });
  });

  it("sanitizeHistory behält vorhandene negativePrompt/cfg-Werte", () => {
    const s = sanitizeSettings({
      history: [
        {
          prompt: "a",
          seed: 1,
          steps: 2,
          model: "sd-turbo",
          width: 512,
          height: 512,
          created: "x",
          negativePrompt: "ugly",
          cfg: 9,
        },
      ],
    });
    expect(s.history[0]).toMatchObject({ negativePrompt: "ugly", cfg: 9 });
  });
});
