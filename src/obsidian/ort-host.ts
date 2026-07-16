// Adapter zu onnxruntime-web (Spec §4): WASM base64-inline (Store-Regel: kein
// Laufzeit-Nachladen von Code), WebGPU-EP, Sessions als schmales Session-Interface.
//
// Step-1-Verifikation (onnxruntime-web@1.27.0):
//   - `ls dist/*.wasm` → `ort-wasm-simd-threaded.jsep.wasm` existiert (JSEP =
//     WebGPU-Build, ~25,6 MB). Dateiname unverändert übernommen.
//   - `exports` enthält `./webgpu` → default: `dist/ort.webgpu.bundle.min.mjs`.
//     Der `.bundle.`-Build inlint das mjs-WASM-Glue selbst; zusammen mit dem
//     hier per `env.wasm.wasmBinary` gesetzten Binary bleibt alles in main.js
//     (kein Sidecar-Fetch, kein Blob-URL-Worker). Import bleibt `.../webgpu`.
import * as ort from "onnxruntime-web/webgpu";
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm";
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
        result[name] = { data: t.data as OrtValue["data"], dims: t.dims };
      }
      return result;
    },
  };
}
