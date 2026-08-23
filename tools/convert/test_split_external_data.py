import numpy as np, onnx
from onnx import helper, numpy_helper, TensorProto
from pathlib import Path
from split_external_data import split_external_data

def _model(tmp: Path, n_tensors: int, elems: int) -> Path:
    inits = [numpy_helper.from_array(
                 np.full((elems,), i, dtype=np.float32), name=f"w{i}")
             for i in range(n_tensors)]
    node = helper.make_node("Identity", ["w0"], ["y"])
    graph = helper.make_graph([node], "g", [],
                              [helper.make_tensor_value_info("y", TensorProto.FLOAT, [elems])],
                              initializer=inits)
    m = helper.make_model(graph)
    p = tmp / "model.onnx"; onnx.save(m, str(p)); return p

def _model_varied(tmp: Path, elems_list: list[int]) -> Path:
    # unterschiedlich grosse Tensoren, um size_threshold zu pruefen — die kleinen simulieren
    # die Achsen/Formen-Tensoren, die eine Shape-Inferenz schon beim Laden braucht.
    inits = [numpy_helper.from_array(
                 np.full((e,), i, dtype=np.float32), name=f"w{i}")
             for i, e in enumerate(elems_list)]
    node = helper.make_node("Identity", ["w0"], ["y"])
    graph = helper.make_graph([node], "g", [],
                              [helper.make_tensor_value_info("y", TensorProto.FLOAT, [elems_list[0]])],
                              initializer=inits)
    m = helper.make_model(graph)
    p = tmp / "model.onnx"; onnx.save(m, str(p)); return p

def test_buckets_respect_size_limit_and_roundtrip(tmp_path):
    p = _model(tmp_path, n_tensors=8, elems=1024)          # 8 × 4096 B
    buckets = split_external_data(p, tmp_path, "unet", bucket_bytes=10_000)
    assert len(buckets) == 4                                # 2 Tensoren je Bucket
    assert [b.name for b in buckets] == [f"unet_{i:03d}.onnx_data" for i in range(4)]
    for b in buckets:
        assert b.stat().st_size <= 10_000 + 64 * 2          # Grenze + Alignment-Zuschlag
    m = onnx.load(str(p), load_external_data=True)
    got = {t.name: numpy_helper.to_array(t) for t in m.graph.initializer}
    for i in range(8):
        assert np.array_equal(got[f"w{i}"], np.full((1024,), i, dtype=np.float32))

def test_offsets_are_aligned(tmp_path):
    # 257 Elemente * 4 B = 1028 B: ueber dem SIZE_THRESHOLD-Default von 1024 (sonst bleibt der
    # Tensor inline und der Test misst gar nichts mehr) UND unrund gegenueber align=64.
    p = _model(tmp_path, n_tensors=4, elems=257)
    split_external_data(p, tmp_path, "unet", bucket_bytes=10_000, align=64)
    # load_external_data=False: der Default lädt die Rohdaten UND löscht dabei
    # data_location/external_data wieder (onnx.external_data_helper.load_external_data_for_model)
    # — genau die Felder, die dieser Test prüfen will, wären sonst schon wieder weg.
    m = onnx.load(str(p), load_external_data=False)
    for t in m.graph.initializer:
        off = int(next(kv.value for kv in t.external_data if kv.key == "offset"))
        assert off % 64 == 0

def test_never_splits_a_tensor_across_files(tmp_path):
    p = _model(tmp_path, n_tensors=3, elems=1024)            # 4096 B je Tensor
    buckets = split_external_data(p, tmp_path, "unet", bucket_bytes=1000)  # kleiner als ein Tensor
    assert len(buckets) == 3                                 # jeder Tensor bekommt seinen Bucket
    m = onnx.load(str(p), load_external_data=True)
    assert len(m.graph.initializer) == 3

def test_small_tensors_stay_inline(tmp_path):
    # w0..w2: 8 Elemente = 32 B, klar unter dem Default-SIZE_THRESHOLD von 1024 — simuliert die
    # Achsen/Formen-Tensoren, die eine Shape-Inferenz schon beim Laden braucht und die deshalb
    # NICHT extern werden duerfen (Regressionsfall vom echten SDXL-Turbo-UNet, 2026-08-24).
    # w3/w4: 1024 Elemente = 4096 B, klar drueber — muessen weiterhin extern wandern.
    p = _model_varied(tmp_path, elems_list=[8, 8, 8, 1024, 1024])
    buckets = split_external_data(p, tmp_path, "unet", bucket_bytes=10_000)
    assert len(buckets) >= 1
    # ohne load_external_data: die kleinen Tensoren muessen DEFAULT geblieben sein und ihr
    # raw_data behalten haben — kein Auslagern bedeutet kein Anfassen dieses Felds.
    m = onnx.load(str(p), load_external_data=False)
    by_name = {t.name: t for t in m.graph.initializer}
    for i in range(3):
        t = by_name[f"w{i}"]
        assert t.data_location == TensorProto.DEFAULT
        assert len(t.raw_data) == 32
    for i in (3, 4):
        t = by_name[f"w{i}"]
        assert t.data_location == TensorProto.EXTERNAL
        assert not t.raw_data
    # Roundtrip: alle Werte, klein wie gross, muessen weiterhin korrekt geladen werden.
    m2 = onnx.load(str(p), load_external_data=True)
    got = {t.name: numpy_helper.to_array(t) for t in m2.graph.initializer}
    for i, e in enumerate([8, 8, 8, 1024, 1024]):
        assert np.array_equal(got[f"w{i}"], np.full((e,), i, dtype=np.float32))

def test_size_threshold_zero_externalizes_everything(tmp_path):
    # size_threshold=0 muss auch die winzigen Tensoren extern machen — Gegenprobe, dass der
    # Parameter wirklich wirkt und nicht nur den Default dekoriert.
    p = _model_varied(tmp_path, elems_list=[8, 8, 1024])
    split_external_data(p, tmp_path, "unet", bucket_bytes=10_000, size_threshold=0)
    m = onnx.load(str(p), load_external_data=False)
    for t in m.graph.initializer:
        assert t.data_location == TensorProto.EXTERNAL
        assert not t.raw_data
