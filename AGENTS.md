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
  Seit 0.8 zusaetzlich **img2img**: von einer Vault-Vorlage aus weiterrechnen. Der eingebaute
  Modus kann das NICHT (kein VAE-Encoder) — die Zeile ist dort ganz weg, nicht deaktiviert.

Desktop-only, ein Sidebar-Hub mit zwei Reitern (Generate/History). Beide Backends
implementieren `ImageBackend` (`src/core/txt2img.ts`); `main.ts` routet nach
`settings.engine`. **Bis 0.4 lief eine aeltere Fassung der Engine im Prozess (plus mflux als
Kindprozess), 0.5 war reiner Thin-Client** — Details unter *Historie* unten; die Reste
(`legacy-cache.ts` fuer die 0.4-Gewichte, totes Settings-Feld `mfluxPath`) bleiben erklaert.

## Workflow conventions

- **Gate:** `npm run gate` (typecheck + check:manifest + vitest + lint + check:pure + build +
  check:clean) — vor jedem Commit grün.
- **Assets (eingebaute Engine):** `tools/convert-model.sh <sd-turbo|sdxl-turbo>`
  (`npm run assets:convert -- <sd-turbo|sdxl-turbo>`; uv-Venv, optimum + ORT-fp16-Konverter,
  seit der zweiten Modellstufe modellparametrisiert in `tools/convert/convert_model.py`)
  erzeugt `dist-assets/` (gitignored), `npm run assets` hasht sie und schreibt
  `src/core/engine-manifest.generated.ts` (**nie von Hand**), `npm run assets:verify` prueft
  I/O-Namen/Dtypes/Shapes mit onnxruntime-node, `npm run assets:upload` laedt ins HF-Repo
  (`johannes-kaindl/local-image-generator-models`, per `HF_MODELS_REPO` ueberschreibbar).
  **Der Namespace ist eine Vertrauenszusage, kein Detail:** die URL steht als Platzhalter der
  Settings-Zeile „Download source" im Bild, und wer 2,5 GB laedt, gleicht den Namen mit dem
  Plugin-Autor ab — er ist deshalb seit 2026-08-21 identisch mit dem GitHub-Profil, auf das
  `authorUrl` zeigt. Das alte `v6t2b9/…` bleibt online: `assetBaseUrl` ist ein GESPEICHERTES
  Setting, eine 0.6.0-Installation traegt die alte URL in ihrer `data.json` und wuerde nach
  einem Repo-Umzug ins Leere laden.
  Nach jedem `onnxruntime-web`-Upgrade: `npm run assets` + Manifest mitcommitten, WASM neu
  hochladen — `check:manifest` bricht sonst das Gate.
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren NIE `obsidian`
  (Gate: `scripts/check-pure.mjs`, `ROOTS`). `src/obsidian/legacy-cache.ts` ist browser-API-only
  (Cache API), ebenfalls obsidian-frei — nicht vom Gate erfasst, manuell halten.
- **Vendoring (nie von Hand):** `sh tools/sync-kit.sh` kopiert die Kit-Module byte-identisch aus
  `../obsidian-kit` (`KIT_DIR` ueberschreibbar), setzt die Stempelzeile und schreibt beide
  `VENDOR.json`. **Zielordner ist Vertrag, nicht Geschmack:** `obsidian-kit/src/pure/*` →
  `src/vendor/kit/`, `obsidian-kit/src/obsidian/*` → `src/vendor/kit-obsidian/` — ein
  obsidian-importierendes Modul unter `src/vendor/kit/` bricht `npm run check:pure` und damit das
  Gate. Ein neues Modul kommt in die Modulliste des Skripts, nicht per `cp` in den Baum; danach
  muss `git status` nach einem erneuten Lauf leer bleiben (Reproduzierbarkeit).
  ⚠️ `HUB_CSS` aus `src/vendor/kit-obsidian/hub.ts` ist zusaetzlich in `styles.css` uebernommen —
  das Kit injiziert kein CSS. Wer das Modul neu vendoriert, gleicht den Block mit ab.
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
- **Die WebGPU-Limits im Obsidian-Renderer sind weit ueber den Spec-Defaults** (gemessen
  2026-08-23, M5 Pro): `maxBufferSize` und `maxStorageBufferBindingSize` je 4 GiB statt
  256/128 MiB, `shader-f16` vorhanden, 16 GiB GPU-Belegung ohne device-lost. Puffergrenzen
  sind hier also kein Engpass — die JS-Seite ist es.
- **Feeds an die Session anpassen, nie hardcoden:** `Session.inputTypes` (Dtype) UND
  `Session.inputShapes` (Rang). Die eigene Konversion deklariert `timestep` als 0-d-Skalar
  (`shape []`) — `dims [1]` bricht das UNet mit „Gemm: must be 2 dimensional" (gemessen
  2026-08-19, erster Live-Lauf). `scripts/verify-model.mjs` zeigt Dtypes + Shapes.
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
- **Die Download-Zusage der Provider-API ist strukturell, nicht bloss gegated.** `generate()`
  im builtin-Modus laedt ohne Klick des Nutzers keine Bytes — das gilt nicht nur, weil das
  Bereitschafts-Gate es abweist, sondern weil es keinen zweiten Ladepfad gibt: `ModelStore.getBuffer`/
  `getText` gehen ueber `matchOrThrow` (`src/obsidian/model-store.ts`), das bei einem
  Cache-Fehltreffer **wirft** und nie laedt. Der einzige Ladepfad ist `ModelStore.download`,
  aufgerufen ausschliesslich von `startDownload()`, das an genau zwei vom Nutzer geklickte
  Bedienelemente haengt und in `ApiDeps` (`src/main.ts`) nicht vorkommt. Selbst ohne das
  Bereitschafts-Gate endet ein builtin-`generate()` ohne Assets als
  `{ ok: false, reason: "failed" }`. Diese Garantie ist staerker als ein Smoke-Punkt sie liefern
  koennte (GUI-Smoke-Punkt 18b misst nur die Form von `capabilities`, im Server-Zweig — siehe
  `docs/SMOKE.md` § 2026-08-22).
- **`new Function(` im Bundle ist die ORT-Glue (Emscripten-embind)** — BEHAVIOR-Disclosure
  einer gebuendelten Dependency, notenneutral (publishing.md); `check-clean` laesst es
  begruendet zu, `eval(` bleibt verboten. Bundle ~184 KB (`check:clean`, gemessen 2026-08-20 nach
  dem Kit-0.27.0-Vendoring; Grenze `MAX_BYTES` = 2 MB).
- **ORT nimmt den eingebetteten Glue-Pfad nur mit gesetztem `env.wasm.wasmBinary` und
  `numThreads = 1`** — sonst versucht es `import()` einer URL (Code-Nachladen). `initOrt()`
  muss vor der ersten Session laufen (`ort-host.ts` wirft sonst).
- **Kit-Hub: `setTab(aktueller Tab)` ist ein No-op — kein `onShow()`, kein Re-Render.** Der
  Guard (`if (id === navState) return`) kam mit dem Vendoring von `buildHubInto` (Kit 0.27.0) und
  ist richtig; er heisst aber, dass ein Klick auf den bereits aktiven Reiter das Panel NICHT
  auffrischt. Wer ein sichtbares Panel neu zeichnen will, nimmt `refreshActive()` (oder den
  Host-Pfad `view.refresh()`), nicht einen zweiten Klick. Der aktive Reiter ueberlebt im
  Workspace-State — was im GUI-Smoke am 2026-08-21 einen flaky Pruefpunkt erzeugte (Punkt 10 mass
  die Historie VOR dem Lauf, weil sein Tab-Klick ins Leere lief; `docs/SMOKE.md` § 2026-08-21).
- **`npm run deploy` ist kein Reload.** Obsidian laedt die kopierte `main.js` erst beim
  Aktivieren des Plugins; ein laufendes Fenster misst sonst den Stand von seinem letzten Start,
  und die Manifest-Version verraet den Unterschied nicht. `scripts/gui-smoke.ts` laedt das Plugin
  deshalb selbst neu, bevor es misst. Wer von Hand prueft: Plugin aus- und einschalten.
- **Settings-Tab: bedingte Zeilen weglassen, nicht `visible:false`** — Obsidian 1.13 cacht
  `getSettingDefinitions()` und wertet Praedikate nicht neu aus; nach Modus-/Zustandswechsel
  `refreshUi()` (gemessen 2026-08-19: Server-Zeile blieb im builtin-Modus stehen).
  **Von aussen (Treiber, Test) heisst das: den Modus ueber das DROPDOWN wechseln, nicht ueber
  die Einstellung.** Nur dessen `onChange` ruft `refreshUi()`. Wer den Wert vorher setzt,
  nimmt dem Wechsel sogar seinen Anlass — das Dropdown steht dann schon richtig, das Ereignis
  bleibt aus, und darunter steht die Zeile des alten Modus (gemessen 2026-08-21 an
  `settings-server.png`, zweimal hintereinander).
- **`.is-hidden` steht am ENDE von `styles.css` — und muss dort bleiben.** Es ist die
  Aus-Schaltung fuer jede Zeile, die ein Backend nicht kann (Negativ-Prompt, CFG, Groesse:
  die Keine-Attrappen-Linie). Die Regel traegt nur eine Klasse und verliert deshalb gegen
  jede spaetere Ein-Klassen-Regel, die `display` setzt. Genau so blieb die Negativ-Zeile im
  builtin-Modus sichtbar, obwohl das Panel sie korrekt markiert hatte (`.lig-prompt-row`
  stand weiter unten). Wer etwas anhaengt, haengt es DARUEBER an.
- **Ein range-Input klemmt seinen `value` selbst, sobald `max` sinkt.** Deshalb darf das
  Nachziehen der Anzeige nicht davon abhaengen, ob `clamped !== stepsEl.value` — diese
  Bedingung ist nach dem Setzen von `max` nie erfuellt, und die Zahl neben dem Regler bleibt
  auf ihrem Startwert stehen (gemessen 2026-08-21: Regler auf 4, Beschriftung „20").
  Verallgemeinert: **beide Anzeigefehler waren nur ueber die GERENDERTE Darstellung
  sichtbar** (`getComputedStyle`, DOM-Text), nie ueber den Zustand — Unit-Tests koennen sie
  nicht finden, ein Screenshot findet sie sofort. **Seit 2026-08-22 bewacht sie Smoke-Punkt 17**
  (`runControlVisibilityCheck`): er misst beide Richtungen ueber `getComputedStyle`, laeuft in
  jedem Lauf (auch `--quick`, er braucht weder Server noch Assets) und schiebt den Steps-Regler
  vorher selbst ueber das builtin-Maximum — ohne dieses Klemmen kann die Beschriftung gar nicht
  danebenliegen, und der Punkt blieb in der Gegenprobe gruen, obwohl der Defekt drin war.
- **Vier Endpunkte, mehr nicht (Server-Modus):** `POST /sdapi/v1/txt2img` erzeugt,
  `POST /sdapi/v1/img2img` rechnet von einer Vorlage aus weiter (seit 0.8; derselbe Body plus
  `init_images` und `denoising_strength`),
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
- **Die Provider-API laedt NIE nach.** `generate()` gibt bei fehlenden Assets
  `model-not-downloaded` zurueck. „Ohne Klick fliesst kein Byte" ist eine Zusage an den
  Nutzer — ein Fremdplugin darf sie nicht umgehen.
- **`isBusy()` deckt beide Wege.** Panel-Laeufe UND API-Laeufe; sonst zieht ein
  Moduswechsel die GPU-Sessions unter einem Fremdlauf weg.
- **Das Ausgangsbild (img2img) ist KEIN Rezept-Parameter.** `GenParams.initImage` ist ein
  VAULT-PFAD, `ImageRequest.initImageData` sind die BASE64-Bytes — bewusst verschiedene
  Namen. Grund fuer die Trennung: `GenParams` wandert in `settings.history`, also in
  `data.json`, das bei jedem `saveSettings()` komplett geschrieben wird; ein eingebettetes
  PNG waere dort ein Megabyte pro Eintrag. Grund fuer die verschiedenen NAMEN: `runGeneration`
  baut den Auftrag als `{ ...params, initImageData }`, und bei gleichem Namen haette ein
  vergessener Override still einen Pfad als Bilddaten an den Server geschickt. Als
  Pflichtfeld mit eigenem Namen faengt das der Typecheck.
- **Ob img2img gerechnet wurde, sagt `denoising` — nicht `initImage`.** Der Pfad darf null
  sein, waehrend sehr wohl ein Bild mitlaeuft: ein Fremdplugin schickt ueber die API Bytes
  ohne Vault-Datei. Deshalb ist auch `HardenInput.initImage` ein `{ ref: string | null }`:
  die ANWESENHEIT des Objekts ist das Signal, `ref` nur die Herkunft. Haengte das Signal am
  Pfad, verlore jeder API-Lauf sein `denoising` und die Notiz meldete einen img2img-Lauf als
  txt2img. Aus demselben Grund darf `ApiRequest` NIE ungeprueft als `HardenInput`
  durchgereicht werden (`deps.harden(req)`) — dort heisst `initImage` Base64.
- **Der Denoise-Regler hat ZWEI Sichtbarkeitsbedingungen, nicht eine.**
  `controls.initImage` = kann das Backend es (Modus), `controls.denoising` = gibt es eine
  Vorlage zu aendern. Ein Regler ohne Vorlage bewirkt nichts und waere dieselbe Attrappe wie
  ein CFG-Regler im builtin-Modus. Deshalb steht `.lig-denoise` auch NICHT in `MODUS_REGLER`
  von `scripts/gui-smoke.ts`: dort gefuehrt, wuerde Punkt 17 die zweite Stufe als Defekt melden.
- **„Speichern & als Vorlage" speichert wirklich — das ist der Punkt.** Der Knopf legt das
  Ergebnis erst im Vault ab und macht dann dessen Pfad zur Vorlage. Ohne das entstuende eine
  Vorlage ohne benennbare Herkunft, und die Ergebnis-Notiz muesste „Vorlage: das vorige
  Ergebnis" behaupten. Legt nur das Bild an, nie eine Notiz — `createMode` gilt fuer
  Ergebnisse, nicht fuer Zwischenschritte.
- **Die Haertung hat genau eine Quelle** (`src/core/params.ts`, `hardenParams`). Zwei
  Haertungen bedeuten, dass die API andere Werte meldet, als das Panel in die Notiz schreibt.
- **Ein Fremdlauf hinterlaesst im Panel KEINE Spur — auch nicht als Fehler.** `runGeneration`
  faellt im `catch` bei `external` auf `{ kind: "idle" }` zurueck statt auf `error` mit der
  rohen Backend-Meldung (Ruling 2026-08-23, `f223c8f`). Das sieht wie ein verschluckter Fehler
  aus und ist keiner: der Erfolgsfall schrieb schon immer `idle`, der Aufrufer bekommt den
  Fehler als Rueckgabewert, und die Statuszeile gehoert dem eigenen Klick. Wer hier einen
  Fehlerzustand zurueckbaut, laesst das Panel wieder einen FREMDEN Fehlschlag als eigenen
  melden. ⚠️ Diese Zeile ist die einzige Deckung — der Fix liegt in `main.ts`, der einzigen
  Schicht ohne Unit-Test-Ebene; ein Smoke-Punkt dafuer ist geseedet, aber noch nicht gebaut.
- **`save()` prueft `created` und `seed`, bevor daraus ein Vault-Pfad wird**
  (`unusableParams` in `src/core/plugin-api.ts`). Sieht redundant aus, weil `ApiParams` beide
  typisiert — TypeScript schuetzt aber keinen JS-Aufrufer, und `buildImageFilename`
  interpoliert beide direkt in den Dateinamen (`lig-NaNNaNNaN-NaNNaNNaN-s7.png` aus einem
  kaputten `created`). Die Abweisung faellt VOR dem Write und als `write-failed`, damit die
  Fehler-Union von v1 unveraendert bleibt.
- **`PanelState.mode` wird ABGELEITET, nicht gespiegelt.** Der gehaltene State ist
  `Omit<PanelState, "mode">`; `mode` entsteht einzig in `getPanelState()` aus
  `settings.engine`. Das `Omit` ist der eigentliche Fix — es macht ein zweites Spiegeln
  typseitig unmoeglich (Gegenprobe: eine Zuweisung `this.state.mode = …` bricht `tsc` mit
  TS2339). Vorher hielten zwei Zuweisungen in `main.ts` die Kopie von Hand synchron, und das
  ViewModel las die Kopie, waehrend alles Neuere `settings.engine` las.
- **Ein Fallback-Argument, das einen injizierten Callback ruft, gehoert lazy.**
  `finite(value, fallback)` in `src/core/params.ts` nimmt deshalb `number | (() => number)`:
  `finite(input.seed, ctx.randomSeed())` haette `randomSeed()` bei JEDER Haertung gezogen, auch
  mit brauchbarem Seed. Konstante Fallbacks bleiben Werte — kein Thunk-Rauschen. Die
  Gegenprobe ist ein Test, der die Ziehungen ZAEHLT; der Rueckgabewert stimmte immer.
- **`ApiParams.created` vs. `GenParams.date`** ist Absicht, kein Versehen: der Vertrag darf
  nicht mitwandern, wenn intern umbenannt wird.
- **Der Erstellungs-Zeitstempel wird AM ANFANG gesetzt, nicht am Ende.** `GenParams.date`
  traegt den Moment der ANFRAGE, nicht der Fertigstellung — die Haertung ist die einzige Quelle
  fuer Panel und API, und eine Doppel-Zeitstempel-Setzung wuerde die zwei berichten
  unterschiedliche Zeiten, im Server-Modus Sekunden, im builtin-Modus Minuten. Folge: eine
  Notiz traegt die Anfrage-Zeit statt der Fertig-Zeit; die Datei traegt diese Zeit im Namen.

## Store-Scorecard (gemessen 2026-08-23, Release 0.8.0)

**Health `Excellent` · Review `Passed`** — zum vierten Mal in Folge, diesmal mit
**zero warnings**. Keine `low`/`medium`/`high`-Befunde.

**Die Befundliste hat sich gegenueber 0.7.0 um GENAU EINE `info`-Zeile veraendert — und die
laesst sich auf eine einzige Codezeile zurueckfuehren:**

> `**Vault Enumeration**: Enumerates all files in the vault (vault.getFiles, getMarkdownFiles, …).`

Ursache ist `app.vault.getFiles()` im `ImagePickerModal` (`src/obsidian/image-picker.ts:21`) —
die Vorlagen-Auswahl fuer img2img. In 0.7.0 gab es keinen einzigen `getFiles`-Aufruf; der Scanner
misst also praezise, was dazukam.

**Damit ist ein Kostensatz gemessen, der ueber dieses Plugin hinausgeht:** ein Vault-Datei-Picker
(`FuzzySuggestModal` ueber `vault.getFiles()`) kostet **eine `info`-Zeile und sonst nichts** —
die Note bleibt `Passed`. Wer eine Dateiauswahl plant, muss dafuer nichts einpreisen. `info` ist
eine *Recommendation*, keine *Warning*; nur `medium` und darueber druecken die Note.

`pass` (unveraendert): Attestierungen fuer `main.js`/`styles.css`, `Build reproduced the release
main.js byte-for-byte`, keine verwundbaren Abhaengigkeiten, **`Vault Write`**.

`info`: `AGPL copyleft`, `Number of network request calls`, `runtime base64 encode or decode`,
**`Vault Enumeration`** (neu, s.o.), **`Dynamic Code Execution`** (das `new Function(` der
Emscripten-embind in der ORT-Glue), `Plugin references unrecognized WASM files`.

⚠️ **Drei Pruefungen liefen wieder gar nicht:** `Malware scan not available`,
`Obfuscation scan not available`, `Network requests scan not available` — **vierte Version in
Folge**. Das steht unter `info` und sieht wie ein Befund aus, ist aber die Abwesenheit einer
Messung. Nicht als Freibrief lesen: wer eine riskante Bauart plant, hat hier **keine**
Bestaetigung bekommen, nur kein Widerwort.

**Was 0.7.0 schon gezeigt hatte und weiter gilt:** eine oeffentliche `plugin.api`, ueber die ein
FREMDES Plugin Bilder erzeugen und in den Vault schreiben laesst, erzeugt **keine** neue
Kategorie — `Vault Write` bleibt ein `pass`, weil der Scanner den *Weg* bewertet (Obsidian-API
statt `fs`), nicht den Ausloeser. Dasselbe gilt fuer img2img: ein zweiter HTTP-Endpunkt zum
selben Server kostet nichts.

Nachlesen: `python3 <obsidian-store-recherche>/scripts/scorecard.py local-image-generator`.
**Der Scan laeuft nie von selbst an** — nach jedem Release im Developer Dashboard einen
Rescan anstossen (0.8.0: von Johannes am 2026-08-23 angestossen, Ergebnis oben).

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
