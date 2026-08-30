# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.10.0] — 2026-08-30

### Added

- **`api.recheck()` for consuming plugins.** `status()` is synchronous and makes no network
  call, so a server that comes up *after* Obsidian started leaves it reporting a stale
  `unreachable` — and `generate()` refusing — until the user reopens the panel. `recheck()`
  makes one network call and returns the fresh status, which lets a consumer recover on its
  own. Additive, so `apiVersion` stays `1`; in built-in mode it is deliberately a no-op that
  returns the current status, because there is no remote state that could have changed.

## [0.9.0] — 2026-08-25

### Added

- **SDXL-Turbo as a second built-in model**, alongside SD-Turbo, chosen from a dropdown in
  the settings and in the generator panel — sharper output, up to 1024×1024, at the cost of
  a larger download (≈ 7.0 GB) and a higher GPU-memory peak during loading (≈ 13 GB). The
  panel's size picker now offers whichever sizes the active model actually supports; the
  four-session pipeline (two text encoders, UNet, VAE decoder) and its own tokenizer pair
  are this plugin's own ONNX conversion of the official `stabilityai/sdxl-turbo` weights.
- A confirmation dialog before downloading any model other than the default, naming its
  size and the peak-memory note above — cancelling starts no download.
- The model's UNet (≈ 5.1 GB) exceeds both ONNX's and the browser's single-file/single-buffer
  limits, so the conversion pipeline now stripes it across 13 external-data buckets
  (`tools/convert/split_external_data.py`) that the engine reassembles at load.

### Fixed

- **SDXL-Turbo produced a pure black image, with no error.** Its VAE decoder's activations
  exceed fp16's range under the WebGPU execution provider (max 65504 → Inf → NaN in the
  entire output), which renders as solid black — a valid PNG at the right size, so nothing
  else in the pipeline noticed. The CPU execution provider doesn't show this at all, which
  is why it stayed hidden through Node-side testing. The VAE decoder now ships in fp32 while
  everything else in the model stays fp16 (+99 MB, 198 MB vs. 99 MB; a few hundred
  milliseconds slower per image). A new, deliberately expensive smoke check now generates a
  real image with SDXL-Turbo and asserts it isn't a uniform color, so a similar precision
  regression fails loudly instead of shipping silently.
- **The panel understated an SDXL-Turbo download by 4.5 GB.** The "not downloaded" empty
  state and its download button always sized and named themselves after the *default*
  model (SD-Turbo, 2.5 GB), never the one actually selected — with SDXL-Turbo chosen and
  not yet cached, the button read "Download model (2.5 GB)" and fetched 7.0 GB. Both now
  read the selected model.
- A session build that fails with a recognizable out-of-memory signal now shows a readable
  status-line message ("not enough memory for this model") instead of the raw runtime error.
  The classifier is a best-effort heuristic over the error text (no reliable in-browser OOM
  signal is measured for the WebGPU path, only a neighboring WASM-EP case); when it misses,
  the previous raw-message behavior applies unchanged — never a stuck spinner either way,
  since any failed session build already surfaced as an error before this change.
- **A session build that never resolves or rejects** (the historical jsep/asyncify silent
  hang that motivated this plugin's watchdog in the first place) now fails after 5 minutes
  with a readable status-line message, instead of leaving the panel stuck on "Loading
  model into GPU…" forever. Together with the previous two entries this closes the
  two-backend design's robustness section (§8) in full.
- `npm run assets:upload`'s precondition now checks that **both** catalog models are present
  in `dist-assets/` before uploading, not just SD-Turbo.

## [0.8.0] — 2026-08-23

### Added

- **Start from an existing image (img2img)** in server mode: choose a reference image from
  your vault, or turn a result you just made into one with **Save & use as reference**, and
  set how far the model may move away from it. Result notes record `denoising` and link the
  reference; the History tab restores both — but only if the reference file still exists, so
  a recipe never silently comes back as a plain text-to-image run.
- The reference row is absent in built-in mode, where SD-Turbo cannot do it, and the strength
  slider only appears once a reference is actually set.
- Plugin API: `generate()` accepts `initImage` (base64) and `denoising`,
  `status().capabilities.initImage` says whether the active backend can honour them, and the
  returned params carry `denoising`. This is additive — `apiVersion` stays `1`.

### Fixed

- A run started by *another* plugin that fails no longer appears in the panel as if your own
  generation had failed. The status line simply returns to idle — the same way it already did
  when someone else's run succeeded. The calling plugin receives the error and reports it.
- The plugin API's `save()` now refuses parameters whose timestamp or seed it cannot read,
  instead of building a file name out of them. A misbehaving consumer can no longer shape a
  vault path like `lig-NaNNaNNaN-NaNNaNNaN-s7.png`.

## [0.7.0] — 2026-08-22

### Added

- Provider-API for other Obsidian plugins: `status()`, `generate()`, `save()` via
  `app.plugins.plugins["local-image-generator"].api` (version 1). Generation and vault
  writes are separate calls, so a consumer can show the image before asking to save it.
- A run started by another plugin is now visible in the panel and blocks Generate while
  it lasts; its result stays out of your image view and history.

### Changed

- The timestamp on a generated image is now set at the start of the run, not at the end.
  This means the creation time in a result note, the history entry, and the filename carry
  the moment the generation was **requested**, not the moment it finished — in server mode
  that is seconds, in built-in mode it can be minutes. The change ensures the panel and
  the plugin API report the same timestamp, since both use the same hardening source.

## [0.6.1] — 2026-08-21

### Changed

- The built-in model is now downloaded from `huggingface.co/johannes-kaindl/local-image-generator-models`
  — the same name as the plugin's author profile on GitHub, so the source of a 2.5 GB
  download can be matched against the person who publishes the plugin. Existing installs
  keep the repository they were configured with and are unaffected; the previous location
  stays online. You can point `Download source` anywhere, and files already downloaded stay
  valid either way — they are keyed by checksum, not by URL.
- The hub's tab bar (Generate / History) now follows the shared kit styling: tabs size
  themselves to their labels and wrap instead of shrinking, the active one is marked by an
  underline and a hover state instead of bold text, and the spacing comes from the theme's
  own variables rather than fixed pixels.
- Each panel now scrolls on its own instead of scrolling the whole view.
- The tabs follow the ARIA tabs pattern: Left/Right/Home/End move between them, and only
  the active tab is a tab stop — reaching the inactive one now uses the arrow keys instead
  of Tab.

### Fixed

- With the built-in engine, the **negative prompt field was still shown** even though
  SD-Turbo ignores it — an input that did nothing. The panel had marked the row as hidden
  all along; a later stylesheet rule silently won over the one that hides it. CFG and the
  size picker were unaffected, which is why this looked like a deliberate choice rather
  than a bug.
- With the built-in engine, the **step count next to the slider could read 20** while the
  slider sat at its maximum of 4 and generation correctly used 4. Only the label was wrong,
  but it contradicted both the slider and the result.
- A cancelled or restarted model download could write a partial file back into the cache:
  the cache entry was deleted while the write for it was still in flight. The delete now
  waits for that write to settle.
- Cancelling a download no longer risks hanging: the cancel waited on a stream branch that
  only resolves once the other branch is cancelled too.
- A cancel that arrives between two chunks is now seen right away instead of surfacing only
  when the stall timeout hits.
- A truncated download is now reported as `download incomplete` rather than as a checksum
  mismatch, and the size is checked against the server's `content-length` as well as against
  the size pinned in the plugin.
- A workspace layout holding an unknown tab id left the hub blank (every panel hidden). An
  unknown id is now ignored.

### Internal

- Four local modules were replaced by their obsidian-kit 0.27.0 originals (settings schema,
  SHA-256, the cache streaming core, the hub) via `tools/sync-kit.sh`. The behaviour changes
  above are what those originals brought with them; none of them was covered by an existing
  test.

## [0.6.0] — 2026-08-19

### Added

- **The built-in engine is back — without any external software.** A new **Engine**
  setting chooses between *Built-in (SD-Turbo)* and *Server (Draw Things / A1111)*.
  Built-in is the default for new installs: SD-Turbo runs on your GPU inside Obsidian
  through onnxruntime-web/WebGPU. The model (≈ 2.5 GB: text encoder, UNet, VAE decoder,
  tokenizer) plus the ONNX Runtime WASM are downloaded **only when you click Download**
  — from the panel or the settings — streamed into the browser's Cache API outside your
  vault, and every file is verified against a SHA-256 pinned in the plugin before use.
  Cancel keeps finished files; **Remove** deletes them all. The model files are the
  plugin's **own ONNX conversion** of the official `stabilityai/sd-turbo` weights (fp16
  weights, fp32 inputs/outputs; `tools/convert-sd-turbo.sh`, reproducible, no
  third-party conversion) under the Stability AI Community License, published in the
  plugin's model repository on Hugging Face together with license and notice.
  Measured on an M5 Pro: first image 19.5 s (8 s of that is loading the model into
  the GPU, shown as its own phase), warm images in about 10 s.
- In built-in mode the panel shows only what SD-Turbo honours — prompt, steps (1–4),
  seed, style chips — and hides negative prompt, CFG and the size picker; the result
  note records `model: sd-turbo`, `cfg: 1` and 512 × 512. Switching to a server brings
  the full controls back.
- **Advanced → Download source** lets you point the model download at a mirror or a
  local server; downloaded files stay valid regardless of the URL.
- Existing 0.5 users with a server endpoint configured stay in server mode after the
  update; everyone else starts with the built-in engine.
- The GUI smoke gained four checks for the built-in engine (mode switch, download via
  the panel button, image + note with `model: sd-turbo`, switching back) — run against
  a local asset server (`npm run smoke:assets`) with the plugin's own conversion.
- The README now shows the plugin instead of describing it: a full-window shot with a
  generated image, the generator panel, the style chips, the history list, a result note
  with its recipe in the frontmatter, and the settings tab. All six are produced by
  `npm run shots`, a tracked recipe that drives a running Obsidian — not by hand, so they
  can be renewed when the UI changes. The three motifs that show a generated image were
  recorded against a real image server with fixed seeds, so a second run yields the same
  pictures.

### Changed

- The progress poll stops asking after the first `404` on `/sdapi/v1/progress`. Draw Things
  does not implement that endpoint, so on a four-minute FLUX run the plugin fired roughly
  240 requests that were guaranteed to fail — against a server busy rendering. The status
  line still counts seconds; a timeout or a `5xx` is treated as transient and keeps polling.
- Internal: the GUI smoke driver no longer dies on a missing image server. It probes
  reachability up front and says what is missing; `--quick` then runs the checks that do not
  need a server and lists the rest as skipped rather than failed. A server that answers
  *wrongly* is still an abort — that is a finding, not a missing prerequisite.

### Fixed

- Internal: two smoke checks treated a reported failure as progress. Check 5 ("a run starts
  visibly") only tested "status text is not Ready", which an error message satisfies, and
  check 7 waited out its full deadline — twenty minutes in the run that surfaced this —
  while the reason sat in the status line the whole time. Both now have a second exit: a
  failure the plugin reports is quoted, not waited out.
- Internal: the settings-search check (12) could not detect the very defect it was written
  for. It treated a missing `getSettingDefinitions()` as "skipped", and its type guard was
  dead code — Obsidian 1.13 supplies the method on `PluginSettingTab` itself, so the check
  was always true. It now tests whether the plugin defines it, and reports a miss as red.

## [0.5.2] — 2026-08-14

### Changed

- Internal: the two HTTP helpers share one `withTimeout` from the bundled kit
  instead of each carrying its own `Promise.race`. No behaviour change.
- Internal: the release script now refuses to build unless `HEAD` sits on the
  tag being released and the tree is clean — a build from a moved working tree
  can otherwise ship code the tag does not contain.

### Note

- The `main.js` asset of the 0.5.1 GitHub release was replaced shortly after
  publication. The original upload had been built from a working tree that had
  moved past the tag, so it contained code absent from `0.5.1`. The replacement
  is a clean `npm ci` build of the tagged source, byte-identical under Node 20
  and Node 24. The Forgejo release was unaffected.

## [0.5.1] — 2026-08-06

### Changed

- **Settings now appear in Obsidian's settings search** (1.13 and later). The
  settings tab was migrated to the declarative settings API: a single
  `getSettingDefinitions()` describes every row, and the classic imperative
  renderer draws that same structure as a fallback for Obsidian 1.8.7–1.12.
  Nothing about the visible settings changes; they just became findable by
  typing their name instead of only by opening the tab. This was the one
  warning that kept the 0.5.0 store review at "Satisfactory" instead of
  "Passed".
- The two folder fields (image output, note output) use Obsidian's own folder
  suggester on 1.13 and later, and the plugin's bundled one below that.

## [0.5.0] — 2026-08-06

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
