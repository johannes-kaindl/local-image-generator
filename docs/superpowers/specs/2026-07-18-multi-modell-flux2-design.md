# Multi-Modell-Support: FLUX.2 klein 4B via mflux (Stufe A, 0.4)

**Datum:** 2026-07-18 · **Status:** Entwurf zur Review
**Stufen-Schnitt:** Dieses Dokument spezifiziert Stufe A (Multi-Modell + FLUX-Text-to-Image).
Stufe B (Editing mit Referenzbildern, 0.5) bekommt eine eigene Spec; §12 hält fest, was
Stufe A dafür vorbereitet.

## §1 Ziel

Das Plugin bekommt ein zweites Modell: **FLUX.2 klein 4B (distilled, Apache 2.0)**, betrieben
als **Kindprozess** über das vom User selbst installierte CLI-Tool
**[mflux](https://github.com/filipstrand/mflux)** (MLX, Apple Silicon). SD-Turbo bleibt
unverändert die in-process-ORT-Engine. Die Architektur ist ein **Modell-Katalog mit
Capabilities**: ein drittes Modell später (z. B. klein-base 4B mit echtem CFG) ist ein
Katalog-Eintrag plus ggf. neue Capability-Felder — kein Umbau.

## §2 Entscheidungen (Brainstorming 2026-07-18)

- **FLUX.2 klein 4B distilled** — nicht 9B (Non-Commercial-Lizenz, ~29 GB), nicht klein-base
  (~50 Steps, Minuten/Bild). klein-base bleibt vorgemerkte Option, falls distilled an Grenzen stößt.
- **klein 4B ist step- UND guidance-distilliert** → CFG-Regler und Negative Prompt bleiben
  draußen (Keine-Attrappen-Linie aus 0.2). Echt werden: **Auflösung/Seitenverhältnis**,
  Prompt-Treue, Text-Rendering.
- **Runtime mflux**, nicht iris.c (Compile-Pflicht, keine Quantisierung) und kein
  Adapter-Doppel (YAGNI). Quantisierung fest **8-bit** (`-q 8`), kein Regler.
- **Kein Code-Nachladen** (Store-Regel): mflux installiert der User selbst
  (`uv tool install mflux`); das Plugin erkennt, spawnt und überwacht es nur.
  Modell**gewichte** sind Daten und werden wie bei SD-Turbo per Opt-in geladen.
- **Modellwahl im Generate-Tab** (Dropdown beim Prompt), nicht in den Settings.
- **Modell-Speicherort wählbar** (Backlog 3): steuert `HF_HOME` des Kindprozesses.
  SD-Turbo-Gewichte bleiben in der Cache API (kein Umzug, 2,5 GB, kein akuter Nutzen).
- **ComfyUI-Checkpoints sind nicht einbindbar** (Single-File-FP8/GGUF vs. HF-Diffusers-Layout
  für MLX). Der geteilte HF-Cache dedupliziert aber gegen alle HF-basierten Tools —
  Settings-Hinweistext macht beides explizit.
- **Umsetzung in zwei Stufen** (A: dieses Dokument → 0.4; B: Editing → 0.5).

## §3 Modell-Katalog (`src/core/models.ts`, neu, pure)

```ts
export interface SizeOption { width: number; height: number; }   // Vielfache von 16

export interface ModelSpec {
  id: "sd-turbo" | "flux2-klein-4b";
  label: string;                       // Anzeige im Dropdown (nicht übersetzt, Eigenname)
  engine: "ort" | "mflux";
  steps: { min: number; max: number; default: number };
  sizes: readonly SizeOption[];        // length 1 → Größen-Regler unsichtbar
  maxReferences: number;               // Stufe A: überall 0; Stufe B: FLUX 4
}

export const MODELS: readonly ModelSpec[] = [
  { id: "sd-turbo",       label: "SD-Turbo",        engine: "ort",
    steps: { min: 1, max: 4, default: 4 }, sizes: [{ width: 512, height: 512 }], maxReferences: 0 },
  { id: "flux2-klein-4b", label: "FLUX.2 klein 4B", engine: "mflux",
    steps: { min: 1, max: 8, default: 4 },
    sizes: [ { width: 512,  height: 512 },  { width: 768,  height: 768 },
             { width: 1024, height: 1024 }, { width: 768,  height: 512 },
             { width: 512,  height: 768 },  { width: 1024, height: 576 },
             { width: 576,  height: 1024 } ],   // alle Vielfache von 16
    maxReferences: 0 },
];
export function getModel(id: string): ModelSpec; // Fallback: sd-turbo (Sanitizing-Pfad)
```

Die UI rendert Regler **ausschließlich aus dem Katalog** (kein Modell-if/else im Panel).
CFG/Negative-Prompt existieren bewusst nicht als Felder — erst ein Modell, das sie echt
kann, führt sie als neue Capability ein.

## §4 Engine-Schicht

### §4.1 Gemeinsames Request/Result (Erweiterung `src/core/engine.ts`-Typen)

`GenerateRequest` += `model: string`, `width: number`, `height: number`.
`GenerateResult.width/height` werden `number` (bisher Literal `512`). Der bestehende
`SdTurboEngine`-Code bleibt funktional unverändert — er bekommt nie etwas anderes als
512², weil der Katalog für sd-turbo nur diese Größe erlaubt.

### §4.2 Engine-Router (Hub-Schicht)

Der Hub spricht einen Router, der per `getModel(req.model).engine` dispatcht:
`"ort"` → bestehender Pfad (Sessions laden, SdTurboEngine), `"mflux"` → MfluxEngine.
Die ORT-Lade-/Watchdog-/Dispose-Logik aus dem Robustheits-Block bleibt unberührt.

### §4.3 MfluxEngine (`src/obsidian/mflux-engine.ts`, neu) — ein spawn pro Generierung

- `child_process.spawn(mfluxBinary, args, { env: { ...process.env, HF_HOME } })` —
  `HF_HOME` nur gesetzt, wenn ein Speicherort konfiguriert ist (§6).
- Kein persistenter Prozess (mflux hat keinen Server-Modus): Modell-Load pro Aufruf,
  durch 8-bit-Quantisierung und macOS-Datei-Cache erträglich.
- Ausgabe: PNG in Temp-Datei im Plugin-Datenverzeichnis, nach Erfolg via bestehendem
  saveImage-Pfad ins Vault-Ausgabeziel übernommen, Temp-Datei immer gelöscht (auch bei Fehler).
- Nur **ein** Kindprozess gleichzeitig (bestehendes busy-Muster).
- Abbruch/Aufräumen: `kill()` bei Watchdog-Auslösung, View-Close und Plugin-Unload.

Pure-Bausteine (Node-testbar, `src/core/`):
- **`mflux-args.ts`**: baut die CLI-Argumentliste aus `GenerateRequest` + Settings
  (Modellname, `--prompt`, `--steps`, `--seed`, `--width/--height`, `-q 8`, Output-Pfad).
  Exakte Flag-Namen werden in der Plan-Phase gegen die installierte mflux-Version
  verifiziert und im Plan festgeschrieben (nicht geraten).
- **`mflux-output.ts`**: stdout/stderr-Zeilenparser → Ereignisse
  `download-progress` (Datei + %), `loading`, `step` (X/Y), `done`, `error(message)`.
  Unbekannte Zeilen sind kein Fehler (Forward-Kompatibilität mit mflux-Updates).

### §4.4 Robustheit (Muster aus Robustheits-Block wiederverwendet)

- **Stall-Watchdog statt Gesamt-Timeout:** 5 Minuten ohne neue stdout/stderr-Zeile →
  Prozess killen, Fehlerzustand in der Statuszeile (Download darf beliebig lange dauern,
  solange er Fortschritt meldet).
- Exit-Code ≠ 0 → Fehlerzustand mit letzter stderr-Zeile als Detail.
- `generateEnabled` wird bei jedem Fehlerzustand wieder `true` (Retry = Generate-Button,
  wie im Robustheits-Block entschieden).
- **Hinweis für die Plan-Phase (Lesson 2026-07-18):** Kindprozess-Lebenszyklus ×
  View-Close × Watchdog ist Nebenläufigkeits-Logik — Task-Reviews rechnen konkrete
  Interleaving-Szenarien durch, 2–3 Review-Runden einplanen.

## §5 Generate-Tab

- **Modell-Dropdown** oberhalb des Prompts, Einträge aus `MODELS`. Auswahl wird in den
  Settings persistiert (`selectedModel`) und von History-Restore/Reroll mitgesetzt.
- **Größen-Dropdown** („Size", Format `1024 × 576`), nur sichtbar wenn `sizes.length > 1`.
  Bei SD-Turbo ändert sich der Tab dadurch nicht.
- **Steps-Slider**: min/max/default aus dem Katalog. Das bestehende Setting `defaultSteps`
  gilt weiterhin nur als Startwert für sd-turbo; FLUX startet auf dem Katalog-Default
  (kein neues Setting, YAGNI).
- **Setup-Zustand:** Ist FLUX gewählt, aber mflux nicht gefunden oder Gewichte fehlen,
  zeigt der Tab statt des Generate-Buttons einen Hinweis mit Button in die Settings
  („Setup nötig"). Kein Fehler-Wurf beim bloßen Auswählen.

## §6 Settings-Sektion „FLUX.2 klein (mflux)" (collapsibleSection)

- **mflux-Pfad** (Setting `mfluxPath: string`, leer = Auto-Detect): Auto-Detect über
  Kandidatenliste (`~/.local/bin/mflux-generate`, `/opt/homebrew/bin/…`,
  `/usr/local/bin/…` — Electron erbt den Shell-PATH nicht), darunter manuelles
  Pfad-Feld (überschreibt Auto-Detect). Statuszeile:
  „mflux gefunden: <Pfad> · Version X" / „nicht gefunden" + Kurzanleitung
  (`uv tool install mflux`).
- **Modell-Speicherort** (Setting `modelsDir: string`, leer = HF-Standard): Textfeld,
  Systempfad (kein Vault-FolderSuggest). Leer =
  HF-Standard-Cache (`~/.cache/huggingface`). Validierung: existiert nicht → wird beim
  Download angelegt; nicht beschreibbar → Fehlermeldung im Feld. Hinweistext:
  geteilter HF-Cache (bereits via HuggingFace geladene Modelle werden wiederverwendet),
  ComfyUI-Checkpoints sind ein anderes Format und nicht einbindbar.
- **Gewichte-Download (Opt-in, ~8 GB):** Button „Modell herunterladen" startet einen
  **Vorbereitungslauf** (mflux-generate, 1 Step, 512², Ergebnis wird verworfen) — mflux
  lädt dabei die Gewichte; Fortschritt (Datei + %) speist das state-getriebene
  Fortschritts-Muster aus dem Robustheits-Block. Bietet die installierte mflux-Version
  einen reinen Download-Weg, darf der Plan den Vorbereitungslauf dadurch ersetzen —
  das UI-Verhalten (Opt-in, Fortschritt, Abschlussmeldung) ist davon unabhängig fixiert.
  „Vorhanden"-Anzeige über Existenz-Check des Modell-Verzeichnisses im (konfigurierten)
  HF-Cache. Kein unangekündigter Download: Generate bei fehlenden Gewichten führt in den
  Setup-Zustand (§5), startet aber nie selbst den Download.

## §7 Statuszeile

Bestehende Phasen werden aus den Parser-Ereignissen (§4.3) gespeist:
`Downloading <file> <pct>%` → `Loading model… (Xs)` (Sekundenzähler wie beim
GPU-Load) → `Step X/Y` → fertig. Fehlerzustände analog Robustheits-Block
(Watchdog, Exit ≠ 0, mflux verschwunden).

## §8 History & Rezepte

- `HistoryEntry` += `width: number; height: number`. Sanitizing/Migration: fehlende
  Felder → 512/512 (alle Alt-Einträge sind SD-Turbo-512er; `model` existiert seit 0.3).
- **`recipeKey` nimmt `model`, `width`, `height` mit auf** (JSON-Tupel erweitert).
  Der bisherige Kommentar „Modell nicht im Schlüssel: einmodellig" wird damit
  gegenstandslos — gleiches Prompt-Rezept auf anderem Modell/Größe ist ein anderes
  Ergebnis und darf nicht kollabieren. `deleteEntry`-Wertgleichheit entsprechend erweitert.
- Restore/Reroll stellen Modell + Größe mit her (inkl. Dropdown-Zustand).

## §9 Ergebnis-Notizen

Frontmatter += `width`, `height` (`model` steht schon drin). buildFrontmatter-Muster
unverändert.

## §10 Provider-API (yijing-oracle)

`ImageBackend`-Request: `model?`, `width?`, `height?` — optional, Default
`selectedModel`-unabhängig **sd-turbo/512²** (stabile API: bestehende Consumer bekommen
exakt das bisherige Verhalten, unabhängig davon, was im Tab gewählt ist). Kein Bruch;
yijing kann ab 0.4 pro Anfrage FLUX wählen.

## §11 i18n, Store-Offenlegung, Tests

- **i18n:** alle neuen UI-Strings als Keys in beiden Dicts (`src/i18n/strings.ts`), Muster
  aus der i18n-Session. Modellnamen bleiben unübersetzt (Eigennamen).
- **README/Store:** Offenlegung ergänzen: optionaler Download von HuggingFace (~8 GB),
  Ausführung eines **vom User installierten** lokalen Tools (mflux) als Kindprozess,
  weiterhin keine Telemetrie. Versions-Bump auf 0.4.0 im Release-Schritt.
- **Tests (pure, vitest, ohne Obsidian-Mock — Repo-Muster):** Katalog/getModel-Fallback,
  mflux-Args-Builder, stdout-Parser (Fortschritt/Steps/Fehler/unbekannte Zeilen),
  recipeKey/deleteEntry/Migration mit model+size, Settings-Sanitizing der neuen Felder,
  Pfad-Kandidaten-Auflösung (injizierte exists-Funktion). Der dünne spawn-Adapter wird
  per Smoke-Test verifiziert (user-handover).

## §12 Nicht-Ziele (Stufe A) & Vorbereitung Stufe B

- **Nicht in 0.4:** Referenzbilder/Editing (Stufe B, eigene Spec), Cancel-Button
  (Watchdog + Unload-Kill reichen; Kindprozess macht Cancel später billig),
  klein-base-Variante, CFG/Negative-Prompt, LoRA, SD-Turbo-Gewichte-Umzug.
- **Stufe B rastet ein auf:** `maxReferences` im Katalog (steht schon), `references?: string[]`
  als vorgesehene optionale Erweiterung von `GenerateRequest` und Provider-API,
  FileSuggest-Anpassung des vendorten FolderSuggest, Referenz-Chips im Generate-Tab.
