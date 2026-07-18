// Prompt-Historie — pure. MRU: neueste zuerst. Dedup nach vollem Rezept (prompt+seed+steps),
// damit Variationen (gleicher Prompt, anderer Seed) erhalten bleiben, aber echte 1:1-
// Wiederholungen kollabieren. Das Limit ist bewusst eine Konstante (YAGNI, kein Regler).
import type { HistoryEntry } from "./settings";

export const HISTORY_LIMIT = 20;

function recipeKey(e: HistoryEntry): string {
  // Seit 0.4 mehrmodellig: model + Größe gehören zum Rezept — dasselbe Prompt-Tupel auf
  // anderem Modell/Format ist ein anderes Ergebnis und darf nicht kollabieren (Spec §8).
  // JSON-Tupel als Schlüssel, damit ein Prompt mit Ziffern/Leerzeichen keine falsche
  // Kollision mit Seed/Steps erzeugt.
  return JSON.stringify([e.prompt.trim(), e.seed, e.steps, e.model, e.width, e.height]);
}

/** Nimmt ein Rezept vorn auf; identisches Rezept wandert nach vorn statt zu doppeln.
 *  Leere/Whitespace-Prompts werden ignoriert. Prompt wird getrimmt gespeichert. */
export function pushHistory(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const prompt = entry.prompt.trim();
  if (prompt === "") return [...list];
  const normalized: HistoryEntry = { ...entry, prompt };
  const key = recipeKey(normalized);
  return [normalized, ...list.filter((e) => recipeKey(e) !== key)].slice(0, HISTORY_LIMIT);
}

/** Gruppiert nach Prompt. Gruppen nach jüngstem Eintrag zuerst (die Liste ist MRU, also
 *  entspricht das der Reihenfolge des ersten Auftretens), innerhalb der Gruppe neueste zuerst. */
export function groupByPrompt(list: readonly HistoryEntry[]): { prompt: string; entries: HistoryEntry[] }[] {
  const groups: { prompt: string; entries: HistoryEntry[] }[] = [];
  const byPrompt = new Map<string, HistoryEntry[]>();
  for (const e of list) {
    let bucket = byPrompt.get(e.prompt);
    if (!bucket) {
      bucket = [];
      byPrompt.set(e.prompt, bucket);
      groups.push({ prompt: e.prompt, entries: bucket });
    }
    bucket.push(e);
  }
  return groups;
}

/** Entfernt genau den passenden Eintrag über Wert-Gleichheit (nicht Index — Index-Falle
 *  aus REGISTRY Z.84: eine parallele Mutation verschiebt Indizes). */
export function deleteEntry(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return list.filter(
    (e) =>
      !(
        e.prompt === entry.prompt &&
        e.seed === entry.seed &&
        e.steps === entry.steps &&
        e.model === entry.model &&
        e.width === entry.width &&
        e.height === entry.height &&
        e.created === entry.created
      ),
  );
}

/** Einzeiliges, gekürztes Label für die Historie-Anzeige. */
export function historyLabel(prompt: string, max = 60): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
