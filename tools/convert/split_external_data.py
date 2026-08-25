"""Tensoren eines ONNX-Modells auf mehrere External-Data-Dateien verteilen.

NICHT convert_model_to_external_data(all_tensors_to_one_file=False): das ergibt eine Datei
je Tensor (fuer SDXL-Turbos UNet gemessen: 1641 Dateien) und ist als Download- und
Cache-Granularitaet unbrauchbar. Hier derselbe Standardmechanismus wie bei
all_tensors_to_one_file=True (location + offset + length), nur auf mehrere Dateien verteilt.

Warum ueberhaupt: im Obsidian-Renderer ist ein plain ArrayBuffer bei ~2,0 GiB zu Ende
(gemessen 2026-08-23), eine monolithische .onnx_data von 4,78 GiB also nicht uebergebbar.
"""
from __future__ import annotations
from pathlib import Path

import onnx
from onnx import TensorProto
# _get_all_tensors ist PRIVAT (Unterstrich), aber die einzige Fassung, die auch
# Attribut-Tensoren erfasst — model.graph.initializer allein laesst sie liegen.
# Verifiziert gegen onnx 1.22.0 (2026-08-23). Bricht sie bei einem Upgrade weg,
# meldet das der Test aus Step 1 sofort; Ersatz waere dann eine eigene Traversierung
# ueber graph.initializer + graph.node[*].attribute[*].t.
from onnx.external_data_helper import _get_all_tensors

BUCKET_BYTES = 400 * 1024 * 1024
ALIGN = 64
# onnxs eigenes convert_model_to_external_data() hat denselben Default: sehr kleine Tensoren
# (Achsen fuer Unsqueeze, Formen fuer Reshape) braucht die Shape-Inferenz schon beim Laden des
# Modells INLINE — extern gemacht, bricht der Ladevorgang selbst, nicht erst die Inferenz
# (gemessen 2026-08-24 am echten SDXL-Turbo-UNet: "Cannot parse data from external tensors"
# beim Unsqueeze-Knoten).
SIZE_THRESHOLD = 1024


def _set_external(tensor: TensorProto, location: str, offset: int, length: int) -> None:
    del tensor.external_data[:]
    tensor.data_location = TensorProto.EXTERNAL
    for key, value in (("location", location), ("offset", offset), ("length", length)):
        entry = tensor.external_data.add()
        entry.key, entry.value = key, str(value)


def split_external_data(
    model_path: Path,
    out_dir: Path,
    part: str,
    bucket_bytes: int = BUCKET_BYTES,
    align: int = ALIGN,
    size_threshold: int = SIZE_THRESHOLD,
) -> list[Path]:
    model = onnx.load(str(model_path), load_external_data=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    buckets: list[Path] = []
    handle = None
    offset = 0
    written: list[Path] = []

    def open_next() -> None:
        nonlocal handle, offset
        if handle is not None:
            handle.close()
        path = out_dir / f"{part}_{len(written):03d}.onnx_data"
        written.append(path)
        handle = path.open("wb")
        offset = 0

    open_next()
    for tensor in _get_all_tensors(model):
        raw = tensor.raw_data
        if not raw:                      # nicht-raw Initializer (selten, klein) bleiben inline
            continue
        if len(raw) < size_threshold:    # Shape-Inferenz braucht diese Werte schon beim Laden
            continue
        # Ein Tensor wird NIE geteilt: passt er nicht mehr, faengt ein neuer Bucket an.
        # Ist er allein groesser als das Budget, bekommt er seinen eigenen Bucket.
        if offset > 0 and offset + len(raw) > bucket_bytes:
            open_next()
        pad = (-offset) % align
        if pad:
            handle.write(b"\0" * pad)
            offset += pad
        handle.write(raw)
        _set_external(tensor, written[-1].name, offset, len(raw))
        tensor.ClearField("raw_data")
        offset += len(raw)
    if handle is not None:
        handle.close()

    buckets = [p for p in written if p.stat().st_size > 0]
    for leer in set(written) - set(buckets):
        leer.unlink()
    onnx.save(model, str(model_path))
    return buckets
