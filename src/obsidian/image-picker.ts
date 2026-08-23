// Auswahl eines Vorlagenbildes aus dem Vault (Spec 0.8 §4, Weg A). Obsidian-nativ:
// FuzzySuggestModal ist dieselbe Bedienung wie der Schnellwechsler — kein eigenes Frontend
// (UI-STANDARD §1). Kennt das Plugin nicht, nur den Rueckruf.
import { FuzzySuggestModal, TFile, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";

/** Was ein A1111-kompatibler Server als Vorlage annimmt. Bewusst knapp gehalten: die Datei
 *  wird unveraendert weitergereicht (Spec §9 — kein Skalieren, kein Zuschneiden). */
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

export class ImagePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onPick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder(t("picker.title"));
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => IMAGE_EXT.has(f.extension.toLowerCase()));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
