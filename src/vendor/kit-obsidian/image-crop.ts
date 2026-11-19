// vendored from obsidian-kit@0.101.0, src/obsidian/image-crop.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Ausschnitt eines Bildes zeichnen: Base64 → Bitmap → Canvas, begrenzt durch einen `Crop` (code-kit `pure/crop`). Das Gegenstück zum
 * `CropModal` (`obsidian/crop-modal`): das Modal wählt den Rahmen, dieses Modul schneidet ihn aus.
 *
 * ## Woher
 *
 * `local-image-generator/src/obsidian/png.ts` (Welle 24, img2img-Steuerung): dort stehen zwei Kopien derselben Dreierfolge, `decodeInitImage`
 * (Ausschnitt auf eine Zielgröße, weiter zu CHW-Gleitkommawerten) und `cropImageToBase64` (Ausschnitt in Originalauflösung als PNG-Base64).
 * Beides ist reine Bildgeometrie ohne Fachinhalt; der Gegenleser des Bibliothek-Gates lehnte die Ausnahme ab (Welle 25), der Master entschied
 * „im Kit bauen“ (Präzedenz Welle 24, `folder-scope`). `drawCroppedImage` ist die gemeinsame Hälfte; was lig danach mit den Pixeln tut
 * (`getImageData` → Float32), bleibt dort.
 *
 * ## `fitImageToBase64` (Welle 36, kc)
 *
 * Dritte Funktion: das Bild auf genau `width × height` bringen (Cover, `coverSourceRect` aus code-kit `crop`), Herkunft `fitInitImageToSize` aus
 * `local-image-generator/src/obsidian/png.ts` (Draw Things lehnt abweichende Maße mit HTTP 422 ab). Anders als `drawCroppedImage` ist die Quelle bei
 * `crop === null` das ganze Bild, nicht das Quadrat. Passt das Bild schon und gibt es keinen Ausschnitt, kommt die Eingabe unverändert zurück.
 *
 * ## Gleichstand mit lig
 *
 * `cropImageToBase64` tut dasselbe wie die lig-Fassung: gleiche Quelle (`cropSourceRect`, ungerundet für `null`, gerundet und geklemmt für
 * einen Rahmen), gleiche Zeichenfläche in Originalgröße des Ausschnitts, gleiche `drawImage`-Aufrufe, PNG ohne `data:`-Präfix. Belegt in
 * `tests/image-crop.test.ts` gegen eine wörtliche Referenzkopie (`tests/fixtures/reference/lig-png-crop.ts`) auf Bildgrößen und Rahmen.
 * **Zwei Unterschiede, beide ohne Wirkung auf das Ergebnis:** das Bitmap wird auch freigegeben, wenn kein 2D-Kontext zu haben ist (lig ließ es
 * dann offen), und eine unbrauchbare Zielgröße (0, negativ, nicht ganzzahlig, `NaN`) ist ein `RangeError` statt einer leeren Zeichenfläche
 * (`toDataURL` lieferte dort `data:,`, also einen leeren „PNG“-Text).
 *
 * ## Ports statt Globals
 *
 * Das Modul liest weder `createImageBitmap` noch `createEl` im Rumpf, sondern über `ImageCropPorts` (Voreinstellung: die echten): ein Test
 * übergibt ein Canvas-Double (wie `imageToJpeg` in `tests/pure/pdf/image.test.ts`), ohne Globals zu ersetzen. `createEl("canvas")` statt
 * `document.createElement` ist die Store-Regel `obsidianmd/prefer-create-el`.
 *
 * ## Fallen beim Übernehmen
 *
 * 1. **Der Dekoder erkennt den Typ am Inhalt.** Der Blob trägt keinen MIME-Typ (nackte Base64 hat keinen); `createImageBitmap` liest PNG, JPEG
 *    und WebP am Inhalt. Eine `<img src="data:…">` würde einen behaupteten Typ glauben.
 * 2. **Das Ergebnis von `drawCroppedImage` ist ein Canvas, das dem Aufrufer gehört.** Er liest Pixel (`getContext("2d").getImageData`) oder kodiert
 *    (`toDataURL`); das Modul hält nichts.
 * 3. **`base64ToImageBitmap` gibt ein Bitmap zurück, das der Aufrufer schließt** (`close()`); `drawCroppedImage` und `cropImageToBase64` schließen
 *    ihr eigenes.
 */

import { base64ToBytes } from "../kit/data-url";
import { cropSourceRect, coverSourceRect, type Crop } from "../kit/crop";

/** Die Berührungspunkte zur Plattform; ohne Angabe die echten. */
export interface ImageCropPorts {
  /** Eine neue Zeichenfläche. Voreinstellung `createEl("canvas")`. */
  createCanvas?: () => HTMLCanvasElement;
  /** Bytes (PNG, JPEG oder WebP) zu einem Bitmap. Voreinstellung `createImageBitmap(new Blob([bytes]))`, der Typ wird am Inhalt erkannt. */
  decode?: (bytes: Uint8Array) => Promise<ImageBitmap>;
}

const defaultDecode = (bytes: Uint8Array): Promise<ImageBitmap> => createImageBitmap(new Blob([bytes.buffer as ArrayBuffer]));
const defaultCanvas = (): HTMLCanvasElement => createEl("canvas");

/** Nackte Base64 (ohne `data:`-Präfix) → Bitmap. Der Aufrufer schließt es. */
export function base64ToImageBitmap(base64: string, ports: ImageCropPorts = {}): Promise<ImageBitmap> {
  return (ports.decode ?? defaultDecode)(base64ToBytes(base64));
}

/** Die Base64 hinter dem Komma einer Daten-URL (`data:image/png;base64,QUJD` → `QUJD`). Nicht `dataUrlToBytes` aus code-kit `data-url`: das
 *  dekodiert, hier bleibt der Text Text (der Server bekommt die nackte Base64). */
function base64OfDataUrl(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function checkTarget(name: string, v: number | undefined): void {
  if (v !== undefined && !(Number.isInteger(v) && v > 0)) throw new RangeError(`${name} must be a positive integer`);
}

/** Zeichnet den Ausschnitt `crop` des Bildes auf ein neues Canvas. Ohne Zielgröße in Originalauflösung des Ausschnitts, mit `targetW`/`targetH`
 *  skaliert (je eine Seite weglassen heißt: die Seite des Ausschnitts). `crop === null` ist das zentrierte Quadrat der kürzeren Seite
 *  (`cropSourceRect`). Wirft bei einer Base64, die kein Bild ist (`createImageBitmap` lehnt ab), bei einer unbrauchbaren Zielgröße (`RangeError`)
 *  und wenn kein 2D-Kontext zu haben ist. */
export async function drawCroppedImage(
  base64: string, crop: Crop | null, targetW?: number, targetH?: number, ports: ImageCropPorts = {},
): Promise<HTMLCanvasElement> {
  checkTarget("targetW", targetW);
  checkTarget("targetH", targetH);
  const bmp = await base64ToImageBitmap(base64, ports);
  try {
    const { sx, sy, sw, sh } = cropSourceRect(bmp.width, bmp.height, crop);
    const canvas = (ports.createCanvas ?? defaultCanvas)();
    canvas.width = targetW ?? sw;
    canvas.height = targetH ?? sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bmp.close();
  }
}

/** Der gewählte Ausschnitt als PNG-Base64 in Originalauflösung, ohne `data:`-Präfix — für Server, die nur den gewählten Bereich bekommen sollen. */
export async function cropImageToBase64(base64: string, crop: Crop, ports: ImageCropPorts = {}): Promise<string> {
  const canvas = await drawCroppedImage(base64, crop, undefined, undefined, ports);
  return base64OfDataUrl(canvas.toDataURL("image/png"));
}

/** Das Bild (oder der gewählte Ausschnitt) auf genau `width` × `height` gebracht, als PNG-Base64 ohne `data:`-Präfix: Cover, so viel
 *  abgeschnitten, wie das Seitenverhältnis verlangt, nie verzerrt (`coverSourceRect` aus code-kit `crop`). Quelle ist der Ausschnitt `crop`
 *  oder, bei `null`, das GANZE Bild (nicht das Quadrat wie bei `drawCroppedImage`: ein Ziel wie 2048×1152 würde sonst verzerrt oder
 *  verlöre den Rest). Für Server, die eine Vorlage in genau der Erzeugungsgröße verlangen: Draw Things lehnt `init_images` mit abweichenden
 *  Maßen mit HTTP 422 ab (gemessen 2026-11-18, App 26.1020.0), A1111 skaliert selbst.
 *
 *  **Hat das Bild schon die Zielmaße und gibt es keinen Ausschnitt, kommt die Eingabe unverändert zurück** (derselbe String, kein Zeichnen,
 *  kein Neukodieren, kein Qualitätsverlust; das Bitmap wird für die Maße dennoch gelesen und geschlossen). Das Ergebnis ist sonst immer PNG,
 *  auch wenn die Eingabe JPEG oder WebP war. Wirft `RangeError` bei einer Zielgröße, die keine positive ganze Zahl ist (vor dem Dekodieren),
 *  bei einer Base64, die kein Bild ist, und wenn kein 2D-Kontext zu haben ist (das Bitmap wird auch dann geschlossen).
 *
 *  Herkunft: local-image-generator `fitInitImageToSize` (`src/obsidian/png.ts`, Welle 36, Bestellung über die Breite); die sieben Tests des
 *  Bestellers laufen gegen diese Fassung (`tests/image-crop.test.ts`). */
export async function fitImageToBase64(
  base64: string, crop: Crop | null, width: number, height: number, ports: ImageCropPorts = {},
): Promise<string> {
  checkTarget("width", width);
  checkTarget("height", height);
  const bmp = await base64ToImageBitmap(base64, ports);
  try {
    if (crop === null && bmp.width === width && bmp.height === height) return base64;
    const { sx, sy, sw, sh } = coverSourceRect(bmp.width, bmp.height, crop, width, height);
    const canvas = (ports.createCanvas ?? defaultCanvas)();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, width, height);
    return base64OfDataUrl(canvas.toDataURL("image/png"));
  } finally {
    bmp.close();
  }
}
