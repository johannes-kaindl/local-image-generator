---
paths:
  - "tools/convert/**"
  - "tools/convert-model.sh"
  - "scripts/build-assets.mjs"
  - "scripts/verify-model.mjs"
  - "scripts/verify-upload-assets.mjs"
  - "scripts/mock-assets.mjs"
  - "src/core/engine-manifest.generated.ts"
  - "src/core/model-manifest.ts"
  - "package.json"
---

# Eingebaute Engine — Assets, Konversion, Manifest

Gotchas zur Modellkonversion, zum Splitten der External Data und zum Asset-Manifest (`tools/convert/`, `scripts/build-assets.mjs`). Das Warum zum HF-Namespace steht in `docs/internal/decisions.md`.

- **Assets (eingebaute Engine):** `tools/convert-model.sh <sd-turbo|sdxl-turbo>`
  (`npm run assets:convert -- <sd-turbo|sdxl-turbo>`; uv-Venv, optimum + ORT-fp16-Konverter,
  seit der zweiten Modellstufe modellparametrisiert in `tools/convert/convert_model.py`)
  erzeugt `dist-assets/` (gitignored), `npm run assets` hasht sie und schreibt
  `src/core/engine-manifest.generated.ts` (**nie von Hand**), `npm run assets:verify` prueft
  I/O-Namen/Dtypes/Shapes mit onnxruntime-node, `npm run assets:upload` laedt ins HF-Repo
  (`johannes-kaindl/local-image-generator-models`, per `HF_MODELS_REPO` ueberschreibbar).
  Nach jedem `onnxruntime-web`-Upgrade: `npm run assets` + Manifest mitcommitten, WASM neu
  hochladen — `check:manifest` bricht sonst das Gate.
- **WASM-Paarung (wieder aktiv seit 0.6):** das ORT-WASM-Binary MUSS zum Glue des importierten
  Bundles passen — `onnxruntime-web/webgpu` referenziert `ort-wasm-simd-threaded.asyncify.wasm`,
  nicht jsep. Falsche Paarung = stiller Ewig-Haenger. `scripts/build-assets.mjs` liest den
  Namen aus dem Bundle und hasht genau diese Datei; `check:manifest` bewacht es.
- **Stueckeln heisst NICHT „alles auslagern": kleine Tensoren muessen inline bleiben.** Der
  Bucket-Splitter (`tools/convert/split_external_data.py`) fuehrt deshalb `size_threshold=1024`
  (der ONNX-Default). Ohne die Schwelle entsteht ein Modell, das strukturell einwandfrei aussieht
  — richtige `location`-Strings, ausgerichtete Offsets, ladbare Buckets — und das ORT trotzdem
  abweist: `[ShapeInferenceError] Cannot parse data from external tensors ... onnx::Unsqueeze_1780`.
  Grund: Achsen fuer `Unsqueeze`, Formen fuer `Reshape` und Aehnliches braucht die Shape-Inferenz
  schon beim LADEN, bevor irgendwer External Data aufloest. Gemessen 2026-08-24 am echten
  SDXL-Turbo-UNet; fuenf gruene Splitter-Tests gegen synthetische Modelle hatten es nicht gesehen.
- **Ein fp16-Modell ueber 2 GiB laesst sich nicht ohne External Data ZWISCHENSPEICHERN.**
  `save_model_to_file(..., use_external_data_format=False)` stirbt bei 4,78 GiB mit
  `google.protobuf.message.EncodeError: Failed to serialize proto` — protobuf serialisiert keine
  Nachricht ueber 2 GiB. Der split-Zweig speichert deshalb MIT External Data (eine grosse
  temporaere `model.onnx.data`), stueckelt daraus und loescht die Zwischendatei. Sie darf nicht
  liegen bleiben: `build-assets.mjs` naehme sie ins Manifest, `assets:upload` lued sie mit hoch.
- **Ein Modell ueber 2 GiB geht nur mit GESTUECKELTER External Data — und nur unter WebGPU.**
  Gemessen 2026-08-23 im Renderer (Obsidian 1.13.7 / Electron 39 / Chromium 142, M5 Pro):
  ein plain `ArrayBuffer` endet bei ~2,0 GiB, `WebAssembly.Memory` bei exakt 4 GiB (wasm32,
  65536 Seiten). Eine monolithische `.onnx_data` von 4,78 GiB (SDXL-Turbos UNet) ist damit
  gar nicht uebergebbar — der Export muss die Tensoren auf mehrere Dateien verteilen
  (`convert_model_to_external_data(all_tensors_to_one_file=False)`). ORTs `externalData`
  nimmt `Blob | Uint8Array | ArrayBuffer`, also unseren Cache-API-Pfad; die URL-Variante
  wuerde ORT selbst fetchen lassen und ist deshalb ausgeschlossen.
  **Die 4-GiB-Grenze des WASM-Heaps bindet dabei NICHT**, weil der WebGPU-EP die Gewichte
  direkt von JS in GPU-Puffer laedt (Glue-Callback: `case 0` schreibt in `HEAPU8`, `case 1`
  laedt zur GPU hoch). Gegenprobe am identischen 4,75-GiB-Modell, einzige Variable der EP:
  `wasm` stirbt mit `std::bad_alloc`, `webgpu` baut die Session in 1,1 s.
  ⚠️ **Spitzenspeicher ist rund das Doppelte der Modellgroesse** — ORT gibt die JS-Puffer
  erst nach `createSession` frei (`unmountExternalData` im `finally`), bis dahin liegen
  Gewichte in JS UND auf der GPU; auf Apple Silicon ist das derselbe Speicherpool.
  **Gebautes Gegenstueck (Stand 2026-08-24):** die reale SDXL-Turbo-Konversion stueckelt
  ihr UNet (≈ 5,1 GiB) in **13 External-Data-Buckets** (`sdxl-turbo/unet/unet_000.onnx_data`
  … `_012`, keiner ueber 420 MB) plus die 4,4-MB-Modell-Shell — genau die Form, die dieser
  Punkt vorschreibt; `src/core/engine-manifest.generated.ts` listet alle 13 mit eigenem
  Hash, `src/obsidian/local-engine.ts::loadPart()` laedt sie als Array (Reihenfolge = die
  des Manifests) und reicht sie als `externalData` an `createOrtSession`.
- **SDXLs VAE-Decoder ueberschreitet in fp16 unter dem WebGPU-EP den Wertebereich — und das
  Ergebnis ist ein reines schwarzes Bild, OHNE jeden Fehler.** Gemessen 2026-08-24: SDXL-Turbo
  lieferte live gueltige PNGs in der richtigen Groesse, Status „Bereit", Inhalt zu 100 % Schwarz.
  Drei Runden Instrumentierung haben es eingekreist — Node/CPU-EP mit denselben Gewichten und
  demselben Code ist durchgaengig saubere Zahlen bis zum Ende der Pipeline; im Renderer/WebGPU
  sind beide Text-Encoder und beide UNet-Schritte ebenso saubere und mit der CPU-Referenz
  deckungsgleiche Zahlen, aber der VAE-Decoder-INPUT ist gesund und der VAE-Decoder-OUTPUT ist zu
  786.432/786.432 (100 %) NaN. Ursache: SDXLs Aktivierungen an dieser Stelle ueberschreiten
  fp16s Bereich (Maximum 65504) → Inf → NaN; ORTs CPU-Kernel rechnen die identische Graph-Struktur
  offenbar hoeher praezise und zeigen den Defekt NICHT — **ein Node-seitiger Test kann diesen
  Fehler grundsaetzlich nicht finden**, nur ein Live-Lauf im Renderer. Eine fp32-Gegenprobe am
  selben Graph, denselben Gewichten, demselben Code (nur die eine Session getauscht) war NaN-frei
  und deckungsgleich mit der CPU-Referenz (Min/Max/Mean je auf ~1 % Abweichung) und produzierte
  ein kohärentes, korrektes Bild. Deshalb bleibt GENAU dieser eine Teil fp32, waehrend alles
  andere im Modell fp16 bleibt (`tools/convert/convert_model.py`, `MODELS["sdxl-turbo"]["fp32"]`,
  Funktion `copy_fp32()`) — SD-Turbo ist von diesem Defekt nicht betroffen und bleibt
  unveraendert vollstaendig fp16. Kosten: **+99 MB** (198.078.154 vs. 99.126.105 Byte, der
  VAE-Decoder allein) und **+~650 ms** pro `generate()`-Aufruf (2317 ms vs. 1671 ms, n=1, sonst
  identische warme Sessions). Kein Zufall, dass es dafuer ein bekanntes Community-Fixmodell
  (`sdxl-vae-fp16-fix`) gibt — das ist eine bekannte Eigenschaft von SDXLs Architektur, kein
  Defekt in diesem Code. GUI-Smoke-Punkt 25 (`scripts/gui-smoke.ts`) generiert seitdem ein
  echtes SDXL-Turbo-Bild und misst dessen Pixel-Inhalt (Luma-Standardabweichung + Zahl
  distinkter Farben) statt nur seine Form — verifiziert per Live-Session-Swap gegen genau
  diesen fp16-Zustand rot, gegen den fp32-Fix gruen (`docs/SMOKE.md` § 2026-08-24 Phase 4).
  **Seit 0.11 gilt dieselbe Ausnahme fuer SDXLs VAE-ENCODER** (img2img, Posten 4a): der
  Spike vom 2026-08-30 mass per torch-Hooks max-|Aktivierung| von **300k–500k auf jedem von
  7 diversen Inputs** — Faktor 7 ueber fp16s 65504, schlimmer als der Decoder-Fall. Er wird
  deshalb fp32 ausgeliefert (137 MB statt ~68 MB; `MODELS["sdxl-turbo"]["fp32"]` fuehrt
  beide). SD-Turbos Encoder bleibt fp16 (Peak 1 248, 50x Luft). Live-Beweis unter WebGPU ist
  GUI-Smoke-Punkt 27 (`docs/SMOKE.md` § 2026-08-31).
  **Bei jedem weiteren fp16-Konversionsschritt an SDXL: diesen Teil NICHT „der Einheitlichkeit
  wegen" zurueckstellen** — er sieht wie eine vergessene Aufraeumarbeit aus und ist keine.
