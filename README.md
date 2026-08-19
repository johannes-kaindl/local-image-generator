# Local Image Generator

Generate images inside Obsidian — on your own machine, with no cloud and no
account. Two ways to do it, chosen in the settings:

- **Built-in (default):** a small, fast model (SD-Turbo) runs **on your GPU
  inside Obsidian** via WebGPU. Nothing to install: click **Download model**
  once (≈ 2.5 GB, verified by checksum, stored outside your vault), then type
  a prompt and press Generate — an image in seconds.
- **Server:** a local image server you run yourself —
  [Draw Things](https://drawthings.ai/),
  [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui),
  [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge), or
  [SD.Next](https://github.com/vladmandic/sdnext) over their shared
  A1111-compatible HTTP API — with whatever models it has loaded, and the
  full set of controls (negative prompt, guidance, sizes).

Either way, your prompts and images never leave your machine.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/local-image-generator?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/local-image-generator/releases)
[![Obsidian](https://img.shields.io/badge/obsidian-1.8.7%2B-purple)](https://obsidian.md)

*Auch auf Deutsch verfügbar: [`README.de.md`](README.de.md).*

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/hero.png" alt="Obsidian with a generated image: the note in the middle shows the finished picture, the generator panel on the right holds the same result with its prompt, size, steps, guidance and seed." width="600">
</p>

## Features

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/generate-panel.png" alt="The generator panel in Obsidian's right sidebar: prompt and negative prompt fields, style chips, size, steps, guidance and seed controls, and a hint to connect a local image server." width="456">
</p>

- Open the generator from the ribbon icon or the **Open generator** command.
- Type a prompt, optionally a **negative prompt** (what to avoid), pick a
  **size** from 7 curated aspect ratios (square, portrait, landscape), and
  adjust **steps** (1–50), **CFG** (guidance scale, 1–15) and **seed** to
  taste. Click a style chip (Sumi-e, Watercolor, Photo, Oil — edit or add
  your own in settings) to append its look to the prompt; click again to
  remove it.
- **Generate** uses the seed from the field (it never rerolls) and greys
  itself out once the current prompt/negative prompt/seed/steps/size/CFG
  exactly match your last result — regenerating without changing anything
  would just reproduce the same image. **Reroll** rolls a fresh seed and
  generates a new variation regardless; use the dice icon to reroll the
  seed by hand without generating.
- Switch to the **History** tab to see your past generations as full recipes
  (prompt · negative prompt · seed · steps · size · CFG · time) — group them
  by prompt, click one to load its recipe back into Generate, delete single
  entries, or clear all.
- **Create** saves the image as a new attachment. By default that's all it
  does (it also opens the image) — set the **Create button** dropdown in
  settings to **Image + note** to have it also create a note with the
  generation's prompt, seed, steps, size and date in its frontmatter and the
  image embedded, and open that note instead. **Insert** always just saves
  the image and embeds it at your cursor in the current note.
- **Built-in engine:** SD-Turbo is a distilled model — 512 × 512, 1–4 steps,
  no guidance — so in this mode the panel shows only what the model honours:
  prompt, steps (1–4), seed and the style chips. Negative prompt, CFG and the
  size picker appear when you switch to a server.
- **Server:** which model actually runs is chosen in your server app (Draw
  Things, AUTOMATIC1111, etc.), not in this plugin — the plugin sends generic
  generation parameters and shows the server's active model name as a status
  hint.

The interface is available in English and German, switching automatically to
match Obsidian's own language setting — no separate language option to set.

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/style-chips.png" alt="The style chips under the prompt field: Sumi-e, Watercolor, Photo and Oil." width="380">
</p>

## Installation

1. Install and enable the plugin from Obsidian's Community Plugins browser
   (or manually — see
   [Releases](https://github.com/johannes-kaindl/local-image-generator/releases)).
2. **Built-in engine (default):** open the generator and click **Download
   model (2.5 GB)** — or do it from **Settings → Local Image Generator →
   Engine**. When the status says *Ready*, generate. That's the whole setup.
3. **Server instead?** Switch **Engine** to *Server (Draw Things / A1111)*,
   enter the server's URL in **Server endpoint**, and click **Test
   connection**.

### Setting up a server (optional)

Pick one — this plugin talks to any of them the same way:

**Draw Things** (macOS, easiest to get started with — no command line):
1. Install Draw Things from the Mac App Store.
2. In Draw Things' own settings, enable its **API Server**. The default
   address is `http://127.0.0.1:7860`.
3. Use that address as this plugin's **Server endpoint**.

**AUTOMATIC1111** (`stable-diffusion-webui`):
Launch it with the `--api` flag (e.g. add `--api` to `COMMANDLINE_ARGS`). It
serves the same API at `http://127.0.0.1:7860` by default.

**Forge** (`stable-diffusion-webui-forge`):
Same A1111-compatible API — launch with `--api`, same default address.

**SD.Next**:
Same A1111-compatible API family — check its docs for the equivalent launch
flag if the API isn't enabled by default.

In all four cases, once the server is running with its API reachable, enter
its URL in this plugin's settings and click **Test connection**. The status
line and settings both show the server's active model name once connected.

## Usage

1. Built-in engine: make sure the model is downloaded (the panel offers the
   button if it isn't). Server mode: make sure your image server (Draw
   Things, AUTOMATIC1111, Forge, or SD.Next) is running and its API is
   reachable — the panel tells you if it isn't.
2. Open the generator (ribbon icon or the **Open generator** command).
3. Type a prompt, adjust steps / seed (and, in server mode, negative prompt /
   size / CFG), and press **Generate**. The first image after an Obsidian
   start takes a few seconds longer with the built-in engine — the model is
   being loaded into the GPU; the status line counts along.
4. Use **Create** to save the image as a new attachment and open it, or
   **Insert** to save it and embed it at your cursor. Set the **Create
   button** dropdown to **Image + note** in settings first if you also want
   a note with the generation's details in its frontmatter.
5. Revisit past generations any time from the **History** tab.

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/history.png" alt="The History tab listing two runs, each with its prompt, seed, step count and time, sorted by recency." width="456">
</p>

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/result-note.png" alt="A result note: the recipe in its frontmatter — prompt, seed, steps, cfg, model, size and the image filename — followed by the embedded picture." width="496">
</p>

## Requirements

- **Obsidian desktop only** (`isDesktopOnly: true` — this plugin does not
  run on Obsidian Mobile).
- **Built-in engine:** a GPU that Obsidian's WebGPU can use with 16-bit
  shaders (`shader-f16`) — Apple Silicon Macs qualify, as do most current
  discrete GPUs — plus roughly 4 GB of free RAM while an image is being
  made and 2.5 GB of disk for the model. The panel tells you if the GPU
  does not qualify; the server mode is the way out then.
- **Server mode:** any A1111-compatible local image server, running and
  reachable — Draw Things, AUTOMATIC1111, Forge, or SD.Next. The server app
  owns the model, its hardware requirements and its own disk footprint.

## Configuration

<p align="center">
  <img src="https://git.jkaindl.de/jkaindl/local-image-generator/raw/branch/main/docs/images/settings.png" alt="The plugin settings: server endpoint with a test button, image and note folders, the Create button mode, default steps, and the editable list of style chips." width="515">
</p>

**Settings → Local Image Generator**:

- **Engine** — *Built-in (SD-Turbo)* or *Server (Draw Things / A1111)*.
  - Built-in shows the **model row**: size, license, status, and
    **Download** / **Cancel** / **Remove**. Nothing is downloaded until you
    click Download.
  - Server shows the **Server endpoint** — the URL of your local image
    server (e.g. `http://127.0.0.1:7860`), plus a **Test connection** button
    that checks reachability and reports the server's active model.
- **Output** — the image folder (leave empty to use Obsidian's attachment
  folder, with autocomplete for existing folders), the note folder used when
  Create makes a note (leave empty to put the note next to the image), the
  **Create button** dropdown (Image only or Image + note), and the starting
  value of the steps slider (1–50).
- **Styles** — the same style presets shown as chips under the prompt field.
  Edit a preset's label or prompt text, delete it, or add a new one.
- **Advanced → Download source** — the base URL the model files are fetched
  from. The default is this plugin's model repository on Hugging Face; point
  it at a mirror or a local server if you need to. Files already downloaded
  stay valid whatever the URL says.
- **Delete old SD-Turbo weights** (only shown if detected) — if you're
  upgrading from a pre-0.5 version of this plugin, which cached a different
  conversion of the model in the browser's Cache API, this row lets you
  delete those ~2.5 GB in one click. The 0.6 engine uses its own files and
  never reads the old ones.

## How it works

The plugin owns the interface — prompt, presets, history, where files land —
and one of two **backends** owns the generation:

**Built-in engine.** SD-Turbo runs inside Obsidian through
[onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/) on the WebGPU
backend. The model files are this plugin's **own ONNX conversion** of the
official `stabilityai/sd-turbo` weights (fp16 weights, fp32 inputs/outputs),
published in the plugin's model repository together with the license and a
notice; the conversion script is in `tools/convert/`. On first use after
Obsidian starts, the three sessions (text encoder, UNet, VAE decoder) are
loaded into the GPU — the status line counts the seconds — then each image
takes one text-encoder pass, 1–4 UNet steps and a VAE decode. The pipeline
(CLIP tokenizer, Euler-ancestral scheduler, seeded noise) is pure TypeScript
and unit-tested against fake sessions.

**Server.** A generation is one `POST /sdapi/v1/txt2img` against the endpoint
you configured, carrying nothing but the generic parameters shown in the panel
(prompt, negative prompt, size, steps, CFG, seed). While it runs, the panel
polls `GET /sdapi/v1/progress` once a second for a percentage — a server that
does not offer that endpoint (Draw Things answers 404) simply shows an
elapsed-time counter instead, and the plugin stops asking after the first 404.
The connection test and the model name in the status line come from
`GET /sdapi/v1/options`. All three calls go through Obsidian's own
`requestUrl`, which is not subject to browser CORS rules, and carry a short
timeout of their own: `requestUrl` knows neither abort nor timeout, so without
one an unreachable server would hang the panel forever rather than report
that it is unreachable.

Either way, the image is written into your vault as an ordinary attachment.
The recipe behind it (prompt, seed, steps, size, CFG, model, time) goes into
the plugin's local data file, which is what the History tab reads — the image
file itself carries no dependency on the plugin.

## How network and storage are used

**Out of the box the plugin downloads nothing.** The built-in engine needs its
model files, and it fetches them **once, only when you click Download** (in
the generator panel or in the settings), from this plugin's model repository
on Hugging Face:

| File | Size | What it is | License |
|---|---|---|---|
| `sd-turbo/text_encoder/model.onnx` | ≈ 681 MB | CLIP text encoder (fp16) | Stability AI Community License |
| `sd-turbo/unet/model.onnx` | ≈ 1.7 GB | UNet (fp16) | Stability AI Community License |
| `sd-turbo/vae_decoder/model.onnx` | ≈ 99 MB | VAE decoder (fp16) | Stability AI Community License |
| `sd-turbo/tokenizer/vocab.json`, `merges.txt` | ≈ 1.6 MB | CLIP BPE tokenizer data | (part of the model release) |
| `runtime/ort-<version>/ort-wasm-simd-threaded.asyncify.wasm` | ≈ 24 MB | ONNX Runtime Web (the same version the plugin is built against) | MIT |

Every file is checked against a SHA-256 pinned in the plugin before it is
used; a mismatch is discarded and reported. The files live in the browser's
Cache API inside Obsidian's profile — **outside your vault**, so they are
never synced — and **Remove** in the settings deletes them again. You can
cancel a download at any time; finished files are kept.

The download source is the only network connection the built-in engine makes.
In server mode, the only connection is to the server endpoint you configure,
and only when you generate, test the connection, or the panel polls progress.
No other network access, no telemetry.

- Prompts and generated images never leave your machine.
- Generated images are saved as normal attachments inside your vault, exactly
  like any image you'd add yourself. Generation history (prompts, seeds,
  settings) is stored in the plugin's own local data file, also on your
  machine.
- **Upgrading from before 0.5?** Those versions cached a different model
  conversion (~2.5 GB) in the Cache API. The 0.6 engine does not use it; the
  plugin shows a one-time notice if it finds it, and **Settings → Delete old
  SD-Turbo weights** removes it.

## Privacy

- **No telemetry.** The plugin does not collect, transmit, or phone home any
  usage data, prompts, or images.
- **No network access** other than (a) the model download you start yourself,
  from the download source shown in the settings, and (b) in server mode, the
  local server endpoint you configure. Nothing is fetched without your click.

## Model & licenses

- **Plugin code:** AGPL-3.0-or-later (see `LICENSE`).
- **Built-in model:** [SD-Turbo](https://huggingface.co/stabilityai/sd-turbo)
  by Stability AI, redistributed as this plugin's own ONNX conversion under
  the [Stability AI Community License](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md)
  — free for research, non-commercial and limited commercial use; read the
  license before using generated images commercially. *Powered by Stability
  AI.* The conversion is reproducible from the official weights with
  `tools/convert-sd-turbo.sh`; no third-party conversion is involved.
- **Server mode:** the model is whatever your server app has loaded — its
  license applies to the images it makes. Check its model card before using
  generated images, especially for commercial purposes.

## Roadmap

The two-backend design keeps both halves replaceable. Ideas under
consideration: a second built-in model with a friendlier license and nicer
output (an LCM-distilled SD 1.5, MIT) as another catalog entry; img2img
(most of the target servers already expose `/sdapi/v1/img2img` in the same
API family); and a small provider API so other community plugins can request
images through an already-configured backend without duplicating this
plugin's logic.

## License

AGPL-3.0-or-later — see [LICENSE](LICENSE). Model licensing is a separate
matter — see [Model & licenses](#model--licenses) above.
