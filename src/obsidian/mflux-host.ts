// Dünne IO-Bindung der puren Erkennung (Spec §6). Desktop-only — node:fs/os sind da.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { hfSnapshotDir, resolveMfluxBinary } from "../core/mflux-detect";
import { getModel } from "../core/models";
import type { LigSettings } from "../core/settings";

export function detectMflux(settings: LigSettings): string | null {
  return resolveMfluxBinary(settings.mfluxPath.trim(), homedir(), existsSync);
}

export function fluxWeightsReady(settings: LigSettings): boolean {
  const spec = getModel("flux2-klein-4b");
  if (!spec.mflux) return false;
  const dir = hfSnapshotDir(settings.modelsDir.trim(), homedir(), spec.mflux.hfRepo);
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}
