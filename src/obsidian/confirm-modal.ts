import { App, Modal } from "obsidian";
import { t } from "../vendor/kit/i18n";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    const confirm = buttons.createEl("button", { text: this.confirmLabel, cls: "mod-warning" });
    confirm.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
