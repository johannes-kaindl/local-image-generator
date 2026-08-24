// Vollstaendigkeits-Wachhund fuer `npm run assets:upload` (I5/Block-5-Fix, Final-Review
// 2026-08-24): der vorherige Guard war `test -f dist-assets/<modell>/unet/model.onnx` — der
// besteht mit 3 von 13 UNet-Buckets oder einem komplett fehlenden text_encoder_2. Der naechste
// Schritt nach dieser Pruefung ist ein 6,9-GB-Upload, dessen Hashes in einem SHIPPED Manifest
// gepinnt sind (src/core/engine-manifest.generated.ts) — ein unvollstaendiger Upload ist fuer
// JEDEN Nutzer ein dauerhaft kaputtes Modell, kein wiederholbarer Fehlgriff.
//
// Diese Pruefung vergleicht die vollstaendige Dateiliste DES GENERIERTEN MANIFESTS (Hauptdatei
// je Modellteil + jeder External-Data-Bucket + Tokenizer-Dateien + die Runtime-WASM) gegen
// dist-assets/: jeder Eintrag muss existieren UND in der Byte-Groesse zum Manifest passen.
// Keine Hash-Neuberechnung (6,9 GB — dafuer ist `npm run assets:verify` mit onnxruntime-node
// da, das laedt die Sessions und prueft I/O; Hashes sind bewusst statisch, s. build-assets.mjs).
//
// NICHT verwechseln mit `node scripts/build-assets.mjs --check`: das prueft NUR den
// ort_wasm-Eintrag gegen node_modules (Gate `check:manifest`) — Modell-Hashes sind dort
// absichtlich statisch, weil CI die ~6,9 GB nicht neu bauen kann. Das saehe wie ein Guard aus
// und prueft dabei nichts an den Modell-Dateien.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist-assets");
const MANIFEST = join(ROOT, "src/core/engine-manifest.generated.ts");

if (!existsSync(MANIFEST)) {
  console.error("verify-upload-assets: src/core/engine-manifest.generated.ts fehlt — erst `npm run assets`.");
  process.exit(1);
}

const text = readFileSync(MANIFEST, "utf8");
const m = text.match(/export const GENERATED_ASSETS = (\{[\s\S]*\n\}) as const;/);
if (!m) {
  console.error("verify-upload-assets: GENERATED_ASSETS liess sich im Manifest nicht finden — Format geaendert?");
  process.exit(1);
}

let GENERATED_ASSETS;
try {
  // Kein eval()/new Function() fuer generierten Code (auch wenn er aus dem eigenen Build stammt) —
  // der Objekt-Literal-Ausschnitt unterscheidet sich von JSON nur in zwei Punkten: unquotierte
  // Bare-Identifier-Keys (`unet:` statt `"unet":`) und trailing commas. Beides textuell in JSON
  // ueberfuehrt, dann JSON.parse — keine Code-Ausfuehrung noetig.
  const asJson = m[1]
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/,(\s*[}\]])/g, "$1");
  GENERATED_ASSETS = JSON.parse(asJson);
} catch (e) {
  console.error(`verify-upload-assets: GENERATED_ASSETS liess sich nicht als JSON lesen: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

/** Hauptdatei + alle External-Data-Buckets eines Katalogeintrags als flache Liste. */
function flatten(entry) {
  return [{ path: entry.path, bytes: entry.bytes }, ...(entry.data ?? []).map((d) => ({ path: d.path, bytes: d.bytes }))];
}

let ok = true;
let checked = 0;

function checkAll(label, entries) {
  for (const [key, entry] of entries) {
    for (const f of flatten(entry)) {
      checked++;
      const abs = join(DIST, f.path);
      if (!existsSync(abs)) {
        console.error(`FEHLT: ${f.path} (${label}/${key})`);
        ok = false;
        continue;
      }
      const size = statSync(abs).size;
      if (size !== f.bytes) {
        console.error(`GROESSE WEICHT AB: ${f.path} (${label}/${key}) — Manifest ${f.bytes} B, dist-assets ${size} B`);
        ok = false;
      }
    }
  }
}

for (const [modelId, assets] of Object.entries(GENERATED_ASSETS.models)) checkAll(modelId, Object.entries(assets));
checkAll("runtime", Object.entries(GENERATED_ASSETS.runtime));

if (!ok) {
  console.error("verify-upload-assets: FEHLGESCHLAGEN — dist-assets/ weicht vom generierten Manifest ab (siehe oben). Kein Upload.");
  process.exit(1);
}
console.log(`verify-upload-assets OK — ${checked} Dateien (Pfad + Groesse) stimmen mit dem generierten Manifest ueberein.`);
