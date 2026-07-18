// Erkennung ohne IO (Spec §6): exists wird injiziert, damit der Kern node-frei testbar
// bleibt (Pure-Core-Schnitt). Electron erbt den Shell-PATH nicht — deshalb eine feste
// Kandidatenliste statt `which`.
export const MFLUX_BINARY = "mflux-generate-flux2";

const CANDIDATE_DIRS = [".local/bin", "/opt/homebrew/bin", "/usr/local/bin"];

export function resolveMfluxBinary(
  configuredPath: string,
  home: string,
  exists: (p: string) => boolean,
): string | null {
  if (configuredPath !== "") {
    // Ein explizit konfigurierter, aber kaputter Pfad fällt NICHT still auf Auto-Detect
    // zurück — sonst benutzt das Plugin heimlich ein anderes Binary als das gewählte.
    return exists(configuredPath) ? configuredPath : null;
  }
  for (const dir of CANDIDATE_DIRS) {
    const base = dir.startsWith("/") ? dir : `${home}/${dir}`;
    const p = `${base}/${MFLUX_BINARY}`;
    if (exists(p)) return p;
  }
  return null;
}

/** huggingface_hub-Layout: <HF_HOME>/hub/models--<org>--<name>/snapshots.
 *  Existiert der snapshots-Ordner und ist nicht leer, gelten die Gewichte als vorhanden
 *  (Heuristik, Spec §6 — abgebrochene Downloads liegen unter blobs/*.incomplete und
 *  erzeugen keinen vollständigen Snapshot-Eintrag). */
export function hfSnapshotDir(modelsDir: string, home: string, hfRepo: string): string {
  const base = modelsDir === "" ? `${home}/.cache/huggingface` : modelsDir;
  return `${base}/hub/models--${hfRepo.replace("/", "--")}/snapshots`;
}
