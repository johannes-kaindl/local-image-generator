import { describe, expect, it, vi } from "vitest";
import { createImageGenerationApi, IMAGE_GENERATION_API_VERSION, type ApiDeps } from "../src/core/plugin-api";
import { BUILTIN_MODELS } from "../src/core/model-manifest";
import { STEPS } from "../src/core/generation";

const params = {
  prompt: "a cat", negativePrompt: "", seed: 7, steps: 4, cfg: 1,
  initImage: null, denoising: null,
  model: BUILTIN_MODELS["sd-turbo"].id, width: 512, height: 512, date: "2026-08-22T22:15:00",
};

function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    getMode: () => "builtin",
    builtinModel: () => "sd-turbo",
    readiness: () => ({ ready: true }),
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
      negativePrompt: false, cfg: false, initImage: false,
      maxSteps: BUILTIN_MODELS["sd-turbo"].steps.max,
      fixedSize: BUILTIN_MODELS["sd-turbo"].sizes[0],
      sizes: BUILTIN_MODELS["sd-turbo"].sizes,
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

  it("meldet im Server-Modus die vollen Faehigkeiten", () => {
    const s = createImageGenerationApi(deps({ getMode: () => "server" })).status();
    expect(s.engine).toBe("server");
    expect(s.capabilities).toEqual({
      negativePrompt: true, cfg: true, initImage: true, maxSteps: STEPS.max, fixedSize: null, sizes: null,
    });
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
          model: BUILTIN_MODELS["sd-turbo"].id, width: 512, height: 512,
          created: "2026-08-22T22:15:00",
          // `denoising` gehoert zum Vertrag (null = es war kein img2img); der interne
          // Vault-PFAD `initImage` gehoert NICHT hinein — er heisst im Vertrag etwas anderes.
          denoising: null,
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

  it("status() und generate() nennen denselben Grund fuer denselben Zustand", async () => {
    const d = deps({
      getMode: () => "server",
      readiness: () => ({ ready: false, reason: "not-configured" }),
    });
    const api = createImageGenerationApi(d);
    const r = await api.generate({ prompt: "x" });
    expect(api.status().reason).toBe("not-configured");
    expect(r).toEqual({ ok: false, reason: "not-configured" });
  });
});

describe("generate() — img2img", () => {
  it("meldet die img2img-Faehigkeit in capabilities", () => {
    expect(createImageGenerationApi(deps({ getMode: () => "server" })).status().capabilities.initImage).toBe(true);
    expect(createImageGenerationApi(deps()).status().capabilities.initImage).toBe(false);
  });

  // Der Vertrag nimmt BASE64, die Haertung nimmt { ref } — ein bequemes `harden(req)` haette
  // zwei Megabyte Base64 ins Pfad-Feld gelegt und als `init_image: [[…]]` in die Notiz
  // geschrieben. Dieser Test haelt die UEBERSETZUNG fest, nicht das Durchreichen.
  it("uebersetzt Base64 in eine pfadlose Vorlage, statt es ins Pfad-Feld zu legen", async () => {
    let gesehen: unknown = null;
    const api = createImageGenerationApi(deps({ harden: (i) => { gesehen = i; return params; } }));
    await api.generate({ prompt: "x", initImage: "AAAA", denoising: 0.4 });
    expect((gesehen as { initImage: unknown }).initImage).toEqual({ ref: null });
    expect((gesehen as { denoising: unknown }).denoising).toBe(0.4);
    expect(JSON.stringify(gesehen)).not.toContain("AAAA");
  });

  it("reicht die Bytes am Rezept vorbei ans Backend", async () => {
    let auftrag: unknown = null;
    const api = createImageGenerationApi(
      deps({
        run: async (_p, _o, initImageData) => { auftrag = initImageData; return { ok: true, base64: "PNG" }; },
      }),
    );
    await api.generate({ prompt: "x", initImage: "AAAA" });
    expect(auftrag).toBe("AAAA");
  });

  it("ohne Vorlage bleibt die Haertung bei undefined", async () => {
    let gesehen: unknown = null;
    const api = createImageGenerationApi(deps({ harden: (i) => { gesehen = i; return params; } }));
    await api.generate({ prompt: "x" });
    expect((gesehen as { initImage: unknown }).initImage).toBeUndefined();
  });

  it("apiVersion bleibt 1 — die Erweiterung ist additiv", () => {
    expect(createImageGenerationApi(deps()).status().apiVersion).toBe(1);
  });
});

describe("save()", () => {
  // `params` (oben in der Datei) ist die INTERNE Form mit `date`; der Vertrag traegt
  // `created`. Hier bewusst umgeschrieben statt gespreizt, damit kein `date` mitreist.
  const { date, ...rest } = params;
  const image = { base64: "PNGDATA", params: { ...rest, created: date } };

  it("folgt der Nutzer-Einstellung, wenn der Aufrufer nichts sagt", async () => {
    let seen: boolean | null = null;
    const api = createImageGenerationApi(
      deps({
        defaultCreateNote: () => true,
        save: async (_img, createNote) => { seen = createNote; return { ok: true, imagePath: "a.png", notePath: "a.md" }; },
      }),
    );
    const r = await api.save(image);
    expect(seen).toBe(true);
    expect(r).toEqual({ ok: true, imagePath: "a.png", notePath: "a.md" });
  });

  it("laesst den Aufrufer die Einstellung ueberstimmen", async () => {
    let seen: boolean | null = null;
    const api = createImageGenerationApi(
      deps({
        defaultCreateNote: () => true,
        save: async (_img, createNote) => { seen = createNote; return { ok: true, imagePath: "a.png", notePath: null }; },
      }),
    );
    await api.save(image, { createNote: false });
    expect(seen).toBe(false);
  });

  // Der Vertrag sagt: `save()` nimmt das, was `generate()` geliefert hat. Ein Konsument kann
  // die Params aber verändern, bevor er sie zurückreicht — und `save()` formt daraus einen
  // VAULT-PFAD (buildImageFilename interpoliert `created` und `seed` direkt). Ohne Prüfung
  // ergibt ein kaputtes `created` den Dateinamen `lig-NaNNaNNaN-NaNNaNNaN-s7.png`, und ein
  // `seed`, der zur Laufzeit kein number ist (TS schützt einen JS-Aufrufer nicht), formt den
  // Pfad frei mit. Keine Rechteausweitung — wer die API rufen kann, kann auch app.vault —
  // aber ein buggy Nachbar soll keinen Pfad formen, den niemand gemeint hat.
  it("schreibt NICHT, wenn `created` kein lesbarer Zeitstempel ist", async () => {
    let geschrieben = false;
    const api = createImageGenerationApi(
      deps({ save: async () => { geschrieben = true; return { ok: true, imagePath: "a.png", notePath: null }; } }),
    );
    const r = await api.save({ ...image, params: { ...image.params, created: "kaputt" } });
    expect(geschrieben).toBe(false);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "write-failed" });
  });

  it("schreibt NICHT, wenn `seed` keine endliche Zahl ist", async () => {
    let geschrieben = false;
    const mk = () =>
      deps({ save: async () => { geschrieben = true; return { ok: true, imagePath: "a.png", notePath: null }; } });

    const nan = await createImageGenerationApi(mk()).save({ ...image, params: { ...image.params, seed: Number.NaN } });
    expect(nan).toMatchObject({ ok: false, reason: "write-failed" });

    // Ein JS-Aufrufer ohne TypeScript kann hier alles hineinlegen — genau der Fall, für den
    // die Prüfung da ist. Der Cast steht für "was zur Laufzeit ankommen kann", nicht für
    // erlaubte Nutzung des Vertrags.
    const pfad = await createImageGenerationApi(mk()).save({
      ...image,
      params: { ...image.params, seed: "../../geheim" as unknown as number },
    });
    expect(pfad).toMatchObject({ ok: false, reason: "write-failed" });

    expect(geschrieben).toBe(false);
  });

  it("meldet einen Schreibfehler als Wert", async () => {
    const api = createImageGenerationApi(
      deps({ save: async () => ({ ok: false, reason: "write-failed", message: "EACCES" }) }),
    );
    await expect(api.save(image)).resolves.toEqual({ ok: false, reason: "write-failed", message: "EACCES" });
  });
});
