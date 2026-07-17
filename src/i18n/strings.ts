// Plugin-eigene UI-Chrome-Strings (Buttons, Settings, Notices). registerI18n() wird EINMALIG
// im onload aufgerufen (vor addCommand/addSettingTab/addRibbonIcon/registerView), siehe
// docs/superpowers/specs/2026-07-17-i18n-design.md §2.
//
// Key-Namespaces: cmd.* (Commands) · view.* (View-Titel/Tabs) · generate.* (Generate-Panel) ·
// status.* (Statuszeile) · empty.* (Leerzustände) · notice.* (new Notice(...)) ·
// settings.<gruppe>.* (Settings-Tab) · history.* (History-Panel) · modal.* (ConfirmModal).
import { defineStrings } from "../vendor/kit/i18n";

export const EN: Record<string, string> = {
  "cmd.open": "Open generator",

  "view.title": "Local image generator",
  "view.tabGenerate": "Generate",
  "view.tabHistory": "History",

  "generate.promptPlaceholder": "Describe the image…",
  "generate.button.generate": "Generate",
  "generate.button.reroll": "Reroll",
  "generate.button.create": "Create",
  "generate.button.insert": "Insert",
  "generate.steps": "Steps",
  "generate.seed": "Seed",
  "generate.randomSeed": "Randomize seed",
  "generate.presetsLabel": "Styles",
  "generate.insertNeedsEditor": "Open a note to insert the image",

  "status.checking": "Checking GPU…",
  "status.ready": "Ready",
  "status.noWebgpu":
    "WebGPU is not available. This plugin needs macOS or Windows with a supported GPU (Linux support depends on drivers).",
  "status.noF16": "This GPU lacks fp16 support (shader-f16), which the model requires.",
  "status.downloading": "Downloading model… {0}%",
  "status.generating": "Generating… step {0}/{1}",
  "status.error": "Error: {0}",

  "empty.noModel": "The model (~2.5 GB) is not downloaded yet.",
  "empty.noModelCta": "Download model (~2.5 GB)",
  "empty.noImage": "Enter a prompt and press Generate.",

  "notice.saveFailed": "Save failed: {0}",
  "notice.oomHint":
    "Generation failed. Try closing other apps — the model needs roughly 4–7 GB of free memory.",
  "notice.saved": "Saved: {0}",
  "notice.noteFailed": "Image saved to {0}, but the note failed: {1}",
  "notice.modelDownloaded": "Model downloaded",

  "settings.model.heading": "Model",
  "settings.model.desc":
    "SD-Turbo (ONNX, fp16) is downloaded from Hugging Face after you explicitly start it. Stored in the local browser cache, outside your vault.",
  "settings.model.download": "Download (~{0} GB)",
  "settings.model.downloadedTooltip": "Downloaded",
  "settings.model.delete": "Delete model",
  "settings.model.deleteConfirm":
    "Delete the downloaded model files (~2.5 GB)? You can download them again anytime.",

  "settings.output.heading": "Output",
  "settings.output.folder": "Image folder",
  "settings.output.folderDesc":
    "Where generated images are saved. Leave empty to use Obsidian's attachment folder.",

  "settings.noteFolder": "Note folder",
  "settings.noteFolderDesc": "Where result notes are saved. Leave empty to put them next to the image.",

  "settings.createMode": "Create button",
  "settings.createModeDesc":
    "Whether Create saves just the image, or also a note with the settings in its frontmatter and the image embedded.",
  "settings.createModeImage": "Image only",
  "settings.createModeNote": "Image + note",

  "settings.defaultSteps": "Default steps",
  "settings.defaultStepsDesc": "Starting value of the steps slider. SD-Turbo is trained for 1–4 steps.",

  "settings.presets.heading": "Styles",
  "settings.presets.desc": "Style chips shown under the prompt. Clicking a chip appends its text to the prompt.",
  "settings.presets.label": "Label",
  "settings.presets.suffix": "Prompt text",
  "settings.presets.add": "Add style",
  "settings.presets.delete": "Delete style",

  "settings.danger.heading": "Danger zone",

  "history.empty": "No history yet. Generate an image to start.",
  "history.viewRecent": "Recent",
  "history.viewGrouped": "By prompt",
  "history.clear": "Clear all",
  "history.clearConfirm": "Clear the entire generation history? This cannot be undone.",
  "history.delete": "Delete entry",
  "history.recipe": "seed {0} · {1} steps · {2}",
  "history.variations.one": "1 variation",
  "history.variations.other": "{0} variations",

  "modal.cancel": "Cancel",
  "modal.confirm": "Delete",
};

export const DE: Record<string, string> = {
  "cmd.open": "Bildgenerator öffnen",

  "view.title": "Lokaler Bildgenerator",
  "view.tabGenerate": "Generieren",
  "view.tabHistory": "Verlauf",

  "generate.promptPlaceholder": "Bild beschreiben…",
  "generate.button.generate": "Generieren",
  "generate.button.reroll": "Neu würfeln",
  "generate.button.create": "Erstellen",
  "generate.button.insert": "Einfügen",
  "generate.steps": "Schritte",
  "generate.seed": "Seed",
  "generate.randomSeed": "Seed zufällig würfeln",
  "generate.presetsLabel": "Stile",
  "generate.insertNeedsEditor": "Notiz öffnen, um das Bild einzufügen",

  "status.checking": "GPU wird geprüft…",
  "status.ready": "Bereit",
  "status.noWebgpu":
    "WebGPU ist nicht verfügbar. Dieses Plugin benötigt macOS oder Windows mit unterstützter GPU (Linux-Unterstützung hängt von den Treibern ab).",
  "status.noF16": "Diese GPU unterstützt kein fp16 (shader-f16), das vom Modell benötigt wird.",
  "status.downloading": "Modell wird heruntergeladen… {0}%",
  "status.generating": "Generiert… Schritt {0}/{1}",
  "status.error": "Fehler: {0}",

  "empty.noModel": "Das Modell (~2,5 GB) wurde noch nicht heruntergeladen.",
  "empty.noModelCta": "Modell herunterladen (~2,5 GB)",
  "empty.noImage": "Prompt eingeben und auf Generieren klicken.",

  "notice.saveFailed": "Speichern fehlgeschlagen: {0}",
  "notice.oomHint":
    "Generierung fehlgeschlagen. Andere Apps schließen — das Modell benötigt etwa 4–7 GB freien Speicher.",
  "notice.saved": "Gespeichert: {0}",
  "notice.noteFailed": "Bild wurde unter {0} gespeichert, aber die Notiz ist fehlgeschlagen: {1}",
  "notice.modelDownloaded": "Modell heruntergeladen",

  "settings.model.heading": "Modell",
  "settings.model.desc":
    "SD-Turbo (ONNX, fp16) wird von Hugging Face heruntergeladen, sobald du das explizit startest. Wird im lokalen Browser-Cache gespeichert, außerhalb deines Vaults.",
  "settings.model.download": "Herunterladen (~{0} GB)",
  "settings.model.downloadedTooltip": "Heruntergeladen",
  "settings.model.delete": "Modell löschen",
  "settings.model.deleteConfirm":
    "Heruntergeladene Modelldateien löschen (~2,5 GB)? Du kannst sie jederzeit erneut herunterladen.",

  "settings.output.heading": "Ausgabe",
  "settings.output.folder": "Bilderordner",
  "settings.output.folderDesc":
    "Wo generierte Bilder gespeichert werden. Leer lassen, um Obsidians Anhang-Ordner zu verwenden.",

  "settings.noteFolder": "Notizordner",
  "settings.noteFolderDesc": "Wo Ergebnis-Notizen gespeichert werden. Leer lassen, um sie neben dem Bild abzulegen.",

  "settings.createMode": "Erstellen-Knopf",
  "settings.createModeDesc":
    "Ob „Erstellen“ nur das Bild speichert oder zusätzlich eine Notiz mit den Einstellungen im Frontmatter und eingebettetem Bild.",
  "settings.createModeImage": "Nur Bild",
  "settings.createModeNote": "Bild + Notiz",

  "settings.defaultSteps": "Standard-Schritte",
  "settings.defaultStepsDesc": "Startwert des Schritte-Reglers. SD-Turbo ist auf 1–4 Schritte trainiert.",

  "settings.presets.heading": "Stile",
  "settings.presets.desc": "Stil-Chips unter dem Prompt. Ein Klick auf einen Chip hängt dessen Text an den Prompt an.",
  "settings.presets.label": "Beschriftung",
  "settings.presets.suffix": "Prompt-Text",
  "settings.presets.add": "Stil hinzufügen",
  "settings.presets.delete": "Stil löschen",

  "settings.danger.heading": "Gefahrenzone",

  "history.empty": "Noch kein Verlauf. Erstelle ein Bild, um zu starten.",
  "history.viewRecent": "Zuletzt",
  "history.viewGrouped": "Nach Prompt",
  "history.clear": "Alles löschen",
  "history.clearConfirm": "Den gesamten Generierungsverlauf löschen? Das kann nicht rückgängig gemacht werden.",
  "history.delete": "Eintrag löschen",
  "history.recipe": "Seed {0} · {1} Schritte · {2}",
  "history.variations.one": "1 Variante",
  "history.variations.other": "{0} Varianten",

  "modal.cancel": "Abbrechen",
  "modal.confirm": "Löschen",
};

/** Registriert EN/DE bei der vendorten i18n-Engine. Einmalig vor dem ersten t()-Aufruf
 *  (main.ts ruft dies im onload auf, vor addCommand/addSettingTab/addRibbonIcon/registerView). */
export function registerI18n(): void {
  defineStrings({ en: EN, de: DE });
}
