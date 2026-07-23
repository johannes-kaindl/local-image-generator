import { beforeEach, describe, expect, it } from "vitest";
import { registerI18n } from "../src/i18n/strings";
import { setLang } from "../src/vendor/kit/i18n";
import { buildViewModel, formatElapsed, type GenParams, type PanelState } from "../src/core/viewmodel";

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
