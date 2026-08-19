import { beforeEach, describe, expect, it } from "vitest";
import { registerI18n } from "../src/i18n/strings";
import { setLang } from "../src/vendor/kit/i18n";
import { buildViewModel, formatBytes, formatElapsed, type GenParams, type PanelState } from "../src/core/viewmodel";

beforeEach(() => {
  registerI18n();
  setLang("en");
});

const baseParams: GenParams = {
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

  it("server-Modus: alle Regler sichtbar, Steps 1–50", () => {
    expect(buildViewModel(base).controls).toEqual({ negative: true, cfg: true, size: true, stepsMin: 1, stepsMax: 50 });
  });
  it("builtin/not-downloaded: Regler reduziert, CTA download, Generate gesperrt — der Server-Zustand ist egal", () => {
    const vm = buildViewModel(builtin);
    expect(vm.controls).toEqual({ negative: false, cfg: false, size: false, stepsMin: 1, stepsMax: 4 });
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
  it("run.error hat im builtin-Modus Vorrang vor dem Engine-Zustand", () => {
    const vm = buildViewModel({ ...builtin, engine: { kind: "ready" }, run: { kind: "error", message: "boom" } });
    expect(vm.status.text).toContain("boom");
  });
  it("recipeUnchanged sperrt im builtin-Modus gegen model 'sd-turbo', unabhängig vom Server-Modellnamen", () => {
    const img = { dataUrl: "d", params: { ...baseParams, cfg: 1, model: "sd-turbo" } };
    expect(buildViewModel({ ...builtin, engine: { kind: "ready" }, image: img }).generateEnabled).toBe(false);
    expect(buildViewModel({ ...builtin, engine: { kind: "ready" }, image: img, seed: 2 }).generateEnabled).toBe(true);
  });
  it("formatBytes", () => {
    expect(formatBytes(812e6)).toBe("812 MB");
    expect(formatBytes(1733e6)).toBe("1.7 GB");
    expect(formatBytes(530e3)).toBe("1 MB");
  });
});
