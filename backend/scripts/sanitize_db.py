import os
import sys
import json
import logging
import argparse

# Setup imports to work from scripts directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from database import SessionLocal
from models import GridSolution, SubgraphDictionary
from core_engine.replay_engine import replay_and_extract_subgraphs, TreeNode, _normalize_sequence, _to_tuples
from core_engine.graph_logic import GridGraph
from core_engine.hashing import generate_canonical_data, get_transformations

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# We need a custom replay function for arbitrary subgraphs since replay_engine only takes m, n.
def replay_subgraph_sequence(graph: GridGraph, sequence: list) -> int:
    root = TreeNode(graph)
    active_nodes = [root]
    sequence = _normalize_sequence(sequence)

    for action in sequence:
        if not action: continue
        action_type = action.get("t", "c")
        raw_vertices = action.get("v", [])

        if action_type in ("v", "i", "s"):
            vap_tuples = _to_tuples(raw_vertices)
            if not vap_tuples: continue
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
        if not cut_tuples: continue
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

        for sg in target_node.graph.get_disconnected_subgraphs():
            child = TreeNode(sg)
            target_node.children.append(child)
            active_nodes.append(child)

    def calc_rank(node: TreeNode) -> int:
        if getattr(node, "ignored", False): return 0
        if node.vaporized_rank is not None: return node.vaporized_rank
        if node.original_vertex_count <= 1: return 1
        if not node.children:
            if node.cut_size > 0: return node.cut_size
            return 999999
        return node.cut_size + max(calc_rank(c) for c in node.children)

    return calc_rank(root)

def replay_and_collect_graphs(m: int, n: int, flat_cut_sequence: list, hash_to_graph: dict) -> int:
    root = TreeNode(GridGraph(m, n, generate=True))
    active_nodes = [root]
    flat_cut_sequence = _normalize_sequence(flat_cut_sequence)

    for action in flat_cut_sequence:
        if not action: continue
        action_type = action.get("t", "c")
        raw_vertices = action.get("v", [])

        if action_type in ("v", "i", "s"):
            vap_tuples = _to_tuples(raw_vertices)
            if not vap_tuples: continue
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
        if not cut_tuples: continue
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

        for sg in target_node.graph.get_disconnected_subgraphs():
            child = TreeNode(sg)
            target_node.children.append(child)
            active_nodes.append(child)

    def calc_intrinsic_rank(node: TreeNode) -> int:
        if getattr(node, "ignored", False): rank = 0
        elif node.vaporized_rank is not None: rank = node.vaporized_rank
        elif node.original_vertex_count <= 1: rank = 1
        elif not node.children:
            if node.cut_size > 0: rank = node.cut_size
            else: return 999999
        else:
            child_ranks = [calc_intrinsic_rank(child) for child in node.children]
            rank = node.cut_size + max(child_ranks)

        is_obliterated = node.original_vertex_count > 1 and not node.children
        if node.canonical_hash and not getattr(node, "ignored", False):
            # Parse the shape_str to get the exact normalized canonical coordinates
            # This ensures that canonical cut sequences match the canonical graph vertices!
            can_data = generate_canonical_data([{"x": x, "y": y} for x, y in node.original_vertices])
            canonical_vertices = [tuple(map(int, v.split(','))) for v in can_data["shape_str"].split('|')]
            
            graph_copy = GridGraph(1, 1, generate=False)
            graph_copy.vertices = set(canonical_vertices)
            graph_copy.adjacency = {v: set() for v in graph_copy.vertices}
            for v in graph_copy.vertices:
                for dx, dy in [(0,1), (1,0), (0,-1), (-1,0)]:
                    neighbor = (v[0]+dx, v[1]+dy)
                    if neighbor in graph_copy.vertices:
                        graph_copy.adjacency[v].add(neighbor)
            hash_to_graph[node.canonical_hash] = graph_copy

        return rank

    return calc_intrinsic_rank(root)

def verify_grid_solutions(db: Session, destructive: bool):
    logger.info("=== Verifying GridSolutions ===")
    solutions = db.query(GridSolution).all()
    corrupt_count = 0
    hash_to_graph = {}

    for sol in solutions:
        try:
            root_rank = replay_and_collect_graphs(sol.m, sol.n, sol.cut_sequence, hash_to_graph)
            
            if root_rank >= 999999:
                logger.error(f"CORRUPT (Incomplete): GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}. "
                             f"Claimed rank: {sol.rank}, True rank: INCOMPLETE.")
                corrupt_count += 1
            elif root_rank != sol.rank:
                action_str = "DELETING" if destructive else "WOULD DELETE"
                logger.warning(f"MISMATCH: GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}. "
                               f"Claimed rank: {sol.rank}, True rank: {root_rank}. {action_str}.")
                if destructive:
                    db.delete(sol)
                corrupt_count += 1
            else:
                logger.debug(f"OK: GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}")
                
        except Exception as e:
            action_str = "DELETED" if destructive else "WOULD DELETE"
            logger.error(f"CORRUPT (Exception): GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}. "
                         f"Error: {e}. {action_str}.")
            if destructive:
                db.delete(sol)
            corrupt_count += 1

    logger.info(f"GridSolutions Verification Complete. Found {corrupt_count} corrupt/mismatched entries out of {len(solutions)}.")
    return hash_to_graph

def verify_subgraph_dictionary(db: Session, hash_to_graph: dict, destructive: bool):
    logger.info("=== Verifying SubgraphDictionary ===")
    subgraphs = db.query(SubgraphDictionary).all()
    corrupt_count = 0
    orphan_count = 0

    corrupt_by_alias = {}

    for sg in subgraphs:
        if sg.hash in hash_to_graph:
            graph = hash_to_graph[sg.hash]
            
            # Subgraphs might just have a sequence. If sequence is missing, rank is 1 for 1x1.
            seq = sg.best_cut_sequence or []
            
            try:
                # Copy the graph because replay mutates it
                graph_copy = GridGraph(1, 1, generate=False)
                graph_copy.vertices = set(graph.vertices)
                graph_copy.adjacency = {v: set(neighbors) for v, neighbors in graph.adjacency.items()}
                
                true_rank = replay_subgraph_sequence(graph_copy, seq)
                
                if true_rank >= 999999:
                    logger.error(f"CORRUPT (Incomplete): Subgraph {sg.hash[:8]}... Claimed rank: {sg.best_rank}, True rank: INCOMPLETE.")
                    alias = sg.discovered_by or "unknown"
                    corrupt_by_alias[alias] = corrupt_by_alias.get(alias, 0) + 1
                    corrupt_count += 1
                elif true_rank != sg.best_rank:
                    action_str = "DELETING" if destructive else "WOULD DELETE"
                    logger.warning(f"MISMATCH: Subgraph {sg.hash[:8]}... Claimed rank: {sg.best_rank}, True rank: {true_rank}. {action_str}.")
                    if destructive:
                        db.delete(sg)
                    alias = sg.discovered_by or "unknown"
                    corrupt_by_alias[alias] = corrupt_by_alias.get(alias, 0) + 1
                    corrupt_count += 1
            except Exception as e:
                action_str = "DELETED" if destructive else "WOULD DELETE"
                logger.error(f"CORRUPT (Exception): Subgraph {sg.hash[:8]}... Error: {e}. {action_str}.")
                if destructive:
                    db.delete(sg)
                alias = sg.discovered_by or "unknown"
                corrupt_by_alias[alias] = corrupt_by_alias.get(alias, 0) + 1
                corrupt_count += 1
        else:
            # We can't verify it natively because we don't know its shape.
            orphan_count += 1

    logger.info(f"Subgraph Verification Complete. Found {corrupt_count} corrupt/mismatched entries.")
    logger.info(f"Could not verify {orphan_count} orphaned subgraphs (their root GridSolutions were missing or they are intermediate fragments).")

    if corrupt_by_alias:
        logger.info("=== Corrupt Subgraphs by Contributor ===")
        for alias, count in corrupt_by_alias.items():
            logger.info(f"Alias: {alias}, Corrupt Count: {count}")

def sanitize(destructive: bool):
    db: Session = SessionLocal()
    try:
        # First, let's query the counts by alias to inform the user
        from sqlalchemy import func
        alias_counts = db.query(SubgraphDictionary.discovered_by, func.count(SubgraphDictionary.hash)).group_by(SubgraphDictionary.discovered_by).all()
        logger.info("=== SubgraphDictionary Contributors ===")
        for alias, count in alias_counts:
            logger.info(f"Alias: {alias}, Count: {count}")

        hash_to_graph = verify_grid_solutions(db, destructive)
        if destructive:
            db.commit() # commit deleted grid solutions
        
        verify_subgraph_dictionary(db, hash_to_graph, destructive)
        if destructive:
            db.commit() # commit deleted subgraphs
        
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sanitize Howl database")
    parser.add_argument("--destructive", action="store_true", help="Actually delete mismatched records from the database")
    args = parser.parse_args()
    
    if not args.destructive:
        logger.info("Running in DRY-RUN mode. Use --destructive to apply deletions.")
    
    sanitize(args.destructive)
