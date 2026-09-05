// zurueckgeholt aus local-image-generator@0.4.4, 2026-08-19
// Euler-Ancestral-Scheduler für sd-turbo (Spec §5) — portiert nach dem Muster von
// microsoft/onnxruntime-inference-examples js/sd-turbo bzw. diffusers
// EulerAncestralDiscreteScheduler. Training: 1000 Steps, beta scaled_linear
// 0.00085→0.012, timestep-Spacing "trailing". Guidance fix 1.0 (keine CFG).
const TRAIN_STEPS = 1000;
const BETA_START = 0.00085;
const BETA_END = 0.012;

export interface Schedule {
  timesteps: number[];
  sigmas: number[]; // Länge steps+1, letzter Eintrag 0
  initNoiseSigma: number;
}

function alphasCumprod(): Float64Array {
  const out = new Float64Array(TRAIN_STEPS);
  let prod = 1;
  const s0 = Math.sqrt(BETA_START);
  const s1 = Math.sqrt(BETA_END);
  for (let t = 0; t < TRAIN_STEPS; t++) {
    const beta = (s0 + (t / (TRAIN_STEPS - 1)) * (s1 - s0)) ** 2;
    prod *= 1 - beta;
    out[t] = prod;
  }
  return out;
}

export function makeSchedule(steps: number): Schedule {
  const ac = alphasCumprod();
  const timesteps: number[] = [];
  const stepRatio = TRAIN_STEPS / steps; // trailing spacing
  for (let i = 0; i < steps; i++) {
    timesteps.push(Math.round(TRAIN_STEPS - i * stepRatio) - 1);
  }
  const sigmas = timesteps.map((t) => Math.sqrt((1 - ac[t]!) / ac[t]!));
  sigmas.push(0);
  return { timesteps, sigmas, initNoiseSigma: sigmas[0]! };
}

/**
 * Einstiegspunkt für Teil-Denoising (img2img) — **kontinuierlich**, nicht gerastert.
 *
 * Die Vorgängerfassung (`denoiseRaster` in `params.ts`, bis 0.11) holte den Rauschpegel
 * an einem ganzzahligen Index: `sigmas[tStart]`. Daraus folgten genau `steps` erreichbare
 * Positionen — bei 4 Steps {0.25, 0.5, 0.75, 1.0}. Gemessen am 2026-09-05 überspringt der
 * Sprung 0.5 → 0.75 dabei genau das Optimum (RMSE-Sprung doppelt so groß wie ein
 * 8-Steps-Schritt, konsistent über drei Motive).
 *
 * Hier wird stattdessen zwischen zwei Stufen interpoliert. Zulässig ist das, weil der
 * Euler-Schritt `sigma_from`/`sigma_to` als Differenz nimmt, nicht als feste Größe.
 *
 * ⚠️ Der Aufrufer MUSS `sigmas[startAt]` durch das zurückgegebene `sigma` ersetzen.
 * `schedulerStep` liest sein Start-Sigma selbst aus dem Array (s. dort); ein interpolierter
 * Wert nur im Init-Latent verpufft und ergibt ein **leise falsches** Bild — kein Fehler,
 * nur ein schlechteres Ergebnis. Dasselbe gilt für `timesteps[startAt]`.
 *
 * Der Timestep wird mitinterpoliert: sonst bekommt das UNet die Konditionierung des
 * Ankers, während der Rauschpegel dazwischen liegt.
 */
export function denoiseEntry(
  steps: number,
  denoising: number,
  sigmas: readonly number[],
  timesteps: readonly number[],
): { startAt: number; sigma: number; timestep: number } {
  // Reelle Position in der Folge. denoising 1 → 0 (ganz vorn, volles Rauschen),
  // denoising 0 → steps (ganz hinten) — deshalb die Klemme eine Zeile weiter.
  const t = (1 - denoising) * steps;
  // Der Anker bleibt im Zeitplan, damit der Rest-Zeitplan nie leer ist. Bei denoising 0
  // ist die interpolierte Sigma dann 0 — der Lauf rechnet einen Schritt ohne Wirkung,
  // und genau das heisst „nichts veraendern".
  const startAt = Math.min(steps - 1, Math.max(0, Math.floor(t)));
  const frac = Math.min(1, Math.max(0, t - startAt));
  // Nachfolger: `sigmas` trägt steps+1 Einträge (letzter 0), `timesteps` nur steps —
  // für den letzten Anker ist der konzeptionelle Nachfolger jeweils 0.
  const sigmaNext = sigmas[startAt + 1] ?? 0;
  const timestepNext = timesteps[startAt + 1] ?? 0;
  const sigma = sigmas[startAt]! + (sigmaNext - sigmas[startAt]!) * frac;
  const timestep = Math.round(timesteps[startAt]! + (timestepNext - timesteps[startAt]!) * frac);
  return { startAt, sigma, timestep };
}

export function scaleInput(latents: Float32Array, sigma: number): Float32Array {
  const k = 1 / Math.sqrt(sigma * sigma + 1);
  const out = new Float32Array(latents.length);
  for (let i = 0; i < latents.length; i++) out[i] = latents[i]! * k;
  return out;
}

export function schedulerStep(
  modelOutput: Float32Array,
  sample: Float32Array,
  i: number,
  sigmas: number[],
  noise: Float32Array,
): Float32Array {
  const sigma = sigmas[i]!;
  const sigmaTo = sigmas[i + 1]!;
  const sigmaUp = Math.sqrt((sigmaTo * sigmaTo * (sigma * sigma - sigmaTo * sigmaTo)) / (sigma * sigma));
  const sigmaDown = Math.sqrt(sigmaTo * sigmaTo - sigmaUp * sigmaUp);
  const dt = sigmaDown - sigma;
  const out = new Float32Array(sample.length);
  for (let j = 0; j < sample.length; j++) {
    const predOriginal = sample[j]! - sigma * modelOutput[j]!; // epsilon-Prediction
    const derivative = (sample[j]! - predOriginal) / sigma;
    out[j] = sample[j]! + derivative * dt + noise[j]! * sigmaUp;
  }
  return out;
}