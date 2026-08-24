---
license: other
license_name: stability-ai-community-license
license_link: https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md
base_model:
  - stabilityai/sd-turbo
  - stabilityai/sdxl-turbo
library_name: onnxruntime-web
tags:
  - onnx
  - stable-diffusion
  - sd-turbo
  - sdxl-turbo
  - webgpu
  - obsidian
pipeline_tag: text-to-image
---

# Local Image Generator — model assets

Asset repository for the Obsidian plugin **Local Image Generator**
(https://github.com/johannes-kaindl/local-image-generator). The plugin's built-in engine
downloads these files **only after the user clicks "Download"**, verifies each file against a
SHA-256 pinned in the plugin release, and stores them outside the vault.

Two models are hosted here, chosen from a dropdown in the plugin: **SD-Turbo** (≈ 2.5 GB,
512×512 only) and **SDXL-Turbo** (≈ 7.0 GB, up to 1024×1024). Both are the plugin's own ONNX
conversion of the respective official Stability AI weights — no third-party conversion is used.

## Contents

| Path | What it is |
|---|---|
| `sd-turbo/text_encoder/model.onnx` | CLIP text encoder, fp16 weights, fp32 inputs/outputs |
| `sd-turbo/unet/model.onnx` | UNet, fp16 weights, fp32 inputs/outputs (`timestep` is a 0-d float32 scalar) |
| `sd-turbo/vae_decoder/model.onnx` | VAE decoder, fp16 weights, fp32 inputs/outputs |
| `sd-turbo/tokenizer/vocab.json`, `merges.txt` | CLIP BPE tokenizer data |
| `sd-turbo/LICENSE.md`, `sd-turbo/NOTICE.md` | Stability AI Community License and attribution (SD-Turbo) |
| `sdxl-turbo/text_encoder/model.onnx` | CLIP-L text encoder (primary), fp16 weights, fp32 inputs/outputs |
| `sdxl-turbo/text_encoder_2/model.onnx` | OpenCLIP-bigG text encoder (secondary), fp16 weights, fp32 inputs/outputs |
| `sdxl-turbo/unet/model.onnx` + `unet/unet_*.onnx_data` | UNet (≈ 5.1 GB), fp16 weights, split across 13 external-data buckets — the model exceeds ONNX's and the browser's single-buffer limits |
| `sdxl-turbo/vae_decoder/model.onnx` | VAE decoder, fp16 weights, fp32 inputs/outputs |
| `sdxl-turbo/tokenizer/vocab.json`, `merges.txt` | Primary (CLIP-L) BPE tokenizer data |
| `sdxl-turbo/tokenizer_2/vocab.json`, `merges.txt` | Secondary (OpenCLIP-bigG) BPE tokenizer data |
| `sdxl-turbo/LICENSE.md`, `sdxl-turbo/NOTICE.md` | Stability AI Community License and attribution (SDXL-Turbo) |
| `runtime/ort-<version>/ort-wasm-simd-threaded.asyncify.wasm` | ONNX Runtime Web (MIT), the exact build the plugin version links against |

## Provenance

The ONNX files are the plugin's **own conversion** of the official
[`stabilityai/sd-turbo`](https://huggingface.co/stabilityai/sd-turbo) and
[`stabilityai/sdxl-turbo`](https://huggingface.co/stabilityai/sdxl-turbo) weights: `optimum`
ONNX export, then onnxruntime's float16 conversion with `keep_io_types=True` (SDXL-Turbo's
UNet additionally split across external-data buckets, see above). The script is
`tools/convert/convert_model.py` in the plugin repository; no third-party conversion is
used for either model. **Powered by Stability AI.**

## License

The model files are redistributed under the Stability AI Community License — see
[SD-Turbo's license](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md) and
[SDXL-Turbo's license](https://huggingface.co/stabilityai/sdxl-turbo/blob/main/LICENSE.md)
(research, non-commercial and limited commercial use free of charge — see the respective
license for the revenue threshold; each model's own `LICENSE.md`/`NOTICE.md` under its
subdirectory above is the one that actually applies to those files). The ONNX Runtime WASM is
MIT. The plugin itself is AGPL-3.0-or-later.
