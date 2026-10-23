---
paths:
  - "src/obsidian/local-engine.ts"
  - "src/obsidian/ort-host.ts"
  - "src/obsidian/model-store.ts"
  - "src/obsidian/legacy-cache.ts"
  - "scripts/check-clean.mjs"
  - "esbuild.config.mjs"
---

# Eingebaute Engine — Laufzeit im Renderer (ORT, WebGPU, Download, Cache)

Gotchas zu `onnxruntime-web` im Obsidian-Renderer, zur Session-Erzeugung, zum Download in die Cache API und zum Bundle (`src/obsidian/local-engine.ts`, `ort-host.ts`, `model-store.ts`, `legacy-cache.ts`). `legacy-cache.ts` findet und löscht die rund 2,5 GB SD-Turbo-Gewichte der 0.4-Bestandsinstallationen (`local-image-generator-models`).

- **`location`-Strings in External Data sind reine Dateinamen, nie Cache-Schluessel oder
  HF-Pfade.** `split_external_data.py` schreibt in jeden Bucket-Verweis nur den Basisnamen
  (`unet_003.onnx_data`), und `loadPart()` muss ORT exakt diesen String zurueckgeben —
  `d.path.split("/").pop()`, NICHT `d.key` (der Cache-API-Schluessel, hash-gebunden seit
  0.6) und NICHT der HF-Pfad (`sdxl-turbo/unet/unet_003.onnx_data`, mit Ordner). Reicht man
  Cache-Schluessel oder HF-Pfad durch, findet ORT die Bucket-Daten nicht — der Session-Aufbau
  scheitert, aber mit einer Meldung, die nach einem Datenfehler aussieht, nicht nach einem
  Pfadfehler.
- **ORT bietet KEIN Abort fuer `InferenceSession.create` — deshalb sitzt der Wachhund am
  Rand, nicht im Kern.** `SESSION_BUILD_TIMEOUT_MS` (`src/obsidian/local-engine.ts`, 5 min)
  umschliesst den Aufruf mit `withTimeout`, aber ein Ablauf BRICHT den Aufruf nicht ab — er
  meldet nur der UI, dass er als haengend gilt, und laesst die echte Promise im Hintergrund
  verwaisen; loest sie doch noch spaeter auf, bleibt diese Session unreleased (kein
  `.dispose()`, GPU-Speicher bleibt belegt). Der Guard sitzt bewusst an der INJIZIERTEN
  Grenze `LocalEngineDeps.createSession`, nicht in `ort-host.ts`: nur dort ist er mit einem
  Fake in Node testbar, `ort-host.ts` ruft echtes ORT. **Dieser Wachhund existierte schon
  einmal** (Entwurf 2026-07-18) und ging ueber zwei Engine-Umbauten (0.5-Entfernung,
  0.6-Rueckholung) verloren, weil er nur in einer Spec-Datei stand, nicht im Code — genau der
  Fehlermodus, den dieser Absatz jetzt verhindern soll: was hier nicht steht, kann beim
  naechsten Umbau wieder verschwinden.
- **Die WebGPU-Limits im Obsidian-Renderer sind weit ueber den Spec-Defaults** (gemessen
  2026-08-23, M5 Pro): `maxBufferSize` und `maxStorageBufferBindingSize` je 4 GiB statt
  256/128 MiB, `shader-f16` vorhanden, 16 GiB GPU-Belegung ohne device-lost. Puffergrenzen
  sind hier also kein Engpass — die JS-Seite ist es.
- **Download per `activeWindow.fetch` + `tee()`, nicht XHR** (`src/obsidian/model-store.ts`):
  speicherkonstantes Streaming einer 1,7-GB-Datei in die Cache API geht nur mit
  ReadableStream; XHR hielte alles im Puffer. PROF-OBS-12-Fall „unvermeidbar", Store-Linter
  bestaetigt (globales `fetch` bleibt gebannt). SHA-256 laeuft chunkweise im Stream
  (`src/vendor/kit/sha256.ts`, ~200 MB/s — seit Kit 0.27.0 vendoriert; die kanonische Quelle
  des Kit-Moduls WAR die frueher hier liegende `src/core/sha256.ts`). Der Streaming-Kern je
  Datei liegt seit 0.27.0 ebenfalls im Kit (`src/vendor/kit/cache-download.ts`,
  `streamIntoCache`); lokal bleiben Key-Ableitung, Manifest-Liste, Fortschritts-Huelle und
  das Hash-Urteil.
- **Cache-Namen nicht verwechseln:** 0.6-Assets liegen in `local-image-generator-assets` mit
  hash-gebundenen, URL-unabhaengigen Schluesseln; `legacy-cache.ts` loescht weiterhin nur
  `local-image-generator-models` (0.4). Die zwei kollidieren nicht.
- **`new Function(` im Bundle ist die ORT-Glue (Emscripten-embind)** — BEHAVIOR-Disclosure
  einer gebuendelten Dependency, notenneutral (publishing.md); `check-clean` laesst es
  begruendet zu, `eval(` bleibt verboten. Bundle ~184 KB (`check:clean`, gemessen 2026-08-20 nach
  dem Kit-0.27.0-Vendoring; Grenze `MAX_BYTES` = 2 MB).
- **ORT nimmt den eingebetteten Glue-Pfad nur mit gesetztem `env.wasm.wasmBinary` und
  `numThreads = 1`** — sonst versucht es `import()` einer URL (Code-Nachladen). `initOrt()`
  muss vor der ersten Session laufen (`ort-host.ts` wirft sonst).
- **Die Gewichte des builtin-Modus liegen in der Browser-Cache-API (`caches.open("local-image-generator-assets")`), nicht im Vault — und ein Satz gilt für alle Vaults eines Obsidian-Profils** (gemessen 2026-10-14, Welle 22: Zweitinstanz mit zwei Vaults, beide Fenster `app://obsidian.md`, ein in Vault A geschriebener Cache-Eintrag war in Vault B lesbar). Ein „Modellpfad je Vault“ oder eine Ablage „über mehrere Vaults“ löst deshalb kein Platzproblem; ein sichtbarer Pfad oder eine externe Platte ginge nur über Node-`fs` und kostet die Store-Note (Behavior `medium`). Nur auf ausdrücklichen Wunsch neu aufmachen.
- **Der WebGPU-EP vertraegt nur EINE Session-Erzeugung zugleich.** `webgpuRegisterDevice` im
  Emscripten-Glue setzt ein Flag und wirft `another WebGPU EP inference session is being
  created`, wenn zwei `InferenceSession.create` ueberlappen. Das `Promise.all` ueber
  `loadPart()` war deshalb seit 0.9 ein Timing-Gluecksspiel und riss live, als der 5. Teil
  (der kleine, schnell erzeugte vae_encoder) dazukam. Fix: Erzeugungs-Queue in
  `LocalEngineBackend` (injizierte Grenze, Node-testbar; `getBuffer` bleibt parallel) plus
  Ketten-RESET beim Session-Timeout — ohne ihn haette ein einziger Ewig-Haenger jede weitere
  Erzeugung der gecachten Instanz blockiert (Review-Fund mit Repro). Die Wachhund-Frist
  enthaelt seither auch die Queue-Wartezeit.
- **0.11-Migration: Bestandsinstallationen zeigen wieder „Download" — und laden dabei NUR den
  Encoder nach.** Der Encoder ist Pflichtteil in `assetsFor()`, also ist ein 0.6–0.10-Cache
  `not-downloaded`; der Downloader ueberspringt gecachte Schluessel und holt nur die fehlende
  Datei (68 MB sd / 137 MB sdxl — gemessen im Smoke: 1 s gegen den lokalen Mock). Der
  Bestaetigungsdialog nennt dabei die GESAMTgroesse des Modells, nicht die fehlenden Bytes.
