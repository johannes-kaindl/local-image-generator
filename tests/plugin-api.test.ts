import { describe, expect, it, vi } from "vitest";
import { createImageGenerationApi, IMAGE_GENERATION_API_VERSION, type ApiDeps } from "../src/core/plugin-api";
import { BUILTIN_MODEL } from "../src/core/model-manifest";

const params = {
  prompt: "a cat", negativePrompt: "", seed: 7, steps: 4, cfg: 1,
  model: BUILTIN_MODEL.id, width: 512, height: 512, date: "2026-08-22T22:15:00",
};

function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    getMode: () => "builtin",
    readiness: () => ({ ready: true, reason: null }),
    isBusy: () => false,
    harden: () => params,
    run: async () => ({ ok: true, base64: "PNGDATA" }),
    save: async () => ({ ok: true, imagePath: "img.png", notePath: null }),
    defaultCreateNote: () => false,
    ...over,
  };
}

describe("status()", () => {
  it("meldet Version, Modus und die Faehigkeiten des Backends", () => {
    const s = createImageGenerationApi(deps()).status();
    expect(s.apiVersion).toBe(IMAGE_GENERATION_API_VERSION);
    expect(s.engine).toBe("builtin");
    expect(s.ready).toBe(true);
    expect(s.reason).toBeNull();
    expect(s.capabilities).toEqual({
      negativePrompt: false, cfg: false,
      maxSteps: BUILTIN_MODEL.steps.max,
      fixedSize: { width: BUILTIN_MODEL.size, height: BUILTIN_MODEL.size },
    });
  });

  it("meldet busy als Grund, auch wenn das Backend bereit waere", () => {
    const s = createImageGenerationApi(deps({ isBusy: () => true })).status();
    expect(s.ready).toBe(false);
    expect(s.reason).toBe("busy");
  });

  it("reicht den Bereitschaftsgrund durch", () => {
    const s = createImageGenerationApi(
      deps({ readiness: () => ({ ready: false, reason: "model-not-downloaded" }) }),
    ).status();
    expect(s.reason).toBe("model-not-downloaded");
  });
});

describe("generate()", () => {
  it("liefert Base64 und die TATSAECHLICH gerechneten Parameter", async () => {
    const r = await createImageGenerationApi(deps()).generate({ prompt: "a cat" });
    expect(r).toEqual({
      ok: true,
      image: {
        base64: "PNGDATA",
        params: {
          prompt: "a cat", negativePrompt: "", seed: 7, steps: 4, cfg: 1,
          model: BUILTIN_MODEL.id, width: 512, height: 512,
          created: "2026-08-22T22:15:00",
        },
      },
    });
  });

  it("sagt busy ab, ohne zu rechnen", async () => {
    const run = vi.fn();
    const r = await createImageGenerationApi(deps({ isBusy: () => true, run })).generate({ prompt: "x" });
    expect(r).toEqual({ ok: false, reason: "busy" });
    expect(run).not.toHaveBeenCalled();
  });

  it("laedt NIE nach, wenn das Modell fehlt", async () => {
    const run = vi.fn();
    const r = await createImageGenerationApi(
      deps({ readiness: () => ({ ready: false, reason: "model-not-downloaded" }), run }),
    ).generate({ prompt: "x" });
    expect(r).toEqual({ ok: false, reason: "model-not-downloaded" });
    expect(run).not.toHaveBeenCalled();
  });

  it("gibt die rohe Backend-Meldung als failed zurueck", async () => {
    const r = await createImageGenerationApi(
      deps({ run: async () => ({ ok: false, message: "txt2img HTTP 500" }) }),
    ).generate({ prompt: "x" });
    expect(r).toEqual({ ok: false, reason: "failed", message: "txt2img HTTP 500" });
  });

  it("reicht onProgress an das Backend durch", async () => {
    let seen: unknown = null;
    const onProgress = (): void => undefined;
    await createImageGenerationApi(
      deps({ run: async (_p, cb) => { seen = cb; return { ok: true, base64: "X" }; } }),
    ).generate({ prompt: "x", onProgress });
    expect(seen).toBe(onProgress);
  });
});
