// Preset-Editor für den Settings-Tab (Spec §7.5).
import { Notice, Setting } from "obsidian";
import type { StylePreset } from "../core/settings";
import { t } from "../vendor/kit/i18n";

export interface PresetEditorHost {
  getPresets(): StylePreset[];
  setPresets(next: StylePreset[]): Promise<void>;
  /** Nur bei Hinzufügen/Löschen aufrufen — NIE bei Textänderungen. */
  rerender(): void;
}

/** Übernimmt einen neuen Preset-Stand. Scheitert das Speichern (Platte voll, Rechte),
 *  steht der Stand zwar im Speicher, aber nicht auf der Platte — ohne Meldung wäre die
 *  Änderung beim nächsten Obsidian-Start still weg. Das rerender() im catch bringt die
 *  Oberfläche auf den tatsächlichen Speicherstand, die Notice sagt, dass er flüchtig ist.
 *  Nach demselben Muster wie der Download-Button im Settings-Tab. */
async function apply(host: PresetEditorHost, next: StylePreset[], rerender: boolean): Promise<void> {
  try {
    await host.setPresets(next);
    if (rerender) host.rerender();
  } catch (e) {
    new Notice(t("notice.saveFailed", e instanceof Error ? e.message : String(e)));
    host.rerender();
  }
}

// Immer immutabel ersetzen, nie in-place mutieren: mergeSettings klont Arrays nur flach,
// die Preset-Objekte können also noch DEFAULT_PRESETS aus src/core/settings.ts sein.
async function patch(host: PresetEditorHost, id: string, change: Partial<StylePreset>): Promise<void> {
  await apply(host, host.getPresets().map((p) => (p.id === id ? { ...p, ...change } : p)), false);
}

export function renderPresetEditor(containerEl: HTMLElement, host: PresetEditorHost): void {
  for (const preset of host.getPresets()) {
    const setting = new Setting(containerEl);

    setting.addText((tf) => {
      tf.setPlaceholder(t("settings.presets.label")).setValue(preset.label);
      tf.inputEl.setAttribute("aria-label", t("settings.presets.label"));
      // Commit auf blur, NICHT über onChange: onChange feuert pro Tastendruck; speichern
      // und neu rendern je Zeichen würde den Fokus nach jedem Buchstaben verlieren
      // (Lesson vim-dojo 0.5.0). Hier bewusst KEIN rerender.
      tf.inputEl.addEventListener("blur", () => {
        void patch(host, preset.id, { label: tf.getValue().trim() });
      });
    });

    setting.addText((tf) => {
      tf.setPlaceholder(t("settings.presets.suffix")).setValue(preset.suffix);
      tf.inputEl.setAttribute("aria-label", t("settings.presets.suffix"));
      tf.inputEl.addClass("lig-preset-suffix");
      tf.inputEl.addEventListener("blur", () => {
        void patch(host, preset.id, { suffix: tf.getValue().trim() });
      });
    });

    setting.addExtraButton((b) =>
      b
        .setIcon("trash")
        .setTooltip(t("settings.presets.delete"))
        .onClick(() => {
          void apply(host, host.getPresets().filter((p) => p.id !== preset.id), true);
        }),
    );
  }

  new Setting(containerEl).addButton((b) =>
    b.setButtonText(t("settings.presets.add")).onClick(() => {
      const fresh: StylePreset = { id: crypto.randomUUID(), label: "", suffix: "" };
      void apply(host, [...host.getPresets(), fresh], true);
    }),
  );
}
