// Muster "Promise.race + Timer, weil die Ziel-API kein Timeout/Abort kennt" — yijing-oracle
// hat es dreimal für requestUrl gebaut (src/obsidian/http.ts). `window.setTimeout` (nicht das
// globale `setTimeout`) für Popout-Fenster-Kompatibilität (obsidianmd/prefer-window-timers) —
// deshalb liegt der Helfer im obsidian-Layer, nicht in core (core bleibt node-pure). Regel-der-
// Drei erreicht — Kit-Extraktion läuft separat über /drift-audit.
export async function raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
