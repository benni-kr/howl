from core_engine.replay_engine import replay_and_extract_subgraphs, _normalize_action

def test_normalize_action():
    # Compact
    assert _normalize_action({"t": "c", "v": [[0,0]]}) == {"t": "c", "v": [[0,0]]}
    # Verbose cut
    assert _normalize_action({"type": "cut", "vertices": [{"x": 1, "y": 2}]}) == {"t": "c", "v": [[1,2]]}
    # Verbose vaporize
    assert _normalize_action({"type": "vaporize", "vertices": [{"x": 1, "y": 2}], "optimal_rank": 5}) == {"t": "v", "v": [[1,2]], "r": 5}
    # Unknown
    assert _normalize_action({"type": "unknown"}) is None

def test_replay_and_extract_subgraphs_empty():
    ranks, root_rank = replay_and_extract_subgraphs(1, 1, [])
    # a 1x1 grid without cuts should return a dict with hash
    # actually a 1x1 grid un-cut is 1 vertex. rank should be 1
    assert len(ranks) == 1
    for key, val in ranks.items():
        assert val["rank"] == 1
        assert val["sequence"] == []

def test_replay_and_extract_subgraphs_simple_cut():
    # 2x1 grid, cut at (0,0) -> leaves (1,0)
    seq = [
        {"t": "c", "v": [[0,0]]}
    ]
    ranks, root_rank = replay_and_extract_subgraphs(2, 1, seq)
    # the cut leaves a 1x1 which has rank 1.
    # rank of the 2x1 is cut_size (1) + max(child_ranks) (1) = 2
    assert len(ranks) > 0
    # Let's find the rank for the 2x1 grid
    # We can just verify the maximum rank in the values is 2
    max_rank = max(r["rank"] for r in ranks.values())
    assert max_rank == 2

def test_replay_and_extract_subgraphs_incomplete():
    # 2x2 grid, no cuts. The root should have rank 999999
    ranks, root_rank = replay_and_extract_subgraphs(2, 2, [])
    assert root_rank >= 999999

def test_replay_and_extract_subgraphs_ignore():
    # 3x1 grid. Cut at (1,0). Leaves two 1x1 grids (0,0) and (2,0).
    # Since they are identical 1x1 grids, one can be ignored.
    seq = [
        {"t": "c", "v": [[1,0]]},
        {"t": "i", "v": [[2,0]]}
    ]
    ranks, root_rank = replay_and_extract_subgraphs(3, 1, seq)
    # The true rank should be: cut_size(1) + max(child_ranks).
    # children are (0,0) with rank 1, and (2,0) which is ignored (so doesn't add to rank).
    # true rank = 1 + max(1, 0) = 2.
    assert root_rank == 2
