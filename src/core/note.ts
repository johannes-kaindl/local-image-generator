// Ergebnis-Notiz (Spec §7.4) — pure Builder: Frontmatter + Embed. Kein Vault-Zugriff;
// Pfad und Link kommen von außen. Muster übernommen von image-to-markdown/src/img_to_md.ts
// (lines[]-Builder, IO injiziert) — dessen schwaches Escaping aber NICHT: das Quoting
// kommt aus dem vendorten Serializer.
import { serializeFrontmatter, type FmValue } from "../vendor/kit/frontmatter";
import type { GenParams } from "./viewmodel";

const FM_ORDER = [
  "prompt",
  "negative_prompt",
  "seed",
  "steps",
  "cfg",
  "model",
  "width",
  "height",
  "created",
  "image",
];

/** @param imageLink Vault-Pfad des Bildes, so wie er in `![[…]]` stehen soll. */
export function buildImageNote(params: GenParams, imageLink: string): string {
  const data: Record<string, FmValue> = {
    prompt: params.prompt,
    // negative_prompt nur bei nicht-leerem Wert (Spec §5) — ein leerer Negativ-Prompt ist
    // "nicht gesetzt", nicht "bewusst leer", und soll nicht als Rauschen in jeder Notiz stehen.
    ...(params.negativePrompt.trim() !== "" ? { negative_prompt: params.negativePrompt } : {}),
    seed: params.seed,
    steps: params.steps,
    cfg: params.cfg,
    model: params.model,
    width: params.width,
    height: params.height,
    created: params.date,
    // Der Serializer quotet das selbst (needsQuoting kennt "[["), aber der Link muss als
    // Wikilink im Wert stehen — unquoted bräche "[[" das YAML.
    image: `[[${imageLink}]]`,
  };
  return `${serializeFrontmatter(data, FM_ORDER)}\n![[${imageLink}]]\n`;
}
