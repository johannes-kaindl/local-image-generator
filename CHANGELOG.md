# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
