import os
import sys
import numpy as np
import gymnasium as gym
from gymnasium import spaces

_CORE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../core_engine"))
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)

from core_engine.graph_logic import GridGraph, filter_and_deduplicate

MAX_ROWS = 10  # Kept as legacy default
MAX_COLS = 10  # Kept as legacy default


class HowlEnv(gym.Env):
    """
    Custom Gymnasium Environment for the Vertex k-Ranking problem on grid graphs.
    Supports arbitrary dynamic grid dimensions (m x n) and direct PyG export.
    """
    def __init__(self, m: int, n: int, generate: bool = True):
        super().__init__()
        self.m = m
        self.n = n

        # Observation space: 5-channel 2D array of the actual grid dimensions
        self.observation_space = spaces.Box(low=0, high=1, shape=(5, m, n), dtype=np.float32)

        # Action space: Flattened 1D discrete selection across the m x n canvas (or coordinate tuple)
        self.action_space = spaces.Discrete(m * n)

        self.graph = None
        self.cuts_made = 0
        if generate:
            self.reset()
        else:
            # Caller will attach a graph directly (e.g. cloning from an observation)
            self.graph = GridGraph(m, n, generate=False)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.graph = GridGraph(self.m, self.n, generate=True)
        self.cuts_made = 0
        return self._get_obs(), {}

    def _get_obs(self, components=None):
        """Build the observation dynamically scaled to (5, m, n)."""
        obs = np.zeros((5, self.m, self.n), dtype=np.float32)

        adjacency = self.graph.adjacency
        if components is None:
            components = self.graph.get_component_vertex_sets()

        for comp_idx, component in enumerate(components):
            comp_id_val = (comp_idx + 1) / max(1, len(components))

            for vertex in component:
                x, y = vertex
                degree = len(adjacency[vertex])

                # Ch 0: Binary Mask
                obs[0, x, y] = 1.0

                # Ch 1: Degree Map
                obs[1, x, y] = degree / 4.0

                # Ch 2: Border Mask
                obs[2, x, y] = 1.0 if degree < 4 else 0.0

                # Ch 3: Component ID
                obs[3, x, y] = comp_id_val

        # Ch 4: Articulation Points (Tarjan, O(V+E) over all components)
        for x, y in self._articulation_points():
            obs[4, x, y] = 1.0

        return obs

    def to_pyg_data(self, device=None):
        """
        Directly exports the active graph state into a PyG Data object.
        Active vertices are deterministically ordered by sorted (x, y).
        """
        import torch
        from torch_geometric.data import Data

        active_vertices = sorted(self.graph.vertices)
        V = len(active_vertices)

        if V == 0:
            x = torch.zeros((0, 4), dtype=torch.float32, device=device)
            edge_index = torch.zeros((2, 0), dtype=torch.long, device=device)
            coords = torch.zeros((0, 2), dtype=torch.long, device=device)
            return Data(x=x, edge_index=edge_index, coords=coords, m=self.m, n=self.n)

        coord_to_idx = {v: i for i, v in enumerate(active_vertices)}
        coords_tensor = torch.tensor(active_vertices, dtype=torch.long, device=device)

        adjacency = self.graph.adjacency
        components = self.graph.get_component_vertex_sets()
        comp_map = {}
        for comp_idx, comp in enumerate(components):
            val = (comp_idx + 1) / max(1, len(components))
            for v in comp:
                comp_map[v] = val

        art_points = self._articulation_points()

        node_feats = []
        src_list = []
        dst_list = []

        for v in active_vertices:
            deg = len(adjacency[v])
            deg_norm = deg / 4.0
            border = 1.0 if deg < 4 else 0.0
            comp_id = comp_map.get(v, 1.0)
            art = 1.0 if v in art_points else 0.0
            node_feats.append([deg_norm, border, comp_id, art])

            idx_u = coord_to_idx[v]
            for neighbor in adjacency[v]:
                if neighbor in coord_to_idx:
                    src_list.append(idx_u)
                    dst_list.append(coord_to_idx[neighbor])

        x_tensor = torch.tensor(node_feats, dtype=torch.float32, device=device)
        if src_list:
            edge_index = torch.tensor([src_list, dst_list], dtype=torch.long, device=device)
        else:
            edge_index = torch.zeros((2, 0), dtype=torch.long, device=device)

        return Data(x=x_tensor, edge_index=edge_index, coords=coords_tensor, m=self.m, n=self.n)

    def _articulation_points(self):
        """Finds all articulation points via Tarjan's algorithm (iterative DFS)."""
        adjacency = self.graph.adjacency
        disc = {}
        low = {}
        points = set()
        counter = 0

        for root in adjacency:
            if root in disc:
                continue

            disc[root] = low[root] = counter
            counter += 1
            root_children = 0
            stack = [(root, None, iter(adjacency[root]))]

            while stack:
                v, parent, neighbors_iter = stack[-1]
                descended = False
                for w in neighbors_iter:
                    if w == parent:
                        continue
                    if w in disc:
                        # Back edge
                        low[v] = min(low[v], disc[w])
                    else:
                        # Tree edge: descend
                        disc[w] = low[w] = counter
                        counter += 1
                        stack.append((w, v, iter(adjacency[w])))
                        descended = True
                        break

                if not descended:
                    stack.pop()
                    if parent is not None:
                        low[parent] = min(low[parent], low[v])
                        if parent == root:
                            root_children += 1
                        elif low[v] >= disc[parent]:
                            points.add(parent)

            if root_children >= 2:
                points.add(root)

        return points

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
            # Still a single component — reuse that knowledge in _get_obs
            self.graph = unique_fragments[0]
            components = [self.graph.vertices]

        obs = self._get_obs(components=components) if compute_obs else None
        return obs, reward, terminated, False, info
