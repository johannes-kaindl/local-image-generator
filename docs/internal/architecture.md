# Aufbau von local-image-generator

Ein Sidebar-Hub mit zwei Reitern (Generate, History) vor vier austauschbaren Backends. `main.ts` routet nach `settings.engine` (`EngineChoice`: `builtin`, `server`, `comfy`, `playground`); alle Backends implementieren `ImageBackend` (`src/core/txt2img.ts`, kompatibel zu `yijing-oracle`).

## Backends

- **Eingebaut (`builtin`, Standard):** SD-Turbo und SDXL-Turbo im Renderer über `onnxruntime-web/webgpu` (`src/core/engine.ts`, `engine-sdxl.ts`, `src/core/pipeline/`; Laufzeit `src/obsidian/local-engine.ts`, `ort-host.ts`). Modell und ORT-WASM kommen nur nach Klick aus dem eigenen HF-Repo in die Cache API (`src/obsidian/model-store.ts`), SHA-256 gegen das generierte Manifest (`src/core/engine-manifest.generated.ts`, nie von Hand).
- **Server (`server`):** Draw Things, AUTOMATIC1111, Forge, SD.Next über die A1111-kompatible HTTP-API (`src/obsidian/http.ts`, Client in `src/core/txt2img.ts`).
- **ComfyUI (`comfy`):** die Workflows des Nutzers liegen in einem Vault-Ordner und werden gepatcht, nicht neu gebaut (`src/core/comfy/`). `classifyWorkflow` (`workflow.ts`) erkennt die Rolle jeder Datei am Graphen: Erzeugen (Sampler und Latent mit Maßen, die alte `inspectWorkflow`-Regel), Bearbeiten (Bild-Eingang, der in den Latent des Samplers mündet, ohne `VAEEncode` und ohne ControlNet) oder Hochskalieren (Bild-Eingang, Upscale-Modell, kein Sampler). `library.ts` macht daraus die Bibliothek des Ordners samt Auswahl je Rolle; das Panel wählt Aufgabe (Kit-Segment-Schalter) und Workflow. Bearbeiten und Hochskalieren laden die Vorlage per multipart an `/upload/image` (`client.ts`, Körper aus code-kit `multipart-body`) und lesen die Ergebnisgröße aus dem PNG (code-kit `png-size`).
- **Image Playground (`playground`):** Apple-Kurzbefehl über die Shortcuts-Brücke (`src/obsidian/playground-backend.ts`, Kit-Modul `shortcuts-bridge`).

## Schichten

- `src/core/`: rein, ohne `obsidian`-Import (Gate `check:pure`): Parameter-Härtung (`params.ts`), Ergebnis-Notiz (`note.ts`), Plugin-API (`plugin-api.ts`), Einstellungen (`settings.ts`), ViewModel (`viewmodel.ts`), Historie (`history.ts`), Endpunkt-Auflösung (`resolve-endpoint.ts`).
- `src/obsidian/`: alles mit Obsidian-API: Hub und Panels (`view.ts`, `hub.ts`, `generate-panel.ts`, `history-panel.ts`), Settings-Tab, Bild-Picker, PNG-Umwandlung (`png.ts`), Modell-Speicher.
- `src/vendor/kit/` (aus code-kit und `obsidian-kit/src/pure`) und `src/vendor/kit-obsidian/` (aus `obsidian-kit/src/obsidian`): Kit-Module per `tools/kit-sync.json`, Pins und Zielordner dort.
- `scripts/`: GUI-Smoke (`gui-smoke.ts`), README-Bilder (`shots.ts`), Mocks (`mock-a1111.mjs`, `mock-comfy.mjs`, `mock-assets.mjs`), Gate-Prüfer (`check-*.mjs`).
- `tools/convert/`: Konversion der Modelle nach ONNX (uv-Venv, `convert_model.py`, `split_external_data.py`).
- `comfy/`: Referenz-Workflows für den ComfyUI-Dienst des Maintainers (`comfy/workflows/`, Herkunft in der README dort; zugleich Fixtures der Rollen-Tests) und die Referenz-Config (`comfy/reference-config.json`).
- `tools/vault-abgleich.mjs` (`npm run vault:abgleich -- --dry`): setzt die Referenz-Config in die `data.json` jedes Vaults mit dem Plugin, kopiert die Workflows in dessen Workflow-Ordner, verschiebt Altdateien in den Papierkorb und trägt im LLM Endpoint Manager den fehlenden Bild-Endpunkt nach; `history`, `presets` und alle übrigen Schlüssel bleiben stehen, offene Vaults nur mit `--offene` (Test `tools/vault-abgleich.test.mjs`, Teil von `npm test`). `tools/vault-probe.ts` (`npm run vault:probe`): prüft je Vault Endpunkt, Ordner, Rollen und Erreichbarkeit mit dem Core-Code des Repos und rechnet ohne `--ohne-bild` ein Testbild.

## Reste aus früheren Fassungen

Bis 0.4 lief eine ältere Fassung der Engine im Prozess (plus `mflux` als Kindprozess), 0.5 war ein reiner Thin-Client, 0.6 hat die Engine im Renderer zurückgeholt. Übrig sind `src/obsidian/legacy-cache.ts` (findet und löscht die rund 2,5 GB SD-Turbo-Gewichte der 0.4-Bestandsinstallationen in `local-image-generator-models`) und das tote Settings-Feld `mfluxPath` (`src/core/settings.ts`).
