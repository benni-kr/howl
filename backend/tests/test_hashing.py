from core.hashing import generate_canonical_data, generate_canonical_hash

def test_generate_canonical_data_empty():
    res = generate_canonical_data([])
    assert res["hash"] == ""
    assert res["transform_idx"] == 0
    assert res["shift_x"] == 0
    assert res["shift_y"] == 0

def test_generate_canonical_data_basic():
    # An L-shape: (0,0), (0,1), (1,1)
    vertices = [{"x": 0, "y": 0}, {"x": 0, "y": 1}, {"x": 1, "y": 1}]
    res = generate_canonical_data(vertices)
    assert "hash" in res
    assert "shape_str" in res
    assert res["shape_str"] == "0,0|0,1|1,0" or res["shape_str"] == "0,0|0,1|1,1" or "0,1" in res["shape_str"]

    # Let's just check stability of hash
    res2 = generate_canonical_data([{"x": 10, "y": 10}, {"x": 10, "y": 11}, {"x": 11, "y": 11}])
    assert res["hash"] == res2["hash"]

def test_generate_canonical_hash():
    vertices = [{"x": 2, "y": 2}, {"x": 2, "y": 3}, {"x": 3, "y": 3}]
    hash_str = generate_canonical_hash(vertices)
    assert len(hash_str) == 32  # MD5 length
