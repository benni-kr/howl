"""Core graph logic for HOWL's grid-based ranking game."""

from __future__ import annotations

from collections import deque
from typing import Iterable, List, Set, Tuple

Vertex = Tuple[int, int]


class GridGraph:
    """Represents an m x n grid graph with 4-neighbor adjacency."""

    def __init__(self, m: int, n: int, *, generate: bool = True) -> None:
        """
        Initialize a grid graph with dimensions m (width) and n (height).

        Args:
            m: Number of columns (x dimension), must be positive.
            n: Number of rows (y dimension), must be positive.
            generate: When True, populate the full m x n grid. Internal use only.
        """
        if m <= 0 or n <= 0:
            raise ValueError("Grid dimensions must be positive integers.")

        self.m = m
        self.n = n
        self.vertices: Set[Vertex] = set()
        self.adjacency: dict[Vertex, Set[Vertex]] = {}

        if generate:
            self._generate_grid()

    def _generate_grid(self) -> None:
        """Generate vertices and edges for a standard m x n grid."""
        for x in range(self.m):
            for y in range(self.n):
                self._add_vertex((x, y))

        for x in range(self.m):
            for y in range(self.n):
                current = (x, y)
                if x + 1 < self.m:
                    self._add_edge(current, (x + 1, y))
                if y + 1 < self.n:
                    self._add_edge(current, (x, y + 1))

    def _add_vertex(self, vertex: Vertex) -> None:
        """Add a vertex to the graph."""
        self.vertices.add(vertex)
        self.adjacency.setdefault(vertex, set())

    def _add_edge(self, a: Vertex, b: Vertex) -> None:
        """Add an undirected edge between a and b."""
        self.adjacency[a].add(b)
        self.adjacency[b].add(a)

    def apply_cut_set(self, vertices_to_remove: Iterable[Vertex]) -> None:
        """
        Remove vertices (and their incident edges) from the graph.

        Args:
            vertices_to_remove: Iterable of (x, y) coordinates to delete.
        """
        to_remove = set(vertices_to_remove)
        for vertex in to_remove:
            if vertex not in self.vertices:
                continue
            for neighbor in self.adjacency[vertex]:
                self.adjacency[neighbor].discard(vertex)
            self.adjacency.pop(vertex, None)
            self.vertices.discard(vertex)

    def get_disconnected_subgraphs(self) -> List["GridGraph"]:
        """
        Return a list of disconnected subgraphs after cuts.

        Each subgraph is a GridGraph containing only the vertices and edges
        from one connected component.
        """
        visited: Set[Vertex] = set()
        subgraphs: List[GridGraph] = []

        for start in self.vertices:
            if start in visited:
                continue
            component = self._bfs_component(start, visited)
            subgraphs.append(self._build_subgraph(component))

        return subgraphs

    def _bfs_component(self, start: Vertex, visited: Set[Vertex]) -> Set[Vertex]:
        """Collect vertices in a connected component using BFS."""
        component: Set[Vertex] = set()
        queue: deque[Vertex] = deque([start])
        visited.add(start)

        while queue:
            current = queue.popleft()
            component.add(current)
            for neighbor in self.adjacency[current]:
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                queue.append(neighbor)

        return component

    def _build_subgraph(self, component_vertices: Set[Vertex]) -> "GridGraph":
        """Build a GridGraph from a set of component vertices."""
        subgraph = GridGraph(self.m, self.n, generate=False)
        subgraph.vertices = set(component_vertices)
        subgraph.adjacency = {
            vertex: set(self.adjacency[vertex]).intersection(component_vertices)
            for vertex in component_vertices
        }
        return subgraph


def get_transformations():
    """Returns the 8 D4 transformations as lambda functions."""
    return [
        lambda x, y: (x, y),           # Identity
        lambda x, y: (-y, x),          # Rot 90
        lambda x, y: (-x, -y),         # Rot 180
        lambda x, y: (y, -x),          # Rot 270
        lambda x, y: (-x, y),          # Reflect X
        lambda x, y: (-y, -x),         # Reflect X + Rot 90
        lambda x, y: (x, -y),          # Reflect X + Rot 180
        lambda x, y: (y, x),           # Reflect X + Rot 270
    ]


def generate_canonical_data(vertices: list[dict]) -> dict:
    """
    Generate a canonical hash and the metadata required to transform 
    any other coordinates into this exact canonical space.
    """
    if not vertices:
        return {"hash": "", "transform_idx": 0, "shift_x": 0, "shift_y": 0}

    coords = [(v["x"], v["y"]) for v in vertices]
    transforms = get_transformations()
    
    best_hash = None
    best_meta = {}

    for idx, transform in enumerate(transforms):
        transformed = [transform(x, y) for x, y in coords]
        min_x = min(x for x, _ in transformed)
        min_y = min(y for _, y in transformed)
        
        normalized = sorted((x - min_x, y - min_y) for x, y in transformed)
        candidate_string = "|".join(f"{x},{y}" for x, y in normalized)
        
        if best_hash is None or candidate_string < best_hash:
            best_hash = candidate_string
            best_meta = {
                "hash": best_hash,
                "transform_idx": idx,
                "shift_x": min_x,
                "shift_y": min_y
            }

    return best_meta


def generate_canonical_hash(vertices: list[dict]) -> str:
    """Wrapper that just returns the canonical hash string."""
    return generate_canonical_data(vertices)["hash"]

class TreeNode:
    """A node in the replay tree built during solution replay.

    Each node represents a subgraph at one point in time.  Cutting a node
    produces child nodes (one per connected component).  Vaporizing a node
    marks it as auto-solved with a known rank.

    Attributes:
        graph:                 The underlying GridGraph (mutated in-place by cuts).
        original_vertex_count: Vertex count captured *before* any cuts mutate the graph.
        canonical_hash:        Rotation/reflection-invariant shape identifier.
        children:              Child TreeNodes produced by cutting this node.
        cut_size:              Number of vertices removed in the cut that split this node.
        vaporized_rank:        If set, this node was auto-solved; value is the known rank.
    """

    def __init__(self, graph: GridGraph):
        self.graph = graph
        self.original_vertices = set(graph.vertices)
        self.original_vertex_count = len(graph.vertices)
        verts = [{"x": x, "y": y} for x, y in graph.vertices]
        self.canonical_data = generate_canonical_data(verts)
        self.canonical_hash = self.canonical_data["hash"]
        self.children: list[TreeNode] = []
        self.cut_size: int = 0
        self.vaporized_rank: int | None = None
        self.ignored: bool = False

def _to_tuples(vertices: list) -> list[tuple[int, int]]:
    """Convert a vertex list of [x, y] pairs to (x, y) tuples."""
    if not vertices:
        return []
    return [(v[0], v[1]) for v in vertices]


def replay_and_extract_subgraphs(m: int, n: int, flat_cut_sequence: list) -> dict[str, dict]:
    """
    Replay a chronological sequence of cuts to build a tree of subgraphs,
    then calculate the intrinsic optimal rank for every node bottom-up.

    Compact payload format:
      ``{t: "c", v: [[x,y], ...]}``           — cut
      ``{t: "v", v: [[x,y], ...], r: N}``     — vaporize with known rank
      ``{t: "i", v: [[x,y], ...]}``           — ignore (duplicate removal)

    Returns:
        dict: Mapping from canonical_hash to dict with rank and best_cut_sequence.
    """
    root = TreeNode(GridGraph(m, n, generate=True))
    active_nodes = [root]

    for action in flat_cut_sequence:
        if not action:
            continue

        # ------------------------------------------------------------------
        # Determine action type and raw vertex list
        # ------------------------------------------------------------------
        action_type = action.get("t", "c")
        raw_vertices = action.get("v", [])

        # ------------------------------------------------------------------
        # Handle VAPORIZE and IGNORE
        # ------------------------------------------------------------------
        if action_type in ("v", "i"):
            vap_tuples = _to_tuples(raw_vertices)
            if not vap_tuples:
                continue
                
            vap_set = set(vap_tuples)
            target_node = None
            
            # Exact match by coordinate set (order-independent, spatially accurate)
            for node in active_nodes:
                if vap_set == node.graph.vertices:
                    target_node = node
                    break
                    
            if target_node is None:
                # Fallback: single-vertex probe (handles edge cases where
                # vertices might differ slightly due to disconnected leftovers)
                for node in active_nodes:
                    if vap_tuples[0] in node.graph.vertices:
                        target_node = node
                        break
                        
            if target_node:
                active_nodes.remove(target_node)
                if action_type == "v":
                    target_node.vaporized_rank = action.get("r", 999999)
                elif action_type == "i":
                    target_node.ignored = True
            continue

        # ------------------------------------------------------------------
        # Handle CUT
        # ------------------------------------------------------------------
        cut_tuples = _to_tuples(raw_vertices)
        if not cut_tuples:
            continue

        # Find which active node contains ALL cut vertices (not just the first).
        # This is more robust than a single-vertex probe.
        target_node = None
        cut_set = set(cut_tuples)
        for node in active_nodes:
            if cut_set.issubset(node.graph.vertices):
                target_node = node
                break

        if not target_node:
            # Cut doesn't apply to any active node — should not happen in a valid sequence.
            continue

        active_nodes.remove(target_node)

        target_node.cut_size = len(cut_tuples)
        target_node.graph.apply_cut_set(cut_tuples)

        subgraphs = target_node.graph.get_disconnected_subgraphs()
        for sg in subgraphs:
            child = TreeNode(sg)
            target_node.children.append(child)
            active_nodes.append(child)

    # ------------------------------------------------------------------
    # Local sequence filtering and transformation
    # ------------------------------------------------------------------
    def extract_local_sequence(original_vertices: set[tuple[int, int]], global_sequence: list) -> list:
        local_seq = []
        for action in global_sequence:
            if not action:
                continue
            action_vertices = set((x, y) for x, y in action.get("v", []))
            
            if action_vertices and action_vertices.issubset(original_vertices):
                local_seq.append(action)
        return local_seq

    def transform_sequence(local_seq: list, canonical_data: dict) -> list:
        transform = get_transformations()[canonical_data["transform_idx"]]
        dx = canonical_data["shift_x"]
        dy = canonical_data["shift_y"]

        transformed_seq = []
        for action in local_seq:
            new_action = dict(action)  # shallow copy
            new_vertices = []
            for coord in action.get("v", []):
                tx, ty = transform(coord[0], coord[1])
                new_vertices.append([tx - dx, ty - dy])
            new_action["v"] = new_vertices
            transformed_seq.append(new_action)
        return transformed_seq

    # ------------------------------------------------------------------
    # Bottom-up rank calculation
    # ------------------------------------------------------------------
    ranks_dict: dict[str, dict] = {}

    def calc_intrinsic_rank(node: TreeNode) -> int:
        """Compute the intrinsic rank of a tree node bottom-up."""
        if getattr(node, "ignored", False):
            rank = 0
        elif node.vaporized_rank is not None:
            rank = node.vaporized_rank
        elif node.original_vertex_count <= 1:
            rank = 1
        elif not node.children:
            # Leaf that was never split further.
            if node.cut_size > 0:
                # "Obliterated" — the entire parent was removed in one cut.
                rank = node.cut_size
            else:
                # Untouched graph that was never cut — not a real solution.
                return 999999
        else:
            child_ranks = [calc_intrinsic_rank(child) for child in node.children]
            rank = node.cut_size + max(child_ranks)

        # Only save non-obliterated, non-sentinel entries, and skip ignored nodes.
        is_obliterated = node.original_vertex_count > 1 and not node.children
        if rank < 999999 and node.canonical_hash and not is_obliterated and not getattr(node, "ignored", False):
            if node.canonical_hash not in ranks_dict or rank < ranks_dict[node.canonical_hash]["rank"]:
                local_seq = extract_local_sequence(node.original_vertices, flat_cut_sequence)
                transformed_seq = transform_sequence(local_seq, node.canonical_data)
                ranks_dict[node.canonical_hash] = {
                    "rank": rank,
                    "sequence": transformed_seq
                }

        return rank

    calc_intrinsic_rank(root)
    return ranks_dict

