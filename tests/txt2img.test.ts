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
  it("null bei fremder Form", () => {
    expect(parseOptionsModel({})).toBeNull();
    expect(parseOptionsModel(null)).toBeNull();
    expect(parseOptionsModel("x")).toBeNull();
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
