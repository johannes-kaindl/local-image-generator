import { beforeEach, describe, expect, it } from "vitest";
import { registerI18n } from "../src/i18n/strings";
import { setLang } from "../src/vendor/kit/i18n";
import { buildViewModel, formatBytes, formatElapsed, type PanelState } from "../src/core/viewmodel";

beforeEach(() => {
  registerI18n();
  setLang("en");
});

const base: PanelState = {
  gpu: "ok",
  model: { kind: "ready" },
  run: { kind: "idle" },
  image: null,
  editorActive: true,
  prompt: "a cat",
};

describe("buildViewModel", () => {
  it("bereit: Generate enabled, Empty-State 'kein Bild', Status ok", () => {
    const vm = buildViewModel(base);
    expect(vm.generateEnabled).toBe(true);
    expect(vm.status.cls).toBe("is-ok");
    expect(vm.empty?.ctaLabel).toBeUndefined();
    expect(vm.showImage).toBe(false);
  });
  it("kein WebGPU: Fehler-Status, kein CTA, Generate disabled", () => {
    const vm = buildViewModel({ ...base, gpu: "no-webgpu" });
    expect(vm.generateEnabled).toBe(false);
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.icon).toBe("circle-x");
    expect(vm.empty?.ctaLabel).toBeUndefined();
  });
  it("Modell fehlt: Empty-State MIT Download-CTA, Generate disabled", () => {
    const vm = buildViewModel({ ...base, model: { kind: "missing" } });
    expect(vm.generateEnabled).toBe(false);
    expect(vm.empty?.ctaLabel).toContain("2.5 GB");
  });
  it("Download läuft: Loader-Status mit Prozent + Datei-Detail, Generate disabled", () => {
    const vm = buildViewModel({
      ...base,
      model: {
        kind: "downloading",
        overallPct: 42,
        fileKey: "unet",
        fileIndex: 2,
        totalFiles: 5,
        receivedBytes: 100,
        totalBytes: 200,
      },
    });
    expect(vm.status.icon).toBe("loader");
    expect(vm.status.text).toContain("42");
    expect(vm.generateEnabled).toBe(false);
  });
  it("GPU-Laden läuft: Loader-Status mit verstrichener Zeit, Generate disabled", () => {
    const vm = buildViewModel({ ...base, run: { kind: "loading", elapsedSec: 65 } });
    expect(vm.status.icon).toBe("loader");
    expect(vm.status.text).toContain("1:05");
    expect(vm.generateEnabled).toBe(false);
  });
  it("Generierung läuft: Step-Anzeige, Generate disabled (Lock)", () => {
    const vm = buildViewModel({ ...base, run: { kind: "running", step: 2, total: 4 } });
    expect(vm.status.text).toContain("2/4");
    expect(vm.generateEnabled).toBe(false);
  });
  it("leerer Prompt: Generate disabled", () => {
    expect(buildViewModel({ ...base, prompt: "  " }).generateEnabled).toBe(false);
  });
  it("Bild da: showImage, Insert nur mit aktivem Editor", () => {
    const withImg = {
      ...base,
      image: {
        dataUrl: "data:",
        params: { prompt: "p", seed: 1, steps: 4, model: "sd-turbo", date: "2026-07-16T21:52:43" },
      },
    };
    expect(buildViewModel(withImg).showImage).toBe(true);
    expect(buildViewModel(withImg).insertEnabled).toBe(true);
    expect(buildViewModel({ ...withImg, editorActive: false }).insertEnabled).toBe(false);
  });
  it("Fehler-Run: Fehlerstatus mit Message", () => {
    const vm = buildViewModel({ ...base, run: { kind: "error", message: "boom" } });
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.text).toContain("boom");
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

describe("formatBytes", () => {
  it("zeigt MB unter 1 GB, GB mit einer Nachkommastelle darüber", () => {
    expect(formatBytes(500_000)).toBe("1 MB");
    expect(formatBytes(99_000_000)).toBe("99 MB");
    expect(formatBytes(1_730_000_000)).toBe("1.7 GB");
  });
});
