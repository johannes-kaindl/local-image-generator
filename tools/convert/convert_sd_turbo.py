"""SD-Turbo → ONNX fp16 (Gewichte fp16, Ein-/Ausgänge fp32) für onnxruntime-web/WebGPU.

Läuft in der uv-Venv aus tools/convert-sd-turbo.sh. Schritte:
  1. optimum-cli export onnx (fp32) aus den OFFIZIELLEN Gewichten stabilityai/sd-turbo
  2. text_encoder / unet / vae_decoder → fp16 mit onnxruntimes eigenem Konverter
     (OnnxModel.convert_float_to_float16, keep_io_types=True, symbolische Shape-Inference —
     onnxconverter-common ohne Shape-Inference ließ 2026-08-19 einen Add-Knoten mit gemischten
     Typen zurück; die fp32-Eingänge sind die 2026-07-16 gemessene robuste Paarung)
  3. je Modell EINE Datei (UNet fp16 < 2 GB → kein externes Datenfile), nach dist-assets/sd-turbo/
Kein Byte stammt aus einer Drittkonversion.
"""
from __future__ import annotations
import argparse, shutil, subprocess, sys
from pathlib import Path

import onnx
from onnxruntime.transformers.onnx_model import OnnxModel

PARTS = ["text_encoder", "unet", "vae_decoder"]

def export_fp32(model_id: str, out: Path) -> None:
    if (out / "unet" / "model.onnx").exists():
        print(f"[1/3] fp32-Export vorhanden: {out}")
        return
    print(f"[1/3] optimum-cli export onnx --model {model_id} → {out}")
    subprocess.run(
        [sys.executable, "-m", "optimum.exporters.onnx", "--model", model_id, "--task", "stable-diffusion", str(out)],
        check=True,
    )

def to_fp16(src: Path, dst: Path) -> None:
    print(f"[2/3] fp16: {src.name}")
    model = onnx.load(str(src / "model.onnx"), load_external_data=True)
    m = OnnxModel(model)
    m.convert_float_to_float16(keep_io_types=True, use_symbolic_shape_infer=True)
    dst.mkdir(parents=True, exist_ok=True)
    m.save_model_to_file(str(dst / "model.onnx"), use_external_data_format=False)
    size = (dst / "model.onnx").stat().st_size
    print(f"      → {dst / 'model.onnx'} ({size / 1e6:.0f} MB)")
    if size >= 2**31:
        raise SystemExit(f"{dst.name}: {size} Bytes ≥ 2 GiB — Protobuf-Grenze; hier wäre externes Datenfile nötig")

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="stabilityai/sd-turbo")
    ap.add_argument("--work", default="dist-assets/_work/sd-turbo-fp32")
    ap.add_argument("--out", default="dist-assets/sd-turbo")
    a = ap.parse_args()
    work, out = Path(a.work), Path(a.out)
    export_fp32(a.model, work)
    for part in PARTS:
        to_fp16(work / part, out / part)
    print("[3/3] Tokenizer + Lizenz kopieren")
    (out / "tokenizer").mkdir(parents=True, exist_ok=True)
    for name in ("vocab.json", "merges.txt"):
        shutil.copy(work / "tokenizer" / name, out / "tokenizer" / name)
    print("fertig:", out)

if __name__ == "__main__":
    main()
