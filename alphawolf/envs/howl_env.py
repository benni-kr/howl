import math
import os
import sys
from collections import deque
from typing import Set, Tuple, List, Dict
import numpy as np
import gymnasium as gym
from gymnasium import spaces

_CORE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../core_engine"))
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)

from core_engine.graph_logic import GridGraph, filter_and_deduplicate

Vertex = Tuple[int, int]
MAX_ROWS = 10  # Kept as legacy default
MAX_COLS = 10  # Kept as legacy default


class HowlEnv(gym.Env):
    """
    Custom Gymnasium Environment for the Vertex k-Ranking problem on grid graphs.
    Supports arbitrary dynamic grid dimensions (m x n), 9-channel D4-invariant features,
    and 8-adjacent perimeter action masking.
    """
    def __init__(self, m: int, n: int, generate: bool = True):
        super().__init__()
        self.m = m
        self.n = n

        # Observation space: 9-channel 2D array of the actual grid dimensions
        self.observation_space = spaces.Box(low=0.0, high=1.0, shape=(9, m, n), dtype=np.float32)

        # Action space: Flattened 1D discrete selection across the m x n canvas
        self.action_space = spaces.Discrete(m * n)

        self.graph = None
        self.cuts_made = 0
        self.cuts_in_turn: Set[Vertex] = set()
        if generate:
            self.reset()
        else:
            # Caller will attach a graph directly (e.g. cloning from an observation)
            self.graph = GridGraph(m, n, generate=False)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.graph = GridGraph(self.m, self.n, generate=True)
        self.cuts_made = 0
        self.cuts_in_turn = set()
        return self._get_obs(), {}

    def get_legal_coords(self, perimeter_only: bool = True) -> Set[Vertex]:
        """
        Returns the set of legal cut coordinates.
        When perimeter_only is True (8-Adjacent to Empty rule), a vertex is legal
        if and only if it borders an empty field (deg_orth < 4 or deg_diag < 4).
        """
        if not perimeter_only:
            return set(self.graph.vertices)

        legal = set()
        diag_deltas = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
        for v in self.graph.vertices:
            deg_orth = len(self.graph.adjacency[v])
            if deg_orth < 4:
                legal.add(v)
                continue
            x, y = v
            diag_count = sum(1 for dx, dy in diag_deltas if (x + dx, y + dy) in self.graph.vertices)
            if diag_count < 4:
                legal.add(v)
        return legal

    def get_legal_action_mask(self, perimeter_only: bool = True) -> np.ndarray:
        """Returns a 1D boolean array of shape (m * n,) indicating legal actions."""
        mask = np.zeros(self.m * self.n, dtype=bool)
        legal_coords = self.get_legal_coords(perimeter_only=perimeter_only)
        for x, y in legal_coords:
            mask[x * self.n + y] = True
        return mask

    def _compute_component_features(self, component: Set[Vertex]) -> Dict[str, Dict[Vertex, float]]:
        """
        Computes all 8 node-level D4-invariant features for a single connected component.
        Returns a dictionary mapping feature names to per-vertex float values,
        plus component-level broadcast scalars.
        """
        V_len = len(component)
        if V_len == 0:
            return {
                "deg_orth": {}, "deg_diag": {}, "depth": {}, "radial": {},
                "split_balance": {}, "frontier": {}, "ar": 0.0, "solidity": 0.0
            }

        diag_deltas = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
        diag_orth_deltas = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

        # 1. deg_orth_norm & 2. deg_diag_norm
        deg_orth_map = {}
        deg_diag_map = {}
        perim_nodes = []
        for v in component:
            d_orth = len(self.graph.adjacency[v])
            deg_orth_map[v] = d_orth / 4.0
            if d_orth < 4:
                perim_nodes.append(v)
            x, y = v
            d_diag = sum(1 for dx, dy in diag_deltas if (x + dx, y + dy) in self.graph.vertices)
            deg_diag_map[v] = d_diag / 4.0

        # 3. boundary_depth_norm (Medial Axis BFS)
        depth_map = {v: 0 for v in perim_nodes}
        queue = deque(perim_nodes)
        while queue:
            curr = queue.popleft()
            d_curr = depth_map[curr]
            for neighbor in self.graph.adjacency[curr]:
                if neighbor in component and neighbor not in depth_map:
                    depth_map[neighbor] = d_curr + 1
                    queue.append(neighbor)

        max_depth = max(depth_map.values()) if depth_map else 0
        depth_norm_map = {v: (0.0 if max_depth == 0 else depth_map.get(v, 0) / max_depth) for v in component}

        # 4. radial_center_dist
        xc = sum(v[0] for v in component) / V_len
        yc = sum(v[1] for v in component) / V_len
        r_map = {v: math.hypot(v[0] - xc, v[1] - yc) for v in component}
        r_max = max(r_map.values()) if r_map else 0.0
        radial_norm_map = {v: (0.0 if (r_max < 1e-6 or V_len <= 1) else r_map[v] / r_max) for v in component}

        # 5. tarjan_split_balance
        split_balance_map = self._tarjan_split_balances(component)

        # 6. cut_frontier_proximity
        if not self.cuts_in_turn:
            frontier_map = {v: 0.0 for v in component}
        else:
            frontier_queue = deque()
            frontier_dist = {}
            for cut in self.cuts_in_turn:
                for dx, dy in diag_orth_deltas:
                    nb = (cut[0] + dx, cut[1] + dy)
                    if nb in component and nb not in frontier_dist:
                        frontier_dist[nb] = 1
                        frontier_queue.append(nb)
            while frontier_queue:
                curr = frontier_queue.popleft()
                d = frontier_dist[curr]
                for dx, dy in diag_orth_deltas:
                    nb = (curr[0] + dx, curr[1] + dy)
                    if nb in component and nb not in frontier_dist:
                        frontier_dist[nb] = d + 1
                        frontier_queue.append(nb)
            frontier_map = {v: (1.0 / frontier_dist[v] if v in frontier_dist else 0.0) for v in component}

        # 7. Aspect ratio & 8. Solidity
        xs = [v[0] for v in component]
        ys = [v[1] for v in component]
        dx = max(xs) - min(xs) + 1 if xs else 1
        dy = max(ys) - min(ys) + 1 if ys else 1
        aspect_ratio = min(dx, dy) / max(dx, dy)
        solidity = V_len / float(dx * dy)

        return {
            "deg_orth": deg_orth_map,
            "deg_diag": deg_diag_map,
            "depth": depth_norm_map,
            "radial": radial_norm_map,
            "split_balance": split_balance_map,
            "frontier": frontier_map,
            "ar": aspect_ratio,
            "solidity": solidity
        }

    def _tarjan_split_balances(self, component: Set[Vertex]) -> Dict[Vertex, float]:
        """
        Finds articulation points and calculates the quantitative split balance score:
        SplitBalance(v) = (|V_C| - 1 - max_i |S_i|) / max(|V_C| / 2.0, 1.0)
        """
        V_len = len(component)
        split_balances = {v: 0.0 for v in component}
        if V_len <= 2:
            return split_balances

        denom = max(V_len / 2.0, 1.0)
        adjacency = self.graph.adjacency

        disc = {}
        low = {}
        subtree_size = {v: 1 for v in component}
        counter = 0

        # Iterative Tarjan DFS to avoid recursion depth limits on large components
        for root in component:
            if root in disc:
                continue

            disc[root] = low[root] = counter
            counter += 1
            tree_children: Dict[Vertex, List[Vertex]] = {root: []}
            stack = [(root, None, iter(adjacency[root]))]
            traversal_order = []

            while stack:
                v, parent, nbr_iter = stack[-1]
                descended = False
                for w in nbr_iter:
                    if w not in component or w == parent:
                        continue
                    if w in disc:
                        # Back edge
                        low[v] = min(low[v], disc[w])
                    else:
                        # Tree edge: descend
                        disc[w] = low[w] = counter
                        counter += 1
                        tree_children.setdefault(v, []).append(w)
                        tree_children[w] = []
                        stack.append((w, v, iter(adjacency[w])))
                        descended = True
                        break

                if not descended:
                    stack.pop()
                    traversal_order.append((v, parent))

            # Post-order traversal to calculate subtree sizes and articulation split balance
            for v, parent in traversal_order:
                children = tree_children.get(v, [])
                for w in children:
                    low[v] = min(low[v], low[w])
                    subtree_size[v] += subtree_size[w]

                if parent is None:
                    # Root node
                    if len(children) >= 2:
                        pieces = [subtree_size[w] for w in children]
                        max_p = max(pieces)
                        balance = (V_len - 1 - max_p) / denom
                        split_balances[v] = max(0.0, min(1.0, balance))
                else:
                    # Non-root node
                    disconnecting = [subtree_size[w] for w in children if low[w] >= disc[v]]
                    if disconnecting:
                        rest_size = V_len - 1 - sum(disconnecting)
                        pieces = disconnecting + [rest_size]
                        max_p = max(pieces)
                        balance = (V_len - 1 - max_p) / denom
                        split_balances[v] = max(0.0, min(1.0, balance))

        return split_balances

    def _get_obs(self, components=None) -> np.ndarray:
        """
        Builds the 9-channel dense observation dynamically scaled to (9, m, n).
        Channels:
          0: is_active (binary mask)
          1: degree_orth_norm (deg_orth / 4.0)
          2: degree_diag_norm (deg_diag / 4.0)
          3: boundary_depth_norm (Medial axis BFS)
          4: radial_center_dist (Centroid Euclidean distance)
          5: tarjan_split_balance (Quantitative split balance)
          6: cut_frontier_proximity (BFS proximity to active cuts)
          7: aspect_ratio_inv (min(W, H) / max(W, H))
          8: component_solidity (|V_C| / (W * H))
        """
        obs = np.zeros((9, self.m, self.n), dtype=np.float32)

        if components is None:
            components = self.graph.get_component_vertex_sets()

        for component in components:
            feats = self._compute_component_features(component)
            ar = feats["ar"]
            solidity = feats["solidity"]

            for v in component:
                x, y = v
                obs[0, x, y] = 1.0
                obs[1, x, y] = feats["deg_orth"][v]
                obs[2, x, y] = feats["deg_diag"][v]
                obs[3, x, y] = feats["depth"][v]
                obs[4, x, y] = feats["radial"][v]
                obs[5, x, y] = feats["split_balance"][v]
                obs[6, x, y] = feats["frontier"][v]
                obs[7, x, y] = ar
                obs[8, x, y] = solidity

        return obs

    def to_pyg_data(self, device=None, perimeter_only: bool = True):
        """
        Directly exports the active graph state into a PyG Data object.
        Active vertices are deterministically ordered by sorted (x, y).
        Includes 8 node feature columns and legal_mask for action filtering.
        """
        import torch
        from torch_geometric.data import Data

        active_vertices = sorted(self.graph.vertices)
        V = len(active_vertices)

        if V == 0:
            x = torch.zeros((0, 8), dtype=torch.float32, device=device)
            edge_index = torch.zeros((2, 0), dtype=torch.long, device=device)
            coords = torch.zeros((0, 2), dtype=torch.long, device=device)
            legal_mask = torch.zeros((0,), dtype=torch.bool, device=device)
            return Data(x=x, edge_index=edge_index, coords=coords, legal_mask=legal_mask, m=self.m, n=self.n)

        coord_to_idx = {v: i for i, v in enumerate(active_vertices)}
        coords_tensor = torch.tensor(active_vertices, dtype=torch.long, device=device)

        components = self.graph.get_component_vertex_sets()
        comp_feats = [self._compute_component_features(comp) for comp in components]

        # Map each vertex to its component's feature dict
        v_to_feats = {}
        for comp, feats in zip(components, comp_feats):
            for v in comp:
                v_to_feats[v] = feats

        legal_coords = self.get_legal_coords(perimeter_only=perimeter_only)
        legal_mask_list = [v in legal_coords for v in active_vertices]

        node_feats = []
        src_list = []
        dst_list = []
        adjacency = self.graph.adjacency

        for v in active_vertices:
            f = v_to_feats[v]
            node_feats.append([
                f["deg_orth"][v],
                f["deg_diag"][v],
                f["depth"][v],
                f["radial"][v],
                f["split_balance"][v],
                f["frontier"][v],
                f["ar"],
                f["solidity"]
            ])

            idx_u = coord_to_idx[v]
            for neighbor in adjacency[v]:
                if neighbor in coord_to_idx:
                    src_list.append(idx_u)
                    dst_list.append(coord_to_idx[neighbor])

        x_tensor = torch.tensor(node_feats, dtype=torch.float32, device=device)
        legal_mask = torch.tensor(legal_mask_list, dtype=torch.bool, device=device)
        if src_list:
            edge_index = torch.tensor([src_list, dst_list], dtype=torch.long, device=device)
        else:
            edge_index = torch.zeros((2, 0), dtype=torch.long, device=device)

        return Data(x=x_tensor, edge_index=edge_index, coords=coords_tensor, legal_mask=legal_mask, m=self.m, n=self.n)

    def _articulation_points(self) -> Set[Vertex]:
        """Legacy helper returning articulation point coordinates."""
        components = self.graph.get_component_vertex_sets()
        art_points = set()
        for comp in components:
            sb = self._tarjan_split_balances(comp)
            for v, val in sb.items():
                if val > 0.0:
                    art_points.add(v)
        return art_points

    def step(self, action, compute_obs: bool = True):
        """Apply a cut. Accepts integer (row * n + col) or coordinate tuple (x, y)."""
        if isinstance(action, (int, np.integer)):
            x = int(action) // self.n
            y = int(action) % self.n
        elif isinstance(action, (tuple, list)):
            x, y = int(action[0]), int(action[1])
        else:
            raise TypeError(f"Action must be int or (x, y) tuple, got {type(action)}")

        vertex = (x, y)

        # Invalid action (cutting an already cut vertex)
        if vertex not in self.graph.vertices:
            obs = self._get_obs() if compute_obs else None
            return obs, -1, False, False, {"invalid": True}

        self.graph.apply_cut_set([vertex])
        self.cuts_made += 1

        fragments = self.graph.get_disconnected_subgraphs()
        unique_fragments, duplicate_fragments = filter_and_deduplicate(fragments)

        reward = -1
        terminated = False
        info = {}
        components = None
        if duplicate_fragments:
            info["duplicates"] = duplicate_fragments

        if len(unique_fragments) == 0:
            # Completely obliterated
            terminated = True
        elif len(unique_fragments) > 1:
            # Graph fractured into independent AND-nodes
            terminated = True
            info["fragments"] = unique_fragments
        else:
            # Still a single component — continue the cut sequence in this turn
            self.graph = unique_fragments[0]
            self.cuts_in_turn.add(vertex)
            components = [self.graph.vertices]

        obs = self._get_obs(components=components) if compute_obs else None
        return obs, reward, terminated, False, info
