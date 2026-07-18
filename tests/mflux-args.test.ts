import { describe, expect, it } from "vitest";
import { buildMfluxArgs, buildMfluxEnv } from "../src/core/mflux-args";
import { getModel } from "../src/core/models";

describe("buildMfluxArgs", () => {
  it("baut die verifizierte Flag-Liste (Global Constraints)", () => {
    const args = buildMfluxArgs(
      getModel("flux2-klein-4b"),
      { prompt: "an apple", seed: 7, steps: 4, width: 1024, height: 576 },
      "/tmp/out.png",
    );
    expect(args).toEqual([
      "--model", "flux2-klein-4b",
      "--quantize", "8",
      "--prompt", "an apple",
      "--seed", "7",
      "--steps", "4",
      "--width", "1024",
      "--height", "576",
      "--output", "/tmp/out.png",
    ]);
  });
  it("wirft für Modelle ohne mflux-Block (sd-turbo)", () => {
    expect(() =>
      buildMfluxArgs(getModel("sd-turbo"), { prompt: "x", seed: 1, steps: 1, width: 512, height: 512 }, "/t.png"),
    ).toThrow(/mflux/);
  });
});

describe("buildMfluxEnv", () => {
  it("leerer modelsDir → keine Overrides", () => {
    expect(buildMfluxEnv("")).toEqual({});
  });
  it("gesetzter modelsDir → HF_HOME", () => {
    expect(buildMfluxEnv("/Volumes/ssd/models")).toEqual({ HF_HOME: "/Volumes/ssd/models" });
  });
});
