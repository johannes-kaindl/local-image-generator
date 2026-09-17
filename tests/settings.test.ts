import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/vendor/kit/settings";
import { validateSettings } from "../src/vendor/kit/settings_schema";
import { DEFAULT_SETTINGS, DEFAULT_PRESETS, migrateSettings, SETTINGS_SCHEMA, type LigSettings } from "../src/core/settings";
import { DEFAULT_ASSET_BASE_URL } from "../src/core/model-manifest";

/** Genau der Aufruf aus main.ts und aus dem Schreibpfad des Settings-Tabs — einmal benannt,
 *  damit die Zusicherungen unten lesbar bleiben. Ersetzt das frühere lokale sanitizeSettings,
 *  das seit Kit 0.27.0 validateSettings + SETTINGS_SCHEMA ist. */
const validate = (raw: unknown): LigSettings => validateSettings(DEFAULT_SETTINGS, raw, SETTINGS_SCHEMA);

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

describe("validateSettings + SETTINGS_SCHEMA (Spec §8)", () => {
  it("lässt einen gesunden Settings-Stand unverändert durch", () => {
    const healthy: LigSettings = {
      engine: "server",
      assetBaseUrl: "http://127.0.0.1:7862",
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
          denoising: null,
          initImage: null,
        },
      ],
      historyView: "grouped",
      endpoint: "http://127.0.0.1:7860",
      selectedModel: "sd-turbo",
      mfluxPath: "/path/to/mflux",
      modelsDir: "/path/to/models",
      sectionsCollapsed: { model: true },
      builtinModel: "sdxl-turbo",
      showModelPicker: true,
      comfyWorkflowPath: "",
      serverEndpointChoice: { endpointId: "e1", model: "m1" },
      comfyEndpointChoice: { endpointId: "e2" },
    };
    expect(validate(healthy)).toEqual(healthy);
  });

  it("presets: null wird zu DEFAULT_PRESETS", () => {
    const s = { ...DEFAULT_SETTINGS, presets: null as unknown as LigSettings["presets"] };
    expect(validate(s).presets).toEqual(DEFAULT_PRESETS);
  });

  it("presets: non-array wird zu DEFAULT_PRESETS", () => {
    const s = { ...DEFAULT_SETTINGS, presets: "nope" as unknown as LigSettings["presets"] };
    expect(validate(s).presets).toEqual(DEFAULT_PRESETS);
  });

  it("presets: non-array-Fallback teilt keine Referenzen mit DEFAULT_PRESETS", () => {
    const s = { ...DEFAULT_SETTINGS, presets: "nope" as unknown as LigSettings["presets"] };
    const sanitized = validate(s).presets;
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
    expect(validate(s).presets).toEqual([{ id: "ok", label: "OK", suffix: "ok-suffix" }]);
  });

  it("ein null-Preset-Eintrag wird aus der Liste entfernt", () => {
    const s: LigSettings = {
      ...DEFAULT_SETTINGS,
      presets: [null, { id: "ok", label: "OK", suffix: "ok-suffix" }] as unknown as LigSettings["presets"],
    };
    expect(validate(s).presets).toEqual([{ id: "ok", label: "OK", suffix: "ok-suffix" }]);
  });

  it("sectionsCollapsed: null wird zu {}", () => {
    const s = { ...DEFAULT_SETTINGS, sectionsCollapsed: null as unknown as Record<string, boolean> };
    expect(validate(s).sectionsCollapsed).toEqual({});
  });

  it("sectionsCollapsed: Array wird zu {}", () => {
    const s = { ...DEFAULT_SETTINGS, sectionsCollapsed: [] as unknown as Record<string, boolean> };
    expect(validate(s).sectionsCollapsed).toEqual({});
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
    expect(validate(s).defaultSteps).toBe(expected);
  });

  it("createMode: 'bogus' wird zu 'image'", () => {
    const s = { ...DEFAULT_SETTINGS, createMode: "bogus" as unknown as LigSettings["createMode"] };
    expect(validate(s).createMode).toBe("image");
  });

  it("createMode: 'note' bleibt 'note'", () => {
    const s = { ...DEFAULT_SETTINGS, createMode: "note" as const };
    expect(validate(s).createMode).toBe("note");
  });

  it("outputFolder/noteFolder: non-string wird zu \"\"", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      outputFolder: 5 as unknown as string,
      noteFolder: {} as unknown as string,
    };
    const sanitized = validate(s);
    expect(sanitized.outputFolder).toBe("");
    expect(sanitized.noteFolder).toBe("");
  });

  it("endpoint: fehlt in {} → \"\"", () => {
    expect(validate({}).endpoint).toBe("");
  });

  it("endpoint: non-string wird zu \"\"", () => {
    expect(validate({ endpoint: 42 }).endpoint).toBe("");
  });

  it("endpoint: gültiger String bleibt erhalten", () => {
    expect(validate({ endpoint: "http://127.0.0.1:7860" }).endpoint).toBe("http://127.0.0.1:7860");
  });
});

describe("Historie-Migration", () => {
  it("verwirft eine alte promptHistory (string[]) und startet leer", () => {
    const s = validate({ promptHistory: ["a", "b", "c"] });
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
      denoising: null,
      initImage: null,
    };
    const s = validate({ history: [entry] });
    expect(s.history).toEqual([entry]);
    expect(s.historyView).toBe("recent");
  });

  it("wirft kaputte history-Einträge weg", () => {
    const s = validate({ history: [{ prompt: "a" }, 42, null] });
    expect(s.history).toEqual([]);
  });

  it("übernimmt historyView='grouped'", () => {
    expect(validate({ historyView: "grouped" }).historyView).toBe("grouped");
    expect(validate({ historyView: "quatsch" }).historyView).toBe("recent");
  });
});

describe("validateSettings — tote Keys mfluxPath/modelsDir/selectedModel (seit 0.5)", () => {
  it("Defaults: alle drei leer", () => {
    const s = validate({});
    expect(s.selectedModel).toBe("");
    expect(s.mfluxPath).toBe("");
    expect(s.modelsDir).toBe("");
  });

  it("überleben als Strings — kein MODELS-Katalog-Bezug mehr (Muster sectionsCollapsed)", () => {
    const s = validate({ selectedModel: "flux99", mfluxPath: "/old/mflux", modelsDir: "/old/models" });
    expect(s.selectedModel).toBe("flux99");
    expect(s.mfluxPath).toBe("/old/mflux");
    expect(s.modelsDir).toBe("/old/models");
  });

  it("Nicht-String-Werte werden leer", () => {
    const s = validate({ selectedModel: 7, mfluxPath: 42, modelsDir: null });
    expect(s.selectedModel).toBe("");
    expect(s.mfluxPath).toBe("");
    expect(s.modelsDir).toBe("");
  });
});

describe("Historie-Migration 0.8 (img2img)", () => {
  // Alt-Eintraege wissen nichts von img2img. `null` heisst „war kein img2img" — ein
  // Vorgabewert (0.75) waere eine Angabe ueber einen Lauf, der nie stattgefunden hat.
  it("Alt-Eintraege ohne img2img-Felder bekommen null, nicht einen Vorgabewert", () => {
    const s = validate({
      history: [{ prompt: "a", seed: 1, steps: 2, model: "sd-turbo", created: "x",
                  width: 512, height: 512, negativePrompt: "", cfg: 7 }],
    });
    expect(s.history[0]!.denoising).toBeNull();
    expect(s.history[0]!.initImage).toBeNull();
    expect(s.history[0]!.prompt).toBe("a"); // nichts verloren
  });

  it("uebernimmt vorhandene img2img-Werte unveraendert", () => {
    const s = validate({
      history: [{ prompt: "a", seed: 1, steps: 2, model: "m", created: "x",
                  width: 512, height: 512, negativePrompt: "", cfg: 7,
                  denoising: 0.4, initImage: "Bilder/a.png" }],
    });
    expect(s.history[0]!.denoising).toBe(0.4);
    expect(s.history[0]!.initImage).toBe("Bilder/a.png");
  });
});

describe("Historie-Migration 0.4 (width/height)", () => {
  it("history-Migration migriert Alt-Einträge ohne width/height auf 512", () => {
    const s = validate({ history: [{ prompt: "a", seed: 1, steps: 2, model: "sd-turbo", created: "x" }] });
    expect(s.history[0]).toMatchObject({ width: 512, height: 512 });
  });
});

describe("Historie-Migration 0.5 (negativePrompt/cfg)", () => {
  it("history-Migration migriert Alt-Einträge ohne negativePrompt/cfg auf '' / 7", () => {
    const s = validate({
      history: [{ prompt: "a", seed: 1, steps: 2, model: "sd-turbo", width: 512, height: 512, created: "x" }],
    });
    expect(s.history[0]).toMatchObject({ negativePrompt: "", cfg: 7 });
  });

  it("history-Migration behält vorhandene negativePrompt/cfg-Werte", () => {
    const s = validate({
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

  // C1 (Final-Review 2026-09-06): seit dem comfy-Modus ist `cfg: null` ein GUELTIGER Wert
  // ("vom Backend bestimmt, nicht vom Plugin") und darf nicht wie ein fehlendes Feld auf 7
  // zurueckgebogen werden — sonst behauptete ein neu geladener Eintrag genau die Zahl, die
  // die Notiz bewusst weglaesst. Das fehlende Feld (Alt-Eintrag) bleibt daneben bei 7.
  it("history-Migration erhaelt cfg: null, backfillt aber ein FEHLENDES cfg auf 7", () => {
    const s = validate({
      history: [
        { prompt: "a", seed: 1, steps: 2, model: "m", width: 512, height: 512, created: "x", negativePrompt: "", cfg: null },
        { prompt: "b", seed: 1, steps: 2, model: "m", width: 512, height: 512, created: "x", negativePrompt: "" },
      ],
    });
    expect(s.history[0]?.cfg).toBeNull();
    expect(s.history[1]?.cfg).toBe(7);
  });
});

describe("engine-Migration (0.6)", () => {
  it("fehlt engine und ein Endpunkt ist gesetzt → server (0.5-Nutzer bleiben, wo sie sind)", () => {
    const s = validate(migrateSettings({ endpoint: "http://127.0.0.1:7860" }));
    expect(s.engine).toBe("server");
  });
  it("fehlt engine ohne Endpunkt → builtin (Zero-Setup-Default)", () => {
    expect(validate(migrateSettings({})).engine).toBe("builtin");
    expect(validate(migrateSettings(null)).engine).toBe("builtin");
  });
  it("vorhandenes engine bleibt; Unsinn fällt auf builtin zurück", () => {
    expect(validate(migrateSettings({ engine: "server" })).engine).toBe("server");
    expect(validate(migrateSettings({ engine: "builtin", endpoint: "http://x" })).engine).toBe("builtin");
    expect(validate({ engine: "toaster" }).engine).toBe("builtin");
  });
  it("assetBaseUrl: Default ist das HF-Repo, Leerstring fällt auf Default, Trailing-Slash bleibt roh (assetUrl normalisiert)", () => {
    expect(validate({}).assetBaseUrl).toBe(DEFAULT_ASSET_BASE_URL);
    expect(validate({ assetBaseUrl: "  " }).assetBaseUrl).toBe(DEFAULT_ASSET_BASE_URL);
    expect(validate({ assetBaseUrl: "http://127.0.0.1:7862/" }).assetBaseUrl).toBe("http://127.0.0.1:7862/");
  });
});

describe("Modellwahl-Settings (Spec 0.9 §6.1)", () => {
  it("Defaults sind sd-turbo und ausgeschalteter Picker", () => {
    expect(DEFAULT_SETTINGS.builtinModel).toBe("sd-turbo");
    expect(DEFAULT_SETTINGS.showModelPicker).toBe(false);
  });

  it("unbekannte Modell-ID faellt auf den Default zurueck", () => {
    const s = validate({ ...DEFAULT_SETTINGS, builtinModel: "flux" });
    expect(s.builtinModel).toBe("sd-turbo");
  });

  it("ein Bestandsstand ohne die Felder laedt unveraendert", () => {
    const alt = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete alt["builtinModel"];
    delete alt["showModelPicker"];
    const s = validate(alt);
    expect(s.builtinModel).toBe("sd-turbo");
    expect(s.showModelPicker).toBe(false);
  });
});

describe("ComfyUI-Backend (Spec 1 §2)", () => {
  it("akzeptiert comfy als Engine-Wert", () => {
    const s = validate({ ...DEFAULT_SETTINGS, engine: "comfy" });
    expect(s.engine).toBe("comfy");
  });

  it("faellt bei unbekanntem Engine-Wert auf den Default zurueck", () => {
    const s = validate({ ...DEFAULT_SETTINGS, engine: "quatsch" });
    expect(s.engine).toBe("builtin");
  });

  it("comfyWorkflowPath ist per Default leer", () => {
    expect(DEFAULT_SETTINGS.comfyWorkflowPath).toBe("");
  });

  // migrateSettings bleibt unangetastet: `engine` existiert bei jedem Bestandsnutzer.
  it("Migration ruehrt einen vorhandenen engine-Wert nicht an", () => {
    const raw = { engine: "comfy", endpoint: "" };
    expect(migrateSettings(raw)).toBe(raw);
  });
});
