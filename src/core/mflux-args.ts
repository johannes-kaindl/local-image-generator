// CLI-Aufbau für mflux-generate-flux2 (Spec §4.3). Flags 2026-07-18 gegen die installierte
// mflux-Version verifiziert (--help), nicht geraten. Quantisierung fest 8-bit (Spec §2).
import type { ModelSpec } from "./models";

export interface MfluxRequest {
  prompt: string;
  seed: number;
  steps: number;
  width: number;
  height: number;
}

export function buildMfluxArgs(spec: ModelSpec, req: MfluxRequest, outputPath: string): string[] {
  if (!spec.mflux) throw new Error(`model ${spec.id} has no mflux runtime`);
  return [
    "--model", spec.mflux.modelArg,
    "--quantize", "8",
    "--prompt", req.prompt,
    "--seed", String(req.seed),
    "--steps", String(req.steps),
    "--width", String(req.width),
    "--height", String(req.height),
    "--output", outputPath,
  ];
}

/** HF_HOME nur setzen, wenn der User einen Speicherort gewählt hat — sonst erbt der
 *  Kindprozess den HF-Standard-Cache (~/.cache/huggingface), geteilt mit anderen Tools. */
export function buildMfluxEnv(modelsDir: string): Record<string, string> {
  return modelsDir === "" ? {} : { HF_HOME: modelsDir };
}
