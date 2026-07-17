// Stil-Presets — pure (Spec §7.1). Das Prompt-Textfeld ist die EINZIGE Wahrheit; der
// Chip-Zustand wird über presetActive daraus abgeleitet und nie parallel geführt. Entfernt
// der Nutzer den Suffix von Hand, geht der Chip dadurch von selbst aus.
//
// Beide Funktionen arbeiten baustein-basiert: Prompt und Suffix werden an Kommas zerlegt.
// Nötig, weil ein Suffix selbst mehrteilig sein darf ("sumi-e painting, monochrome ink");
// nebenbei macht es Teilstring-Fehltreffer unmöglich ("oil" ≠ "oil painting").
//
// Bewusst in Kauf genommen: Teilen sich zwei Presets einen Baustein, entfernt das
// Abschalten des einen ihn auch dem anderen. Das ist selten und sichtbar — die Alternative
// wäre ein Referenzzähler neben dem Textfeld, also genau die zweite Wahrheit, die wir
// vermeiden wollen.

const SEP = ", ";

function splitParts(text: string): string[] {
  return text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Aktiv, wenn ALLE Bausteine des Suffix im Prompt stehen. Leerer Suffix → nie aktiv. */
export function presetActive(prompt: string, suffix: string): boolean {
  const suffixParts = splitParts(suffix);
  if (suffixParts.length === 0) return false;
  const promptParts = splitParts(prompt);
  return suffixParts.every((p) => promptParts.includes(p));
}

/** Schaltet den Suffix an/aus. Normalisiert die Trennung auf ", ". */
export function togglePresetInPrompt(prompt: string, suffix: string): string {
  const suffixParts = splitParts(suffix);
  if (suffixParts.length === 0) return prompt;
  const promptParts = splitParts(prompt);
  const next = presetActive(prompt, suffix)
    ? promptParts.filter((p) => !suffixParts.includes(p))
    : [...promptParts, ...suffixParts.filter((p) => !promptParts.includes(p))];
  return next.join(SEP);
}
