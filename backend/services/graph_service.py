from typing import List, Optional, Tuple

from graph_logic import GridGraph

Coordinate = Tuple[int, int]
Edge = Tuple[Coordinate, Coordinate]

def build_graph(vertices: List[Coordinate], edges: Optional[List[Edge]]) -> GridGraph:
    if not vertices:
        graph = GridGraph(1, 1, generate=False)
        graph.vertices = set()
        graph.adjacency = {}
        return graph

    max_x = max(x for x, _ in vertices)
    max_y = max(y for _, y in vertices)
    graph = GridGraph(max_x + 1, max_y + 1, generate=False)

    vertex_set = {tuple(vertex) for vertex in vertices}
    adjacency = {vertex: set() for vertex in vertex_set}

    if edges is None:
        for x, y in vertex_set:
            right = (x + 1, y)
            down = (x, y + 1)
            if right in vertex_set:
                adjacency[(x, y)].add(right)
                adjacency[right].add((x, y))
            if down in vertex_set:
                adjacency[(x, y)].add(down)
                adjacency[down].add((x, y))
    else:
        for a, b in edges:
            a_coord = tuple(a)
            b_coord = tuple(b)
            if a_coord not in vertex_set or b_coord not in vertex_set:
                continue
            adjacency[a_coord].add(b_coord)
            adjacency[b_coord].add(a_coord)

    graph.vertices = vertex_set
    graph.adjacency = adjacency
    return graph


def serialize_graph(graph: GridGraph) -> dict:
    vertices = sorted(graph.vertices, key=lambda v: (v[0], v[1]))
    edges: List[Edge] = []
    seen = set()

    for a, neighbors in graph.adjacency.items():
        for b in neighbors:
            key = (a, b) if a <= b else (b, a)
            if key in seen:
                continue
            seen.add(key)
            edges.append(key)

    edges.sort(key=lambda e: (e[0][0], e[0][1], e[1][0], e[1][1]))
    return {
        "vertices": [[x, y] for x, y in vertices],
        "edges": [[[a[0], a[1]], [b[0], b[1]]] for a, b in edges],
    }
