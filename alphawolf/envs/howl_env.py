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
    def __init__(self, m: int, n: int):
        super().__init__()
        assert m <= MAX_ROWS and n <= MAX_COLS, f"Grid size {m}x{n} exceeds max {MAX_ROWS}x{MAX_COLS}"
        self.m = m
        self.n = n
        
        # Observation space: 2D array of the padded grid (1 = active vertex, 0 = removed/padded)
        self.observation_space = spaces.Box(low=0, high=1, shape=(MAX_ROWS, MAX_COLS), dtype=np.int8)
        
        # Action space: Flattened 1D discrete selection across the full 10x10 canvas
        self.action_space = spaces.Discrete(MAX_ROWS * MAX_COLS)
        
        self.graph = None
        self.cuts_made = 0
        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.graph = GridGraph(self.m, self.n, generate=True)
        self.cuts_made = 0
        return self._get_obs(), {}

    def _get_obs(self):
        obs = np.zeros((MAX_ROWS, MAX_COLS), dtype=np.int8)
        for (x, y) in self.graph.vertices:
            obs[x, y] = 1
        return obs

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
