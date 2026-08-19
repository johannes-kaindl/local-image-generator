#!/usr/bin/env bash
# Eigene SD-Turbo-Konversion (Spec 0.6 §3): offizielle Gewichte → ONNX fp16 nach dist-assets/.
# Voraussetzung: uv (https://docs.astral.sh/uv/). Läuft komplett lokal; ~5 GB Download beim ersten Mal.
set -euo pipefail
cd "$(dirname "$0")/.."
VENV=tools/convert/.venv
if [ ! -x "$VENV/bin/python" ]; then
  uv venv "$VENV" --python 3.11
  uv pip install --python "$VENV/bin/python" \
    "optimum[exporters,onnxruntime]" diffusers transformers accelerate torch onnx onnxconverter-common sentencepiece
fi
"$VENV/bin/python" tools/convert/convert_sd_turbo.py "$@"
# Lizenz + Attribution aus dem Quell-Repo neben die Gewichte legen (Community License §: Weitergabe
# nur mit Lizenztext und "Powered by Stability AI").
"$VENV/bin/python" - <<'PY'
from huggingface_hub import hf_hub_download
import shutil, pathlib
dst = pathlib.Path("dist-assets/sd-turbo")
shutil.copy(hf_hub_download("stabilityai/sd-turbo", "LICENSE.md"), dst / "LICENSE.md")
(dst / "NOTICE.md").write_text(
"""# NOTICE

Powered by Stability AI.

These files are an ONNX conversion (fp16 weights, fp32 inputs/outputs) of
`stabilityai/sd-turbo` (https://huggingface.co/stabilityai/sd-turbo), redistributed under the
Stability AI Community License (see LICENSE.md). Conversion: `optimum` ONNX export of the official
weights, then `onnxconverter-common` float16 with `keep_io_types=True`; script:
local-image-generator/tools/convert/convert_sd_turbo.py. No third-party conversion was used.

Intended consumer: the Obsidian plugin *Local Image Generator*
(https://github.com/johannes-kaindl/local-image-generator), which downloads these files only
after the user clicks "Download" and verifies their SHA-256 before use.
""")
print("LICENSE.md + NOTICE.md geschrieben")
PY
# Model-Card fürs HF-Repo (getrackte Vorlage, Lizenz-Metadaten im Frontmatter)
cp tools/convert/hf-readme.md dist-assets/README.md && echo "README.md (Model-Card) kopiert"
