# Local image generator

Generate images locally inside Obsidian — no cloud, no external app, no API key.
The plugin runs [SD-Turbo](https://huggingface.co/stabilityai/sd-turbo) entirely
on your own GPU via WebGPU, using [onnxruntime-web](https://github.com/microsoft/onnxruntime)
as the inference engine.

## What it does

- Open the generator from the ribbon icon or the **Open generator** command.
- Type a prompt, adjust steps/seed if you like, and press **Generate**. Click
  a style chip (Sumi-e, Watercolor, Photo, Oil — edit or add your own in
  settings) to append its look to the prompt; click again to remove it.
- **Generate** uses the seed from the field (it never rerolls); **Reroll**
  rolls a fresh seed and generates a new variation. Use the dice icon to reroll
  the seed by hand.
- Switch to the **History** tab to see your past generations as full recipes
  (prompt · seed · steps · time) — group them by prompt, click one to load its
  recipe back into Generate, delete single entries, or clear all.
- **Create** saves the image as a new attachment. By default that's all it
  does (it also opens the image) — set the **Create button** dropdown in
  settings to **Image + note** to have it also create a note with the
  generation's prompt, seed, steps and date in its frontmatter and the image
  embedded, and open that note instead. **Insert** always just saves the
  image and embeds it at your cursor in the current note.

There is no img2img, no LoRA/ControlNet, and no model catalog in this version —
just one curated model (SD-Turbo) for fast local text-to-image generation.

Output resolution is fixed at **512×512**: SD-Turbo is distilled for exactly
that resolution and 1–4 steps, so there's no slider for it.

## Requirements

- **Obsidian desktop only** (`isDesktopOnly: true` — this plugin does not run
  on Obsidian Mobile).
- **WebGPU with `shader-f16` support.** This generally works on macOS and
  Windows with a reasonably modern GPU; on Linux it depends on your graphics
  driver. If your system doesn't qualify, the plugin's status area tells you
  so instead of generating.
- **~2.5 GB of disk space** for the model download (see below).
- **Roughly 4–7 GB of free memory** while an image is generating. If
  generation fails, try closing other apps first.

## Install & first steps

1. Install and enable the plugin.
2. Open **Settings → Local image generator** and click **Download**
   (~2.5 GB). This is a one-time download; nothing happens automatically.
3. Once the download finishes, open the generator (ribbon icon or the
   **Open generator** command), enter a prompt, and press **Generate**.
4. Use **Create** to save the image as a new attachment and open it, or
   **Insert** to save it and embed it at your cursor. Set the **Create
   button** dropdown to **Image + note** in settings first if you also want
   a note with the generation's details.

You can re-download or delete the model at any time from the same settings
page.

## Settings

**Settings → Local image generator** is grouped into collapsible sections:

- **Model** — download the SD-Turbo model files.
- **Output** — the image folder (leave empty to use Obsidian's attachment
  folder, with autocomplete for existing folders), the note folder used when
  Create makes a note (leave empty to put the note next to the image), the
  **Create button** dropdown (Image only or Image + note), and the starting
  value of the steps slider.
- **Styles** — the same style presets shown as chips under the prompt field.
  Edit a preset's label or prompt text, delete it, or add a new one.
- **Danger zone** — delete the downloaded model files.

## How network and storage are used

This section is here so you know exactly what the plugin does over the
network and what it writes to disk — nothing beyond what's listed here
happens.

**Network — only on explicit user action ("Download" in settings).** The
plugin fetches five files, once, from Hugging Face:

| URL | Approx. size |
| --- | --- |
| `https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/text_encoder/model.onnx` | ~681 MB |
| `https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/unet/model.onnx` | ~1.73 GB |
| `https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/vae_decoder/model.onnx` | ~99 MB |
| `https://huggingface.co/stabilityai/sd-turbo/resolve/main/tokenizer/vocab.json` | ~1.1 MB |
| `https://huggingface.co/stabilityai/sd-turbo/resolve/main/tokenizer/merges.txt` | ~0.5 MB |

Total download: **~2.5 GB**. This download only happens when you click
**Download** in settings — the plugin makes no network requests at startup,
during editing, or at any other time. Files that are already present are
skipped, and each file's integrity is checked against its expected size.
After the download, image generation itself is fully offline: your prompts
never leave your machine, and no image data is ever sent anywhere.

**Storage.** Downloaded model files are written to the browser's
[Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache) inside
Obsidian's Electron profile — **not** into your vault, and not synced by
Obsidian Sync or any vault sync tool. You can delete the cached model files
at any time via **Settings → Local image generator → Delete model**.
Generated images, by contrast, are saved as normal attachments inside your
vault, exactly like any image you'd add yourself.

The WebAssembly runtime (onnxruntime-web) is bundled inline with the plugin;
no plugin code is loaded from the network at runtime.

## Privacy

- **No telemetry.** The plugin does not collect, transmit, or phone home any
  usage data, prompts, or images.
- **No network access** other than the one-time, user-initiated model
  download described above. Once the model is downloaded, generation runs
  entirely on your GPU, offline.

## Model & licenses

- **Plugin code:** MIT license (see `LICENSE`).
- **Model weights:** [stabilityai/sd-turbo](https://huggingface.co/stabilityai/sd-turbo)
  — subject to Stability AI's model license. Please review the terms on the
  model card before using generated images, especially for commercial
  purposes.
- **ONNX export used by this plugin:** [schmuell/sd-turbo-ort-web](https://huggingface.co/schmuell/sd-turbo-ort-web),
  the reference export used by Microsoft's WebGPU demo for onnxruntime-web.
- **Inference engine:** [onnxruntime-web](https://github.com/microsoft/onnxruntime).

This plugin only distributes code; the model weights are downloaded directly
from Hugging Face by the user, on demand.

## Roadmap

This plugin currently offers a single generator view with one curated model.
A future release is planned to expose a small provider API so other
community plugins can request locally-generated images without duplicating
this infrastructure. Additional backends (e.g. ComfyUI/DrawThings), img2img,
LoRA/ControlNet, and a model catalog are explicitly out of scope for now.

## License

MIT — see [LICENSE](LICENSE). Model weights have their own license terms
(see Model & licenses above).
