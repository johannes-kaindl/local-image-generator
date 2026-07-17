// Prompt-Historie — pure (Spec §7.3). MRU: neueste zuerst, Duplikate wandern nach vorn
// statt zu doppeln. Das Limit ist bewusst eine Konstante und kein Setting — ein Regler
// dafür wurde nicht verlangt (YAGNI), und ein Feld in data.json ohne UI wäre ein Fremdkörper.
export const HISTORY_LIMIT = 20;

/** Nimmt einen Prompt vorn auf. Leere/Whitespace-Prompts werden ignoriert (die Liste
 *  wird nur bei erfolgreicher Generierung gefüttert, aber der Guard hält sie sauber). */
export function pushHistory(list: readonly string[], prompt: string): string[] {
  const trimmed = prompt.trim();
  if (trimmed === "") return [...list];
  return [trimmed, ...list.filter((p) => p !== trimmed)].slice(0, HISTORY_LIMIT);
}

/** Einzeiliges, gekürztes Label für das Historie-Menü. */
export function historyLabel(prompt: string, max = 60): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
