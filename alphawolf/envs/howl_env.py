import numpy as np
import gymnasium as gym
from gymnasium import spaces

from core_engine.graph_logic import GridGraph, filter_and_deduplicate

MAX_ROWS = 10
MAX_COLS = 10

class HowlEnv(gym.Env):
    """
    Custom Gymnasium Environment for the Vertex k-Ranking problem on grid graphs.
    """
    def __init__(self, m: int, n: int, generate: bool = True):
        super().__init__()
        assert m <= MAX_ROWS and n <= MAX_COLS, f"Grid size {m}x{n} exceeds max {MAX_ROWS}x{MAX_COLS}"
        self.m = m
        self.n = n

        # Observation space: 5-channel 2D array of the padded grid
        self.observation_space = spaces.Box(low=0, high=1, shape=(5, MAX_ROWS, MAX_COLS), dtype=np.float32)

        # Action space: Flattened 1D discrete selection across the full 10x10 canvas
        self.action_space = spaces.Discrete(MAX_ROWS * MAX_COLS)

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

    def _get_obs(self):
        obs = np.zeros((5, MAX_ROWS, MAX_COLS), dtype=np.float32)

        adjacency = self.graph.adjacency
        fragments = self.graph.get_disconnected_subgraphs()

        for comp_idx, fragment in enumerate(fragments):
            comp_id_val = (comp_idx + 1) / max(1, len(fragments))

            for vertex in fragment.vertices:
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

    def step(self, action: int):
        x = action // MAX_COLS
        y = action % MAX_COLS
        vertex = (x, y)
        
        # Invalid action (cutting an already cut vertex)
        if vertex not in self.graph.vertices:
            return self._get_obs(), -1, False, False, {"invalid": True}
        
        self.graph.apply_cut_set([vertex])
        self.cuts_made += 1
        
        fragments = self.graph.get_disconnected_subgraphs()
        unique_fragments, duplicate_fragments = filter_and_deduplicate(fragments)
        
        reward = -1
        terminated = False
        info = {}
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
            # Still a single component
            self.graph = unique_fragments[0]
            
        return self._get_obs(), reward, terminated, False, info
