# AGENTS.md

Conventions for AI assistants working in this repo.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, ../../_docs relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

## What this is

Obsidian community plugin: eine **Oberflaeche** fuer Bilderzeugung (Prompt, Stil-Chips,
Verlauf, Ablage im Vault) vor **zwei austauschbaren Backends** (seit 0.6, Spec im Cockpit
`_SDD/2026-08-19-eingebaute-engine-zwei-backends-design.md`):

- **Eingebaut (Default):** SD-Turbo im Renderer ueber `onnxruntime-web/webgpu`. Modell
  (eigene fp16-ONNX-Konversion, ~2,5 GB) + ORT-WASM werden **nur nach Klick** aus dem
  eigenen HF-Repo in die Cache API gestreamt, SHA-256 gegen das generierte Manifest
  geprueft. 512 px, Steps 1–4, kein Negativ/CFG (Keine-Attrappen-Linie).
- **Server:** Draw Things, AUTOMATIC1111, Forge oder SD.Next ueber deren gemeinsame
  A1111-kompatible HTTP-API — dem Server gehoeren Modell und Hardware, volle Regler.

Desktop-only, ein Sidebar-Hub mit zwei Reitern (Generate/History). Beide Backends
implementieren `ImageBackend` (`src/core/txt2img.ts`); `main.ts` routet nach
`settings.engine`. **Bis 0.4 lief eine aeltere Fassung der Engine im Prozess (plus mflux als
Kindprozess), 0.5 war reiner Thin-Client** — Details unter *Historie* unten; die Reste
(`legacy-cache.ts` fuer die 0.4-Gewichte, totes Settings-Feld `mfluxPath`) bleiben erklaert.

## Workflow conventions

- **Gate:** `npm run gate` (typecheck + check:manifest + vitest + lint + check:pure + build +
  check:clean) — vor jedem Commit grün.
- **Assets (eingebaute Engine):** `tools/convert-sd-turbo.sh` (uv-Venv, optimum + ORT-fp16-
  Konverter) erzeugt `dist-assets/` (gitignored), `npm run assets` hasht sie und schreibt
  `src/core/engine-manifest.generated.ts` (**nie von Hand**), `npm run assets:verify` prueft
  I/O-Namen/Dtypes/Shapes mit onnxruntime-node, `npm run assets:upload` laedt ins HF-Repo.
  Nach jedem `onnxruntime-web`-Upgrade: `npm run assets` + Manifest mitcommitten, WASM neu
  hochladen — `check:manifest` bricht sonst das Gate.
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren NIE `obsidian`
  (Gate: `scripts/check-pure.mjs`). `src/obsidian/legacy-cache.ts` ist browser-API-only
  (Cache API), ebenfalls obsidian-frei — nicht vom Gate erfasst, manuell halten.
- **Commit style:** Conventional Commits (deutsch), AI-Commits mit Co-Authored-By-Trailer.
- **Deploy (lokal):** `OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins/local-image-generator npm run deploy`
- **Dach-Regeln gelten:** Kit-first (`../AGENTS.md`, `../REGISTRY.md`), UI-STANDARD (`../UI-STANDARD.md`).

## Memory + logs

- **Cockpit (SSOT):** `$VAULT/25_Coding/local-image-generator/` (Hub, _Tasks, _Log, Handover; maintainer-lokal).
- **Memory:** `~/.claude/projects/-Users-Shared-code-obsidian-plugins/memory/` (Zeiger-Schicht).
- Spec/Plan (neu): im Coding-Cockpit des Maintainers (siehe §Memory) — nicht mehr im Repo.

## Memory

- **SDD-Artefakte (seit 2026-07-16): Cockpit, nicht Repo** — Specs/Plans/Task-Reports leben im
  Coding-Cockpit des Maintainers (`$VAULT/25_Coding/local-image-generator/_SDD/`, CORE-META-14, maintainer-lokal).
  Sie tragen Arbeitskontext (Vault-Pfade, Schwester-Repo-Interna), der in einem public Repo niemandem nützt.
  Das Repo behält die Design-Essenz in dieser Datei + `CHANGELOG.md`.
- **Alt-Bestand:** `docs/superpowers/{specs,plans}/` ist eingefroren — nichts Neues dort ablegen.
- **Nie im Repo:** absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade) — Platzhalter nutzen
  (`$VAULT/…`, `~/…`, repo-relativ). Herkunftsnachweise als Repo-Name + `Datei:Zeile` sind dagegen erwünscht.
  Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).

## Architecture notes / Gotchas

- **WASM-Paarung (wieder aktiv seit 0.6):** das ORT-WASM-Binary MUSS zum Glue des importierten
  Bundles passen — `onnxruntime-web/webgpu` referenziert `ort-wasm-simd-threaded.asyncify.wasm`,
  nicht jsep. Falsche Paarung = stiller Ewig-Haenger. `scripts/build-assets.mjs` liest den
  Namen aus dem Bundle und hasht genau diese Datei; `check:manifest` bewacht es.
- **Feeds an die Session anpassen, nie hardcoden:** `Session.inputTypes` (Dtype) UND
  `Session.inputShapes` (Rang). Die eigene Konversion deklariert `timestep` als 0-d-Skalar
  (`shape []`) — `dims [1]` bricht das UNet mit „Gemm: must be 2 dimensional" (gemessen
  2026-08-19, erster Live-Lauf). `scripts/verify-model.mjs` zeigt Dtypes + Shapes.
- **Download per `activeWindow.fetch` + `tee()`, nicht XHR** (`src/obsidian/model-store.ts`):
  speicherkonstantes Streaming einer 1,7-GB-Datei in die Cache API geht nur mit
  ReadableStream; XHR hielte alles im Puffer. PROF-OBS-12-Fall „unvermeidbar", Store-Linter
  bestaetigt (globales `fetch` bleibt gebannt). SHA-256 laeuft chunkweise im Stream
  (`src/core/sha256.ts`, ~200 MB/s).
- **Cache-Namen nicht verwechseln:** 0.6-Assets liegen in `local-image-generator-assets` mit
  hash-gebundenen, URL-unabhaengigen Schluesseln; `legacy-cache.ts` loescht weiterhin nur
  `local-image-generator-models` (0.4). Die zwei kollidieren nicht.
- **`new Function(` im Bundle ist die ORT-Glue (Emscripten-embind)** — BEHAVIOR-Disclosure
  einer gebuendelten Dependency, notenneutral (publishing.md); `check-clean` laesst es
  begruendet zu, `eval(` bleibt verboten. Bundle ~175 KB.
- **ORT nimmt den eingebetteten Glue-Pfad nur mit gesetztem `env.wasm.wasmBinary` und
  `numThreads = 1`** — sonst versucht es `import()` einer URL (Code-Nachladen). `initOrt()`
  muss vor der ersten Session laufen (`ort-host.ts` wirft sonst).
- **Settings-Tab: bedingte Zeilen weglassen, nicht `visible:false`** — Obsidian 1.13 cacht
  `getSettingDefinitions()` und wertet Praedikate nicht neu aus; nach Modus-/Zustandswechsel
  `refreshUi()` (gemessen 2026-08-19: Server-Zeile blieb im builtin-Modus stehen).
- **Drei Endpunkte, mehr nicht (Server-Modus):** `POST /sdapi/v1/txt2img` erzeugt,
  `GET /sdapi/v1/progress` liefert den Fortschritt (1-s-Polling), `GET /sdapi/v1/options`
  nennt das aktive Modell und dient als Verbindungstest. Alles Weitere gehoert dem
  Server, nicht uns.
- **`requestUrl` kennt weder Abort noch Timeout** (`src/obsidian/http.ts`). Ohne das
  selbst gesetzte kurze Zeitlimit haengt das Panel an einem toten Server ewig, statt ihn
  als unerreichbar zu melden. Diese Zeile nicht "vereinfachen".
- **Ein Server ohne `/progress` ist kein Fehlerfall:** liefert er 404 oder eine fremde
  Form, faellt die Anzeige auf unbestimmt zurueck — der Lauf selbst bleibt gueltig.
  Seit `598f050` fragt der `ProgressPoller` (`src/core/txt2img.ts`, eine Instanz pro Lauf)
  nach dem **ersten 404 nicht mehr** — Draw Things kennt den Endpunkt nicht, und ~240
  vergebliche Anfragen pro Bild sind Last auf einem rechnenden Server. Nur 404 schaltet ab;
  Timeout und 5xx sind voruebergehend und pollen weiter. Nicht "vereinheitlichen".
- **GUI-Smoke ohne echten Bild-Server:** `node scripts/mock-a1111.mjs` stellt die drei
  Endpunkte auf Port 7861 (`/progress` → 404, zaehlt Anfragen in `.mock-a1111-counts.json`);
  Plugin-Endpunkt darauf stellen, `npm run smoke:gui` fahren. Draw Things' API-Server ist ein
  Schalter in der App-Oberflaeche — `open -a "Draw Things"` allein oeffnet Port 7860 nicht.
- **Der Server bestimmt das Modell.** Das Plugin schickt generische Parameter und zeigt
  den gemeldeten Modellnamen als Statushinweis; es waehlt nie ein Modell aus.
- **Engine-Interface** (`ImageBackend`-kompatibel zu yijing-oracle) nicht brechen — die
  Provider-API 0.2 rastet darauf ein.

## Store-Scorecard (gemessen 2026-08-19, Release 0.6.0)

**Health `Excellent` · Review `Passed`** — die Bestnote MIT eingebauter Engine (ORT-WebGPU im
Renderer, 2,5-GB-Modell-Download vom eigenen HF-Repo). Keine `low`/`medium`/`high`-Befunde.
`pass`: Attestierungen fuer `main.js`/`styles.css`, `Build reproduced the release main.js
byte-for-byte`, keine verwundbaren Abhaengigkeiten. `info` (kostet die Note nicht): `Number of
network request calls`, `Plugin references unrecognized WASM files`, **`Dynamic Code Execution`
(das `new Function(` der Emscripten-embind in der ORT-Glue — BEHAVIOR-Disclosure, wie in
publishing.md vorhergesagt)**, `runtime base64 encode or decode`, `AGPL copyleft`. Damit ist
die Spike-Rechnung vom 2026-08-19 bestaetigt: Modell-Download + WASM + in-process-Inferenz
sind Passed-vertraeglich, solange kein `fs`/`child_process`, kein globales `fetch`, `main.js`
klein. Nachlesen: `python3 <obsidian-store-recherche>/scripts/scorecard.py local-image-generator`.

## Historie: die in-process-Engine (bis 0.4) und der Thin-Client (0.5)

0.5 hatte die Engine ganz entfernt (Store-Warnungen durch `child_process`/`fs`/34-MB-Bundle);
0.6 hat sie **im Renderer** zurueckgeholt — ohne mflux, ohne Inline-WASM, mit Assets vom eigenen
HF-Repo (Spike 2026-08-19: Nachladen kostet nur `info`). Die Notizen unten bleiben, weil die
zurueckgeholte Pipeline genau diese Fallen traegt:

- **WASM-Paarung:** Die inline gebundelte ORT-WASM-Variante MUSS zum Glue des importierten
  Bundles passen. ORT 1.27 `onnxruntime-web/webgpu` → `asyncify`, NICHT `jsep`. Falsche
  Paarung = stiller Ewig-Haenger (uncaught rejection, create() resolved nie).
- **fp16-Gewichte ≠ fp16-Inputs:** Die Engine passt Feed-Dtypes an `Session.inputTypes`
  (aus ort `inputMetadata`) an. Nie Dtypes hardcoden.
- **Tokenizer:** CLIP-BPE exact-match (kein `</w>`-Fallback), Pad-Token 0 (OpenCLIP/sd-turbo-
  Referenz, MS-Demo index.js L256).
- **Referenz:** microsoft/onnxruntime-inference-examples `js/sd-turbo/index.js` (nicht main.js).
- **mflux-Kindprozess (0.4):** FLUX.2 klein lief ueber `mflux-generate-flux2` (User-
  installiert, Auto-Detect in mflux-detect.ts, IO-Bindung in mflux-host.ts — Electron erbt
  keinen Shell-PATH). tqdm schreibt Fortschritt auf **stderr mit `\r`**. Uebrig ist davon
  nur das tote Settings-Feld `mfluxPath`.
- **Uebrig im Code:** `src/obsidian/legacy-cache.ts` findet und loescht die ~2,5 GB
  SD-Turbo-Gewichte, die Bestandsinstallationen noch in der Cache API haben.
