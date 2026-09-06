import { describe, expect, it } from "vitest";
import { A1111Client, parseOptionsModel, parseProgressPct, ProgressPoller, statusUrlFor } from "../src/core/txt2img";

const req = { prompt: "a cat", negativePrompt: "blurry", width: 768, height: 512, steps: 20, seed: 42, cfg: 7,
  initImageData: null, denoising: null };

describe("A1111Client", () => {
  it("mappt das Rezept auf den A1111-Body und liefert images[0]", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const client = new A1111Client("http://127.0.0.1:7860/", async (url, body) => {
      captured = { url, body };
      return { status: 200, json: { images: ["BASE64PNG"] } };
    });
    const png = await client.generate(req);
    expect(png).toBe("BASE64PNG");
    expect(captured!.url).toBe("http://127.0.0.1:7860/sdapi/v1/txt2img");
    expect(captured!.body).toEqual({
      prompt: "a cat", negative_prompt: "blurry", width: 768, height: 512,
      steps: 20, seed: 42, cfg_scale: 7,
    });
  });
  it("wirft Klartext bei HTTP != 200", async () => {
    const client = new A1111Client("http://x", async () => ({ status: 500, json: {} }));
    await expect(client.generate(req)).rejects.toThrow("txt2img HTTP 500");
  });
  it("wirft bei leerem/fehlendem images", async () => {
    const client = new A1111Client("http://x", async () => ({ status: 200, json: { images: [] } }));
    await expect(client.generate(req)).rejects.toThrow("txt2img: empty result");
  });
});

describe("A1111Client — img2img", () => {
  function client(sink: { url: string; body: any }[], status = 200) {
    return new A1111Client("http://127.0.0.1:7860", async (url, body) => {
      sink.push({ url, body: body as any });
      return { status, json: { images: ["BASE64PNG"] } };
    });
  }

  it("ohne Vorlage geht der Auftrag unveraendert an txt2img", async () => {
    const gesehen: { url: string; body: any }[] = [];
    await client(gesehen).generate({ ...req, initImageData: null, denoising: null });
    expect(gesehen[0]!.url).toBe("http://127.0.0.1:7860/sdapi/v1/txt2img");
    expect(gesehen[0]!.body).not.toHaveProperty("init_images");
    expect(gesehen[0]!.body).not.toHaveProperty("denoising_strength");
  });

  it("mit Vorlage geht der Auftrag an img2img, mit init_images und denoising_strength", async () => {
    const gesehen: { url: string; body: any }[] = [];
    await client(gesehen).generate({ ...req, initImageData: "AAAA", denoising: 0.4 });
    expect(gesehen[0]!.url).toBe("http://127.0.0.1:7860/sdapi/v1/img2img");
    expect(gesehen[0]!.body.init_images).toEqual(["AAAA"]);
    expect(gesehen[0]!.body.denoising_strength).toBe(0.4);
    // Alles Uebrige bleibt wie bei txt2img — derselbe Endpunktstil, ein zusaetzliches Feld.
    expect(gesehen[0]!.body.prompt).toBe("a cat");
    expect(gesehen[0]!.body.cfg_scale).toBe(7);
  });

  it("nennt den benutzten Endpunkt in der Fehlermeldung", async () => {
    await expect(client([], 500).generate({ ...req, initImageData: "AAAA", denoising: 0.4 }))
      .rejects.toThrow("img2img HTTP 500");
    await expect(client([], 500).generate({ ...req, initImageData: null, denoising: null }))
      .rejects.toThrow("txt2img HTTP 500");
  });
});

describe("parseOptionsModel", () => {
  it("liest sd_model_checkpoint", () => {
    expect(parseOptionsModel({ sd_model_checkpoint: "flux.2-klein" })).toBe("flux.2-klein");
  });
  // Draw Things nennt das Feld `model` statt `sd_model_checkpoint` — verifiziert am
  // laufenden Server (0.5.0-Smoke, 2026-08-03: GET /sdapi/v1/options → model:
  // "flux_2_dev_i8x.ckpt", kein sd_model_checkpoint). Ohne diesen Zweig blieb der
  // Modellname null und landete als "unknown" im Frontmatter der Ergebnis-Notiz.
  it("liest Draw Things' model-Feld", () => {
    expect(parseOptionsModel({ model: "flux_2_dev_i8x.ckpt" })).toBe("flux_2_dev_i8x.ckpt");
  });
  it("bevorzugt sd_model_checkpoint, wenn beide Felder da sind", () => {
    expect(parseOptionsModel({ sd_model_checkpoint: "a1111.safetensors", model: "andere.ckpt" })).toBe("a1111.safetensors");
  });
  it("null bei fremder Form", () => {
    expect(parseOptionsModel({})).toBeNull();
    expect(parseOptionsModel(null)).toBeNull();
    expect(parseOptionsModel("x")).toBeNull();
    expect(parseOptionsModel({ model: 42 })).toBeNull();
    expect(parseOptionsModel({ model: "" })).toBeNull();
  });
});

describe("parseProgressPct", () => {
  it("skaliert progress 0..1 auf ganze Prozent", () => {
    expect(parseProgressPct({ progress: 0.42 })).toBe(42);
  });
  it("null bei fehlendem/kaputtem Feld", () => {
    expect(parseProgressPct({})).toBeNull();
    expect(parseProgressPct(null)).toBeNull();
    expect(parseProgressPct({ progress: "x" })).toBeNull();
  });
});

describe("ProgressPoller", () => {
  const url = "http://127.0.0.1:7860/sdapi/v1/progress";
  function poller(get: (url: string) => Promise<{ status: number; json: unknown }>) {
    const calls: string[] = [];
    const p = new ProgressPoller("http://127.0.0.1:7860/", async (u) => { calls.push(u); return get(u); });
    return { p, calls };
  }

  it("liefert bei 200 die Prozent und fragt weiter", async () => {
    const { p, calls } = poller(async () => ({ status: 200, json: { progress: 0.25 } }));
    expect(await p.poll()).toBe(25);
    expect(await p.poll()).toBe(25);
    expect(calls).toEqual([url, url]);
  });

  it("stellt nach dem ersten 404 das Fragen ein — Server kennt den Endpunkt nicht", async () => {
    const { p, calls } = poller(async () => ({ status: 404, json: undefined }));
    expect(await p.poll()).toBeNull();
    expect(await p.poll()).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("fragt nach einem Timeout weiter — vorübergehende Störung", async () => {
    const { p, calls } = poller(async () => { throw new Error("timeout after 1000 ms"); });
    expect(await p.poll()).toBeNull();
    expect(await p.poll()).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("fragt nach einem 5xx weiter — vorübergehende Störung", async () => {
    const { p, calls } = poller(async () => ({ status: 503, json: undefined }));
    expect(await p.poll()).toBeNull();
    expect(await p.poll()).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe("statusUrlFor", () => {
  it("waehlt den Status-Endpunkt nach Modus", () => {
    expect(statusUrlFor("server", "http://127.0.0.1:7860/")).toBe("http://127.0.0.1:7860/sdapi/v1/options");
    expect(statusUrlFor("comfy", "http://127.0.0.1:8188")).toBe("http://127.0.0.1:8188/system_stats");
  });
});
