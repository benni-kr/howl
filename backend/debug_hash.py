"""Diagnostic tooling for HOWL's SubgraphDictionary.

Usage:
    python debug_hash.py              — interactive hash visualizer
    python debug_hash.py --stats      — print DB row count + latest entries
    python debug_hash.py <hash>       — visualize a single hash
"""
import sqlite3
import sys
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "howl.db")


def print_hash_shape(canonical_hash: str) -> None:
    """Parse a canonical hash and print a 2D ASCII grid."""
    if not canonical_hash:
        print("Empty hash")
        return

    points = set()
    for pair in canonical_hash.split("|"):
        x_str, y_str = pair.split(",")
        points.add((int(x_str), int(y_str)))

    if not points:
        return

    min_x = min(x for x, _ in points)
    max_x = max(x for x, _ in points)
    min_y = min(y for _, y in points)
    max_y = max(y for _, y in points)

    print(f"\nHash: {canonical_hash}")
    print(f"Size: {len(points)} vertices, bounds ({max_x - min_x + 1}x{max_y - min_y + 1})")
    print("Shape:")
    for y in range(min_y, max_y + 1):
        row = []
        for x in range(min_x, max_x + 1):
            if (x, y) in points:
                row.append("[X]")
            else:
                row.append("   ")
        print("".join(row))
    print()


def print_db_stats() -> None:
    """Query SQLite and print total rows + latest 5 entries from subgraph_dictionary."""
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM subgraph_dictionary")
    total = cursor.fetchone()[0]
    print(f"\n{'=' * 60}")
    print(f"SubgraphDictionary: {total} total entries")
    print(f"{'=' * 60}")

    cursor.execute("SELECT hash, best_rank, is_optimal FROM subgraph_dictionary ORDER BY best_rank ASC LIMIT 10")
    rows = cursor.fetchall()

    if rows:
        print(f"\n{'Hash':<50} {'Rank':>6} {'Optimal':>8}")
        print("-" * 66)
        for h, rank, optimal in rows:
            label = "  ✓" if optimal else ""
            # Truncate long hashes for display
            display_hash = h if len(h) <= 48 else h[:45] + "..."
            print(f"{display_hash:<50} {rank:>6}{label:>8}")
    else:
        print("\n  (empty — no entries yet)")

    print()
    conn.close()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--stats":
            print_db_stats()
        else:
            print_hash_shape(sys.argv[1])
    else:
        print("HOWL SubgraphDictionary Debug Tool")
        print("Commands: type a hash, 'stats', or Ctrl+C to quit\n")
        while True:
            try:
                h = input("> ").strip()
                if h == "stats":
                    print_db_stats()
                elif h:
                    print_hash_shape(h)
            except (KeyboardInterrupt, EOFError):
                print("\nExiting.")
                break
