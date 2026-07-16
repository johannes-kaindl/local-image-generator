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
