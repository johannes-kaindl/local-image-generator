#!/usr/bin/env bash
# Eigene Modellkonversion (Spec 0.6 §3, erweitert fuer die zweite Modellstufe): offizielle
# Gewichte → ONNX fp16 nach dist-assets/<model>/. Voraussetzung: uv (https://docs.astral.sh/uv/).
# Laeuft komplett lokal; erster Lauf pro Modell laedt mehrere GB von huggingface.co.
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${1:?Aufruf: tools/convert-model.sh <sd-turbo|sdxl-turbo> [--out DIR] [--work DIR]}"
shift
OUT="dist-assets/$MODEL"
# --out durchreichen (z. B. fuer eine Gegenprobe, die die ausgelieferte Konversion nicht
# ueberschreiben darf): dieselbe Ableitung wie in convert_model.py, damit LICENSE.md/NOTICE.md
# neben die tatsaechlich geschriebenen Gewichte kommen, nicht in dist-assets/<model>/.
prev=""
for arg in "$@"; do
  if [ "$prev" = "--out" ]; then OUT="$arg"; fi
  prev="$arg"
done
VENV=tools/convert/.venv
if [ ! -x "$VENV/bin/python" ]; then
  uv venv "$VENV" --python 3.11
  uv pip install --python "$VENV/bin/python" \
    "optimum[exporters,onnxruntime]" diffusers transformers accelerate torch onnx \
    onnxconverter-common sentencepiece pytest
fi
"$VENV/bin/python" tools/convert/convert_model.py --model "$MODEL" "$@"
# Lizenz + Attribution aus dem Quell-Repo neben die Gewichte legen (Community License §: Weitergabe
# nur mit Lizenztext und "Powered by Stability AI"). Gilt fuer beide Modelle — SDXL-Turbo hat seine
# eigene Lizenzdatei im eigenen HF-Repo, deshalb wird MODEL durchgereicht statt sd-turbo fest zu verdrahten.
MODEL="$MODEL" OUT="$OUT" "$VENV/bin/python" - <<'PY'
import os
from huggingface_hub import hf_hub_download
import shutil, pathlib

MODEL = os.environ["MODEL"]
HF_IDS = {"sd-turbo": "stabilityai/sd-turbo", "sdxl-turbo": "stabilityai/sdxl-turbo"}
hf_id = HF_IDS[MODEL]
dst = pathlib.Path(os.environ["OUT"])
dst.mkdir(parents=True, exist_ok=True)
shutil.copy(hf_hub_download(hf_id, "LICENSE.md"), dst / "LICENSE.md")
(dst / "NOTICE.md").write_text(
f"""# NOTICE

Powered by Stability AI.

These files are an ONNX conversion (fp16 weights, fp32 inputs/outputs) of
`{hf_id}` (https://huggingface.co/{hf_id}), redistributed under the
Stability AI Community License (see LICENSE.md). Conversion: `optimum` ONNX export of the official
weights, then `onnxconverter-common` float16 with `keep_io_types=True`; script:
local-image-generator/tools/convert/convert_model.py. No third-party conversion was used.

Intended consumer: the Obsidian plugin *Local Image Generator*
(https://github.com/johannes-kaindl/local-image-generator), which downloads these files only
after the user clicks "Download" and verifies their SHA-256 before use.
""")
print("LICENSE.md + NOTICE.md geschrieben:", dst)
PY
# Model-Card fürs HF-Repo (getrackte Vorlage, Lizenz-Metadaten im Frontmatter, deckt seit
# 2026-08-24 beide Modelle — I3-Fix, Final-Review). Frueher an "$MODEL" = "sd-turbo" gegated
# mit dem Kommentar "die sdxl-turbo-Fassung folgt mit der eigenen Konversion (Task 3)" — Task 3
# lieferte die Konversion, die Karte blieb einmodellig UND die Kopie lief nie fuer sdxl-turbo.
# Beide Modelle liegen unter derselben Repo-Wurzel (dist-assets/README.md), die Karte gehoert
# also bei JEDER kanonischen Konversion aktualisiert, nicht nur bei sd-turbo. Nur bei der
# ausgelieferten Konversion kopieren, nicht bei einer Gegenprobe mit --out.
if [ "$OUT" = "dist-assets/$MODEL" ]; then
  cp tools/convert/hf-readme.md dist-assets/README.md && echo "README.md (Model-Card) kopiert"
fi
