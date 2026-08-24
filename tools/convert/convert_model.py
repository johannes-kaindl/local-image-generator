"""Offizielle Gewichte → ONNX fp16 (Gewichte fp16, Ein-/Ausgaenge fp32) fuer ort-web/WebGPU.

Traegt beide eingebauten Modelle. SD-Turbo bleibt monolithisch (UNet 1,73 GB < 2 GiB);
SDXL-Turbo wird gestueckelt (UNet 4,78 GiB), weil ein ArrayBuffer im Renderer bei ~2,0 GiB endet.

Läuft in der uv-Venv aus tools/convert-model.sh. Schritte je Modell:
  1. optimum-cli export onnx (fp32) aus den OFFIZIELLEN Gewichten (siehe MODELS[...]["hf"])
  2. jeder Teil → fp16 mit onnxruntimes eigenem Konverter (OnnxModel.convert_float_to_float16,
     keep_io_types=True, symbolische Shape-Inference — onnxconverter-common ohne
     Shape-Inference ließ 2026-08-19 einen Add-Knoten mit gemischten Typen zurück; die
     fp32-Eingänge sind die 2026-07-16 gemessene robuste Paarung) — AUSSER Teilen aus
     MODELS[...]["fp32"], die unveraendert aus dem fp32-Export uebernommen werden (s. u.)
  3. Teile aus MODELS[...]["split"] werden zusaetzlich per split_external_data gestueckelt
     (Task 1), alle anderen bleiben als einzelne model.onnx < 2 GiB
Kein Byte stammt aus einer Drittkonversion.

Praezisions-Ausnahme (gemessen 2026-08-24, Phase 1-3 des SDXL-Turbo-Debuggings): SDXLs
VAE-Decoder ueberschreitet in fp16 unter dem WebGPU-EP den Wertebereich (Aktivierungen > 65504)
→ Inf → NaN im gesamten Ausgang → ein rein schwarzes Bild, OHNE jeden Fehler (gueltige PNG-Datei,
richtige Groesse, Status "Bereit"). ORTs CPU-Kernel rechnen dieselbe Graph-Struktur intern
offenbar hoeher praezise und zeigen den Defekt NICHT — ein Node-seitiger Test kann ihn deshalb
nicht finden, nur ein Live-Lauf im Renderer. Eine fp32-Gegenprobe am selben Graph, denselben
Gewichten, demselben Pfad war NaN-frei und deckungsgleich mit der CPU-Referenz (0/786432 NaN vs.
786432/786432 zuvor). Deshalb bleibt GENAU dieser eine Teil fp32, waehrend alles andere fp16
bleibt — das ist eine Konsequenz aus dem gemessenen Fehlerbild, keine Nachlaessigkeit beim
Aufraeumen. Kosten: +99 MB (198.078.154 vs. 99.126.105 Byte), +~650 ms pro generate() (n=1).
Diesen Teil NICHT "der Einheitlichkeit wegen" auf fp16 zurueckstellen.
"""
from __future__ import annotations
import argparse, shutil, subprocess, sys
from pathlib import Path

import onnx
from onnxruntime.transformers.onnx_model import OnnxModel

from split_external_data import split_external_data

MODELS = {
    "sd-turbo": {
        "hf": "stabilityai/sd-turbo",
        "task": "stable-diffusion",
        "parts": ["text_encoder", "unet", "vae_decoder"],
        "tokenizers": {"tokenizer": "tokenizer"},
        "split": [],                       # nichts stueckeln
        "fp32": [],                        # keine Ausnahme — SD-Turbo bleibt komplett fp16
    },
    "sdxl-turbo": {
        "hf": "stabilityai/sdxl-turbo",
        "task": "stable-diffusion-xl",
        "parts": ["text_encoder", "text_encoder_2", "unet", "vae_decoder"],
        "tokenizers": {"tokenizer": "tokenizer", "tokenizer_2": "tokenizer_2"},
        "split": ["unet"],                 # nur das UNet reisst die Grenze
        "fp32": ["vae_decoder"],           # ueberschreitet in fp16 den Wertebereich, s. Modulkopf
    },
}


def export_fp32(model_id: str, task: str, out: Path) -> None:
    if (out / "unet" / "model.onnx").exists():
        print(f"[1/3] fp32-Export vorhanden: {out}")
        return
    print(f"[1/3] optimum-cli export onnx --model {model_id} --task {task} → {out}")
    subprocess.run(
        [sys.executable, "-m", "optimum.exporters.onnx", "--model", model_id, "--task", task, str(out)],
        check=True,
    )


def to_fp16(src: Path, dst: Path, part: str, split: list[str]) -> None:
    print(f"[2/3] fp16: {src.name}")
    model = onnx.load(str(src / "model.onnx"), load_external_data=True)
    m = OnnxModel(model)
    m.convert_float_to_float16(keep_io_types=True, use_symbolic_shape_infer=True)
    dst.mkdir(parents=True, exist_ok=True)
    if part in split:
        # Protobuf kann keine Nachricht ueber 2 GiB serialisieren — genau DESHALB gibt es den
        # Splitter (SDXL-Turbos fp16-UNet liegt bei ~4,78 GiB). use_external_data_format=False
        # waere hier also gar nicht erst aufrufbar (EncodeError, gemessen 2026-08-23); stattdessen
        # MIT External Data speichern, das legt eine grosse TEMPORAERE Sammel-Datei
        # "<model>.onnx.data" an (OnnxModel.save: location = Path(output_path + ".data").name).
        # split_external_data laedt ohnehin mit load_external_data=True und findet raw_data damit
        # auch aus dieser Datei. Die temporaere Datei muss danach weg: sie waere sonst zusaetzlich
        # zu den Buckets im Manifest (build-assets.mjs) und beim Upload dabei — mehrere GB Redundanz.
        m.save_model_to_file(str(dst / "model.onnx"), use_external_data_format=True)
        tmp_data = dst / "model.onnx.data"
        buckets = split_external_data(dst / "model.onnx", dst, part)
        if tmp_data.exists():
            tmp_data.unlink()
        total = sum(b.stat().st_size for b in buckets)
        print(f"      → {len(buckets)} Buckets, {total / 1e9:.2f} GB")
        return
    # Nicht-gestueckelte Teile (SD-Turbo: alle drei) bleiben bei der alten harten 2-GiB-Grenze.
    m.save_model_to_file(str(dst / "model.onnx"), use_external_data_format=False)
    size = (dst / "model.onnx").stat().st_size
    print(f"      → {dst / 'model.onnx'} ({size / 1e6:.0f} MB)")
    if size >= 2**31:
        raise SystemExit(f"{dst.name}: {size} Bytes ≥ 2 GiB — gehoert in die split-Liste")


def copy_fp32(src: Path, dst: Path, part: str) -> None:
    """Teile aus MODELS[...]["fp32"] unveraendert aus dem fp32-Export uebernehmen — kein
    Aufruf von convert_float_to_float16. Reiner Byte-Kopie statt onnx.load/save, damit die
    Datei exakt die in Phase 3 verifizierte ist (kein Risiko einer abweichenden Serialisierung).
    Bricht hart ab, falls der Teil doch je die 2-GiB-Grenze reisst: fp32-Teile ueber der
    Grenze (External Data + Stueckelung) sind hier noch nicht vorgesehen."""
    print(f"[2/3] fp32 (bleibt unveraendert): {src.name}")
    dst.mkdir(parents=True, exist_ok=True)
    size = (src / "model.onnx").stat().st_size
    if size >= 2**31:
        raise SystemExit(
            f"{part}: fp32-Teil ist {size} Bytes ≥ 2 GiB — External Data/Stueckelung fuer "
            "fp32-Teile ist noch nicht implementiert."
        )
    if (src / "model.onnx.data").exists():
        raise SystemExit(
            f"{part}: fp32-Export hat External Data (model.onnx.data) — copy_fp32 kopiert "
            "bisher nur Einzeldateien."
        )
    shutil.copy(src / "model.onnx", dst / "model.onnx")
    print(f"      → {dst / 'model.onnx'} ({size / 1e6:.0f} MB, fp32)")


def assert_hidden_states(part_dir: Path, part: str) -> None:
    """SDXL nutzt den VORLETZTEN Hidden-Layer beider Text-Encoder. Liefert der Export nur
    last_hidden_state, entsteht kein Fehler, sondern ein still schlechteres Bild — deshalb
    hier ein harter Abbruch statt einer Warnung."""
    outs = [o.name for o in onnx.load(str(part_dir / "model.onnx"), load_external_data=False).graph.output]
    if not any("hidden_states" in o for o in outs):
        raise SystemExit(
            f"{part}: Export ohne hidden_states (nur {outs}). SDXL braucht den vorletzten "
            f"Hidden-Layer — ohne ihn wird das Bild still schlechter. Export-Task pruefen."
        )


def copy_tokenizers(work: Path, out: Path, tokenizers: dict[str, str]) -> None:
    for dst_name, src_name in tokenizers.items():
        dst = out / dst_name
        dst.mkdir(parents=True, exist_ok=True)
        for name in ("vocab.json", "merges.txt"):
            shutil.copy(work / src_name / name, dst / name)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, choices=sorted(MODELS))
    ap.add_argument("--work", default=None, help="Default: dist-assets/_work/<model>-fp32")
    ap.add_argument("--out", default=None, help="Default: dist-assets/<model>")
    a = ap.parse_args()
    spec = MODELS[a.model]
    work = Path(a.work) if a.work else Path(f"dist-assets/_work/{a.model}-fp32")
    out = Path(a.out) if a.out else Path(f"dist-assets/{a.model}")

    export_fp32(spec["hf"], spec["task"], work)
    for part in spec["parts"]:
        if part in spec["fp32"]:
            copy_fp32(work / part, out / part, part)
        else:
            to_fp16(work / part, out / part, part, spec["split"])
        if spec["task"] == "stable-diffusion-xl" and part in ("text_encoder", "text_encoder_2"):
            assert_hidden_states(out / part, part)
    print("[3/3] Tokenizer kopieren")
    copy_tokenizers(work, out, spec["tokenizers"])
    print("fertig:", out)


if __name__ == "__main__":
    main()
