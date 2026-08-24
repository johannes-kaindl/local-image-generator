import { describe, expect, it } from "vitest";
import { isOutOfMemoryError } from "../src/core/engine-errors";

describe("isOutOfMemoryError", () => {
  it.each([
    ["std::bad_alloc (WASM-EP-Praezedenzfall, AGENTS.md)", new Error("Uncaught std::bad_alloc")],
    ["Emscripten-Heap-Abbruch", new Error("Aborted(OOM). Build with -sASSERTIONS for more info.")],
    ["V8-Puffer-Allokation", new RangeError("Array buffer allocation failed")],
    ["WebGPU-Spec-Fehlername", new Error("GPUOutOfMemoryError: buffer allocation failed")],
    ["reiner Text statt Error-Objekt", "device lost: out of memory"],
    ["Gross-/Kleinschreibung ist egal", new Error("BAD_ALLOC")],
  ])("erkennt: %s", (_label, err) => {
    expect(isOutOfMemoryError(err)).toBe(true);
  });

  it.each([
    ["ein unverwandter Fehler", new Error("network timeout")],
    ["ein Checksummen-Fehler", new Error("Checksum mismatch for unet/model.onnx")],
    ["undefined", undefined],
    ["ein Objekt ohne message", { foo: "bar" }],
    ["leerer String", ""],
  ])("erkennt NICHT: %s", (_label, err) => {
    expect(isOutOfMemoryError(err)).toBe(false);
  });
});
