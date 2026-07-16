// Adapter zu onnxruntime-web (Spec §4): WASM base64-inline (Store-Regel: kein
// Laufzeit-Nachladen von Code), WebGPU-EP, Sessions als schmales Session-Interface.
//
// WASM-Variante MUSS zum Glue des importierten Bundles passen (Smoke-Test-Befund
// 2026-07-16): `onnxruntime-web/webgpu` → `ort.webgpu.bundle.min.mjs` referenziert
// in 1.27 `ort-wasm-simd-threaded.asyncify.wasm` (NICHT mehr die jsep-Variante —
// deren Export-Tabelle weicht in 62/35 Namen ab). Falsche Paarung bricht die
// interne Init mit "XA.$b is not a function" und `InferenceSession.create`
// resolved nie (Hänger auf "Generating"). Prüfbefehl bei ORT-Upgrades:
//   grep -o '[a-z.-]*\.wasm' dist/ort.webgpu.bundle.min.mjs | sort -u
//   → genau diese Datei unten importieren.
// Der `.bundle.`-Build inlint das mjs-Glue; zusammen mit `env.wasm.wasmBinary`
// bleibt alles in main.js (kein Sidecar-Fetch, kein Blob-URL-Worker).
import * as ort from "onnxruntime-web/webgpu";
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm";
import type { OrtValue, Session } from "../core/engine";

let initialized = false;

function initOrt(): void {
  if (initialized) return;
  ort.env.wasm.wasmBinary = ortWasm.buffer.slice(
    ortWasm.byteOffset,
    ortWasm.byteOffset + ortWasm.byteLength,
  ) as ArrayBuffer;
  ort.env.wasm.numThreads = 1; // keine Worker-Spawns aus Blob-URLs (Electron-CSP)
  initialized = true;
}

export async function checkGpu(): Promise<"ok" | "no-webgpu" | "no-f16"> {
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> };
    }
  ).gpu;
  if (!gpu) return "no-webgpu";
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return "no-webgpu";
  return adapter.features.has("shader-f16") ? "ok" : "no-f16";
}

function dtypeOf(v: OrtValue): "float32" | "float16" | "int32" | "int64" {
  if (v.data instanceof Float32Array) return "float32";
  if (v.data instanceof Uint16Array) return "float16";
  if (v.data instanceof Int32Array) return "int32";
  return "int64";
}

export async function createOrtSession(buf: ArrayBuffer): Promise<Session> {
  initOrt();
  const session = await ort.InferenceSession.create(buf, {
    executionProviders: ["webgpu"],
  });
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async run(
      feeds: Record<string, OrtValue>,
    ): Promise<Record<string, OrtValue>> {
      const ortFeeds: Record<string, ort.Tensor> = {};
      for (const [name, v] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor(dtypeOf(v), v.data, v.dims as number[]);
      }
      const out = await session.run(ortFeeds);
      const result: Record<string, OrtValue> = {};
      for (const [name, t] of Object.entries(out)) {
        result[name] = { data: toOrtData(name, t.data), dims: t.dims };
      }
      return result;
    },
    release: () => session.release(),
  };
}

// Validiert, dass ein ORT-Output-Tensor eines der vier OrtValue-Dtypes trägt.
// Sonderfall Float16Array: künftige ORT-Versionen könnten fp16-Outputs als
// echtes Float16Array liefern — dessen Buffer als Uint16Array re-wrappen, damit
// die pure Pipeline (die fp16 als Uint16Array-Rohbits erwartet) unverändert läuft.
function toOrtData(name: string, data: unknown): OrtValue["data"] {
  if (
    data instanceof Float32Array ||
    data instanceof Uint16Array ||
    data instanceof Int32Array ||
    data instanceof BigInt64Array
  ) {
    return data;
  }
  const F16 = (globalThis as { Float16Array?: new (...a: never[]) => ArrayBufferView }).Float16Array;
  if (F16 && data instanceof F16) {
    const t = data as ArrayBufferView & { length: number };
    return new Uint16Array(t.buffer, t.byteOffset, t.length);
  }
  const ctor = (data as { constructor?: { name?: string } })?.constructor?.name ?? typeof data;
  throw new Error(`unexpected output dtype for "${name}": ${ctor}`);
}
