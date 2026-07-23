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

  "view.title": "Local Image Generator",
  "view.tabGenerate": "Generate",
  "view.tabHistory": "History",

  "generate.promptPlaceholder": "Describe the image…",
  "generate.button.generate": "Generate",
  "generate.button.reroll": "Reroll",
  "generate.button.create": "Create",
  "generate.button.insert": "Insert",
  "generate.model": "Model",
  "generate.modelInfo": "Model: {0}",
  "generate.modelInApp": "Model: (chosen in the server app)",
  "generate.negativePrompt": "Negative prompt",
  "generate.negativePromptPlaceholder": "What to avoid…",
  "generate.size": "Size",
  "generate.steps": "Steps",
  "generate.cfg": "Guidance (CFG)",
  "generate.seed": "Seed",
  "generate.randomSeed": "Randomize seed",
  "generate.presetsLabel": "Styles",
  "generate.insertNeedsEditor": "Open a note to insert the image",

  "status.ready": "Ready",
  "status.error": "Error: {0}",
  "status.noEndpoint": "No image server configured",
  "status.serverChecking": "Checking server…",
  "status.serverUnreachable": "Server unreachable — is the API enabled?",
  "status.contacting": "Contacting server…",
  "status.generatingPct": "Generating… {0}%",
  "status.generatingElapsed": "Generating… ({0})",

  "empty.noImage": "Enter a prompt and press Generate.",
  "empty.noServer":
    "Connect a local image server such as Draw Things (enable its API server) or AUTOMATIC1111 (--api), then enter the endpoint in the settings.",
  "empty.noServerCta": "Open settings",
  "empty.unreachable": "The server did not respond. Is it running and the API enabled?",
  "empty.unreachableCta": "Retry",

  "notice.saveFailed": "Save failed: {0}",
  "notice.saved": "Saved: {0}",
  "notice.noteFailed": "Image saved to {0}, but the note failed: {1}",

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

  "settings.server.name": "Server endpoint",
  "settings.server.desc":
    "A1111-compatible local image server — Draw Things (enable API server), AUTOMATIC1111 (--api), Forge, SD.Next.",
  "settings.server.test": "Test connection",

  "notice.serverOk": "Server OK — model: {0}",
  "notice.serverFail": "Server not reachable. Check that it is running and the API is enabled.",

  "settings.legacy.delete": "Delete old SD-Turbo weights (~2.5 GB)",
  "settings.legacy.done": "Old weights deleted.",
  "notice.legacyHint": "Old in-process model weights found (~2.5 GB). You can delete them in the settings.",

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
  "generate.model": "Modell",
  "generate.modelInfo": "Modell: {0}",
  "generate.modelInApp": "Modell: (in der Server-App gewählt)",
  "generate.negativePrompt": "Negativ-Prompt",
  "generate.negativePromptPlaceholder": "Was vermieden werden soll…",
  "generate.size": "Größe",
  "generate.steps": "Schritte",
  "generate.cfg": "Guidance (CFG)",
  "generate.seed": "Seed",
  "generate.randomSeed": "Seed zufällig würfeln",
  "generate.presetsLabel": "Stile",
  "generate.insertNeedsEditor": "Notiz öffnen, um das Bild einzufügen",

  "status.ready": "Bereit",
  "status.error": "Fehler: {0}",
  "status.noEndpoint": "Kein Bildserver konfiguriert",
  "status.serverChecking": "Server wird geprüft…",
  "status.serverUnreachable": "Server nicht erreichbar — ist die API aktiviert?",
  "status.contacting": "Server wird kontaktiert…",
  "status.generatingPct": "Generiert… {0}%",
  "status.generatingElapsed": "Generiert… ({0})",

  "empty.noImage": "Prompt eingeben und auf Generieren klicken.",
  "empty.noServer":
    "Verbinde einen lokalen Bildserver wie Draw Things (API-Server aktivieren) oder AUTOMATIC1111 (--api) und trage den Endpunkt in den Einstellungen ein.",
  "empty.noServerCta": "Einstellungen öffnen",
  "empty.unreachable": "Der Server hat nicht geantwortet. Läuft er, und ist die API aktiviert?",
  "empty.unreachableCta": "Erneut versuchen",

  "notice.saveFailed": "Speichern fehlgeschlagen: {0}",
  "notice.saved": "Gespeichert: {0}",
  "notice.noteFailed": "Bild wurde unter {0} gespeichert, aber die Notiz ist fehlgeschlagen: {1}",

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

  "settings.server.name": "Server-Endpoint",
  "settings.server.desc":
    "A1111-kompatibler lokaler Bild-Server — Draw Things (API-Server aktivieren), AUTOMATIC1111 (--api), Forge, SD.Next.",
  "settings.server.test": "Verbindung testen",

  "notice.serverOk": "Server OK — Modell: {0}",
  "notice.serverFail": "Server nicht erreichbar. Prüfe, ob er läuft und die API aktiviert ist.",

  "settings.legacy.delete": "Alte SD-Turbo-Gewichte löschen (~2,5 GB)",
  "settings.legacy.done": "Alte Gewichte gelöscht.",
  "notice.legacyHint": "Alte In-Process-Modellgewichte gefunden (~2,5 GB). Du kannst sie in den Einstellungen löschen.",

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
