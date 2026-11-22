# ComfyUI reference workflows

API-format workflows (ComfyUI → Workflow → Export (API)) that local-image-generator uses in ComfyUI mode. Put them in the workflow folder set in the plugin settings; the plugin reads every `.json` file there and recognizes its role from the graph (generate, edit, upscale). `tools/vault-abgleich.mjs` copies this folder into your vaults (setup: `../README.md`). The files are also the fixtures of `tests/comfy-roles.test.ts`, so a change here is a change to the tests.

JSON carries no comments, so the provenance of each file is here. Model files are those of a ComfyUI 0.43 install with FLUX.3 klein (distilled, int8), SDXL base 1.0 and the 4x-UltraSharp upscaler; a workflow whose model is missing on the server fails at `/prompt` with ComfyUI's own message.

| File | Role | Source (2026-11-22) | Changes | Models |
|---|---|---|---|---|
| `flux3-klein.api.json` | generate | `apps/outpost-worldbuilding/workflows/flux3_klein_api.json` | prompt text, `filename_prefix` | `flux3-image-klein-int8-convrot.safetensors`, `qwen3vl_4b_int8_convrot.safetensors`, `flux2-vae_bfl.safetensors` |
| `sdxl-base.api.json` | generate | `apps/outpost-worldbuilding/workflows/sdxl_base_api.json` | `filename_prefix` | `sd_xl_base_1.0.safetensors` |
| `sdxl-pixel-art.api.json` | generate | `apps/outpost-worldbuilding/workflows/sdxl_with_lora_api.json` | `lora_name` set to `pixel-art-xl.safetensors`, prompt starts with `pixel art,`, negative `blurry, photo, 3d render`, `filename_prefix` | as SDXL plus `pixel-art-xl.safetensors` |
| `flux3-klein-edit.api.json` | edit | ComfyUI template `image_flux3_klein_distilled_image_edit`, as adapted and measured in `infra/comfyui` (`docs/how-to/bild-bearbeiten.md`, export `edit_flux3.json`) | removed the prompt upsampler (`TextGenerate`, its `CLIPLoader`, `PrimitiveStringMultiline`, `BatchImagesNode`, `ComfySwitchNode`, both `PreviewAny`), the layout prompt and bounding-box editor (`Flux3LayoutPrompt`, `CreateBoundingBoxes`), `ImageCompare` and an unused `EmptyFlux2LatentImage`; the instruction is a literal in `CLIPTextEncode` (node 4); `LoadImage` points at `PLACEHOLDER.png`, the plugin uploads the init image and sets it | as FLUX.3 klein |
| `upscale-4x-ultrasharp.api.json` | upscale | `infra/comfyui` measurement `upscale_ultrasharp_mitscale.json` | `LoadImage` on `PLACEHOLDER.png`, `filename_prefix`; the `ImageScale` before the upscaler stays — without it the result is horizontal stripes on Apple GPUs (MPS), and the plugin sets its width and height to the init image's | `4x-UltraSharp.pth` |

Not included on purpose: Z-Image Turbo (the model is being removed from the server), SDXL img2img and ControlNet workflows (the plugin rejects them in this version and says so in the settings).
