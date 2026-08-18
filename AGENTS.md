# AGENTS.md

Conventions for AI assistants working in this repo.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, ../../_docs relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

## What this is

Obsidian community plugin: eine **Oberflaeche** fuer Bilderzeugung (Prompt, Stil-Chips,
Verlauf, Ablage im Vault) vor einem **externen, lokalen Bild-Server**, den der Nutzer
selbst betreibt — Draw Things, AUTOMATIC1111, Forge oder SD.Next ueber deren gemeinsame
A1111-kompatible HTTP-API. **Das Plugin erzeugt selbst keine Bilder** und laedt keine
Modellgewichte: dem Server gehoeren Modell und Hardware, dem Plugin die Bedienung.
Desktop-only, ein Sidebar-Hub mit zwei Reitern (Generate/History).

**Bis 0.4 war das anders** — da lief SD-Turbo per onnxruntime-web im Prozess, spaeter
zusaetzlich mflux als Kindprozess. Beides ist mit 0.5 entfallen; was davon noch im Code
steht, ist Aufraeumen (`src/obsidian/legacy-cache.ts`) oder totes Settings-Feld
(`mfluxPath`, dokumentiert in `src/core/settings.ts`). Details unter *Historie* unten —
die Notizen bleiben stehen, weil sie erklaeren, warum diese Reste existieren.

## Workflow conventions

- **Gate:** `npm run gate` (typecheck + vitest + check:pure + build) — vor jedem Commit grün.
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

- **Drei Endpunkte, mehr nicht:** `POST /sdapi/v1/txt2img` erzeugt,
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

## Historie: die in-process-Engine (bis 0.4)

Ueberholt seit 0.5 (Thin-Client). Steht hier, weil es die Reste im Code erklaert und
weil eine spaetere eigene Engine dieselben Fallen wiederfaende:

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
