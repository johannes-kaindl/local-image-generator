# Aufbau von local-image-generator

Ein Sidebar-Hub mit zwei Reitern (Generate, History) vor vier austauschbaren Backends. `main.ts` routet nach `settings.engine` (`EngineChoice`: `builtin`, `server`, `comfy`, `playground`); alle Backends implementieren `ImageBackend` (`src/core/txt2img.ts`, kompatibel zu `yijing-oracle`).

## Backends

- **Eingebaut (`builtin`, Standard):** SD-Turbo und SDXL-Turbo im Renderer über `onnxruntime-web/webgpu` (`src/core/engine.ts`, `engine-sdxl.ts`, `src/core/pipeline/`; Laufzeit `src/obsidian/local-engine.ts`, `ort-host.ts`). Modell und ORT-WASM kommen nur nach Klick aus dem eigenen HF-Repo in die Cache API (`src/obsidian/model-store.ts`), SHA-256 gegen das generierte Manifest (`src/core/engine-manifest.generated.ts`, nie von Hand).
- **Server (`server`):** Draw Things, AUTOMATIC1111, Forge, SD.Next über die A1111-kompatible HTTP-API (`src/obsidian/http.ts`, Client in `src/core/txt2img.ts`).
- **ComfyUI (`comfy`):** ein Workflow des Nutzers wird gepatcht, nicht neu gebaut (`src/core/comfy/`, Auswahl in `src/obsidian/workflow-picker.ts`).
- **Image Playground (`playground`):** Apple-Kurzbefehl über die Shortcuts-Brücke (`src/obsidian/playground-backend.ts`, Kit-Modul `shortcuts-bridge`).

## Schichten

- `src/core/`: rein, ohne `obsidian`-Import (Gate `check:pure`): Parameter-Härtung (`params.ts`), Ergebnis-Notiz (`note.ts`), Plugin-API (`plugin-api.ts`), Einstellungen (`settings.ts`), ViewModel (`viewmodel.ts`), Historie (`history.ts`), Endpunkt-Auflösung (`resolve-endpoint.ts`).
- `src/obsidian/`: alles mit Obsidian-API: Hub und Panels (`view.ts`, `hub.ts`, `generate-panel.ts`, `history-panel.ts`), Settings-Tab, Bild-Picker, PNG-Umwandlung (`png.ts`), Modell-Speicher.
- `src/vendor/kit/` (aus code-kit und `obsidian-kit/src/pure`) und `src/vendor/kit-obsidian/` (aus `obsidian-kit/src/obsidian`): Kit-Module per `tools/kit-sync.json`, Pins und Zielordner dort.
- `scripts/`: GUI-Smoke (`gui-smoke.ts`), README-Bilder (`shots.ts`), Mocks (`mock-a1111.mjs`, `mock-comfy.mjs`, `mock-assets.mjs`), Gate-Prüfer (`check-*.mjs`).
- `tools/convert/`: Konversion der Modelle nach ONNX (uv-Venv, `convert_model.py`, `split_external_data.py`).

## Reste aus früheren Fassungen

Bis 0.4 lief eine ältere Fassung der Engine im Prozess (plus `mflux` als Kindprozess), 0.5 war ein reiner Thin-Client, 0.6 hat die Engine im Renderer zurückgeholt. Übrig sind `src/obsidian/legacy-cache.ts` (findet und löscht die rund 2,5 GB SD-Turbo-Gewichte der 0.4-Bestandsinstallationen in `local-image-generator-models`) und das tote Settings-Feld `mfluxPath` (`src/core/settings.ts`).
