import { describe, expect, it } from "vitest";
import { parseMfluxLine, splitChunks } from "../src/core/mflux-output";

describe("parseMfluxLine", () => {
  it("HF-Download-Zeile (tqdm mit Byte-Einheiten und Datei-Prefix)", () => {
    expect(
      parseMfluxLine("model-00001-of-00002.safetensors:  45%|████      | 2.25G/5.00G [01:00<01:10, 39.2MB/s]"),
    ).toEqual({ kind: "download", file: "model-00001-of-00002.safetensors", pct: 45 });
  });
  it("Download-Zeile ohne Datei-Prefix → file 'model'", () => {
    expect(parseMfluxLine("Fetching 12 files:  30%|███       | 3.60G/12.0G [00:40<01:30, 95MB/s]")).toEqual({
      kind: "download",
      file: "Fetching 12 files",
      pct: 30,
    });
  });
  it("Generierungs-Step (kleine Totale, keine Byte-Einheiten)", () => {
    expect(parseMfluxLine(" 50%|█████     | 2/4 [00:05<00:05,  2.50s/it]")).toEqual({ kind: "step", step: 2, total: 4 });
  });
  it("unbekannte Zeilen → null (kein Fehler)", () => {
    expect(parseMfluxLine("Loading transformer weights…")).toBeNull();
    expect(parseMfluxLine("")).toBeNull();
    expect(parseMfluxLine("100 things happened")).toBeNull();
  });
});

describe("splitChunks", () => {
  it("trennt an \\r und \\n und puffert Unvollständiges", () => {
    const a = splitChunks("", " 25%|██| 1/4 [\r 50%|███");
    expect(a.lines).toEqual([" 25%|██| 1/4 ["]);
    expect(a.rest).toBe(" 50%|███");
    const b = splitChunks(a.rest, "██| 2/4 [\n");
    expect(b.lines).toEqual([" 50%|█████| 2/4 ["]);
    expect(b.rest).toBe("");
  });
});
