// Gegenprobe der eigenen Konversion (Spec 0.6 §3): Namen und Dtypes müssen zu core/engine.ts passen —
// stille Abweichungen sind der 0.1-Hänger-Befund („fp16-Gewichte ≠ fp16-Inputs"). Läuft mit
// onnxruntime-node (CPU), lädt jede Datei einmal, prüft, gibt frei. Kein Bild wird gerechnet.
import { InferenceSession } from "onnxruntime-node";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const ROOT = process.argv[2] ?? "dist-assets/sd-turbo";

// Teile ohne requireHiddenStates: sd-turbo. requireHiddenStates: SDXL-Turbo (Spec §9.1) — beide
// Text-Encoder nutzen den VORLETZTEN Hidden-Layer, nicht last_hidden_state. Fehlt der Output,
// wird kein Fehler geworfen, das Bild wird nur still schlechter — deshalb hart pruefen statt warnen.
const EXPECT_SD_TURBO = {
  text_encoder: { inputs: ["input_ids"], firstOutput: "last_hidden_state" },
  unet: { inputs: ["sample", "timestep", "encoder_hidden_states"], firstOutput: "out_sample" },
  vae_decoder: { inputs: ["latent_sample"], firstOutput: "sample" },
};
// unet.inputs "text_embeds"/"time_ids": aus dem Spike-Plan uebernommene ERWARTUNG (Task-3-Brief
// Step 5), an dieser Konversion noch NICHT nachgemessen — dist-assets/sdxl-turbo/ war beim
// Schreiben dieser Zeilen noch unvollstaendig. Bestaetigt wird das erst mit einem echten
// npm run assets:verify dist-assets/sdxl-turbo (Brief Step 5). Die Pruefung bleibt trotzdem
// fail-safe: eine falsche Erwartung faellt als "✗" auf, nicht als stiller Fehlschlag.
const EXPECT_SDXL_TURBO = {
  text_encoder: { inputs: ["input_ids"], firstOutput: "last_hidden_state", requireHiddenStates: true },
  text_encoder_2: { inputs: ["input_ids"], firstOutput: "last_hidden_state", requireHiddenStates: true },
  unet: {
    inputs: ["sample", "timestep", "encoder_hidden_states", "text_embeds", "time_ids"],
    firstOutput: "out_sample",
  },
  vae_decoder: { inputs: ["latent_sample"], firstOutput: "sample" },
};
const MODELS = { "sd-turbo": EXPECT_SD_TURBO, "sdxl-turbo": EXPECT_SDXL_TURBO };
const EXPECT = MODELS[basename(ROOT)] ?? EXPECT_SD_TURBO;

// External Data (Spec §7.2): ein Modellteil ueber 2 GiB liegt nicht mehr als eine .onnx_data,
// sondern gestueckelt als <part>_000.onnx_data, <part>_001.onnx_data, ... im selben Verzeichnis
// wie model.onnx. ORT-Node nimmt sie als { path, data } — path MUSS der reine Dateiname sein,
// weil genau dieser String als location im ONNX steht (kein Verzeichnispfad). Monolithische
// Modelle (sd-turbo) liefern hier ein leeres Array — unveraendertes Verhalten.
function externalDataFor(modelPath) {
  const dir = dirname(modelPath);
  const part = basename(dir); // z.B. "unet"
  return readdirSync(dir)
    .filter((n) => n.startsWith(`${part}_`) && n.endsWith(".onnx_data"))
    .sort()
    .map((n) => ({ path: n, data: readFileSync(join(dir, n)) }));
}

let bad = 0;
for (const [part, exp] of Object.entries(EXPECT)) {
  const path = `${ROOT}/${part}/model.onnx`;
  let size;
  try {
    size = statSync(path).size;
  } catch (err) {
    // Nur ein fehlendes Verzeichnis/Datei (ENOENT) wird uebersprungen — sdxl-turbo hat
    // text_encoder_2 zusaetzlich zu sd-turbo, und waehrend die Konversion noch laeuft, kann ein
    // Teil vorruebergehend fehlen. Jeder ANDERE Fehler (Rechte, kaputtes Dateisystem, ...) ist
    // gravierender als ein fehlender hidden_states-Output und darf NICHT stillschweigend als
    // "übersprungen" mit Exit 0 durchgehen — er wird weitergereicht.
    if (err.code !== "ENOENT") throw err;
    console.log(`… ${part}: übersprungen (nicht vorhanden unter ${path})`);
    continue;
  }
  const buckets = externalDataFor(path);
  const sessionOptions = { executionProviders: ["cpu"] };
  if (buckets.length > 0) sessionOptions.externalData = buckets;
  const s = await InferenceSession.create(path, sessionOptions);
  const inputs = [...s.inputNames];
  const meta = Object.fromEntries((s.inputMetadata ?? []).map((m) => [m.name, m.isTensor ? `${m.type}${JSON.stringify(m.shape ?? [])}` : "?"]));
  const outputs = [...s.outputNames];
  const okInputs = exp.inputs.every((n) => inputs.includes(n));
  const okOut = outputs[0] === exp.firstOutput;
  const okHiddenStates = !exp.requireHiddenStates || outputs.includes("hidden_states");
  const bucketNote = buckets.length > 0 ? ` · ${buckets.length} Buckets` : "";
  const totalSize = size + buckets.reduce((sum, b) => sum + b.data.length, 0);
  const line = `${part}: ${(totalSize / 1e6).toFixed(0)} MB${bucketNote} · inputs ${JSON.stringify(meta)} · outputs ${JSON.stringify(outputs)}`;
  if (okInputs && okOut && okHiddenStates) {
    console.log("✓ " + line);
  } else {
    const missing = [];
    if (!okInputs) missing.push(`inputs ${exp.inputs.join(",")}`);
    if (!okOut) missing.push(`out[0] ${exp.firstOutput}`);
    if (!okHiddenStates) missing.push("output hidden_states (SDXL braucht den vorletzten Hidden-Layer, Spec §9.1)");
    console.error("✗ " + line + ` — erwartet ${missing.join(" · ")}`);
    bad++;
  }
  await s.release();
}
process.exit(bad ? 1 : 0);
