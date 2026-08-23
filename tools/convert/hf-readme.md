---
license: other
license_name: stability-ai-community-license
license_link: https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md
base_model: stabilityai/sd-turbo
library_name: onnxruntime-web
tags:
  - onnx
  - stable-diffusion
  - sd-turbo
  - webgpu
  - obsidian
pipeline_tag: text-to-image
---

# Local Image Generator — model assets

Asset repository for the Obsidian plugin **Local Image Generator**
(https://github.com/johannes-kaindl/local-image-generator). The plugin's built-in engine
downloads these files **only after the user clicks "Download"**, verifies each file against a
SHA-256 pinned in the plugin release, and stores them outside the vault.

## Contents

| Path | What it is |
|---|---|
| `sd-turbo/text_encoder/model.onnx` | CLIP text encoder, fp16 weights, fp32 inputs/outputs |
| `sd-turbo/unet/model.onnx` | UNet, fp16 weights, fp32 inputs/outputs (`timestep` is a 0-d float32 scalar) |
| `sd-turbo/vae_decoder/model.onnx` | VAE decoder, fp16 weights, fp32 inputs/outputs |
| `sd-turbo/tokenizer/vocab.json`, `merges.txt` | CLIP BPE tokenizer data |
| `sd-turbo/LICENSE.md`, `sd-turbo/NOTICE.md` | Stability AI Community License and attribution |
| `runtime/ort-<version>/ort-wasm-simd-threaded.asyncify.wasm` | ONNX Runtime Web (MIT), the exact build the plugin version links against |

## Provenance

The ONNX files are the plugin's **own conversion** of the official
[`stabilityai/sd-turbo`](https://huggingface.co/stabilityai/sd-turbo) weights: `optimum`
ONNX export, then onnxruntime's float16 conversion with `keep_io_types=True`. The script is
`tools/convert/convert_model.py` in the plugin repository; no third-party conversion is
used. **Powered by Stability AI.**

## License

The model files are redistributed under the
[Stability AI Community License](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md)
(research, non-commercial and limited commercial use free of charge — see the license for
the revenue threshold). The ONNX Runtime WASM is MIT. The plugin itself is AGPL-3.0-or-later.
