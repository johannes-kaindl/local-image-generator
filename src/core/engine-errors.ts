// Spec-Luecke §8 Punkt 1: "Session-Aufbau scheitert an knappem Speicher" bekommt einen lesbaren
// Zustand in der Statuszeile statt eines rohen Fehlertexts. Kein Ewig-Spinner entsteht dafuer
// bereits generisch (jeder Wurf aus `createOrtSession`/`loadPart` landet im `catch` von
// `runGeneration`, src/main.ts) — diese Datei entscheidet nur, OB der Text als "kein Speicher"
// gelesen werden darf, nicht OB ueberhaupt ein Fehlerzustand entsteht.
//
// Kein zuverlaessiges Signal ist gemessen fuer den tatsaechlichen Pfad (WebGPU-EP im Renderer).
// Gemessen ist nur ein Nachbarfall: dasselbe UNet (4,78 GiB) unter dem WASM-EP (onnxruntime-node,
// `scripts/verify-model.mjs`) stirbt mit `std::bad_alloc` (AGENTS.md, "Ein Modell ueber 2 GiB
// geht nur ... unter WebGPU"). Der C++-Kern ist derselbe ueber beide EPs; ein Allokations-
// fehlschlag traegt deshalb plausibel dasselbe Vokabular, auch im WebGPU-Pfad — belegt ist das
// NICHT. Dazu kommen die bekannten Vokabeln der beiden Schichten, durch die die Gewichte laufen,
// bevor sie auf der GPU landen (AGENTS.md, Glue-Callback schreibt zuerst in `HEAPU8`):
// Emscripten bricht Wasm-Heap-Erschoepfung mit "Aborted(OOM)" ab, und ein zu grosser
// JS-Puffer wirft eine `RangeError` mit "Array buffer allocation failed" (V8) oder schlicht
// "out of memory". Das WebGPU-Spec-Objekt fuer einen abgelehnten `requestDevice`/Buffer-Erwerb
// heisst `GPUOutOfMemoryError`.
//
// Das ist eine Bestenfalls-Heuristik auf Fehlertext, keine Garantie. Trifft sie nicht zu, bleibt
// der generische Pfad (`status.error` mit der rohen Meldung) — lesbar, aber nicht freundlich.
// Genau das ist die im Task-Auftrag verlangte ehrliche Rueckfallebene.
const OOM_SIGNALS = [
  "bad_alloc",
  "out of memory",
  "aborted(oom)",
  "gpuoutofmemoryerror",
  "array buffer allocation failed",
] as const;

/** Reiner Klassifizierer, keine I/O. Nimmt, was ein `catch` auch immer faengt (Error, String,
 *  etwas Fremdes) — dieselbe Grosszuegigkeit, die `runGeneration` schon fuer `e instanceof Error`
 *  braucht. */
export function isOutOfMemoryError(e: unknown): boolean {
  const text = errorText(e).toLowerCase();
  if (text.length === 0) return false;
  return OOM_SIGNALS.some((signal) => text.includes(signal));
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name} ${e.message}`;
  if (typeof e === "string") return e;
  return "";
}
