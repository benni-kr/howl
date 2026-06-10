"""Core graph logic for HOWL's grid-based ranking game."""

from __future__ import annotations

from collections import deque
from typing import Iterable, List, Set, Tuple

from core_engine.hashing import generate_canonical_hash

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


def filter_and_deduplicate(fragments: List[GridGraph]) -> List[GridGraph]:
    """
    Filters a list of subgraphs to remove canonical duplicates.
    Since Treedepth relies on a MAX() operator across independent fragments,
    max(A, A) = A. Thus, only one unique shape is needed.
    (Subgraph containment checks are explicitly skipped for V1 performance).
    """
    seen_hashes = set()
    unique_fragments = []
    
    for frag in fragments:
        if not frag.vertices:
            continue
        # Convert vertices (x, y) tuples to list of dicts for the hashing function
        verts = [{"x": x, "y": y} for x, y in frag.vertices]
        can_hash = generate_canonical_hash(verts)
        
        if can_hash not in seen_hashes:
            seen_hashes.add(can_hash)
            unique_fragments.append(frag)
            
    return unique_fragments

