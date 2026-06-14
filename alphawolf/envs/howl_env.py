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
        
        # Observation space: 5-channel 2D array of the padded grid
        self.observation_space = spaces.Box(low=0, high=1, shape=(5, MAX_ROWS, MAX_COLS), dtype=np.float32)
        
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
        obs = np.zeros((5, MAX_ROWS, MAX_COLS), dtype=np.float32)
        
        fragments = self.graph.get_disconnected_subgraphs()
        
        for comp_idx, fragment in enumerate(fragments):
            comp_id_val = (comp_idx + 1) / max(1, len(fragments))
            
            for vertex in fragment.vertices:
                x, y = vertex
                
                # Ch 0: Binary Mask
                obs[0, x, y] = 1.0
                
                # Ch 1: Degree Map
                neighbors = self.graph.adjacency[vertex]
                degree = len(neighbors)
                obs[1, x, y] = degree / 4.0
                
                # Ch 2: Border Mask
                obs[2, x, y] = 1.0 if degree < 4 else 0.0
                
                # Ch 3: Component ID
                obs[3, x, y] = comp_id_val
                
                # Ch 4: Articulation Points
                if degree > 1:
                    neighbors_list = list(neighbors)
                    start = neighbors_list[0]
                    visited = {vertex} # Mask out the current vertex
                    queue = [start]
                    visited.add(start)
                    reachable_neighbors = 1
                    
                    while queue:
                        curr = queue.pop(0)
                        for nxt in self.graph.adjacency[curr]:
                            if nxt not in visited:
                                visited.add(nxt)
                                queue.append(nxt)
                                if nxt in neighbors_list:
                                    reachable_neighbors += 1
                                    
                    if reachable_neighbors < len(neighbors_list):
                        obs[4, x, y] = 1.0
                        
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
