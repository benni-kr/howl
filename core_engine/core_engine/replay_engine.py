from core_engine.graph_logic import GridGraph
from core_engine.hashing import generate_canonical_data, get_transformations

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

def _normalize_action(action: dict) -> dict | None:
    """Convert a single action from any known format to compact format.

    Handles:
      - Compact:  {t: "c", v: [[x,y], ...]}              → pass-through
      - Verbose:  {type: "cut", vertices: [{x, y}, ...]}  → compact
    Returns None for unrecognizable actions.
    """
    if not action or not isinstance(action, dict):
        return None

    # Already compact format — has "t" key
    if "t" in action:
        return action

    # Verbose format — has "type" key
    action_type = action.get("type")
    if not action_type:
        return None

    type_map = {"cut": "c", "vaporize": "v", "ignore": "i", "subgraph": "s"}
    t = type_map.get(action_type)
    if t is None:
        return None

    raw_verts = action.get("vertices", [])
    # Vertices may be [{x, y}, ...] dicts or [[x, y], ...] tuples
    v = []
    for vert in raw_verts:
        if isinstance(vert, dict):
            v.append([vert["x"], vert["y"]])
        else:
            v.append([vert[0], vert[1]])

    compact: dict = {"t": t, "v": v}
    if t == "v" and "optimal_rank" in action:
        compact["r"] = action["optimal_rank"]
    elif t == "v" and "r" in action:
        compact["r"] = action["r"]
    return compact

def _normalize_sequence(sequence: list) -> list:
    """Normalize a full cut sequence to compact format."""
    result = []
    for action in sequence:
        normalized = _normalize_action(action)
        if normalized:
            result.append(normalized)
    return result

def replay_and_extract_subgraphs(m: int, n: int, flat_cut_sequence: list) -> dict[str, dict]:
    """
    Replay a chronological sequence of cuts to build a tree of subgraphs,
    then calculate the intrinsic optimal rank for every node bottom-up.

    Compact payload format:
      ``{t: "c", v: [[x,y], ...]}``           — cut
      ``{t: "v", v: [[x,y], ...], r: N}``     — vaporize with known rank
      ``{t: "i", v: [[x,y], ...]}``           — ignore (duplicate removal)

    Returns:
        tuple[dict[str, dict], int]: A tuple containing the mapping of canonical_hash to rank/sequence dict, 
        and the total intrinsic rank of the root graph (which will be >= 999999 if the solution is incomplete).
    """
    root = TreeNode(GridGraph(m, n, generate=True))
    active_nodes = [root]

    flat_cut_sequence = _normalize_sequence(flat_cut_sequence)

    for action in flat_cut_sequence:
        if not action:
            continue

        action_type = action.get("t", "c")
        raw_vertices = action.get("v", [])

        if action_type in ("v", "i", "s"):
            vap_tuples = _to_tuples(raw_vertices)
            if not vap_tuples:
                continue
                
            vap_set = set(vap_tuples)
            target_node = None
            
            for node in active_nodes:
                if vap_set == node.graph.vertices:
                    target_node = node
                    break
                    
            if not target_node:
                for node in active_nodes:
                    if vap_tuples[0] in node.graph.vertices:
                        target_node = node
                        break
            if not target_node:
                raise ValueError(f"Invalid vaporize target: {vap_tuples}")

            active_nodes.remove(target_node)
            if action_type == "v":
                target_node.vaporized_rank = action.get("r", 999999)
            else:
                target_node.ignored = True
            continue

        cut_tuples = _to_tuples(raw_vertices)
        if not cut_tuples:
            continue

        target_node = None
        cut_set = set(cut_tuples)
        for node in active_nodes:
            if cut_set.issubset(node.graph.vertices):
                target_node = node
                break

        if not target_node:
            raise ValueError(f"Invalid cut target: {cut_tuples}")

        active_nodes.remove(target_node)
        target_node.cut_size = len(cut_tuples)
        target_node.graph.apply_cut_set(cut_tuples)

        subgraphs = target_node.graph.get_disconnected_subgraphs()
        for sg in subgraphs:
            child = TreeNode(sg)
            target_node.children.append(child)
            active_nodes.append(child)

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
            new_action = dict(action)
            new_vertices = []
            for coord in action.get("v", []):
                tx, ty = transform(coord[0], coord[1])
                new_vertices.append([tx - dx, ty - dy])
            new_action["v"] = new_vertices
            transformed_seq.append(new_action)
        return transformed_seq

    ranks_dict: dict[str, dict] = {}

    def calc_intrinsic_rank(node: TreeNode) -> int:
        if getattr(node, "ignored", False):
            rank = 0
        elif node.vaporized_rank is not None:
            rank = node.vaporized_rank
        elif node.original_vertex_count <= 1:
            rank = 1
        elif not node.children:
            if node.cut_size > 0:
                rank = node.cut_size
            else:
                return 999999
        else:
            child_ranks = [calc_intrinsic_rank(child) for child in node.children]
            rank = node.cut_size + max(child_ranks)

        is_obliterated = node.original_vertex_count > 1 and not node.children
        if rank < 999999 and node.canonical_hash and not is_obliterated and not getattr(node, "ignored", False):
            if node.canonical_hash not in ranks_dict or rank < ranks_dict[node.canonical_hash]["rank"]:
                local_seq = extract_local_sequence(node.original_vertices, flat_cut_sequence)
                transformed_seq = transform_sequence(local_seq, node.canonical_data)
                ranks_dict[node.canonical_hash] = {
                    "rank": rank,
                    "sequence": transformed_seq,
                    "shape_str": node.canonical_data["shape_str"]
                }

        return rank

    root_rank = calc_intrinsic_rank(root)
    return ranks_dict, root_rank


def canonicalize_grid_solution(m: int, n: int, cut_sequence: list) -> tuple[int, int, list]:
    """
    Canonicalizes grid dimensions to ensure m >= n.
    If m < n, transposes dimensions to (n, m) and all coordinates [x, y] -> [y, x].
    """
    if m >= n:
        return m, n, cut_sequence

    transposed_seq = []
    for action in cut_sequence:
        norm = _normalize_action(action)
        if norm is None:
            continue
        act = dict(norm)
        if "v" in act and isinstance(act["v"], list):
            act["v"] = [[y, x] for x, y in act["v"]]
        transposed_seq.append(act)
    return n, m, transposed_seq

