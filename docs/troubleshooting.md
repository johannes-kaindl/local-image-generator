# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text — then the cause and what to do. If yours is not here, see [Getting help](#getting-help).

## The model is not downloaded

> The built-in model (SD-Turbo, …) is not downloaded yet. Nothing is downloaded before you click.

**Cause:** the built-in engine needs its model files, and the plugin never fetches them on its own.

**Fix:** click **Download model** in the panel, or use the model row under **Settings → Local Image Generator → Engine**. If the panel says the model is *partly downloaded*, the button reads **Download the missing …** and fetches only what is left.

## Checksum mismatch

> Checksum mismatch for … — the file was discarded. Try the download again.

**Cause:** a downloaded file did not match the checksum pinned in the plugin, so it was thrown away. Usually a broken connection or a mirror that serves a different file.

**Fix:** click the download button again; finished, valid files are kept. If you changed **Download source** under **Advanced**, set it back to the default and try again.

## The built-in engine is unavailable

> WebGPU is not available in this Obsidian — use a server (settings)

> The GPU has no shader-f16 — use a server (settings)

**Cause:** the built-in engine needs WebGPU with 16-bit shaders. Apple Silicon Macs and most current discrete GPUs have it; older or virtualised GPUs do not.

**Fix:** switch **Engine** to **Server (Draw Things / A1111)** or **ComfyUI (your workflow)** under **Settings → Local Image Generator**.

## Not enough memory

> Not enough memory for this model — free up GPU memory or switch to a server backend.

**Cause:** the model does not fit. SDXL-Turbo needs roughly 13 GB at its peak while the session is built; SD-Turbo about 4 GB.

**Fix:** close other GPU-heavy apps, or choose the smaller model (SD-Turbo) under **Model**, or use a server.

## Loading the model takes forever

> Loading the model into the GPU is taking unusually long or got stuck silently. Click Generate to try again.

**Cause:** the plugin stops waiting after five minutes, because the runtime offers no way to cancel a stuck load.

**Fix:** click **Generate** again. If it keeps happening, restart Obsidian and retry.

## Server unreachable

> Server unreachable — is the API enabled?

**Cause:** in server mode nothing answered at the **Server endpoint**. The server app is not running, its API is off, or the address is wrong.

**Fix:** start the server and enable its API (Draw Things: switch on the API server in its settings; AUTOMATIC1111 and Forge: launch with `--api`). Then press **Test connection** in the settings, or **Retry** in the panel. A server that is up shows "Server OK — model: …".

## No ComfyUI at this address

> No ComfyUI at this address (default port 8188, or 8000 in the ComfyUI desktop app) — is it running?

**Cause:** the endpoint is shared between Server and ComfyUI mode. An address left over from Draw Things or AUTOMATIC1111 answers, but not with ComfyUI's API.

**Fix:** enter the address of your ComfyUI server under **ComfyUI endpoint**: `http://127.0.0.1:8188`, or `http://127.0.0.1:8000` in the ComfyUI desktop app.

## The workflow is not accepted

The **Workflow folder** holds workflows exported from ComfyUI in API format (`.json`). The settings list every file with its role — generate, edit or upscale — or with the reason it is not usable:

| Message | Cause and fix |
|---|---|
| The file is not valid JSON. | The file is damaged or not a workflow. Export it again. |
| Not a workflow: expected an object of nodes. Export from ComfyUI with 'Save (API format)', not the normal save. | Use **Save (API format)** in ComfyUI. |
| No sampler found — no node takes positive, negative and latent_image together. | The plugin looks for one sampler node; without it there is nothing to fill in. |
| Several samplers found (…). Refiner chains aren't supported — the plugin can't tell which one to fill in. | Reduce the workflow to a single sampler. |
| This sampler has no steps field … | Use a sampler with a `steps` field (for example KSampler). |
| The latent node carries no width/height … Use EmptyLatentImage as the sampler's latent_image. | Feed the sampler from an **EmptyLatentImage** node. |
| Several image inputs found (…). | An edit or upscale workflow takes exactly one **Load Image** node — the plugin fills it with the template image. |
| The image reaches the sampler through VAEEncode (img2img with denoise). … | img2img with denoise isn't supported in ComfyUI mode yet. For editing by instruction use an edit workflow such as `flux3-klein-edit.api.json`. |
| ControlNet workflows aren't supported yet. | Remove the ControlNet nodes, or use the workflow outside the plugin. |
| The image input doesn't reach the sampler's latent_image … | The **Load Image** node is not connected to what the sampler renders from. |
| No text node feeds the sampler's positive input … | Connect a **CLIP Text Encode** node to the sampler's positive input (through the reference node in an edit workflow). |
| Several text nodes feed the sampler's positive input (…). … | Edit workflows with their own negative prompt aren't supported; use a zeroed negative (**ConditioningZeroOut**). |
| An image input without a sampler or an upscale model … | An upscale workflow needs **Load Upscale Model** and **Upscale Image (using Model)**. |

An upscale workflow without an **Upscale Image** (`ImageScale`) node between **Load Image** and the upscaler is accepted, but the settings warn: on Apple GPUs the result comes out as horizontal stripes. Put the node in with the image's own size; the plugin sets its width and height to the template image's.

"Workflow folder not found: …" means the folder was moved or deleted; pick it again in the settings. "No valid edit workflow in the workflow folder" (or generate, upscale) means the folder has no usable file for the task chosen in the panel.

## Nothing happens when I press Generate

> Not possible while an image is being generated — wait for it to finish.

**Cause:** only one image is made at a time — by this panel or by another plugin using the generator (the status line then reads "Another plugin is generating an image…").

**Fix:** wait for the running image to finish.

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/local-image-generator/issues) with your Obsidian version, the plugin version (Settings → Community plugins) and what you expected to happen.
