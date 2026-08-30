import { beforeEach, describe, expect, it } from "vitest";
import { registerI18n } from "../src/i18n/strings";
import { setLang } from "../src/vendor/kit/i18n";
import { buildViewModel, formatBytes, formatElapsed, type GenParams, type PanelState } from "../src/core/viewmodel";
import { assetsFor, RUNTIME_WASM, totalBytes } from "../src/core/model-manifest";

beforeEach(() => {
  registerI18n();
  setLang("en");
});

const baseParams: GenParams = {
  initImage: null,
  denoising: null,
  prompt: "a cat",
  negativePrompt: "",
  seed: 1,
  steps: 4,
  cfg: 7,
  model: "sd-turbo",
  width: 512,
  height: 512,
  date: "2026-07-23T10:00:00",
};

const base: PanelState = {
  initImage: null,
  denoising: null,
  downloadedModels: [],
  builtinModel: "sd-turbo",
  showModelPicker: false,
  mode: "server",
  engine: { kind: "not-downloaded" },
  server: { kind: "ok", modelName: "sd-turbo" },
  run: { kind: "idle" },
  image: null,
  editorActive: true,
  prompt: "a cat",
  negativePrompt: "",
  seed: 1,
  steps: 4,
  cfg: 7,
  width: 512,
  height: 512,
};

/** Basis + Overrides — spart das Ausschreiben aller PanelState-Felder in jedem Test. */
const stateOf = (overrides: Partial<PanelState>): PanelState => ({ ...base, ...overrides });

describe("buildViewModel — server state", () => {
  it("unconfigured: Fehler-Status, Empty mit Settings-CTA, Generate disabled", () => {
    const vm = buildViewModel({ ...base, server: { kind: "unconfigured" } });
    expect(vm.generateEnabled).toBe(false);
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.icon).toBe("circle-x");
    expect(vm.empty?.ctaAction).toBe("settings");
    expect(vm.empty?.ctaLabel).toBeDefined();
  });

  it("checking: Loader-Status, Generate disabled", () => {
    const vm = buildViewModel({ ...base, server: { kind: "checking" } });
    expect(vm.status.icon).toBe("loader");
    expect(vm.generateEnabled).toBe(false);
  });

  it("unreachable: Fehler-Status, Empty mit Recheck-CTA, Generate disabled", () => {
    const vm = buildViewModel({ ...base, server: { kind: "unreachable" } });
    expect(vm.status.cls).toBe("is-error");
    expect(vm.empty?.ctaAction).toBe("recheck");
    expect(vm.generateEnabled).toBe(false);
  });

  it("ok + idle + nicht-leerer Prompt: Generate enabled, Status ready", () => {
    const vm = buildViewModel(base);
    expect(vm.generateEnabled).toBe(true);
    expect(vm.status.cls).toBe("is-ok");
    expect(vm.status.text).toBe("Ready");
  });

  it("leerer Prompt: Generate disabled trotz erreichbarem Server", () => {
    expect(buildViewModel({ ...base, prompt: "  " }).generateEnabled).toBe(false);
  });
});

describe("buildViewModel — run state", () => {
  it("contacting: Loader-Status 'Contacting server', Generate disabled", () => {
    const vm = buildViewModel({ ...base, run: { kind: "contacting" } });
    expect(vm.status.icon).toBe("loader");
    expect(vm.status.text).toContain("Contacting server");
    expect(vm.generateEnabled).toBe(false);
  });

  it("generating mit pct: Text enthält Prozent", () => {
    const vm = buildViewModel({ ...base, run: { kind: "generating", pct: 42, elapsedSec: 3 } });
    expect(vm.status.icon).toBe("loader");
    expect(vm.status.text).toContain("42");
    expect(vm.generateEnabled).toBe(false);
  });

  it("generating ohne pct: Text enthält verstrichene Zeit", () => {
    const vm = buildViewModel({ ...base, run: { kind: "generating", pct: null, elapsedSec: 65 } });
    expect(vm.status.text).toContain("1:05");
    expect(vm.generateEnabled).toBe(false);
  });

  it("error: Fehlerstatus mit Message, Generate bei nicht-leerem Prompt wieder enabled (Retry)", () => {
    const vm = buildViewModel({ ...base, run: { kind: "error", message: "boom" } });
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.text).toContain("boom");
    expect(vm.generateEnabled).toBe(true);
  });

  it("meldet einen Fremdlauf sichtbar und sperrt Generate", () => {
    const vm = buildViewModel({ ...base, run: { kind: "external", pct: 40 } });
    expect(vm.status.text).toContain("40");
    expect(vm.generateEnabled).toBe(false);
  });

  it("Fremdlauf ohne Prozent zeigt den eigenen Text (kein roher Key bei Tippfehler)", () => {
    const vm = buildViewModel({ ...base, run: { kind: "external", pct: null } });
    expect(vm.status.text).toBe("Another plugin is generating an image…");
    expect(vm.generateEnabled).toBe(false);
  });
});

describe("buildViewModel — Bild/Insert", () => {
  it("Bild da: showImage, Insert nur mit aktivem Editor", () => {
    const withImg: PanelState = {
      ...base,
      image: { dataUrl: "data:", params: baseParams },
    };
    expect(buildViewModel(withImg).showImage).toBe(true);
    expect(buildViewModel(withImg).insertEnabled).toBe(true);
    expect(buildViewModel({ ...withImg, editorActive: false }).insertEnabled).toBe(false);
  });

  it("kein Bild, nicht busy: Empty-State 'kein Bild'", () => {
    const vm = buildViewModel(base);
    expect(vm.empty?.text).toBeDefined();
    expect(vm.showImage).toBe(false);
  });

  it("kein Bild, aber generating: kein widersprüchlicher Empty-State", () => {
    const vm = buildViewModel({ ...base, run: { kind: "generating", pct: 10, elapsedSec: 1 } });
    expect(vm.empty).toBeNull();
  });
});

describe("buildViewModel — Generate-Gating (unverändertes Rezept)", () => {
  it("identisches Rezept + modelName stimmt überein → Generate disabled, Reroll unberührt", () => {
    const state: PanelState = {
      ...base,
      image: { dataUrl: "data:", params: baseParams },
    };
    expect(buildViewModel(state).generateEnabled).toBe(false);
  });

  it("identisches Rezept, aber modelName: null (unbeobachtbarer Serverwechsel) → Generate enabled", () => {
    const state: PanelState = {
      ...base,
      server: { kind: "ok", modelName: null },
      image: { dataUrl: "data:", params: baseParams },
    };
    expect(buildViewModel(state).generateEnabled).toBe(true);
  });

  it("ein abweichendes Feld (cfg) → Generate wieder enabled", () => {
    const state: PanelState = {
      ...base,
      cfg: 9,
      image: { dataUrl: "data:", params: baseParams },
    };
    expect(buildViewModel(state).generateEnabled).toBe(true);
  });

  it("abweichender negativePrompt → Generate wieder enabled", () => {
    const state: PanelState = {
      ...base,
      negativePrompt: "blurry",
      image: { dataUrl: "data:", params: baseParams },
    };
    expect(buildViewModel(state).generateEnabled).toBe(true);
  });
});

describe("formatElapsed", () => {
  it("formatiert Sekunden als m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(5)).toBe("0:05");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(3661)).toBe("61:01");
  });
});

describe("buildViewModel — builtin engine (0.6)", () => {
  const builtin: PanelState = { ...base, mode: "builtin", server: { kind: "unconfigured" }, cfg: 1 };

  it("server-Modus: alle Regler sichtbar, Steps 1–50, kein Raster (kontinuierlich)", () => {
    expect(buildViewModel(base).controls).toEqual({
      negative: true, cfg: true, size: true, sizes: null, initImage: true, denoising: false,
      modelPicker: false, stepsMin: 1, stepsMax: 50, denoiseRaster: null,
    });
  });
  it("builtin/not-downloaded: Regler reduziert, CTA download, Generate gesperrt — der Server-Zustand ist egal; img2img seit 0.11 aber verfuegbar", () => {
    const vm = buildViewModel(builtin);
    expect(vm.controls).toEqual({
      negative: false, cfg: false, size: false, sizes: [{ width: 512, height: 512 }], initImage: true,
      denoising: false, modelPicker: false, stepsMin: 1, stepsMax: 4,
      denoiseRaster: { min: 0.25, step: 0.25 }, // steps=4 (base.steps), geklemmt auf caps.maxSteps=4
    });
    expect(vm.empty?.ctaAction).toBe("download");
    expect(vm.status.cls).toBe("is-error");
    expect(vm.generateEnabled).toBe(false);
  });
  it("builtin/downloading zeigt Datei und MB in der Statuszeile, CTA cancel-download", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "downloading", file: "model.onnx", received: 812e6, total: 1733e6, fileIndex: 2, fileCount: 6 } });
    expect(vm.status.text).toContain("model.onnx");
    expect(vm.status.text).toContain("812 MB");
    expect(vm.status.text).toContain("1.7 GB");
    expect(vm.status.cls).toBe("is-checking");
    expect(vm.empty?.ctaAction).toBe("cancel-download");
    expect(vm.generateEnabled).toBe(false);
  });
  it("builtin/verifying: Prüfstatus, weiter cancel-download", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "verifying", file: "model.onnx" } });
    expect(vm.status.text).toContain("model.onnx");
    expect(vm.empty?.ctaAction).toBe("cancel-download");
  });
  it("builtin/gpu-missing: Fehlerstatus mit Grund, CTA settings, Generate gesperrt", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "gpu-missing", reason: "no-f16" } });
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.text).toContain("f16");
    expect(vm.empty?.ctaAction).toBe("settings");
    expect(vm.generateEnabled).toBe(false);
  });
  it("builtin/error: Fehlertext, CTA download (Retry)", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "error", message: "checksum" } });
    expect(vm.status.text).toContain("checksum");
    expect(vm.empty?.ctaAction).toBe("download");
  });
  it("builtin/ready: Generate frei, Modell-Label nennt SD-Turbo, Leerzustand wie gewohnt", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "ready" } });
    expect(vm.generateEnabled).toBe(true);
    expect(vm.modelLabel).toContain("SD-Turbo");
    expect(vm.status.cls).toBe("is-ok");
    expect(vm.empty?.ctaAction).toBeUndefined();
  });
  it("loading-model zeigt Sekunden und sperrt Generate; generating im builtin-Modus zeigt Prozent", () => {
    const loading = buildViewModel({ ...builtin, engine: { kind: "ready" }, run: { kind: "loading-model", elapsedSec: 42 } });
    expect(loading.status.text).toContain("0:42");
    expect(loading.generateEnabled).toBe(false);
    expect(loading.empty).toBeNull();
    const gen = buildViewModel({ ...builtin, engine: { kind: "ready" }, run: { kind: "generating", pct: 50, elapsedSec: 3 } });
    expect(gen.status.text).toContain("50");
  });
  it("contacting heißt im builtin-Modus nicht „Server", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "ready" }, run: { kind: "contacting" } });
    expect(vm.status.text).not.toMatch(/server/i);
    expect(vm.status.cls).toBe("is-checking");
  });
  it("run.error hat im builtin-Modus Vorrang vor dem Engine-Zustand", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "ready" }, run: { kind: "error", message: "boom" } });
    expect(vm.status.text).toContain("boom");
  });
  it("recipeUnchanged sperrt im builtin-Modus gegen model 'sd-turbo', unabhängig vom Server-Modellnamen", () => {
    const img = { dataUrl: "d", params: { ...baseParams, cfg: 1, model: "sd-turbo" } };
    expect(buildViewModel({ ...builtin, engine: { kind: "ready" }, image: img }).generateEnabled).toBe(false);
    expect(buildViewModel({ ...builtin, engine: { kind: "ready" }, image: img, seed: 2 }).generateEnabled).toBe(true);
  });
  // Regression: recipeUnchanged verglich frueher IMMER gegen das feste Default-Modell
  // (BUILTIN_MODEL.id === "sd-turbo") statt gegen das GEWAEHLTE (state.builtinModel) — mit
  // sdxl-turbo aktiv waere Generate nach einem unveraenderten Rezept nie gesperrt gewesen.
  it("recipeUnchanged sperrt auch mit sdxl-turbo als gewaehltem Modell, nicht nur mit dem Default", () => {
    const sdxlState = { ...builtin, builtinModel: "sdxl-turbo" as const, engine: { kind: "ready" as const } };
    const matchingImg = { dataUrl: "d", params: { ...baseParams, cfg: 1, model: "sdxl-turbo" } };
    const staleImg = { dataUrl: "d", params: { ...baseParams, cfg: 1, model: "sd-turbo" } };
    expect(buildViewModel({ ...sdxlState, image: matchingImg }).generateEnabled).toBe(false);
    expect(buildViewModel({ ...sdxlState, image: staleImg }).generateEnabled).toBe(true);
  });
  // Review-Befund (14a-Fixrunde): engineEmpty() rechnete die "not-downloaded"-Groesse ueber
  // allAssets() — das ist per Definition IMMER das Default-Modell (sd-turbo). Mit sdxl-turbo
  // gewaehlt und nicht gecacht zeigte Panel und Download-Knopf 2,5 GB und luden tatsaechlich
  // 6,4 GB. Der Name war zusaetzlich als Literal "SD-Turbo" im String hartkodiert.
  it("builtin/not-downloaded nennt Name UND Groesse des GEWAEHLTEN Modells, nicht des Default", () => {
    const sdTurboSize = formatBytes(totalBytes([...assetsFor("sd-turbo"), RUNTIME_WASM]));
    const sdxlTurboSize = formatBytes(totalBytes([...assetsFor("sdxl-turbo"), RUNTIME_WASM]));
    expect(sdxlTurboSize).not.toBe(sdTurboSize); // die Faelle muessen sich ueberhaupt unterscheiden

    const sdVm = buildViewModel({ ...builtin, builtinModel: "sd-turbo" });
    expect(sdVm.empty?.text).toContain("SD-Turbo");
    expect(sdVm.empty?.text).toContain(sdTurboSize);
    expect(sdVm.empty?.ctaLabel).toContain(sdTurboSize);

    const sdxlVm = buildViewModel({ ...builtin, builtinModel: "sdxl-turbo" });
    expect(sdxlVm.empty?.text).toContain("SDXL-Turbo");
    expect(sdxlVm.empty?.text).toContain(sdxlTurboSize);
    expect(sdxlVm.empty?.ctaLabel).toContain(sdxlTurboSize);
    expect(sdxlVm.empty?.text).not.toContain(sdTurboSize);
  });
  it("formatBytes", () => {
    expect(formatBytes(812e6)).toBe("812 MB");
    expect(formatBytes(1733e6)).toBe("1.7 GB");
    expect(formatBytes(530e3)).toBe("1 MB");
  });
});

describe("Regler fuer img2img — zwei Fragen, nicht eine", () => {
  const vorlage = { path: "Bilder/a.png", dataUrl: "data:image/png;base64,AAAA" };

  it("die Vorlagen-Zeile gehoert seit 0.11 beiden Modi — der VAE-Encoder ist im builtin-Modus Pflicht-Asset", () => {
    expect(buildViewModel({ ...base, mode: "server" }).controls.initImage).toBe(true);
    expect(buildViewModel({ ...base, mode: "builtin" }).controls.initImage).toBe(true);
  });

  // Zweite Stufe: der Regler haengt nicht am Backend, sondern daran, ob es ueberhaupt etwas
  // zu aendern gibt. Ein Denoise-Regler ohne Vorlage ist dieselbe Attrappe wie ein
  // CFG-Regler im builtin-Modus — nur eine Ebene tiefer.
  it("der Denoise-Regler erscheint erst mit einer Vorlage", () => {
    expect(buildViewModel({ ...base, mode: "server", initImage: null }).controls.denoising).toBe(false);
    expect(buildViewModel({ ...base, mode: "server", initImage: vorlage }).controls.denoising).toBe(true);
  });

  // Vor 0.11 verschwand eine aus dem Server-Modus mitgenommene Vorlage im builtin-Modus
  // spurlos (initImage: false streichte die ganze Zeile). Seit dem Capabilities-Flip zeigt
  // der Wechsel denselben Regler wie im Server-Modus.
  it("eine Vorlage aus einem frueheren Server-Lauf zeigt seit 0.11 auch im builtin-Modus den Regler", () => {
    const vm = buildViewModel({ ...base, mode: "builtin", initImage: vorlage });
    expect(vm.controls.initImage).toBe(true);
    expect(vm.controls.denoising).toBe(true);
  });

  it("denoiseRaster ist nur im builtin-Modus gesetzt und rastert auf 1/steps", () => {
    expect(buildViewModel({ ...base, mode: "server" }).controls.denoiseRaster).toBeNull();
    const vm = buildViewModel({ ...base, mode: "builtin", steps: 4 });
    expect(vm.controls.denoiseRaster).toEqual({ min: 0.25, step: 0.25 });
  });
});

describe("generateEnabled kennt img2img", () => {
  const vorlage = { path: "Bilder/a.png", dataUrl: "data:image/png;base64,AAAA" };
  // Ein Ergebnis, dessen Rezept exakt dem aktuellen Panel-Zustand entspricht: Generate ist
  // ausgegraut, weil ein erneuter Lauf dasselbe Bild braechte.
  const fertig: PanelState = {
    ...base,
    prompt: baseParams.prompt,
    negativePrompt: baseParams.negativePrompt,
    seed: baseParams.seed,
    steps: baseParams.steps,
    cfg: baseParams.cfg,
    width: baseParams.width,
    height: baseParams.height,
    image: { dataUrl: "data:,", params: baseParams },
  };

  it("das unveraenderte Rezept sperrt Generate weiterhin", () => {
    expect(buildViewModel(fertig).generateEnabled).toBe(false);
  });

  // Derselbe Seed mit Vorlage ergibt ein VOELLIG anderes Bild — der Lauf ginge an einen
  // anderen Endpunkt. Ohne diesen Vergleich bleibt der Knopf gesperrt und das Feature ist
  // aus dem Panel heraus unbenutzbar, sobald einmal ein Bild dasteht.
  it("eine neu gesetzte Vorlage macht das Rezept wieder erzeugbar", () => {
    const mit = buildViewModel({ ...fertig, initImage: vorlage, denoising: 0.4 });
    expect(mit.generateEnabled).toBe(true);
  });

  it("eine geaenderte Aenderungsstaerke zaehlt als neues Rezept", () => {
    const gerechnet = { ...baseParams, initImage: "Bilder/a.png", denoising: 0.4 };
    const stand: PanelState = { ...fertig, image: { dataUrl: "data:,", params: gerechnet },
                                initImage: vorlage, denoising: 0.4 };
    expect(buildViewModel(stand).generateEnabled).toBe(false);
    expect(buildViewModel({ ...stand, denoising: 0.8 }).generateEnabled).toBe(true);
  });

  it("das Entfernen der Vorlage zaehlt ebenfalls als neues Rezept", () => {
    const gerechnet = { ...baseParams, initImage: "Bilder/a.png", denoising: 0.4 };
    const stand: PanelState = { ...fertig, image: { dataUrl: "data:,", params: gerechnet },
                                initImage: null, denoising: null };
    expect(buildViewModel(stand).generateEnabled).toBe(true);
  });
});

describe("Modell-Picker im Panel (Spec 0.9 §6.2)", () => {
  const basis = { ...stateOf({ mode: "builtin" }), builtinModel: "sdxl-turbo" as const };

  it("unsichtbar, wenn der Toggle aus ist — auch bei zwei geladenen Modellen", () => {
    const vm = buildViewModel({ ...basis, showModelPicker: false, downloadedModels: ["sd-turbo", "sdxl-turbo"] });
    expect(vm.controls.modelPicker).toBe(false);
  });

  it("unsichtbar, wenn nur ein Modell geladen ist — auch mit Toggle an", () => {
    const vm = buildViewModel({ ...basis, showModelPicker: true, downloadedModels: ["sdxl-turbo"] });
    expect(vm.controls.modelPicker).toBe(false);
  });

  it("sichtbar erst, wenn beide Bedingungen erfuellt sind", () => {
    const vm = buildViewModel({ ...basis, showModelPicker: true, downloadedModels: ["sd-turbo", "sdxl-turbo"] });
    expect(vm.controls.modelPicker).toBe(true);
    expect(vm.modelOptions.map((o) => o.id)).toEqual(["sd-turbo", "sdxl-turbo"]);
  });

  it("listet NUR geladene Modelle — ein Panel-Klick darf nie einen Download ausloesen", () => {
    const vm = buildViewModel({ ...basis, showModelPicker: true, downloadedModels: ["sdxl-turbo"] });
    expect(vm.modelOptions.every((o) => o.id === "sdxl-turbo")).toBe(true);
  });

  it("im Server-Modus gibt es keinen Picker", () => {
    const vm = buildViewModel({ ...stateOf({ mode: "server" }), showModelPicker: true, downloadedModels: ["sd-turbo", "sdxl-turbo"] });
    expect(vm.controls.modelPicker).toBe(false);
  });
});

describe("Groessen-Zeile (Spec 0.9 §6.3)", () => {
  it("bei sd-turbo weg, bei sdxl-turbo da", () => {
    expect(buildViewModel({ ...stateOf({ mode: "builtin" }), builtinModel: "sd-turbo" }).controls.size).toBe(false);
    expect(buildViewModel({ ...stateOf({ mode: "builtin" }), builtinModel: "sdxl-turbo" }).controls.size).toBe(true);
  });

  it("die Sichtbarkeit haengt an sizes.length, nicht am Modellnamen", () => {
    const vm = buildViewModel({ ...stateOf({ mode: "builtin" }), builtinModel: "sdxl-turbo" });
    expect(vm.controls.sizes).toHaveLength(2);
  });
});
