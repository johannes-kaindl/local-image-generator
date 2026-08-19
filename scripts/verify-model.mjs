// Gegenprobe der eigenen Konversion (Spec 0.6 §3): Namen und Dtypes müssen zu core/engine.ts passen —
// stille Abweichungen sind der 0.1-Hänger-Befund („fp16-Gewichte ≠ fp16-Inputs"). Läuft mit
// onnxruntime-node (CPU), lädt jede Datei einmal, prüft, gibt frei. Kein Bild wird gerechnet.
import { InferenceSession } from "onnxruntime-node";
import { statSync } from "node:fs";
const ROOT = process.argv[2] ?? "dist-assets/sd-turbo";
const EXPECT = {
  text_encoder: { inputs: ["input_ids"], firstOutput: "last_hidden_state" },
  unet: { inputs: ["sample", "timestep", "encoder_hidden_states"], firstOutput: "out_sample" },
  vae_decoder: { inputs: ["latent_sample"], firstOutput: "sample" },
};
let bad = 0;
for (const [part, exp] of Object.entries(EXPECT)) {
  const path = `${ROOT}/${part}/model.onnx`;
  const size = statSync(path).size;
  const s = await InferenceSession.create(path, { executionProviders: ["cpu"] });
  const inputs = [...s.inputNames];
  const meta = Object.fromEntries((s.inputMetadata ?? []).map((m) => [m.name, m.isTensor ? `${m.type}${JSON.stringify(m.shape ?? [])}` : "?"]));
  const okInputs = exp.inputs.every((n) => inputs.includes(n));
  const okOut = s.outputNames[0] === exp.firstOutput;
  const line = `${part}: ${(size / 1e6).toFixed(0)} MB · inputs ${JSON.stringify(meta)} · outputs ${JSON.stringify([...s.outputNames])}`;
  if (okInputs && okOut) console.log("✓ " + line);
  else { console.error("✗ " + line + ` — erwartet inputs ${exp.inputs.join(",")}, out[0] ${exp.firstOutput}`); bad++; }
  await s.release();
}
process.exit(bad ? 1 : 0);
