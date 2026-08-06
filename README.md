# Local Image Generator

A prompt/preset/history front end for image generation inside Obsidian, backed
by a local image server you run yourself. This plugin does not generate images
on its own — it talks to [Draw Things](https://drawthings.ai/),
[AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui),
[Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge), or
[SD.Next](https://github.com/vladmandic/sdnext) over their shared
A1111-compatible HTTP API. Everything stays on your machine: your prompts and
images travel between two local processes you control — Obsidian and your
image server — and nowhere else.

## What it does

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
- Which model actually runs is chosen in your server app (Draw Things,
  AUTOMATIC1111, etc.), not in this plugin — the plugin sends generic
  generation parameters and shows the server's active model name as a status
  hint.

The interface is available in English and German, switching automatically to
match Obsidian's own language setting — no separate language option to set.

## Installation

1. Install and enable the plugin from Obsidian's Community Plugins browser
   (or manually — see
   [Releases](https://github.com/johannes-kaindl/local-image-generator/releases)).
2. Set up a local image server (see below) and note its URL.
3. Open **Settings → Local Image Generator**, enter that URL in **Server
   endpoint**, and click **Test connection** to confirm the plugin can reach
   it.

### Setting up a server

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

1. Make sure your image server (Draw Things, AUTOMATIC1111, Forge, or
   SD.Next) is running and its API is reachable — the generator panel tells
   you if it isn't.
2. Open the generator (ribbon icon or the **Open generator** command).
3. Type a prompt (and, optionally, a negative prompt), adjust size / steps /
   CFG / seed, and press **Generate**.
4. Use **Create** to save the image as a new attachment and open it, or
   **Insert** to save it and embed it at your cursor. Set the **Create
   button** dropdown to **Image + note** in settings first if you also want
   a note with the generation's details in its frontmatter.
5. Revisit past generations any time from the **History** tab.

## Requirements

- **Obsidian desktop only** (`isDesktopOnly: true` — this plugin does not
  run on Obsidian Mobile).
- Any A1111-compatible local image server, running and reachable — Draw
  Things, AUTOMATIC1111, Forge, or SD.Next (see [Installation](#installation)
  above). This plugin does not generate images by itself and does not bundle
  or download any model weights; the server app you run owns the model,
  its hardware requirements, and its own disk footprint.

## Settings

**Settings → Local Image Generator**:

- **Server endpoint** — the URL of your local image server (e.g.
  `http://127.0.0.1:7860`), plus a **Test connection** button that checks
  reachability and reports the server's active model.
- **Output** — the image folder (leave empty to use Obsidian's attachment
  folder, with autocomplete for existing folders), the note folder used when
  Create makes a note (leave empty to put the note next to the image), the
  **Create button** dropdown (Image only or Image + note), and the starting
  value of the steps slider (1–50).
- **Styles** — the same style presets shown as chips under the prompt field.
  Edit a preset's label or prompt text, delete it, or add a new one.
- **Delete old SD-Turbo weights** (only shown if detected) — if you're
  upgrading from a pre-0.5 version of this plugin, which generated images
  in-process and cached its own model weights (~2.5 GB) in the browser's
  Cache API, this row lets you delete them in one click. They serve no
  purpose anymore since generation moved to your external server. See
  [How network and storage are used](#how-network-and-storage-are-used).

## How network and storage are used

- **The only network connection this plugin makes is to the server endpoint
  you configure yourself**, and only when you generate an image, test the
  connection, or the panel polls generation progress. No other network
  access, no telemetry, and no downloads of any kind — the plugin never
  downloads model weights or any other data; that's entirely your server
  app's job, outside this plugin's control.
- Prompts and generated images never leave your machine — they're exchanged
  between two local processes (Obsidian and your server app), not sent to
  any remote service.
- Generated images are saved as normal attachments inside your vault, exactly
  like any image you'd add yourself. Generation history (prompts, seeds,
  settings) is stored in the plugin's own local data file, also on your
  machine.
- **Upgrading from before 0.5?** Earlier versions ran an image model
  in-process and cached roughly 2.5 GB of model weights in the browser's
  Cache API. That cache is now unused. On load, the plugin checks for it
  once and shows a one-time notice if found; you can delete it any time
  from **Settings → Local Image Generator**.

## Privacy

- **No telemetry.** The plugin does not collect, transmit, or phone home any
  usage data, prompts, or images.
- **No network access** other than the local server endpoint you configure
  yourself. This plugin never downloads anything on its own.

## Model & licenses

- **Plugin code:** AGPL-3.0-or-later (see `LICENSE`).
- **Models and their licenses:** this plugin does not bundle, download, or
  choose any model — that's entirely up to the server app you run and the
  model you load into it. Generated images may be subject to that model's
  own license terms; check its model card before using generated images,
  especially for commercial purposes.

## Roadmap

The thin-client architecture — generic prompt/negative-prompt/size/steps/CFG
controls talking to an A1111-compatible HTTP API — is deliberately not tied
to any one server or model, so it's positioned to grow without another
rewrite. Ideas under consideration: img2img (most of the target servers
already expose `/sdapi/v1/img2img` in the same API family), and a small
provider API so other community plugins can request images through an
already-configured server without duplicating this plugin's connection
logic.

## License

AGPL-3.0-or-later — see [LICENSE](LICENSE). Model licensing is a separate
matter — see [Model & licenses](#model--licenses) above.
