// Preset-Editor für den Settings-Tab (Spec §7.5).
import { Setting } from "obsidian";
import type { StylePreset } from "../core/settings";
import { STRINGS } from "../core/strings";

export interface PresetEditorHost {
  getPresets(): StylePreset[];
  setPresets(next: StylePreset[]): Promise<void>;
  /** Nur bei Hinzufügen/Löschen aufrufen — NIE bei Textänderungen. */
  rerender(): void;
}

// Immer immutabel ersetzen, nie in-place mutieren: mergeSettings klont Arrays nur flach,
// die Preset-Objekte können also noch DEFAULT_PRESETS aus src/core/settings.ts sein.
async function patch(host: PresetEditorHost, id: string, change: Partial<StylePreset>): Promise<void> {
  await host.setPresets(host.getPresets().map((p) => (p.id === id ? { ...p, ...change } : p)));
}

export function renderPresetEditor(containerEl: HTMLElement, host: PresetEditorHost): void {
  for (const preset of host.getPresets()) {
    const setting = new Setting(containerEl);

    setting.addText((t) => {
      t.setPlaceholder(STRINGS.settingsPresetLabel).setValue(preset.label);
      t.inputEl.setAttribute("aria-label", STRINGS.settingsPresetLabel);
      // Commit auf blur, NICHT über onChange: onChange feuert pro Tastendruck; speichern
      // und neu rendern je Zeichen würde den Fokus nach jedem Buchstaben verlieren
      // (Lesson vim-dojo 0.5.0). Hier bewusst KEIN rerender.
      t.inputEl.addEventListener("blur", () => {
        void patch(host, preset.id, { label: t.getValue().trim() });
      });
    });

    setting.addText((t) => {
      t.setPlaceholder(STRINGS.settingsPresetSuffix).setValue(preset.suffix);
      t.inputEl.setAttribute("aria-label", STRINGS.settingsPresetSuffix);
      t.inputEl.addClass("lig-preset-suffix");
      t.inputEl.addEventListener("blur", () => {
        void patch(host, preset.id, { suffix: t.getValue().trim() });
      });
    });

    setting.addExtraButton((b) =>
      b
        .setIcon("trash")
        .setTooltip(STRINGS.settingsPresetDelete)
        .onClick(() => {
          void (async () => {
            await host.setPresets(host.getPresets().filter((p) => p.id !== preset.id));
            host.rerender();
          })();
        }),
    );
  }

  new Setting(containerEl).addButton((b) =>
    b.setButtonText(STRINGS.settingsPresetAdd).onClick(() => {
      void (async () => {
        const fresh: StylePreset = { id: crypto.randomUUID(), label: "", suffix: "" };
        await host.setPresets([...host.getPresets(), fresh]);
        host.rerender();
      })();
    }),
  );
}
