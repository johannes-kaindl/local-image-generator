// Ergebnis-Notiz — pure Builder: Frontmatter + Embed. Kein Vault-Zugriff;
// Pfad und Link kommen von außen. Muster übernommen von image-to-markdown/src/img_to_md.ts
// (lines[]-Builder, IO injiziert) — dessen schwaches Escaping aber NICHT: das Quoting
// kommt aus dem vendorten Serializer.
import { serializeFrontmatter, wikilinkOf, type FmValue } from "../vendor/kit/frontmatter";
import type { GenParams } from "./viewmodel";
import { formatCrop } from "../vendor/kit/crop";

const FM_ORDER = [
  "prompt",
  "negative_prompt",
  "seed",
  "steps",
  "cfg",
  "denoising",
  "init_image",
  "init_crop",
  "model",
  "width",
  "height",
  "created",
  "image",
];

/** Ein Vault-Pfad als Wikilink, oder als Klartext, wenn ein Link auf eine andere Datei zeigte oder auf keine: ein Pfad mit `[ ] # ^ |` (Obsidian lässt solche Namen
 *  zu, ein Link darauf bräche am Zeichen) gibt bei `wikilinkOf` `null`. Ein sichtbarer Pfad ist eine Unbequemlichkeit, ein Link auf die falsche Notiz ein Fehler. */
function linkOrText(path: string): string {
  return wikilinkOf(path) ?? path;
}

/** @param imageLink Vault-Pfad des Bildes; als Embed `![[…]]`, bei einem Pfad mit `[ ] # ^ |` als Markdown-Embed `![](<…>)`, das den Pfad ganz liest. */
export function buildImageNote(params: GenParams, imageLink: string): string {
  const data: Record<string, FmValue> = {
    prompt: params.prompt,
    // negative_prompt nur bei nicht-leerem Wert — ein leerer Negativ-Prompt ist
    // "nicht gesetzt", nicht "bewusst leer", und soll nicht als Rauschen in jeder Notiz stehen.
    ...(params.negativePrompt.trim() !== "" ? { negative_prompt: params.negativePrompt } : {}),
    seed: params.seed,
    steps: params.steps,
    // cfg nur, wenn das Plugin den Wert bestimmt hat. `null` heisst „vom Backend bestimmt"
    // (comfy-Modus: der Workflow traegt sein eigenes CFG) — eine Zahl stuende dort als
    // Tatsache und schickte jeden, der das Bild reproduzieren will, auf den falschen Wert.
    // Dasselbe Muster wie `denoising` und `negative_prompt` zwei Zeilen weiter.
    ...(params.cfg !== null ? { cfg: params.cfg } : {}),
    // Beide nur bei einem img2img-Lauf — und `init_image` zusaetzlich nur, wenn die Vorlage
    // eine benennbare Herkunft hat. Ein API-Lauf schickt Bytes ohne Vault-Datei; die Notiz
    // behauptet dann keine Quelle, nennt aber sehr wohl die Aenderungsstaerke.
    ...(params.denoising !== null ? { denoising: params.denoising } : {}),
    ...(params.initImage !== null ? { init_image: linkOrText(params.initImage) } : {}),
    // Der gerechnete Bildbereich der Vorlage (x, y, Breite, Hoehe, relativ zum Original).
    ...(params.initCrop !== null ? { init_crop: formatCrop(params.initCrop) } : {}),
    model: params.model,
    width: params.width,
    height: params.height,
    created: params.date,
    // Der Serializer quotet das selbst (needsQuoting kennt "[["), aber der Link muss als
    // Wikilink im Wert stehen — unquoted bräche "[[" das YAML.
    image: linkOrText(imageLink),
  };
  const embed = wikilinkOf(imageLink) === null ? `![](<${imageLink}>)` : `!${linkOrText(imageLink)}`;
  return `${serializeFrontmatter(data, FM_ORDER)}\n${embed}\n`;
}
