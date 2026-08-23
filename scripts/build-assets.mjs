// Asset-Manifest generieren (Spec 0.6 §3, Muster audio-interface/scripts/build-assets.mjs):
// hasht die eigene SD-Turbo-Konversion in dist-assets/ und die ORT-WASM-Datei, die das
// gebündelte onnxruntime-web/webgpu-Glue tatsächlich referenziert (WASM-Paarung, AGENTS.md-
// Gotcha: falsche Paarung = stiller Ewig-Hänger), und schreibt src/core/engine-manifest.generated.ts.
//
//   node scripts/build-assets.mjs           # voll: braucht dist-assets/sd-turbo (tools/convert-model.sh sd-turbo)
//   node scripts/build-assets.mjs --check   # Gate: nur der ort_wasm-Eintrag muss zu node_modules passen
//
// Modell-Hashes sind statisch (CI kann 2,6 GB nicht neu bauen); der WASM-Eintrag ist es nicht —
// er wandert mit jedem ORT-Upgrade und wird deshalb im Gate geprüft.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist-assets");
const OUT = join(ROOT, "src/core/engine-manifest.generated.ts");
const ORT_DIR = join(ROOT, "node_modules/onnxruntime-web");
const CHECK = process.argv.includes("--check");

const MODEL_FILES = {
  text_encoder: "sd-turbo/text_encoder/model.onnx",
  unet: "sd-turbo/unet/model.onnx",
  vae_decoder: "sd-turbo/vae_decoder/model.onnx",
  vocab: "sd-turbo/tokenizer/vocab.json",
  merges: "sd-turbo/tokenizer/merges.txt",
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

const ort = ortInfo();
const wasm = await entry(ort.path, ort.src);

if (CHECK) {
  if (!existsSync(OUT)) { console.error("check:manifest — src/core/engine-manifest.generated.ts fehlt: erst `npm run assets`"); process.exit(1); }
  const cur = readFileSync(OUT, "utf8");
  const m = cur.match(/ort_wasm:\s*\{\s*path:\s*"([^"]+)",\s*bytes:\s*(\d+),\s*sha256:\s*"([0-9a-f]{64})"/);
  const okv = cur.includes(`ORT_VERSION = "${ort.version}"`);
  if (!m || !okv || m[1] !== wasm.path || Number(m[2]) !== wasm.bytes || m[3] !== wasm.sha256) {
    console.error(`check:manifest — ort_wasm im Manifest passt nicht zu node_modules (${ort.version}, ${ort.name}). Erst \`npm run assets\` und das Manifest mitcommitten.`);
    process.exit(1);
  }
  console.log(`check:manifest OK — ort ${ort.version} · ${ort.name} · ${wasm.sha256.slice(0, 12)}…`);
  process.exit(0);
}

for (const rel of Object.values(MODEL_FILES)) {
  if (!existsSync(join(DIST, rel))) { console.error(`build-assets: ${rel} fehlt in dist-assets/ — erst tools/convert-model.sh sd-turbo`); process.exit(1); }
}
mkdirSync(join(DIST, dirname(ort.path)), { recursive: true });
copyFileSync(ort.src, join(DIST, ort.path));

const assets = {};
for (const [key, rel] of Object.entries(MODEL_FILES)) {
  assets[key] = await entry(rel, join(DIST, rel));
  console.log(`  ${key.padEnd(13)} ${(assets[key].bytes / 1e6).toFixed(1).padStart(8)} MB  ${assets[key].sha256.slice(0, 12)}…`);
}
assets.ort_wasm = wasm;
console.log(`  ${"ort_wasm".padEnd(13)} ${(wasm.bytes / 1e6).toFixed(1).padStart(8)} MB  ${wasm.sha256.slice(0, 12)}…  (${ort.name})`);

const lines = Object.entries(assets).map(([k, v]) => `  ${k}: { path: ${JSON.stringify(v.path)}, bytes: ${v.bytes}, sha256: ${JSON.stringify(v.sha256)} },`);
writeFileSync(OUT, `// generiert von scripts/build-assets.mjs — NIE von Hand editieren (Gate: npm run check:manifest).
// Hashes der eigenen SD-Turbo-Konversion (tools/convert-model.sh sd-turbo) und der ORT-WASM-Datei,
// die das gebündelte onnxruntime-web/webgpu-Glue referenziert.
export const ORT_VERSION = ${JSON.stringify(ort.version)};
export const GENERATED_ASSETS = {
${lines.join("\n")}
} as const;
`);
console.log(`geschrieben: ${OUT}`);
