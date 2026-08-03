# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Breaking

- **In-process image generation is gone.** Both the SD-Turbo engine
  (ONNX/WebGPU, running inside the plugin) and the FLUX.2 klein 4B engine
  (via a local `mflux` child process) have been removed entirely, along with
  the model catalog that drove them. The plugin now requires a **separately
  running local A1111-compatible image server** — [Draw Things](https://drawthings.ai/),
  [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui),
  [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge), or
  [SD.Next](https://github.com/vladmandic/sdnext) — configured via a new
  **Server endpoint** setting. See the rewritten README for setup
  instructions.

### Added

- **Thin-client architecture**: the plugin talks to `/sdapi/v1/txt2img`,
  `/sdapi/v1/options`, and `/sdapi/v1/progress` over HTTP instead of running
  a model in-process. Model choice now lives entirely in the server app; the
  plugin sends generic parameters and shows the server's active model as a
  status hint.
- **Real negative prompt and CFG (guidance scale) controls** — previously
  impossible, since both old models (SD-Turbo, FLUX.2 klein 4B) were
  guidance-distilled and didn't support them meaningfully. Server-hosted
  models generally do.
- Generic **size** (7 curated aspect ratios), **steps** (1–50) and **CFG**
  (1–15) controls replace the old per-model catalog and its fixed
  SD-Turbo resolution / FLUX.2-only size dropdown.
- **Test connection** button in settings, checking reachability and
  reporting the server's active model.
- **Legacy-cache cleanup**: upgraders from pre-0.5 versions may still have
  ~2.5 GB of old SD-Turbo model weights cached in the browser's Cache API
  from the old in-process architecture. The plugin detects this once on
  load and shows a one-time notice; a new settings button deletes the
  cache in one click.

### Changed

- Generation history is preserved across the upgrade: existing entries are
  loaded with default values for the new fields (`negativePrompt: ""`,
  `cfg: 7`) rather than being discarded or breaking.
- Bundle size dropped from ~34 MB (including the bundled ONNX-runtime-web
  WASM runtime) to ~39.7 KB, since no inference runtime or model code ships
  with the plugin anymore.
- Confirmation dialogs now follow the shared UI convention (cancel on the
  left, standard button container).

### Removed

- SD-Turbo (ONNX/WebGPU) and FLUX.2 klein 4B (`mflux`) engines, the model
  catalog, and all associated settings (model download, `mflux` path, FLUX
  weights location).

### Fixed

- **Draw Things' model name is now detected.** Draw Things reports the active
  model under `model` in `/sdapi/v1/options`, while A1111, Forge and SD.Next
  use `sd_model_checkpoint`; only the latter was read. As a result the status
  hint stayed at "(chosen in server)" and — more importantly — every generated
  note got `model: unknown` in its frontmatter, the very field meant to make a
  recipe reproducible.

## [0.4.4] — 2026-07-23

### Changed
- **Settings sections no longer collapse.** They are all open now, separated by headings.
  This is a trade: collapsible sections and Obsidian's settings **search** (1.13+) are
  mutually exclusive, and search solves the underlying problem of a long page better — you
  no longer need to know which section holds a setting, you type its name. Your stored
  open/closed state is kept in the configuration and simply ignored. The collapsible groups
  in the history panel are unaffected.

## [0.4.3] — 2026-07-19

### Internal

- Popout-window-safe timers: `window.setTimeout`/`window.clearTimeout` throughout,
  and the `raceTimeout` helper moved into the obsidian layer (the core stays
  node-pure). Resolves the remaining `prefer-window-timers` review warnings.

## [0.4.2] — 2026-07-19

### Changed

- Renamed to **Local Image Generator** (title case) in the manifest, view title
  and docs.

### Internal

- Community-store review compliance: the manifest description no longer contains
  the word "Obsidian"; global `fetch`/`setTimeout`/`globalThis`/`document.createElement`
  were replaced with their popout-window-safe Obsidian equivalents where applicable
  (`activeWindow.fetch`, `createEl`, …); unnecessary type assertions removed.
- Added `eslint-plugin-obsidianmd` as a local lint gate (`npm run lint`) so
  store-review findings surface before submission instead of after.

## [0.4.1] — 2026-07-19

### Added

- First public release. Generate images locally inside Obsidian — no external
  server, no cloud, weights downloaded on explicit opt-in.
- **SD-Turbo** in-process via onnxruntime-web (WebGPU), bundled runtime, no code
  loaded at runtime.
- **FLUX.2 klein 4B** via a local `mflux` child process (user-installed), with
  selectable resolutions / aspect ratios and a cold-start hint in the status line.
- Model catalog driving the UI controls and engine dispatch — adding a model is a
  catalog entry, not a rewrite.
- Sidebar hub view with **Generate** and **History** tabs; history stores full
  recipes (prompt, seed, steps, model, size) with dedup and a Reroll button.
- Style presets (editable), seed control, prompt history.
- **Create as note** — result note with frontmatter (prompt/seed/steps/model/size)
  and an embedded image.
- Selectable output folder (with autocomplete) and selectable model storage
  location (`HF_HOME`).
- Robustness: per-file download progress that survives settings re-render, a
  distinct "loading model into GPU" status phase, a watchdog around session
  creation, and an `unhandledrejection` guard.
- Generate button gates on an unchanged recipe; Reroll stays independently active.
- Automatic DE/EN localization following Obsidian's UI language.
