// vendored from obsidian-kit@0.69.1, src/obsidian/crop-modal.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Ausschnitt-Wahl (UI-STANDARD §8 ergänzt): das Bild mit einem quadratischen Rahmen darüber. Ziehen am Rahmen verschiebt, der Griff unten rechts
 * skaliert; `onChoose(crop)` bekommt den Rahmen, `onChoose(null)` heißt „ganzes Bild“ (keine Wahl), Abbrechen ruft nichts.
 *
 * ## Woher
 *
 * `local-image-generator/src/obsidian/crop-modal.ts` (Welle 24, img2img-Steuerung), das einzige Exemplar im Bestand. Die Geometrie (Klemmen,
 * Quadrat in Bildpunkten, `Crop` als Anteil des Originals) liegt in code-kit `pure/crop` (seit 0.33.0, unverändert gegen lig); dieses Modul
 * ist nur die Zeigerbehandlung und der Aufbau. Das Bild ist ein `<img>` (typisch eine Daten-URL), der Rahmen ein absolut positioniertes `<div>` in
 * Prozent des Bildes — gezeichnet wird nicht auf einem Canvas, damit die Darstellung dem Theme folgt und bei jeder Skalierung stimmt.
 *
 * ## Was gegenüber lig neu ist
 *
 * - **Tastatur (CORE-META-20: interaktive UI ist ab der ersten Fassung zugänglich).** lig bediente nur Zeiger. Hier ist der Rahmen fokussierbar
 *   (Pfeiltasten verschieben um 1 % der kürzeren Bildseite, mit Umschalt um das Zehnfache) und der Griff ein `role="slider"` mit
 *   `aria-valuemin`/`-max`/`-now` in Bildpunkten (rechts/oben größer, links/unten kleiner). Esc schließt weiter das Modal, Tab bleibt Tab.
 * - **Texte als Parameter** (`CropModalStrings`, UI-STANDARD §10), `info` als Funktion, weil die Wortstellung der Sprache gehört.
 * - **Theme-Farben statt `rgba`, mit einer Ausnahme:** Rand und Griff folgen dem Akzent. Die Abdunklung außerhalb des Rahmens ist die Variable
 *   `--okit-crop-scrim` mit dem festen Rückfallwert `rgba(0, 0, 0, 0.55)`. `--background-modifier-cover` taugte nicht: es ist im hellen Theme hell
 *   und dunkelte das Bild dort nicht ab (gemessen Welle 25/26). Eine Abdunklung ist unabhängig vom Theme dunkel, weil sie vor dem Bild steht, nicht vor dem
 *   Fenster. Der Consumer überschreibt `--okit-crop-scrim` in seiner `styles.css`, wenn er eine andere Stärke will.
 * - **„Übernehmen“ ist erst nach dem Laden des Bildes wirksam** (vorher gibt es keinen Rahmen).
 *
 * ## Fallen beim Übernehmen
 *
 * 1. **Das Kit injiziert kein CSS.** `CROP_MODAL_CSS` gehört in die `styles.css` des Consumers.
 * 2. **`start` ist ein Anteil des Originals** (`Crop`), keine Bildpunkte — dasselbe Rezept meint für ein 512²- und ein 1024²-Modell denselben Bereich.
 * 3. **Der Zweig „Bild ist beim Öffnen schon geladen“ (`img.complete`) ist im Kit-Test nicht belegt** (das Double hat keinen Ladezustand); lig hat ihn so.
 */

import { Modal, type App } from "obsidian";
import { defaultCrop, moveCrop, resizeCrop, MIN_CROP_PX, type Crop } from "../kit/crop";

/** Sichtbare Texte; das Kit schreibt keine Sprache fest (UI-STANDARD §10). */
export interface CropModalStrings {
  /** Titel des Modals. */
  title: string;
  /** Name des Rahmens für Screenreader; darf die Bedienung nennen („Pfeiltasten verschieben“). */
  frameLabel: string;
  /** Name des Griffs („Größe ändern“). */
  handleLabel: string;
  /** Knopf: kein Ausschnitt, das ganze Bild. */
  whole: string;
  cancel: string;
  ok: string;
  /** Maßangabe unter dem Bild: Rahmen (Breite, Höhe) und Original (Breite, Höhe), alles in Bildpunkten. */
  info: (cropW: number, cropH: number, imageW: number, imageH: number) => string;
}

export interface CropModalOptions {
  /** Quelle des Bildes, meist eine Daten-URL. */
  src: string;
  /** Rahmen beim Öffnen; `null` beginnt mit dem größten zentrierten Quadrat. */
  start: Crop | null;
  strings: CropModalStrings;
  /** `crop === null` heißt „ganzes Bild“ (keine Wahl); Abbrechen ruft nichts. */
  onChoose: (crop: Crop | null) => void;
  /** Zusätzliche Klassen am Inhalt, durch Leerraum getrennt — der Design-Scope des Consumers. */
  cls?: string;
}

/** Tastaturschritt in Bildpunkten: 1 % der kürzeren Bildseite, mindestens 1; mit Umschalt das Zehnfache. */
function keyStep(natural: { w: number; h: number }, shift: boolean): number {
  return Math.max(1, Math.round(Math.min(natural.w, natural.h) / 100)) * (shift ? 10 : 1);
}

export class CropModal extends Modal {
  private crop: Crop | null;
  private frameEl!: HTMLElement;
  private handleEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private imgEl!: HTMLImageElement;
  private okEl!: HTMLButtonElement;
  private natural: { w: number; h: number } | null = null;

  constructor(app: App, private readonly opts: CropModalOptions) {
    super(app);
    this.crop = opts.start;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    const { strings } = this.opts;
    titleEl.setText(strings.title);
    contentEl.addClass("okit-crop-modal");
    // Obsidians addClass wirft bei einem Leerzeichen (InvalidCharacterError) — mehrere Klassen einzeln.
    for (const c of (this.opts.cls ?? "").split(/\s+/)) if (c !== "") contentEl.addClass(c);

    const stage = contentEl.createDiv({ cls: "okit-crop-stage" });
    this.imgEl = stage.createEl("img", { cls: "okit-crop-img", attr: { src: this.opts.src, alt: "", draggable: "false" } });
    this.frameEl = stage.createDiv({ cls: "okit-crop-frame", attr: { "aria-label": strings.frameLabel, tabindex: "0" } });
    this.handleEl = this.frameEl.createDiv({
      cls: "okit-crop-handle",
      attr: { "aria-label": strings.handleLabel, role: "slider", tabindex: "0", "aria-valuemin": String(MIN_CROP_PX) },
    });
    this.infoEl = contentEl.createDiv({ cls: "okit-crop-info" });

    this.wirePointer(this.frameEl, "move");
    this.wirePointer(this.handleEl, "resize");
    this.wireKeys(this.frameEl, "move");
    this.wireKeys(this.handleEl, "resize");

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const whole = buttons.createEl("button", { text: strings.whole, cls: "okit-crop-whole" });
    whole.addEventListener("click", () => { this.close(); this.opts.onChoose(null); });
    const cancel = buttons.createEl("button", { text: strings.cancel, cls: "okit-crop-cancel" });
    cancel.addEventListener("click", () => { this.close(); });
    this.okEl = buttons.createEl("button", { text: strings.ok, cls: "mod-cta okit-crop-ok" });
    this.okEl.addEventListener("click", () => {
      const c = this.crop;
      // Vor dem Laden gibt es keinen Rahmen: nichts melden, das Modal bleibt offen.
      if (c === null || this.natural === null) return;
      this.close();
      this.opts.onChoose(c);
    });

    const ready = (): void => {
      this.natural = { w: this.imgEl.naturalWidth, h: this.imgEl.naturalHeight };
      this.crop ??= defaultCrop(this.natural.w, this.natural.h);
      this.render();
    };
    if (this.imgEl.complete && this.imgEl.naturalWidth > 0) ready();
    else this.imgEl.addEventListener("load", ready, { once: true });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Zeigerereignisse (nicht mouse*): so geht es auch mit Touch und Stift. `setPointerCapture` hält die Bewegung am Element, auch wenn der
   *  Zeiger den Rahmen verlässt. */
  private wirePointer(el: HTMLElement, mode: "move" | "resize"): void {
    el.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (this.natural === null || this.crop === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      el.setPointerCapture(ev.pointerId);
      let last = { x: ev.clientX, y: ev.clientY };
      const onMove = (m: PointerEvent): void => {
        if (this.natural === null || this.crop === null) return;
        const scale = this.imgEl.clientWidth / this.natural.w;
        if (scale <= 0) return;
        const dx = (m.clientX - last.x) / scale;
        const dy = (m.clientY - last.y) / scale;
        last = { x: m.clientX, y: m.clientY };
        this.apply(mode === "move" ? { dx, dy } : { side: (dx + dy) / 2 });
      };
      const end = (): void => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", end);
        el.removeEventListener("pointercancel", end);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
    });
  }

  /** Pfeiltasten: am Rahmen verschieben, am Griff die Seite ändern. Alles andere (Tab, Esc) bleibt unberührt. */
  private wireKeys(el: HTMLElement, mode: "move" | "resize"): void {
    el.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (this.natural === null || this.crop === null) return;
      const step = keyStep(this.natural, ev.shiftKey);
      let dx = 0, dy = 0;
      if (ev.key === "ArrowLeft") dx = -step;
      else if (ev.key === "ArrowRight") dx = step;
      else if (ev.key === "ArrowUp") dy = -step;
      else if (ev.key === "ArrowDown") dy = step;
      else return;
      ev.preventDefault();
      // Am Griff heißt „rechts/oben“ größer und „links/unten“ kleiner.
      this.apply(mode === "move" ? { dx, dy } : { side: dx !== 0 ? dx : -dy });
    });
  }

  private apply(change: { dx: number; dy: number } | { side: number }): void {
    if (this.natural === null || this.crop === null) return;
    this.crop = "side" in change
      ? resizeCrop(this.crop, this.natural.w, this.natural.h, change.side)
      : moveCrop(this.crop, this.natural.w, this.natural.h, change.dx, change.dy);
    this.render();
  }

  private render(): void {
    if (this.crop === null || this.natural === null) return;
    const c = this.crop;
    const side = Math.round(c.w * this.natural.w);
    // Prozentwerte relativ zum Bild: der Rahmen bleibt richtig, wenn das Bild skaliert wird. Auf vier Nachkommastellen gerundet (Anzeige,
    // nicht Geometrie): `0.105 * 100` ergibt sonst `10.500000000000002%`.
    const pct = (v: number): string => `${Math.round(v * 1e6) / 1e4}%`;
    this.frameEl.setCssProps({ left: pct(c.x), top: pct(c.y), width: pct(c.w), height: pct(c.h) });
    this.handleEl.setAttribute("aria-valuemax", String(Math.min(this.natural.w, this.natural.h)));
    this.handleEl.setAttribute("aria-valuenow", String(side));
    this.infoEl.setText(this.opts.strings.info(side, Math.round(c.h * this.natural.h), this.natural.w, this.natural.h));
  }
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS. Nur Theme-Variablen. */
export const CROP_MODAL_CSS = `
.okit-crop-stage { position: relative; display: inline-block; max-width: 100%; overflow: hidden; line-height: 0; user-select: none; touch-action: none; }
.okit-crop-img { display: block; max-width: 100%; max-height: 60vh; }
/* Der Rahmen dunkelt das Bild AUSSERHALB ab (Form), der Rand und der Griff folgen dem Akzent des Themes. Die Abdunklung ist eine eigene Variable
   mit hartem Rückfallwert (einzige feste Farbe der Konstante): ein Theme-Wert wie die Modal-Abdeckung ist im hellen Theme hell. */
.okit-crop-frame {
  position: absolute; box-sizing: border-box; cursor: move; touch-action: none;
  border: 2px solid var(--interactive-accent);
  box-shadow: 0 0 0 9999px var(--okit-crop-scrim, rgba(0, 0, 0, 0.55));
}
/* Der Griff sitzt IM Rahmen: ragte er über die Ecke hinaus, schnitte ihn die Bühne (overflow: hidden) am Bildrand ab, sobald der Rahmen
   bis dorthin reicht (gemessen 2026-10-23: 4 px fehlten). */
.okit-crop-handle {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
  background: var(--interactive-accent); cursor: nwse-resize; touch-action: none;
}
/* Der Fokusrahmen liegt INNEN (negativer outline-offset). Ein äußerer Ring wurde von der Bühne abgeschnitten, wo der Rahmen den Bildrand
   berührt, und las sich dort als zweite Kante neben dem Rahmen (Befund 2026-10-23). */
.okit-crop-frame:focus-visible { outline: 2px solid var(--text-normal); outline-offset: -4px; }
.okit-crop-handle:focus-visible { outline: 2px solid var(--background-primary); outline-offset: -4px; }
.okit-crop-info { color: var(--text-muted); font-size: var(--font-ui-small); margin-top: var(--size-4-2); }
`;
