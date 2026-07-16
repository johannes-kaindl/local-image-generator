# AGENTS.md

Conventions for AI assistants working in this repo.

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

- **Cockpit (SSOT):** `10_Pallas/25_Coding/local-image-generator/` (Hub, _Tasks, _Log, Handover).
- **Memory:** `~/.claude/projects/-Users-Shared-code-obsidian-plugins/memory/` (Zeiger-Schicht).
- Spec/Plan: `docs/superpowers/specs/` bzw. `docs/superpowers/plans/`.

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
