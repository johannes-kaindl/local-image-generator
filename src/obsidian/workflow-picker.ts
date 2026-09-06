// Auswahl der ComfyUI-Workflow-Datei aus dem Vault. Obsidian-nativ: FuzzySuggestModal ist
// dieselbe Bedienung wie der Schnellwechsler (UI-STANDARD §1). Form uebernommen von
// src/obsidian/image-picker.ts.
import { FuzzySuggestModal, TFile, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";

export class WorkflowPickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onPick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder(t("workflow.pickerTitle"));
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "json");
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
