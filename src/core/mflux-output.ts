// Zeilenparser für mflux-stdout/stderr (Spec §4.3). tqdm rendert "NN%|…| X/Y [rate]".
// BEWUSST heuristisch: Downloads erkennt man an Byte-Einheiten (G/M), Steps an kleiner
// Totale ohne Einheit. Unbekannte Zeilen sind null — mflux-Updates dürfen den Parser
// nicht brechen (Forward-Kompatibilität); der Smoke-Test verifiziert das echte Format.
export type MfluxEvent =
  | { kind: "download"; file: string; pct: number }
  | { kind: "step"; step: number; total: number }
  | null;

const PCT = /(\d{1,3})%\|/;
const BYTES = /\|\s*[\d.]+\s*[GM]i?B?\/[\d.]+\s*[GM]i?B?/;
const STEP = /\|\s*(\d+)\/(\d+)\s*\[/;

export function parseMfluxLine(line: string): MfluxEvent {
  const pctMatch = PCT.exec(line);
  if (!pctMatch) return null;
  const pct = Math.min(100, Number(pctMatch[1]));
  if (BYTES.test(line)) {
    const prefix = line.slice(0, line.indexOf(pctMatch[0])).replace(/:\s*$/, "").trim();
    return { kind: "download", file: prefix === "" ? "model" : prefix, pct };
  }
  const stepMatch = STEP.exec(line);
  if (stepMatch) {
    const total = Number(stepMatch[2]);
    if (total >= 1 && total <= 64) return { kind: "step", step: Number(stepMatch[1]), total };
  }
  return null;
}

/** Chunk-Splitter: tqdm trennt mit \r (Progress-Rewrite), normale Logs mit \n.
 *  Liefert vollständige Zeilen und den Rest-Puffer zurück (Streaming-tauglich). */
export function splitChunks(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split(/[\r\n]+/);
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim() !== ""), rest };
}
