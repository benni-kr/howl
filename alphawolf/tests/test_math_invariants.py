"""
Unit and Property Tests for HOWL & AlphaWolf Mathematical Invariants.
"""

import math
import random
import numpy as np
import pytest

from core_engine.graph_logic import GridGraph, filter_and_deduplicate
from core_engine.hashing import generate_canonical_data, generate_canonical_hash, get_transformations
from core_engine.replay_engine import replay_and_extract_subgraphs
from envs.howl_env import HowlEnv, MAX_ROWS, MAX_COLS
from models.net import AlphaWolfNet
from train import play_episode
import db.tablebase as tb


# ============================================================================
# 1. D4 CANONICAL HASHING & CACHE INTEGRITY
# ============================================================================

def test_d4_transformations_completeness():
    """Verify all 8 transformations in get_transformations() are distinct and form D4."""
    transforms = get_transformations()
    assert len(transforms) == 8, f"Expected 8 transformations, got {len(transforms)}"

    test_pt = (3, 7)
    results = [t(test_pt[0], test_pt[1]) for t in transforms]
    assert len(set(results)) == 8, f"D4 transformations did not produce 8 distinct coordinates for {test_pt}: {results}"


def test_d4_invariance_on_asymmetric_shapes():
    """
    Assert that an asymmetric shape produces the EXACT same canonical hash
    and shape_str across all 8 D4 transformations and translations.
    """
    f_shape = [
        (0, 0), (1, 0), (2, 0),
        (0, 1),
        (0, 2), (1, 2),
        (0, 3)
    ]
    
    transforms = get_transformations()
    canonical_hashes = []
    shape_strings = []

    for t in transforms:
        for shift_x in [-15, 0, 42]:
            for shift_y in [-8, 0, 99]:
                transformed = [{"x": t(x, y)[0] + shift_x, "y": t(x, y)[1] + shift_y} for x, y in f_shape]
                data = generate_canonical_data(transformed)
                canonical_hashes.append(data["hash"])
                shape_strings.append(data["shape_str"])

    assert len(set(canonical_hashes)) == 1, f"D4 hashing produced multiple hashes: {set(canonical_hashes)}"
    assert len(set(shape_strings)) == 1, f"D4 hashing produced multiple shape strings: {set(shape_strings)}"


def test_randomized_shapes_d4_invariance():
    """
    Generate 30 arbitrary connected grid shapes, apply all 8 D4
    rotations/reflections and random 2D translations, and assert 100% hash consistency.
    """
    rng = random.Random(1337)
    transforms = get_transformations()

    for shape_idx in range(30):
        num_cells = rng.randint(4, 16)
        curr = (0, 0)
        shape_cells = {curr}
        for _ in range(num_cells * 3):
            dx, dy = rng.choice([(0, 1), (0, -1), (1, 0), (-1, 0)])
            curr = (curr[0] + dx, curr[1] + dy)
            shape_cells.add(curr)
            if len(shape_cells) >= num_cells:
                break

        hashes = set()
        shape_strs = set()
        for t in transforms:
            offset_x = rng.randint(-50, 50)
            offset_y = rng.randint(-50, 50)
            transformed = [{"x": t(x, y)[0] + offset_x, "y": t(x, y)[1] + offset_y} for x, y in shape_cells]
            data = generate_canonical_data(transformed)
            hashes.add(data["hash"])
            shape_strs.add(data["shape_str"])

        assert len(hashes) == 1, f"Random shape #{shape_idx} yielded inconsistent hashes: {hashes}"
        assert len(shape_strs) == 1, f"Random shape #{shape_idx} yielded inconsistent shape strings: {shape_strs}"


def test_canonical_cache_immutability():
    """Verify that calling generate_canonical_data returns a mutation-safe copy."""
    shape = [{"x": 1, "y": 2}, {"x": 2, "y": 2}, {"x": 2, "y": 3}]
    data1 = generate_canonical_data(shape)
    orig_hash = data1["hash"]
    
    data1["hash"] = "CORRUPTED_HASH"
    data1["shift_x"] = 999999
    
    data2 = generate_canonical_data(shape)
    assert data2["hash"] == orig_hash, "Canonical cache was mutated by caller!"
    assert data2["shift_x"] != 999999, "Canonical cache metadata was mutated by caller!"


# ============================================================================
# 2. GRAPH LOGIC & COMPONENT DECOMPOSITION
# ============================================================================

def test_component_vertex_sets_equivalence():
    """Verify get_component_vertex_sets() partitions the vertices identically to get_disconnected_subgraphs()."""
    g = GridGraph(6, 6, generate=True)
    cuts = [(2, y) for y in range(6)] + [(x, 2) for x in range(6)]
    g.apply_cut_set(cuts)

    vertex_sets = g.get_component_vertex_sets()
    subgraphs = g.get_disconnected_subgraphs()

    assert len(vertex_sets) == len(subgraphs)
    
    set_of_frozensets_1 = {frozenset(s) for s in vertex_sets}
    set_of_frozensets_2 = {frozenset(sg.vertices) for sg in subgraphs}
    assert set_of_frozensets_1 == set_of_frozensets_2

    for sg in subgraphs:
        for v in sg.vertices:
            for neighbor in sg.adjacency[v]:
                assert neighbor in sg.vertices
                assert v in g.adjacency[neighbor]


def test_filter_and_deduplicate_symmetry():
    """On a symmetric cut, verify filter_and_deduplicate isolates exact uniques vs duplicates."""
    g = GridGraph(5, 5, generate=True)
    cuts = [(2, y) for y in range(5)] + [(x, 2) for x in range(5)]
    g.apply_cut_set(cuts)

    subgraphs = g.get_disconnected_subgraphs()
    assert len(subgraphs) == 4, f"Expected 4 corner subgraphs, got {len(subgraphs)}"

    uniques, duplicates = filter_and_deduplicate(subgraphs)
    assert len(uniques) == 1, f"Expected 1 unique 2x2 subgraph, got {len(uniques)}"
    assert len(duplicates) == 3, f"Expected 3 duplicate 2x2 subgraphs, got {len(duplicates)}"


# ============================================================================
# 3. TARJAN ARTICULATION POINTS INVARIANTS
# ============================================================================

def test_tarjan_articulation_points_intact_grid():
    """An intact m x n grid (m, n >= 2) is 2-connected and has 0 articulation points."""
    for m in [2, 3, 5, 8]:
        for n in [2, 3, 5, 8]:
            env = HowlEnv(m, n)
            art_pts = env._articulation_points()
            assert len(art_pts) == 0, f"Intact {m}x{n} grid reported articulation points: {art_pts}"


def test_tarjan_articulation_points_path_graph():
    """A path graph 1 x n has exactly internal nodes as articulation points."""
    n = 6
    env = HowlEnv(1, n)
    art_pts = env._articulation_points()
    expected = {(0, y) for y in range(1, n - 1)}
    assert art_pts == expected, f"Path graph 1x{n} articulation points {art_pts} != {expected}"


def test_tarjan_articulation_points_barbell():
    """A barbell graph (two 2x2 squares joined by a bridge node) must identify the bridge."""
    env = HowlEnv(5, 5, generate=False)
    left_sq = [(0,0), (0,1), (1,0), (1,1)]
    bridge = [(2,1)]
    right_sq = [(3,0), (3,1), (4,0), (4,1)]
    
    for v in left_sq + bridge + right_sq:
        env.graph._add_vertex(v)
    
    for sq in [left_sq, right_sq]:
        for v in sq:
            for dx, dy in [(0, 1), (1, 0)]:
                nb = (v[0] + dx, v[1] + dy)
                if nb in sq:
                    env.graph._add_edge(v, nb)
    
    env.graph._add_edge((1, 1), (2, 1))
    env.graph._add_edge((2, 1), (3, 1))

    art_pts = env._articulation_points()
    assert (2, 1) in art_pts, f"Bridge node (2,1) not detected: {art_pts}"
    assert (1, 1) in art_pts, f"Attachment node (1,1) not detected: {art_pts}"
    assert (3, 1) in art_pts, f"Attachment node (3,1) not detected: {art_pts}"


# ============================================================================
# 4. TREEDEPTH RECURRENCE & BASE CASES
# ============================================================================

def test_treedepth_base_cases():
    """Validate known theoretical rank numbers: 1x1->1, 1x3->2, 2x2->3."""
    seq_1x1 = [{"t": "c", "v": [[0, 0]]}]
    _, root_rank = replay_and_extract_subgraphs(1, 1, seq_1x1)
    assert root_rank == 1

    seq_1x3 = [
        {"t": "c", "v": [[0, 1]]},
        {"t": "i", "v": [[0, 2]]},
        {"t": "c", "v": [[0, 0]]}
    ]
    _, root_rank = replay_and_extract_subgraphs(1, 3, seq_1x3)
    assert root_rank == 2

    seq_2x2 = [
        {"t": "c", "v": [[0, 0]]},
        {"t": "c", "v": [[1, 1]]},
        {"t": "i", "v": [[1, 0]]},
        {"t": "c", "v": [[0, 1]]}
    ]
    _, root_rank = replay_and_extract_subgraphs(2, 2, seq_2x2)
    assert root_rank == 3


def test_tablebase_induction_and_non_degradation(isolated_db):
    """Verify tablebase upserts set is_optimal for rank <= 4 and never degrade better scores."""
    dummy_hash = "abc123canonical"
    dummy_str = "0,0|1,0"
    
    tb.upsert_subgraph(dummy_hash, dummy_str, 5, [{"t": "c", "v": [[0,0]]}], discovered_by="test")
    res = tb.query_tablebase([dummy_hash])
    assert res[dummy_hash]["best_rank"] == 5
    assert res[dummy_hash]["is_optimal"] is False

    tb.upsert_subgraph(dummy_hash, dummy_str, 6, [{"t": "c", "v": [[0,0]]}], discovered_by="test_worse")
    res = tb.query_tablebase([dummy_hash])
    assert res[dummy_hash]["best_rank"] == 5

    tb.upsert_subgraph(dummy_hash, dummy_str, 4, [{"t": "c", "v": [[0,0]]}], discovered_by="test_better")
    res = tb.query_tablebase([dummy_hash])
    assert res[dummy_hash]["best_rank"] == 4
    assert res[dummy_hash]["is_optimal"] is True


# ============================================================================
# 5. 9-CHANNEL D4-INVARIANT FEATURES & ACTION MASKING INVARIANTS
# ============================================================================

def test_9_channel_features_d4_invariance():
    """
    Assert that all 8 node features extracted on an asymmetric shape are bit-identical /
    strictly invariant under all 8 D4 rotations and reflections.
    """
    f_shape = {
        (0, 0), (1, 0), (2, 0),
        (0, 1),
        (0, 2), (1, 2),
        (0, 3)
    }
    transforms = get_transformations()

    # Base features on original shape
    env_base = HowlEnv(10, 10, generate=False)
    for v in f_shape:
        env_base.graph._add_vertex(v)
    for v in f_shape:
        for dx, dy in [(0, 1), (1, 0)]:
            if (v[0] + dx, v[1] + dy) in f_shape:
                env_base.graph._add_edge(v, (v[0] + dx, v[1] + dy))

    feats_base = env_base._compute_component_features(f_shape)

    for t_idx, t in enumerate(transforms):
        transformed_verts = {t(x, y) for x, y in f_shape}
        # Shift to non-negative bounding box
        min_x = min(x for x, y in transformed_verts)
        min_y = min(y for x, y in transformed_verts)
        shifted_verts = {(x - min_x, y - min_y) for x, y in transformed_verts}

        env_t = HowlEnv(10, 10, generate=False)
        for v in shifted_verts:
            env_t.graph._add_vertex(v)
        for v in shifted_verts:
            for dx, dy in [(0, 1), (1, 0)]:
                if (v[0] + dx, v[1] + dy) in shifted_verts:
                    env_t.graph._add_edge(v, (v[0] + dx, v[1] + dy))

        feats_t = env_t._compute_component_features(shifted_verts)

        # Global scalars
        assert math.isclose(feats_base["ar"], feats_t["ar"], abs_tol=1e-5), f"Aspect ratio mismatch on transform #{t_idx}"
        assert math.isclose(feats_base["solidity"], feats_t["solidity"], abs_tol=1e-5), f"Solidity mismatch on transform #{t_idx}"

        # Per-node features: map original vertex to transformed vertex
        for orig_v in f_shape:
            tx, ty = t(orig_v[0], orig_v[1])
            mapped_v = (tx - min_x, ty - min_y)

            assert math.isclose(feats_base["deg_orth"][orig_v], feats_t["deg_orth"][mapped_v], abs_tol=1e-5)
            assert math.isclose(feats_base["deg_diag"][orig_v], feats_t["deg_diag"][mapped_v], abs_tol=1e-5)
            assert math.isclose(feats_base["depth"][orig_v], feats_t["depth"][mapped_v], abs_tol=1e-5)
            assert math.isclose(feats_base["radial"][orig_v], feats_t["radial"][mapped_v], abs_tol=1e-5)
            assert math.isclose(feats_base["split_balance"][orig_v], feats_t["split_balance"][mapped_v], abs_tol=1e-5)


def test_division_by_zero_guards():
    """Verify that thin ribbons, 2x2 blocks, and 1x1 shapes do not trigger division by zero."""
    # 1. 1x1 isolated node
    env_1x1 = HowlEnv(1, 1)
    obs_1x1 = env_1x1._get_obs()
    assert obs_1x1.shape == (9, 1, 1)
    assert not np.isnan(obs_1x1).any()
    assert obs_1x1[3, 0, 0] == 0.0  # depth
    assert obs_1x1[4, 0, 0] == 0.0  # radial

    # 2. 1x5 ribbon
    env_1x5 = HowlEnv(1, 5)
    obs_1x5 = env_1x5._get_obs()
    assert obs_1x5.shape == (9, 1, 5)
    assert not np.isnan(obs_1x5).any()
    assert (obs_1x5[3] == 0.0).all()  # All perimeter, depth max=0 -> 0.0

    # 3. 2x2 square
    env_2x2 = HowlEnv(2, 2)
    obs_2x2 = env_2x2._get_obs()
    assert obs_2x2.shape == (9, 2, 2)
    assert not np.isnan(obs_2x2).any()
    assert (obs_2x2[3] == 0.0).all()  # All corners, depth max=0 -> 0.0


def test_tarjan_split_balance_quantitative_scores():
    """Verify exact quantitative split balance values on an 8-node path graph."""
    env = HowlEnv(1, 8)
    split_balances = env._tarjan_split_balances(set(env.graph.vertices))

    # Endpoints are not articulation points
    assert split_balances[(0, 0)] == 0.0
    assert split_balances[(0, 7)] == 0.0

    # Node (0, 3) splits into 3 and 4 -> (|V|-1 - max(3,4)) / (8/2) = (7-4)/4 = 3/4 = 0.75
    assert math.isclose(split_balances[(0, 3)], 0.75, abs_tol=1e-5)
    # Node (0, 4) splits into 4 and 3 -> 0.75
    assert math.isclose(split_balances[(0, 4)], 0.75, abs_tol=1e-5)
    # Node (0, 1) splits into 1 and 6 -> (7-6)/4 = 1/4 = 0.25
    assert math.isclose(split_balances[(0, 1)], 0.25, abs_tol=1e-5)


def test_cut_frontier_proximity():
    """Verify cut frontier proximity BFS gradient from active cuts."""
    env = HowlEnv(5, 5)
    
    # Before any cut: all 0.0
    obs, _ = env.reset()
    assert (obs[6] == 0.0).all()

    # Step 1: cut corner (0, 0)
    obs, _, terminated, _, _ = env.step((0, 0))
    assert not terminated
    assert (0, 0) in env.cuts_in_turn

    # 8-neighbors of (0, 0): (0, 1), (1, 0), (1, 1) must have proximity 1.0
    assert obs[6, 0, 1] == 1.0
    assert obs[6, 1, 0] == 1.0
    assert obs[6, 1, 1] == 1.0

    # 2-hops from (0, 0): e.g. (0, 2), (2, 0), (2, 2) must have proximity 0.5
    assert obs[6, 0, 2] == 0.5
    assert obs[6, 2, 0] == 0.5
    assert obs[6, 2, 2] == 0.5


def test_perimeter_action_masking_legality():
    """Verify 8-adjacent perimeter action mask correctly filters interior vs perimeter nodes."""
    env = HowlEnv(5, 5)
    env.reset()

    legal_coords = env.get_legal_coords(perimeter_only=True)
    mask = env.get_legal_action_mask(perimeter_only=True)

    # 5x5 has 16 outer boundary nodes and 9 interior nodes
    assert len(legal_coords) == 16
    assert mask.sum() == 16

    # Interior nodes (1,1), (2,2), (3,3) are not legal initially
    assert (1, 1) not in legal_coords
    assert (2, 2) not in legal_coords
    assert (3, 3) not in legal_coords

    # After cutting (0, 0), (1, 1) is now 8-adjacent to an empty cell -> becomes legal
    env.step((0, 0))
    legal_after_corner_cut = env.get_legal_coords(perimeter_only=True)
    assert (1, 1) in legal_after_corner_cut
    assert (2, 2) not in legal_after_corner_cut
