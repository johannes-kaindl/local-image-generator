import { describe, expect, it } from "vitest";
import { parseOptionsModel, parseProgressPct, Txt2ImgClient } from "../src/core/txt2img";

const req = { prompt: "a cat", negativePrompt: "blurry", width: 768, height: 512, steps: 20, seed: 42, cfg: 7 };

describe("Txt2ImgClient", () => {
  it("mappt das Rezept auf den A1111-Body und liefert images[0]", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const client = new Txt2ImgClient("http://127.0.0.1:7860/", async (url, body) => {
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
    const client = new Txt2ImgClient("http://x", async () => ({ status: 500, json: {} }));
    await expect(client.generate(req)).rejects.toThrow("txt2img HTTP 500");
  });
  it("wirft bei leerem/fehlendem images", async () => {
    const client = new Txt2ImgClient("http://x", async () => ({ status: 200, json: { images: [] } }));
    await expect(client.generate(req)).rejects.toThrow("txt2img: empty result");
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
