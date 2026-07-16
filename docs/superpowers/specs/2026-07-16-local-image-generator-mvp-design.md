# local-image-generator — MVP-Design (0.1)

**Datum:** 2026-07-16 · **Status:** beschlossen (Brainstorming mit Jay, Ansatz A)
**Repo:** `/Users/Shared/code/obsidian-plugins/local-image-generator` (eigenständig, PROF-OBS-09)

## 1. Kontext & Ziel

yijing-oracle generiert Bilder bisher über externe Software (DrawThings via A1111-API).
Dieses Plugin generiert Bilder **self-contained in-process** im Obsidian-Renderer —
via `onnxruntime-web` mit WebGPU — und soll perspektivisch anderen Plugins als
Provider dienen. Der MVP (0.1) ist bewusst standalone.

**Erfolgskriterium 0.1:** In der Sidebar einen Prompt eingeben → Bild wird lokal
generiert → Preview → per Klick im Vault angelegt oder in die aktive Notiz eingefügt.
Kein externes Programm, kein Server.

## 2. Beschlossene Eckpunkte (Brainstorming 2026-07-16)

| Frage | Entscheidung |
|---|---|
| MVP-Schnitt | **Standalone zuerst**; Provider-API für yijing-oracle in 0.2 |
| Plattform | **Desktop-only, alle OS** (`isDesktopOnly: true`); Referenzgerät Apple Silicon; Linux-WebGPU unzuverlässig → saubere Fehlermeldung |
| Qualität | **SD-Turbo-Klasse reicht** (512 px, 1–4 Steps); Flux kommt erst mit Stufe 2 (Kindprozess) |
| Modellverwaltung | **Genau 1 kuratiertes Modell** (SD-Turbo ONNX); Download nur nach explizitem Opt-in |
| UI | **Eine zentrale Sidebar-Hub-View** (UI-STANDARD §1/§4): Preview mit „Neu generieren", **Anlegen** (speichern + in neuem Tab öffnen), **Einfügen** (speichern + `![[…]]` an Cursor) |
| Ansatz | **A: onnxruntime-web direkt, eigene schlanke Pipeline** (Microsoft-sd-turbo-Demo als Referenz); web-txt2img nur als Spickzettel; Kindprozess-Engine = Stufe 2, nicht MVP |

## 3. Recherche-Grundlagen (verifiziert 2026-07-16)

- **WebGPU in Obsidian:** aktuelle Installer = Electron 35–39 / Chromium ≥130;
  `navigator.gpu` auf macOS/Windows ohne Flags verfügbar. Präzedenz: Smart
  Connections nutzt GPU-Inferenz im Renderer. Linux: Adapter oft `null`.
- **Modell:** `schmuell/sd-turbo-ort-web` (HuggingFace), fp16-ONNX der SD-2.1-Turbo-
  Architektur: `text_encoder/model.onnx` 681 MB, `unet/model.onnx` 1,73 GB,
  `vae_decoder/model.onnx` 99 MB → **~2,5 GB** (kein vae_encoder nötig, nur txt2img).
  Referenzimplementierung: `microsoft/onnxruntime-inference-examples/js/sd-turbo`.
- **ORT-Runtime:** JSEP/WebGPU-WASM ~20 MB (Custom-Build ~8 MB) → wird **base64-inline
  in main.js gebundelt** (Präzedenz SQL Viewer; Laufzeit-Nachladen von ausführbarem
  Code ist Store-Grauzone). `ort.env.wasm.wasmPaths` → Blob-URL des Inline-Binaries.
- **Store-Policies:** Modell-Gewichte (Daten) zur Laufzeit laden ist zulässig mit
  README-Offenlegung + Opt-in (Präzedenz Smart Connections). fp16-Compute braucht
  `shader-f16`-Feature (Chromium ≥121 — gegeben).
- **Bibliotheken:** diffusers.js unmaintained, Transformers.js kann keine SD-Pipelines
  → eigene Pipeline ist der einzige gepflegte Weg.

## 4. Architektur

Grundschnitt wie yijing-oracle: `src/core/` = pure TS ohne Obsidian-Import (Node-testbar),
`src/obsidian/` = Integrationsschicht, `src/vendor/kit/` = vendored Kit-Bausteine
(`mergeSettings`, ggf. weitere).

| Komponente | Ort | Aufgabe |
|---|---|---|
| Pipeline | `src/core/pipeline/` | CLIP-Tokenizer (BPE), 1-Step-Euler-Scheduler (sd-turbo: keine CFG, guidance 1.0), geseedeter PRNG für Start-Latents, Latent→RGB-Umrechnung — pure Funktionen |
| Engine | `src/core/engine.ts` | Orchestriert drei injizierte ONNX-Sessions (text_encoder → unet → vae_decoder) hinter `ImageBackend.generate(req)`; lazy Session-Load beim ersten Bild; genau eine Generierung gleichzeitig (Lock) |
| ORT-Host | `src/obsidian/ort-host.ts` | Kapselt onnxruntime-web: Inline-WASM als Blob-URL registrieren, WebGPU-Sessions aus Cache-API-Blobs erzeugen |
| Model-Store | `src/obsidian/model-store.ts` | Download der drei Gewichts-Dateien (fetch-Streaming mit Fortschritt) → **Cache API** (`caches.open`, liegt außerhalb des Vaults, wird nie gesynct); Datei-Granularität (vorhandene Dateien werden übersprungen); Integritätscheck über erwartete Byte-Größen; Löschen |
| Hub-View | `src/obsidian/view.ts` | Die eine Sidebar-View, Mount-once-Muster (§4: State-behaftet — Prompt-Eingabe, Preview überleben Re-Render); ViewModel als pure Funktion `State → ViewModel` |
| Settings | `src/obsidian/settings-tab.ts` | Modell-Sektion (Status/Download/Fortschritt), Ausgabe-Sektion, Danger-Zone (Modell löschen, Confirm-Modal) |
| Strings | `src/core/strings.ts` | Alle UI-Texte zentral, Englisch, sentence case (i18n-Ausbau später) |
| Wiring | `src/main.ts` | `registerView` (genau einer), Command „Open generator", Ribbon-Icon, `mergeSettings`-Persistenz |

**Interface-Kompatibilität (tragende Entscheidung):** `ImageRequest`/`ImageBackend`
sind deckungsgleich mit yijing-oracles `src/obsidian/image-client.ts`
(`generate(req) → Base64-PNG`). Dadurch rasten später ein: (a) die Provider-API 0.2
(yijing-oracle konsumiert unsere Engine als zweites `ImageBackend`), (b) die
Kindprozess-Engine (Stufe 2) als weitere Implementierung — ohne Änderung an View,
Settings oder Consumer.

## 5. Pipeline-Details

- **Modell fest kuratiert:** Manifest als Konstante (HF-Base-URL, drei Dateien,
  erwartete Größen). Kein Katalog, keine User-Modelle in 0.1.
- **Ablauf:** Prompt → CLIP-Tokenizer (77 Tokens, padded) → text_encoder →
  Start-Latents 1×4×64×64 aus geseedetem PRNG (Box-Muller) → UNet-Loop 1–4 Steps
  (Euler-Ancestral-Diskretisierung wie im MS-Demo, guidance 1.0, kein Negative-Prompt —
  sd-turbo ignoriert ihn architektonisch) → vae_decoder → f16/f32-Tensor →
  RGB-Clamp → Canvas → `toBlob("image/png")` (kein Encoder-Dependency).
- **Seed:** pro Generierung zufällig, im UI sichtbar und fixierbar („Neu generieren"
  würfelt neu); Ergebnis reproduzierbar bei gleichem Seed+Steps.
- **Bildgröße:** 512×512 fix in 0.1 (native sd-turbo-Auflösung).
- **Kein Web Worker in 0.1:** WebGPU-Calls sind async; CPU-Anteile winzig. Falls der
  Smoke-Test UI-Ruckeln zeigt, ist der Worker ein isolierter Nachrüst-Schritt.

## 6. UI (verbindlich: UI-STANDARD.md)

- **Ein `registerView`** (`local-image-generator`), rechtes Sidebar-Leaf; Öffnen via
  Ribbon + Command.
- **Panel-Aufbau** (Hub-Blaupause §4, Mount-once): Kopf mit Titel; Content =
  Generieren-Panel; Statuszeile unten (Modell-/GPU-/Laufstatus, „die eine nächste
  Handlung").
- **Generieren-Panel:** Prompt-Textarea → Zeile mit Steps (Slider 1–4, Default 1) und
  Seed (Zahlenfeld + Würfel-Button, `aria-label`) → Generate-Button (`mod-cta`,
  disabled während Lauf) → Preview-Karte (Info-Karten-Baustein §8:
  `background-secondary`, Border, Radius) mit Bild + Aktionszeile: **Neu generieren**
  (klassenlos) · **Anlegen** (`mod-cta`) · **Einfügen** (`mod-cta`; disabled + Tooltip,
  wenn kein Markdown-Editor aktiv).
- **Empty-States** (§8-Baustein): (a) Modell fehlt → Text + genau ein CTA „Download
  model (~2.5 GB)" der in die Settings führt; (b) WebGPU fehlt → Fehlertext ohne CTA;
  (c) Modell da, noch kein Bild → Hinweistext.
- **Fortschritt:** Download-% in Settings UND Statuszeile der View; Generierungs-
  Fortschritt als Step-Anzeige in der Statuszeile. Status-Indikator nach §8-Vokabel
  (`loader`/`circle-check`/`circle-x`, Form+Farbe+Klasse+`aria-label`).
- **CSS:** Präfix `lig-`, nur Theme-Variablen, flex+gap-Muster, kein `!important`.
- **DOM** nur `createEl`/`createDiv`/`createSpan`/`empty()`.

## 7. Dateien & Ausgabe

- **Speichern:** Setting `outputFolder` (leer = Obsidians Attachment-Logik via
  `fileManager.getAvailablePathForAttachment`); Dateiname
  `lig-<YYYYMMDD-HHmmss>-s<seed>.png`; Schreiben via `vault.createBinary`.
- **Anlegen** = speichern + `workspace.getLeaf(true).openFile(...)`.
- **Einfügen** = speichern + `editor.replaceSelection("![[<pfad>]]")` in der aktiven
  Markdown-View; ohne aktive Notiz ist der Button disabled (Tooltip erklärt warum).

## 8. Fehlerbehandlung

| Fall | Verhalten |
|---|---|
| `navigator.gpu` fehlt / Adapter `null` (Linux!) | View-Empty-State + Settings-Hinweis: „WebGPU not available…"; kein WASM-Fallback (unbrauchbar langsam) |
| `shader-f16` fehlt | gleiche Meldung, Variante „GPU lacks fp16 support" |
| Download bricht ab | Datei-genauer Retry (fertige Dateien bleiben im Cache); Fehler als Status + Notice |
| Größen-Mismatch nach Download | Datei verwerfen + Fehler anzeigen (kein korruptes Modell laden) |
| Inferenz-Fehler / OOM | catch → Notice + Statuszeile; Sessions disposen und beim nächsten Lauf neu laden; Hinweis „try closing other apps (needs ~4–7 GB free memory)" |
| Doppel-Klick auf Generate | Lock: Button disabled, ein Lauf gleichzeitig |
| Obsidian-Neustart während Download | Cache API persistiert fertige Dateien; unfertige Datei wird beim nächsten Download-Klick neu geholt |

## 9. Testing (TDD, Skill `obsidian-plugin-test-pattern`)

- **Pure Units (vitest, node-env):** Tokenizer gegen bekannte CLIP-Golden-Vektoren;
  Scheduler-Mathe (Sigma-Schedule, 1-Step-Update); PRNG-Determinismus (gleicher Seed
  → gleiche Latents); Latent→RGB-Clamp; Dateinamens-Schema; ViewModel-Zustände
  (kein Modell / lädt / bereit / generiert / Fehler); Model-Store-Manifestlogik
  (welche Dateien fehlen, Größen-Validierung) mit gemocktem Cache.
- **Engine-Test:** Fake-Sessions (injizierte `run`-Stubs) → richtige Feed-Namen,
  Shapes, Reihenfolge, Lock-Verhalten, Dispose-on-Error.
- **Obsidian-Schicht:** Mock aus `obsidian-kit/testing` (vitest `resolve.alias`).
- **Manueller Smoke-Test** (Jay, als user-handover): Download-Flow, erstes Bild auf
  Apple Silicon (Benchmark fehlt in der Literatur!), Anlegen/Einfügen. Bild-/Farb-
  Sichtprüfung übernimmt Claude (Render + Analyse).

## 10. Store-Compliance (0.1-Checkliste)

- `manifest.json`: `isDesktopOnly: true`, id `local-image-generator`, Name
  „Local image generator".
- README legt offen: (a) Download von HuggingFace (URLs, ~2,5 GB) nach explizitem
  Opt-in, (b) Ablage im lokalen Browser-Cache außerhalb des Vaults, (c) keine
  Telemetrie, keine weiteren Netzwerkzugriffe.
- Kein Laufzeit-Nachladen von Code: ORT-WASM inline gebundelt.
- UI-Texte Englisch, sentence case; keine `innerHTML`; nur Theme-CSS-Variablen.
- MIT-Lizenz.

## 11. Nicht-Ziele 0.1 & Roadmap

**Nicht in 0.1:** Provider-API für andere Plugins · ComfyUI/DrawThings-Backends ·
img2img/LoRA/ControlNet · Modell-Katalog oder eigene Modelle · Mobile · Web Worker ·
i18n über Englisch hinaus · Negative-Prompt-UI.

**Roadmap:** **0.2** Provider-API (yijing-oracle konsumiert `ImageBackend` über
`app.plugins.getPlugin("local-image-generator").api`; API-Design dann mit REGISTRY-
Eintrag). **0.3+** Stufe 2: Kindprozess-Engine (stable-diffusion.cpp/mflux, Flux-
Qualität) als weitere `ImageBackend`-Implementierung; ggf. Modell-Katalog, SDXL-Turbo.
