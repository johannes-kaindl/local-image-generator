# AGENTS.md

Conventions for AI assistants working in this repo.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, ../../workspace/_docs relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

## What this is

Obsidian community plugin: eine **Oberflaeche** fuer Bilderzeugung (Prompt, Stil-Chips,
Verlauf, Ablage im Vault) vor **vier austauschbaren Backends** (Eingebaut/Server seit 0.6,
Spec im Cockpit `_SDD/2026-08-19-eingebaute-engine-zwei-backends-design.md`; ComfyUI seit
0.13, Spec `2026-09-06-comfyui-backend-design.md`; Image Playground seit Welle 13):

- **Eingebaut (Default):** SD-Turbo im Renderer ueber `onnxruntime-web/webgpu`. Modell
  (eigene fp16-ONNX-Konversion, ~2,6 GB) + ORT-WASM werden **nur nach Klick** aus dem
  eigenen HF-Repo in die Cache API gestreamt, SHA-256 gegen das generierte Manifest
  geprueft. 512 px, Steps 1–8, kein Negativ/CFG (Keine-Attrappen-Linie).
- **Server:** Draw Things, AUTOMATIC1111, Forge oder SD.Next ueber deren gemeinsame
  A1111-kompatible HTTP-API — dem Server gehoeren Modell und Hardware, volle Regler.
  Seit 0.8 zusaetzlich **img2img**: von einer Vault-Vorlage aus weiterrechnen — seit 0.11 in
  BEIDEN Backends: der Server kontinuierlich (denoising 0–1 in 0,05er-Schritten), die
  eingebaute Engine ueber ihren eigenen VAE-Encoder ebenso kontinuierlich (0–1 in 0,05er-
  Schritten; der Einstiegspunkt im Zeitplan wird interpoliert statt gerastert, s. `.claude/rules/img2img.md`).
- **ComfyUI (seit 0.13):** ein vom Nutzer bereitgestellter API-Workflow (Vault-Datei, JSON im
  ComfyUI-API-Format) wird vor jedem Lauf **gepatcht**, nicht neu gebaut — Prompt, Negativ,
  Seed, Steps und Groesse wandern in die vom Workflow selbst benannten Nodes, alles andere
  (Sampler, Scheduler, CFG, LoRAs, Upscaler) bleibt in der Hand des Nutzers. Ein Workflow ohne
  setzbare Steps oder Bildmasse wird abgewiesen, nicht stillschweigend mit Luecken uebernommen
  (Begruendung in `.claude/rules/comfy.md`). Kein img2img, kein CFG-Regler, Fortschrittsbalken nur über den optionalen Socket (seit Welle 24) — Details
  im CHANGELOG-Eintrag 0.13.0. Herkunft: Client und Workflow-Inspektion sind aus `yijing-oracle`
  uebernommen (Vendoring-Header in `src/core/comfy/client.ts`/`workflow.ts`), nicht neu gebaut.
- **Image Playground (seit Welle 13):** ein Apple-Kurzbefehl erzeugt das Bild über die Shortcuts-Brücke des Kits (`src/obsidian/playground-backend.ts`), mobil-tauglich; ohne Negativ, CFG, Größe, Steps und Seed (Keine-Attrappen-Linie: ein Regler, den das Backend nicht kann, wird ausgeblendet, nie ohne Wirkung gezeigt).

Desktop-only, ein Sidebar-Hub mit zwei Reitern (Generate/History). Alle vier Backends
implementieren `ImageBackend` (`src/core/txt2img.ts`); `main.ts` routet nach
`settings.engine`. **Bis 0.4 lief eine aeltere Fassung der Engine im Prozess (plus mflux als
Kindprozess), 0.5 war reiner Thin-Client** — Details in `docs/internal/architecture.md`; die Reste
(`legacy-cache.ts` fuer die 0.4-Gewichte, totes Settings-Feld `mfluxPath`) bleiben erklaert.

## Workflow conventions

- **Gate:** `npm run gate` (typecheck + check:manifest + vitest + lint + check:pure + build +
  check:clean) — vor jedem Commit grün.
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren NIE `obsidian`
  (Gate: `scripts/check-pure.mjs`, `ROOTS`). `src/obsidian/legacy-cache.ts` ist browser-API-only
  (Cache API), ebenfalls obsidian-frei — nicht vom Gate erfasst, manuell halten.
- **Commit style:** Conventional Commits (deutsch), AI-Commits mit Co-Authored-By-Trailer.
- **Deploy (lokal):** `OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins/local-image-generator npm run deploy` — ⚠️ **`npm run deploy` ist kein Reload.** Obsidian laedt die kopierte `main.js` erst beim Aktivieren des Plugins; ein laufendes Fenster misst sonst den Stand von seinem letzten Start, und die Manifest-Version verraet den Unterschied nicht. Wer von Hand prueft: Plugin aus- und einschalten (`scripts/gui-smoke.ts` laedt es selbst neu).
- **Nie von Hand:** `src/vendor/**` (nur `sh tools/sync-kit.sh`, Pins in `tools/kit-sync.json`) und `src/core/engine-manifest.generated.ts` (nur `npm run assets`).
- **Dach-Regeln gelten:** Kit-first (`../AGENTS.md`, `../REGISTRY.md`), UI-STANDARD (`../UI-STANDARD.md`).

## UI-Abweichungen

- **Ausschnitt-Abdunklung (CropModal)** — Grund: Das Kit-Modal dunkelt über `--background-modifier-cover` ab; gemessen 2026-10-23 am Fenster (Obsidian 1.14.5) ist das im Light-Theme `rgba(220, 220, 220, 0.4)` und hellt auf statt abzudunkeln, im Dark-Theme `rgba(10, 10, 10, 0.4)` und wirkt schwächer als das bisherige Schwarz (zuerst gemessen in der Abnahme Welle 24). lig überschreibt mit festem `rgba(0, 0, 0, 0.55)` (`.lig-crop-modal .okit-crop-frame` in `styles.css`, Scope über `cls` in `main.ts`; Smoke-Punkt 48 misst den berechneten Wert). Entfällt, sobald das Kit eine eigene Scrim-Variable mit dunklem Standard führt (Kit-Task Welle 26) — gilt-solange: `src/vendor/kit-obsidian/crop-modal.ts` enthaelt-nicht `--okit-crop-scrim`

Keine Abweichung von einem §8-Baustein. Das `CropModal` ist seit Welle 25 der Kit-Baustein (`src/vendor/kit-obsidian/crop-modal.ts`, obsidian-kit 0.66.1, Einzelpin; Geometrie code-kit `crop` 0.34.0 unter `src/vendor/kit/crop.ts`), kein Eigenbau mehr. Bei installiertem LLM Endpoint Manager zeigt die Endpunkt-Zeile dessen Kit-Baustein `buildEndpointSourceSection` (`src/obsidian/settings-tab.ts::renderServer`), ohne Manager bleibt das einzelne Textfeld `renderServerFallback`; das Plugin hat nur EIN Endpunkt-Textfeld (`tools/ui_adoption_check.py` misst seit Dach `272ebfc` 0 Befunde).

## Gotchas

- **Die Download-Zusage der Provider-API ist strukturell, nicht bloss gegated.** `generate()`
  im builtin-Modus laedt ohne Klick des Nutzers keine Bytes — das gilt nicht nur, weil das
  Bereitschafts-Gate es abweist, sondern weil es keinen zweiten Ladepfad gibt: `ModelStore.getBuffer`/
  `getText` gehen ueber `matchOrThrow` (`src/obsidian/model-store.ts`), das bei einem
  Cache-Fehltreffer **wirft** und nie laedt. Der einzige Ladepfad ist `ModelStore.download`,
  aufgerufen ausschliesslich von `startDownload()`, das an genau zwei vom Nutzer geklickte
  Bedienelemente haengt und in `ApiDeps` (`src/main.ts`) nicht vorkommt. Selbst ohne das
  Bereitschafts-Gate endet ein builtin-`generate()` ohne Assets als
  `{ ok: false, reason: "failed" }`.
  **Seit 2026-08-30 ist die Zusage zusaetzlich GEMESSEN, nicht nur begruendet** — GUI-Smoke-Punkt
  18d, platziert zwischen den Punkten 13 und 14, wo der Zustand `not-downloaded` geprueft statt
  angenommen ist. ⚠️ Er prueft DREI Dinge (Rueckgabewert, Cache-Umfang, Engine-Zustand), und das
  ist kein Guertel-mit-Hosentraeger: in der Gegenprobe wurde er **allein ueber den Engine-Zustand**
  rot, waehrend die Cache-Zaehlung nach drei Sekunden noch unveraendert dastand — der Download
  lief bereits, hatte aber noch keine Datei fertig geschrieben. Wer die Zustandspruefung fuer
  redundant haelt und streicht, macht den Punkt blind fuer genau den Defekt, gegen den er steht
  (`docs/SMOKE.md` § 2026-08-30).
- **Engine-Interface** (`ImageBackend`-kompatibel zu yijing-oracle) nicht brechen — die
  Provider-API (`apiVersion` 1) rastet darauf ein.

## Context index

- Bevor du Dateien unter `tools/convert/`, `scripts/build-assets.mjs` oder das Asset-Manifest änderst, oder nach einem `onnxruntime-web`-Upgrade: `.claude/rules/engine-assets.md` (Konversion, External Data, fp16-Fallen, `npm run assets` + Manifest mitcommitten).
- Bevor du die eingebaute Engine (`src/core/engine*.ts`, `src/core/pipeline/`) anfasst: `.claude/rules/engine-pipeline.md`; für ORT, WebGPU, Download und Cache API (`src/obsidian/local-engine.ts`, `ort-host.ts`, `model-store.ts`): `.claude/rules/engine-laufzeit.md`.
- Bevor du `src/core/plugin-api.ts`, `params.ts` oder `note.ts` änderst: `.claude/rules/provider-api.md`.
- Bevor du img2img, die Vorlage, den Denoise-Regler oder den Ausschnitt (`initCrop`) anfasst: `.claude/rules/img2img.md`.
- Bevor du `src/core/comfy/` oder den Workflow-Weg änderst: `.claude/rules/comfy.md`; für den Server-Modus (`src/obsidian/http.ts`, `src/core/txt2img.ts`): `.claude/rules/server-backend.md`.
- Bevor du `src/main.ts`, `src/core/viewmodel.ts` oder die Endpunkt-Auflösung änderst, oder einen weiteren Backend-Modus einführst: `.claude/rules/modi-und-main.md` (die Liste der Stellen, an denen `tsc` einen neuen Modus nicht meldet).
- Bevor du `styles.css`, den Settings-Tab oder den Hub änderst: `.claude/rules/panel-und-css.md`; zusätzlich im Dach `../.claude/rules/store-css.md` und `../UI-STANDARD.md`.
- Bevor du `scripts/gui-smoke.ts`, `scripts/shots.ts` oder einen Mock änderst: `.claude/rules/smoke-treiber.md`, `docs/SMOKE.md` und die Dach-Regeln `../.claude/rules/gui-smoke-treiber.md`, `../.claude/rules/obsidian-instanz.md`, `../.claude/rules/cdp-lock.md`, `../.claude/rules/staging-vaults.md`.
- Bevor du `tools/kit-sync.json` oder etwas unter `src/vendor/` änderst (nie von Hand, `sh tools/sync-kit.sh`): `.claude/rules/vendoring.md`.
- Vor einem Release, einer Store-Einreichung oder einem Rescan: Dach `../.claude/rules/release-und-store.md`, Skills `plugin-release-setup` und `store-rescan`; `npm run release` fährt der Master (Minions melden „release-reif“).
- Bevor du den Aufbau (Backends, Module, Vendoring-Ordner) nachschlägst: `docs/internal/architecture.md`.
- Bevor du eine Altentscheidung übernimmst (HF-Namespace, Store-Wertung, Vertrieb): `docs/internal/decisions.md`.

## Memory

- **Cockpit (SSOT):** `$VAULT/25_Coding/local-image-generator/` (Hub, `_Tasks`, `_Log`, Handover; maintainer-lokal). Seit 2026-07-16 leben Specs, Pläne und Task-Reports im Cockpit unter `_SDD/` (CORE-META-14), weil sie Arbeitskontext tragen (Vault-Pfade, Schwester-Repo-Interna), der in einem public Repo niemandem nützt; `docs/superpowers/` gibt es im Repo nicht mehr, nichts Neues dort ablegen. Das Repo behält die Design-Essenz in `docs/internal/` und in `CHANGELOG.md`.
- **Memory:** Projekt-Memory unter `~/.claude/projects/<slug>/memory/` (Zeiger-Schicht).
- **Nie im Repo:** absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade), Platzhalter nutzen (`$VAULT/…`, `~/…`, repo-relativ). Herkunftsnachweise als Repo-Name + `Datei:Zeile` sind dagegen erwünscht. Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).

## Abweichungen von der Leitkonvention

Keine.
