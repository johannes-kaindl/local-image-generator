import { beforeEach, describe, expect, it } from "vitest";
import { registerI18n } from "../src/i18n/strings";
import { setLang } from "../src/vendor/kit/i18n";
import { backendCapabilities, STEPS, toBackendContext } from "../src/core/generation";
import { hardenParams } from "../src/core/params";
import { buildViewModel, type GenParams, type PanelState } from "../src/core/viewmodel";
import { activeEntry, libraryFrom, type LibraryState } from "../src/core/comfy/library";
import { BUILTIN_MODELS } from "../src/core/model-manifest";
import flux3 from "../comfy/workflows/flux3-klein.api.json";
import sdxlPixel from "../comfy/workflows/sdxl-pixel-art.api.json";
import flux3Edit from "../comfy/workflows/flux3-klein-edit.api.json";
import upscale from "../comfy/workflows/upscale-4x-ultrasharp.api.json";

beforeEach(() => {
  registerI18n();
  setLang("en");
});

const F = "W/flows";
const LIB: LibraryState = libraryFrom(F, [
  { path: `${F}/flux3-klein.api.json`, raw: JSON.stringify(flux3) },
  { path: `${F}/sdxl-pixel-art.api.json`, raw: JSON.stringify(sdxlPixel) },
  { path: `${F}/flux3-klein-edit.api.json`, raw: JSON.stringify(flux3Edit) },
  { path: `${F}/upscale-4x-ultrasharp.api.json`, raw: JSON.stringify(upscale) },
]);
const ONLY_TXT2IMG: LibraryState = libraryFrom(F, [{ path: `${F}/flux3-klein.api.json`, raw: JSON.stringify(flux3) }]);
const NO_SEL = { txt2img: "", edit: "", upscale: "" };

describe("backendCapabilities je ComfyUI-Aufgabe", () => {
  const caps = (task: "txt2img" | "edit" | "upscale") =>
    backendCapabilities(toBackendContext("comfy", "sd-turbo", { task, workflow: activeEntry(LIB, task, "") }));

  it("Erzeugen: Prompt, Negativ, Größe, Steps, Seed; keine Vorlage", () => {
    expect(caps("txt2img")).toMatchObject({
      prompt: true, negativePrompt: true, size: true, steps: true, seed: true, cfg: false,
      initImage: false, initRequired: false, denoising: false,
    });
  });

  it("Bearbeiten: Prompt, Steps, Seed und Pflicht-Vorlage; kein Negativ, keine Größe, kein Denoise", () => {
    expect(caps("edit")).toMatchObject({
      prompt: true, negativePrompt: false, size: false, steps: true, seed: true, cfg: false,
      initImage: true, initRequired: true, denoising: false, minSteps: STEPS.min, maxSteps: STEPS.max,
    });
  });

  it("Hochskalieren: nur die Pflicht-Vorlage", () => {
    expect(caps("upscale")).toMatchObject({
      prompt: false, negativePrompt: false, size: false, steps: false, seed: false, cfg: false,
      initImage: true, initRequired: true, denoising: false,
    });
  });

  it("die anderen Modi behalten ihre Regler und bekommen die neuen Felder ehrlich gesetzt", () => {
    const server = backendCapabilities({ mode: "server" });
    expect(server).toMatchObject({ prompt: true, steps: true, seed: true, size: true, initRequired: false, denoising: true });
    const pg = backendCapabilities({ mode: "playground" });
    expect(pg).toMatchObject({ prompt: true, steps: false, seed: false, size: false, initRequired: false, denoising: false });
    const sd = backendCapabilities({ mode: "builtin", model: "sd-turbo" });
    expect(sd).toMatchObject({ size: false, denoising: true });
    const sdxl = backendCapabilities({ mode: "builtin", model: "sdxl-turbo" });
    expect(sdxl.size).toBe(true);
  });
});

describe("hardenParams — Bearbeiten", () => {
  const ctx = {
    mode: "comfy" as const,
    defaultSteps: 20,
    model: "unknown",
    builtinModel: BUILTIN_MODELS["sd-turbo"].id,
    comfy: { task: "edit" as const, workflow: activeEntry(LIB, "edit", "") },
    now: new Date("2026-11-22T01:00:00"),
    randomSeed: () => 4242,
  };

  it("behält die Vorlage, verwirft Negativ und Denoise, CFG unbestimmt", () => {
    const p = hardenParams({ prompt: "make it rain", negativePrompt: "x", denoising: 0.4, cfg: 9, initImage: { ref: "a.png" } }, ctx);
    expect(p.initImage).toBe("a.png");
    expect(p.negativePrompt).toBe("");
    expect(p.denoising).toBeNull();
    expect(p.cfg).toBeNull();
  });
});

const params = (over: Partial<GenParams> = {}): GenParams => ({
  prompt: "a cat", negativePrompt: "", seed: 1, steps: 16, cfg: null, model: "unknown", width: 1344, height: 576,
  date: "2026-11-22T01:00:00", initImage: null, initCrop: null, denoising: null, ...over,
});

const comfyState = (over: Partial<PanelState> = {}): PanelState => ({
  initImage: null, initCrop: null, denoising: null, missingBytes: null, downloadedModels: [], builtinModel: "sd-turbo",
  showModelPicker: false, mode: "comfy", comfyLibrary: LIB, comfyTask: "txt2img", comfySelection: NO_SEL,
  engine: { kind: "not-downloaded" }, server: { kind: "ok", modelName: null }, playgroundShortcutName: "",
  run: { kind: "idle" }, image: null, editorActive: true, prompt: "a cat", negativePrompt: "", seed: 1, steps: 16,
  cfg: 7, width: 1344, height: 576, ...over,
});

const INIT = { path: "Bilder/turm.png", dataUrl: "data:image/png;base64,AAAA" };

describe("buildViewModel — ComfyUI-Aufgaben", () => {
  it("außerhalb von comfy gibt es keinen Aufgaben-Schalter", () => {
    expect(buildViewModel({ ...comfyState(), mode: "server" }).comfy).toBeNull();
  });

  it("listet die Aufgaben mit Freigabe und die Workflows der gewählten Rolle", () => {
    const vm = buildViewModel(comfyState());
    expect(vm.comfy?.tasks.map((t) => [t.task, t.enabled])).toEqual([["txt2img", true], ["edit", true], ["upscale", true]]);
    expect(vm.comfy?.options).toEqual([
      { file: "flux3-klein.api.json", label: "flux3-klein" },
      { file: "sdxl-pixel-art.api.json", label: "sdxl-pixel-art" },
    ]);
    expect(vm.comfy?.selected).toBe("flux3-klein.api.json");
  });

  it("eine Aufgabe ohne gültigen Workflow ist gesperrt und nennt den Grund", () => {
    const vm = buildViewModel(comfyState({ comfyLibrary: ONLY_TXT2IMG }));
    const edit = vm.comfy?.tasks.find((t) => t.task === "edit");
    expect(edit?.enabled).toBe(false);
    expect(edit?.reason).toMatch(/edit/i);
  });

  it("die gewählte Datei wird angezeigt", () => {
    const vm = buildViewModel(comfyState({ comfySelection: { ...NO_SEL, txt2img: "sdxl-pixel-art.api.json" } }));
    expect(vm.comfy?.selected).toBe("sdxl-pixel-art.api.json");
  });

  it("Erzeugen: Regler wie bisher, keine Vorlagen-Zeile auch mit gesetzter Vorlage", () => {
    const vm = buildViewModel(comfyState({ initImage: INIT }));
    expect(vm.controls).toMatchObject({ prompt: true, chips: true, negative: true, size: true, steps: true, seed: true, initImage: false, initRequired: false, denoising: false });
    expect(vm.generateLabel).toBe("generate");
    expect(vm.generateEnabled).toBe(true);
  });

  it("Bearbeiten: Anweisung, Vorlage Pflicht, Steps und Seed; kein Negativ, keine Größe, keine Chips", () => {
    const vm = buildViewModel(comfyState({ comfyTask: "edit", initImage: INIT }));
    expect(vm.controls).toMatchObject({ prompt: true, chips: false, negative: false, size: false, steps: true, seed: true, initImage: true, initRequired: true, denoising: false, cfg: false });
    expect(vm.generateLabel).toBe("edit");
    expect(vm.generateEnabled).toBe(true);
  });

  it("Bearbeiten ohne Vorlage ist gesperrt", () => {
    expect(buildViewModel(comfyState({ comfyTask: "edit" })).generateEnabled).toBe(false);
  });

  it("Hochskalieren: nur die Vorlage, kein Prompt nötig", () => {
    const vm = buildViewModel(comfyState({ comfyTask: "upscale", initImage: INIT, prompt: "" }));
    expect(vm.controls).toMatchObject({ prompt: false, chips: false, negative: false, size: false, steps: false, seed: false, initImage: true, initRequired: true });
    expect(vm.generateLabel).toBe("upscale");
    expect(vm.generateEnabled).toBe(true);
    expect(buildViewModel(comfyState({ comfyTask: "upscale", prompt: "" })).generateEnabled).toBe(false);
  });

  it("eine gesperrte Aufgabe ist nicht ausführbar", () => {
    expect(buildViewModel(comfyState({ comfyLibrary: ONLY_TXT2IMG, comfyTask: "edit", initImage: INIT })).generateEnabled).toBe(false);
  });

  it("unverändertes Rezept sperrt auch im comfy-Modus, ein anderer Workflow gibt frei", () => {
    const image = { dataUrl: "data:,", params: params({ workflow: "flux3-klein.api.json" }) };
    expect(buildViewModel(comfyState({ image })).generateEnabled).toBe(false);
    expect(buildViewModel(comfyState({ image, comfySelection: { ...NO_SEL, txt2img: "sdxl-pixel-art.api.json" } })).generateEnabled).toBe(true);
    expect(buildViewModel(comfyState({ image, seed: 2 })).generateEnabled).toBe(true);
  });

  it("dasselbe Rezept in einer anderen Aufgabe sperrt nicht", () => {
    const image = { dataUrl: "data:,", params: params({ workflow: "flux3-klein.api.json" }) };
    expect(buildViewModel(comfyState({ image, comfyTask: "edit", initImage: INIT })).generateEnabled).toBe(true);
  });

  it("Ordner fehlt: Status nennt ihn, nichts ausführbar", () => {
    const vm = buildViewModel(comfyState({ comfyLibrary: { kind: "missing", folder: F } }));
    expect(vm.status.cls).toBe("is-error");
    expect(vm.status.text).toContain(F);
    expect(vm.generateEnabled).toBe(false);
    expect(vm.comfy?.tasks.every((t) => !t.enabled)).toBe(true);
  });
});
