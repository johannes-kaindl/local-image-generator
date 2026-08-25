// Asset-Manifest generieren (Spec 0.6 §3, Muster audio-interface/scripts/build-assets.mjs):
// hasht die eigenen SD-Turbo- und SDXL-Turbo-Konversionen in dist-assets/ und die ORT-WASM-Datei,
// die das gebündelte onnxruntime-web/webgpu-Glue tatsächlich referenziert (WASM-Paarung, AGENTS.md-
// Gotcha: falsche Paarung = stiller Ewig-Hänger), und schreibt src/core/engine-manifest.generated.ts.
//
//   node scripts/build-assets.mjs           # voll: braucht dist-assets/<sd-turbo|sdxl-turbo> (tools/convert-model.sh)
//   node scripts/build-assets.mjs --check   # Gate: nur der ort_wasm-Eintrag muss zu node_modules passen
//
// Modell-Hashes sind statisch (CI kann die ~6,4 GB nicht neu bauen); der WASM-Eintrag ist es nicht —
// er wandert mit jedem ORT-Upgrade und wird deshalb im Gate geprüft.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist-assets");
const OUT = join(ROOT, "src/core/engine-manifest.generated.ts");
const ORT_DIR = join(ROOT, "node_modules/onnxruntime-web");
const CHECK = process.argv.includes("--check");

const MODELS = {
  "sd-turbo": {
    text_encoder: "text_encoder/model.onnx",
    unet: "unet/model.onnx",
    vae_decoder: "vae_decoder/model.onnx",
    vocab: "tokenizer/vocab.json",
    merges: "tokenizer/merges.txt",
  },
  "sdxl-turbo": {
    text_encoder: "text_encoder/model.onnx",
    text_encoder_2: "text_encoder_2/model.onnx",
    unet: "unet/model.onnx",
    vae_decoder: "vae_decoder/model.onnx",
    vocab: "tokenizer/vocab.json",
    merges: "tokenizer/merges.txt",
    vocab_2: "tokenizer_2/vocab.json",
    merges_2: "tokenizer_2/merges.txt",
  },
};

async function sha256(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

function ortInfo() {
  const version = JSON.parse(readFileSync(join(ORT_DIR, "package.json"), "utf8")).version;
  const glue = readFileSync(join(ORT_DIR, "dist/ort.webgpu.bundle.min.mjs"), "utf8");
  const names = [...new Set(glue.match(/ort-wasm-simd-threaded[a-z.]*\.wasm/g) ?? [])];
  if (names.length !== 1) throw new Error(`WASM-Paarung unklar: das WebGPU-Bundle referenziert ${JSON.stringify(names)} — genau eine Datei erwartet`);
  const name = names[0];
  return { version, name, src: join(ORT_DIR, "dist", name), path: `runtime/ort-${version}/${name}` };
}

async function entry(path, absPath) {
  return { path, bytes: statSync(absPath).size, sha256: await sha256(absPath) };
}

/** Liest ein Modellteil ein und hängt seine External-Data-Buckets an, falls welche daliegen
 *  (`<part>_NNN.onnx_data` neben `model.onnx`, s. AGENTS.md „Stückeln"-Gotcha). */
async function entryWithData(modelId, key, rel) {
  const abs = join(DIST, modelId, rel);
  const e = await entry(join(modelId, rel), abs);
  const dir = dirname(abs);
  const part = basename(dir);
  const buckets = readdirSync(dir)
    .filter((n) => n.startsWith(`${part}_`) && n.endsWith(".onnx_data"))
    .sort();
  if (buckets.length === 0) return e;
  e.data = [];
  for (const n of buckets) e.data.push(await entry(join(modelId, dirname(rel), n), join(dir, n)));
  return e;
}

const ort = ortInfo();
const wasm = await entry(ort.path, ort.src);

if (CHECK) {
  if (!existsSync(OUT)) { console.error("check:manifest — src/core/engine-manifest.generated.ts fehlt: erst `npm run assets`"); process.exit(1); }
  const cur = readFileSync(OUT, "utf8");
  const runtimeBlock = cur.match(/runtime:\s*\{([\s\S]*?)\}\s*,\s*\n\s*models:/);
  const m = runtimeBlock?.[1].match(/ort_wasm:\s*\{\s*path:\s*"([^"]+)",\s*bytes:\s*(\d+),\s*sha256:\s*"([0-9a-f]{64})"/);
  const okv = cur.includes(`ORT_VERSION = "${ort.version}"`);
  if (!m || !okv || m[1] !== wasm.path || Number(m[2]) !== wasm.bytes || m[3] !== wasm.sha256) {
    console.error(`check:manifest — ort_wasm im Manifest passt nicht zu node_modules (${ort.version}, ${ort.name}). Erst \`npm run assets\` und das Manifest mitcommitten.`);
    process.exit(1);
  }
  console.log(`check:manifest OK — ort ${ort.version} · ${ort.name} · ${wasm.sha256.slice(0, 12)}…`);
  process.exit(0);
}

for (const [modelId, files] of Object.entries(MODELS)) {
  for (const rel of Object.values(files)) {
    if (!existsSync(join(DIST, modelId, rel))) { console.error(`build-assets: ${modelId}/${rel} fehlt in dist-assets/ — erst tools/convert-model.sh ${modelId}`); process.exit(1); }
  }
}
mkdirSync(join(DIST, dirname(ort.path)), { recursive: true });
copyFileSync(ort.src, join(DIST, ort.path));

const models = {};
for (const [modelId, files] of Object.entries(MODELS)) {
  const assets = {};
  for (const [key, rel] of Object.entries(files)) {
    assets[key] = await entryWithData(modelId, key, rel);
    const dataInfo = assets[key].data ? ` (+${assets[key].data.length} Buckets)` : "";
    console.log(`  ${modelId}/${key.padEnd(13)} ${(assets[key].bytes / 1e6).toFixed(1).padStart(8)} MB  ${assets[key].sha256.slice(0, 12)}…${dataInfo}`);
  }
  models[modelId] = assets;
}
console.log(`  ${"ort_wasm".padEnd(13 + 12)} ${(wasm.bytes / 1e6).toFixed(1).padStart(8)} MB  ${wasm.sha256.slice(0, 12)}…  (${ort.name})`);

function fmtEntry(e, indent) {
  const dataStr = e.data ? `, data: [\n${e.data.map((d) => `${indent}    { path: ${JSON.stringify(d.path)}, bytes: ${d.bytes}, sha256: ${JSON.stringify(d.sha256)} },`).join("\n")}\n${indent}  ]` : "";
  return `{ path: ${JSON.stringify(e.path)}, bytes: ${e.bytes}, sha256: ${JSON.stringify(e.sha256)}${dataStr} }`;
}

const modelsLines = Object.entries(models)
  .map(([modelId, assets]) => {
    const entries = Object.entries(assets).map(([k, v]) => `    ${k}: ${fmtEntry(v, "    ")},`).join("\n");
    return `  ${JSON.stringify(modelId)}: {\n${entries}\n  },`;
  })
  .join("\n");

writeFileSync(OUT, `// generiert von scripts/build-assets.mjs — NIE von Hand editieren (Gate: npm run check:manifest).
// Hashes der eigenen SD-Turbo- und SDXL-Turbo-Konversionen (tools/convert-model.sh <sd-turbo|sdxl-turbo>)
// und der ORT-WASM-Datei, die das gebündelte onnxruntime-web/webgpu-Glue referenziert.
export const ORT_VERSION = ${JSON.stringify(ort.version)};
export const GENERATED_ASSETS = {
  runtime: {
    ort_wasm: ${fmtEntry(wasm, "  ")},
  },
  models: {
${modelsLines}
  },
} as const;
`);
console.log(`geschrieben: ${OUT}`);
