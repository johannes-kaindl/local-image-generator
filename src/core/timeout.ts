// Vierte Instanz des Musters "Promise.race + setTimeout, weil die Ziel-API kein Timeout/
// Abort kennt" — yijing-oracle hat es bereits dreimal für requestUrl gebaut
// (src/obsidian/http.ts: httpPostJson/probeEndpoint/probeImageEndpoint). Regel-der-Drei
// erreicht — Kit-Extraktion läuft separat über /drift-audit (siehe Spec
// 2026-07-18-robustheits-block-design.md §4), hier nur die vierte, noch unabhängige Kopie.
export async function raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
