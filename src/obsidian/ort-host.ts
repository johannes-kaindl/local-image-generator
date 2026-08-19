// zurueckgeholt aus local-image-generator@0.4.4, 2026-08-19 — Anpassung 0.6: das WASM-Binary
// kommt nicht mehr inline aus main.js, sondern als Asset aus der Cache API (Spec 0.6 §3/§5).
//
// Adapter zu onnxruntime-web: WebGPU-EP, Sessions als schmales Session-Interface der pure Engine.
//
// WASM-Paarung (Smoke-Test-Befund 2026-07-16): das Binary MUSS zum Glue des importierten Bundles
// passen — `onnxruntime-web/webgpu` referenziert `ort-wasm-simd-threaded.asyncify.wasm` (NICHT
// jsep; deren Export-Tabellen weichen ab). Falsche Paarung bricht die interne Init lautlos und
// `InferenceSession.create` resolved nie. Seit 0.6 prüft `scripts/build-assets.mjs` die Paarung
// maschinell: es liest den referenzierten Dateinamen aus dem Bundle und hasht genau diese Datei
// ins Manifest (Gate: npm run check:manifest).
import * as ort from "onnxruntime-web/webgpu";
import type { OrtValue, Session } from "../core/engine";

let initialized = false;

/** Einmalig pro Sitzung: WASM-Binary aus dem Cache setzen, bevor die erste Session entsteht.
 *  Danach lädt ORT nichts mehr nach (kein Sidecar-Fetch, kein Blob-URL-Worker). */
export function initOrt(wasmBinary: ArrayBuffer): void {
  if (initialized) return;
  ort.env.wasm.wasmBinary = wasmBinary;
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
  if (!initialized) throw new Error("ort-host: initOrt() must run before the first session");
  const session = await ort.InferenceSession.create(buf, {
    executionProviders: ["webgpu"],
  });
  // Deklarierte Eingabetypen aus den Session-Metadaten ziehen (ORT ≥1.21) —
  // die Engine passt ihre Feed-Dtypes daran an (fp16-Gewichte ≠ fp16-Inputs).
  const inputTypes: Record<string, string> = {};
  const inputShapes: Record<string, readonly (number | string)[]> = {};
  const meta = (session as unknown as {
    inputMetadata?: readonly { name: string; isTensor: boolean; type?: unknown; shape?: unknown }[];
  }).inputMetadata;
  for (const m of meta ?? []) {
    if (!m.isTensor) continue;
    if (typeof m.type === "string") inputTypes[m.name] = m.type;
    if (Array.isArray(m.shape)) inputShapes[m.name] = m.shape as readonly (number | string)[];
  }
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    inputTypes,
    inputShapes,
    async run(feeds: Record<string, OrtValue>): Promise<Record<string, OrtValue>> {
      const ortFeeds: Record<string, ort.Tensor> = {};
      for (const [name, v] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor(dtypeOf(v), v.data, v.dims);
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
  const F16 = (activeWindow as { Float16Array?: new (...a: never[]) => ArrayBufferView }).Float16Array;
  if (F16 && data instanceof F16) {
    const t = data as ArrayBufferView & { length: number };
    return new Uint16Array(t.buffer, t.byteOffset, t.length);
  }
  const ctor = (data as { constructor?: { name?: string } })?.constructor?.name ?? typeof data;
  throw new Error(`unexpected output dtype for "${name}": ${ctor}`);
}
