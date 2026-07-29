# AGENTS.md

Conventions for AI assistants working in this repo.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, ../../_docs relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

## What this is

Obsidian community plugin that generates images **in-process** — SD-Turbo via
onnxruntime-web (WebGPU), no external server, no cloud. One sidebar hub view,
one curated model, weights downloaded on explicit opt-in into the Cache API
(outside the vault).

## Workflow conventions

- **Gate:** `npm run gate` (typecheck + vitest + check:pure + build) — vor jedem Commit grün.
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren NIE `obsidian`
  (Gate: `scripts/check-pure.mjs`). `src/obsidian/model-store.ts` ist browser-API-only,
  ebenfalls obsidian-frei (nicht vom Gate erfasst — manuell halten).
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

- **WASM-Paarung:** Die inline gebundelte ORT-WASM-Variante MUSS zum Glue des importierten
  Bundles passen. ORT 1.27 `onnxruntime-web/webgpu` → `asyncify`, NICHT `jsep`. Bei
  ORT-Upgrades prüfen: `grep -o '[a-z.-]*\.wasm' node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs`.
  Falsche Paarung = stiller Ewig-Hänger (uncaught rejection, create() resolved nie).
- **fp16-Gewichte ≠ fp16-Inputs:** Die Engine passt Feed-Dtypes an `Session.inputTypes`
  (aus ort `inputMetadata`) an. Nie Dtypes hardcoden.
- **Tokenizer:** CLIP-BPE exact-match (kein `</w>`-Fallback), Pad-Token 0 (OpenCLIP/sd-turbo-
  Referenz, MS-Demo index.js L256).
- **Engine-Interface** (`ImageBackend`-kompatibel zu yijing-oracle) nicht brechen — die
  Provider-API 0.2 und die spätere Kindprozess-Engine (Flux) rasten darauf ein.
- **Referenz:** microsoft/onnxruntime-inference-examples `js/sd-turbo/index.js` (nicht main.js).
- **mflux-Kindprozess (0.4):** FLUX.2 klein läuft über `mflux-generate-flux2` (User-
  installiert, Auto-Detect in mflux-detect.ts (core, Kandidatenliste + Begründung),
  IO-Bindung in mflux-host.ts — Electron erbt keinen Shell-PATH). tqdm
  schreibt Fortschritt auf **stderr mit `\r`** — splitChunks/parseMfluxLine (core) sind
  die einzige Stelle, die das Format kennt. Quantisierung fest `--quantize 8`.
