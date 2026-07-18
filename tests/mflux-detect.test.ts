import { describe, expect, it } from "vitest";
import { hfSnapshotDir, resolveMfluxBinary } from "../src/core/mflux-detect";

describe("resolveMfluxBinary", () => {
  const HOME = "/Users/jay";
  it("konfigurierter Pfad gewinnt, wenn er existiert", () => {
    expect(resolveMfluxBinary("/custom/mflux-generate-flux2", HOME, (p) => p === "/custom/mflux-generate-flux2")).toBe(
      "/custom/mflux-generate-flux2",
    );
  });
  it("konfigurierter Pfad, der nicht existiert → null (KEIN stiller Fallback auf Auto-Detect)", () => {
    expect(resolveMfluxBinary("/custom/missing", HOME, () => false)).toBeNull();
  });
  it("Auto-Detect probiert ~/.local/bin, /opt/homebrew/bin, /usr/local/bin (in dieser Reihenfolge)", () => {
    const tried: string[] = [];
    const r = resolveMfluxBinary("", HOME, (p) => {
      tried.push(p);
      return p === "/opt/homebrew/bin/mflux-generate-flux2";
    });
    expect(r).toBe("/opt/homebrew/bin/mflux-generate-flux2");
    expect(tried[0]).toBe("/Users/jay/.local/bin/mflux-generate-flux2");
  });
  it("nichts gefunden → null", () => {
    expect(resolveMfluxBinary("", HOME, () => false)).toBeNull();
  });
});

describe("hfSnapshotDir", () => {
  it("Default-Cache unter <home>/.cache/huggingface", () => {
    expect(hfSnapshotDir("", "/Users/jay", "black-forest-labs/FLUX.2-klein-4B")).toBe(
      "/Users/jay/.cache/huggingface/hub/models--black-forest-labs--FLUX.2-klein-4B/snapshots",
    );
  });
  it("modelsDir überschreibt die Basis (HF_HOME-Semantik)", () => {
    expect(hfSnapshotDir("/Volumes/ssd/hf", "/Users/jay", "black-forest-labs/FLUX.2-klein-4B")).toBe(
      "/Volumes/ssd/hf/hub/models--black-forest-labs--FLUX.2-klein-4B/snapshots",
    );
  });
});
