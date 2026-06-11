import networkx as nx
import json
import datetime
import sys
import os

# Add parent directory to sys.path so we can import backend modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core_engine.hashing import generate_canonical_data, get_transformations

ROBUST_CACHE = {}


def get_vertex_rank(G):
    """Calculates exact vertex rank number chi_r(G)."""
    n_count = G.number_of_nodes()
    e_count = G.number_of_edges()
    cache_key = (n_count, e_count)

    if cache_key in ROBUST_CACHE:
        for cached_G, cached_rank in ROBUST_CACHE[cache_key]:
            if nx.is_isomorphic(G, cached_G):
                return cached_rank

    if n_count == 0: return 0
    if n_count == 1: return 1

    if not nx.is_connected(G):
        res = max(get_vertex_rank(G.subgraph(c).copy()) for c in nx.connected_components(G))
        ROBUST_CACHE.setdefault(cache_key, []).append((G.copy(), res))
        return res

    min_highest_subrank = float('inf')
    for v in G.nodes():
        subgraph = G.copy()
        subgraph.remove_node(v)
        if subgraph.number_of_nodes() == 0:
            subrank = 0
        else:
            subrank = max(get_vertex_rank(subgraph.subgraph(c).copy()) for c in nx.connected_components(subgraph))
        if subrank < min_highest_subrank:
            min_highest_subrank = subrank

    res = 1 + min_highest_subrank
    ROBUST_CACHE.setdefault(cache_key, []).append((G.copy(), res))
    return res


def get_optimal_coloring(G):
    """Recursively finds a valid coloring layout."""
    rank = get_vertex_rank(G)
    if rank == 0: return {}
    if rank == 1: return {list(G.nodes())[0]: 1}

    for v in G.nodes():
        subgraph = G.copy()
        subgraph.remove_node(v)
        components = [subgraph.subgraph(c).copy() for c in nx.connected_components(subgraph)]

        if all(get_vertex_rank(comp) < rank for comp in components):
            coloring = {v: rank}
            for comp in components:
                coloring.update(get_optimal_coloring(comp))
            return coloring
    return {}


def coloring_to_cut_sequence(colored_nodes):
    """Converts a list of colored nodes into a valid cut sequence (compact format)."""
    if not colored_nodes: return []
    
    sorted_nodes = sorted(colored_nodes, key=lambda n: n["rank"], reverse=True)
    
    cut_sequence = []
    for node in sorted_nodes:
        if node["rank"] > 1:
            cut_sequence.append({
                "t": "c",
                "v": [[node["x"], node["y"]]]
            })
            
    return cut_sequence


def get_neighbors(node):
    return [(node[0] + 1, node[1]), (node[0] - 1, node[1]), (node[0], node[1] + 1), (node[0], node[1] - 1)]


def normalize_coordinates(node_set):
    """Translates coordinates so the bottom-left corner is always (0,0)."""
    min_x = min(n[0] for n in node_set)
    min_y = min(n[1] for n in node_set)
    return frozenset((n[0] - min_x, n[1] - min_y) for n in node_set)


def export_to_sqlite(G, canonical_data, rank):
    """Handles the formatting and printing of the SQL insert statement."""
    # 1. Map coloring to the dictionary format expected by the cut sequence generator
    coloring_dict = get_optimal_coloring(G)
    colored_nodes = [{"x": x, "y": y, "rank": r} for (x, y), r in coloring_dict.items()]

    # 2. Generate the JSON string
    cut_seq = coloring_to_cut_sequence(colored_nodes)
    
    # Transform cut_seq to match canonical shape
    transform = get_transformations()[canonical_data["transform_idx"]]
    dx = canonical_data["shift_x"]
    dy = canonical_data["shift_y"]

    canonical_cut_seq = []
    for cut in cut_seq:
        new_vertices = []
        for v in cut["v"]:
            tx, ty = transform(v[0], v[1])
            new_vertices.append([tx - dx, ty - dy])
        canonical_cut_seq.append({"t": "c", "v": new_vertices})

    cut_seq_json = json.dumps(canonical_cut_seq)

    # 3. Use the canonical hash string
    hash_str = canonical_data["hash"]

    # 4. Generate timestamp
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")

    # 5. Output the SQL
    sql = (
        f"INSERT INTO subgraph_dictionary (hash, best_rank, is_optimal, best_cut_sequence, discovered_by, last_updated) "
        f"VALUES ('{hash_str}', {rank}, True, '{cut_seq_json}'::json, 'computer', '{timestamp}') "
        f"ON CONFLICT (hash) DO UPDATE SET "
        f"best_rank = EXCLUDED.best_rank, is_optimal = EXCLUDED.is_optimal, "
        f"best_cut_sequence = EXCLUDED.best_cut_sequence, discovered_by = EXCLUDED.discovered_by, "
        f"last_updated = EXCLUDED.last_updated;"
    )
    print(sql)


def generate_database_seed():
    unique_hashes = {2: set(), 3: set()}

    start_seed = normalize_coordinates(frozenset([(0, 0)]))
    queue = [start_seed]
    visited_sets = {start_seed}

    print("-- BEGIN TRANSACTION;")

    while queue:
        current_nodes = queue.pop(0)

        G = nx.Graph()
        G.add_nodes_from(current_nodes)
        for u in current_nodes:
            for v in get_neighbors(u):
                if v in current_nodes:
                    G.add_edge(u, v)

        rank = get_vertex_rank(G)

        if rank in [2, 3]:
            # Generate canonical data for the current shape
            verts = [{"x": x, "y": y} for x, y in G.nodes()]
            canonical_data = generate_canonical_data(verts)
            canonical_hash = canonical_data["hash"]

            if canonical_hash not in unique_hashes[rank]:
                unique_hashes[rank].add(canonical_hash)
                export_to_sqlite(G, canonical_data, rank)

        # Stop growing if it hits rank 4
        if rank < 4:
            perimeter_neighbors = set()
            for node in current_nodes:
                for nbr in get_neighbors(node):
                    if nbr not in current_nodes:
                        perimeter_neighbors.add(nbr)

            for nbr in perimeter_neighbors:
                new_nodes = normalize_coordinates(current_nodes | {nbr})
                if new_nodes not in visited_sets:
                    visited_sets.add(new_nodes)
                    queue.append(new_nodes)

    print("-- COMMIT;")


# Run the seeder
generate_database_seed()
