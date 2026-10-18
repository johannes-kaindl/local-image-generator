import { Modal, type App } from "obsidian";
import { defaultCrop, moveCrop, resizeCrop, type Crop } from "../core/crop";
import { t } from "../vendor/kit/i18n";

/** Ausschnitt-Wahl fuer die Vorlage (img2img, Spec img2img-Steuerung §4.5): das Bild mit einem
 *  quadratischen Rahmen darueber. Ziehen verschiebt, die Ecke unten rechts skaliert. Das Bild ist
 *  ein <img> mit Daten-URL, der Rahmen ein absolut positioniertes <div> — gezeichnet wird nicht
 *  auf einem Canvas, damit die Darstellung dem Theme folgt. Geometrie (Klemmen, Quadrat in
 *  Bildpunkten) steht rein in `core/crop.ts`; hier liegt nur die Zeigerbehandlung.
 *
 *  Kein Kit-Baustein und kein Vorbild im Workspace (UI-Abweichung in der AGENTS.md deklariert). */
export class CropModal extends Modal {
  private crop: Crop | null;
  private frameEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private imgEl!: HTMLImageElement;
  private natural: { w: number; h: number } | null = null;

  constructor(
    app: App,
    private readonly dataUrl: string,
    start: Crop | null,
    /** `crop === null` heisst „ganzes Bild" (keine Wahl); Abbrechen ruft nichts. */
    private readonly onChoose: (crop: Crop | null) => void,
  ) {
    super(app);
    this.crop = start;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(t("crop.title"));
    contentEl.addClass("lig-crop-modal");

    const stage = contentEl.createDiv({ cls: "lig-crop-stage" });
    this.imgEl = stage.createEl("img", { cls: "lig-crop-img", attr: { src: this.dataUrl, alt: "", draggable: "false" } });
    this.frameEl = stage.createDiv({ cls: "lig-crop-frame", attr: { "aria-label": t("crop.frameLabel") } });
    const handle = this.frameEl.createDiv({ cls: "lig-crop-handle", attr: { "aria-label": t("crop.handleLabel") } });
    this.infoEl = contentEl.createDiv({ cls: "lig-crop-info" });

    this.wirePointer(this.frameEl, "move");
    this.wirePointer(handle, "resize");

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const whole = buttons.createEl("button", { text: t("crop.whole"), cls: "lig-crop-whole" });
    whole.addEventListener("click", () => { this.close(); this.onChoose(null); });
    const cancel = buttons.createEl("button", { text: t("crop.cancel"), cls: "lig-crop-cancel" });
    cancel.addEventListener("click", () => this.close());
    const ok = buttons.createEl("button", { text: t("crop.ok"), cls: "mod-cta lig-crop-ok" });
    ok.addEventListener("click", () => { const c = this.crop; this.close(); if (c !== null) this.onChoose(c); });

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

  /** Zeigerereignisse (nicht mouse*): so geht es auch mit Touch und Stift. `setPointerCapture`
   *  haelt die Bewegung am Element, auch wenn der Zeiger den Rahmen verlaesst. */
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
        this.crop = mode === "move"
          ? moveCrop(this.crop, this.natural.w, this.natural.h, dx, dy)
          : resizeCrop(this.crop, this.natural.w, this.natural.h, (dx + dy) / 2);
        this.render();
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

  private render(): void {
    if (this.crop === null || this.natural === null) return;
    const c = this.crop;
    // Prozentwerte relativ zum Bild: der Rahmen bleibt richtig, wenn das Bild skaliert wird.
    this.frameEl.setCssProps({
      left: `${c.x * 100}%`,
      top: `${c.y * 100}%`,
      width: `${c.w * 100}%`,
      height: `${c.h * 100}%`,
    });
    this.infoEl.setText(t("crop.info", Math.round(c.w * this.natural.w), Math.round(c.h * this.natural.h), this.natural.w, this.natural.h));
  }
}
