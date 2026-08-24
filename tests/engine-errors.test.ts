import { describe, expect, it } from "vitest";
import { isOutOfMemoryError } from "../src/core/engine-errors";

// Eine echte `GPUOutOfMemoryError` ist ein `GPUError` (WebIDL-Interface), KEIN `Error` — sie
// erbt nicht von `Error.prototype`. WebIDL-Interfaces bekommen automatisch ein
// `Symbol.toStringTag`, ueber das `String(x)` (via `Object.prototype.toString`) den
// Interface-Namen liefert, auch ohne eigenes `toString()`. Diese Fake-Klasse bildet genau das
// nach, ohne einen echten GPU-Kontext zu brauchen.
class FakeGpuOutOfMemoryError {
  get [Symbol.toStringTag](): string { return "GPUOutOfMemoryError"; }
}

describe("isOutOfMemoryError", () => {
  it.each([
    ["std::bad_alloc (WASM-EP-Praezedenzfall, AGENTS.md)", new Error("Uncaught std::bad_alloc")],
    ["Emscripten-Heap-Abbruch", new Error("Aborted(OOM). Build with -sASSERTIONS for more info.")],
    ["V8-Puffer-Allokation", new RangeError("Array buffer allocation failed")],
    ["WebGPU-Spec-Fehlername", new Error("GPUOutOfMemoryError: buffer allocation failed")],
    ["reiner Text statt Error-Objekt", "device lost: out of memory"],
    ["Gross-/Kleinschreibung ist egal", new Error("BAD_ALLOC")],
    ["echte GPUOutOfMemoryError-Form (kein Error, nur Symbol.toStringTag)", new FakeGpuOutOfMemoryError()],
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
