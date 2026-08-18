"""Exact vertex-ranking solver for small shapes in the subgraph dictionary.

Solves shapes by exhaustive treedepth recursion on bitboards:

    rank(G) = 1 + min over v of rank(G - v)
    rank at a fracture = max over components (the separator theorem)

Every result is provably optimal, so entries get is_optimal=True — something
neither players nor the network can produce beyond the rank<=4 induction.

Usage (from the alphawolf directory):
    python exact_solver.py --dry-run              # solve, report, write nothing
    python exact_solver.py                        # verify/repair the tablebase
    python exact_solver.py --max-cells 22 --budget 600

The solver only processes shapes already present in the DB (is_optimal=0),
keyed by their stored hash — it never computes canonical hashes itself, so
there is no risk of drifting from core_engine's hashing.
"""
import argparse
import os
import shutil
import sqlite3
import subprocess
import time

DB_PATH = "../backend/howl.db"

RUST_BINARY = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "solver_rs", "target", "release", "howl_solver")

# Bit-row stride: shapes are origin-normalized, so any shape with <= STRIDE
# rows/cols fits. Coordinates beyond it are skipped defensively.
STRIDE = 32
NOT_LEFT = ~sum(1 << (r * STRIDE) for r in range(STRIDE))
NOT_RIGHT = ~sum(1 << (r * STRIDE + STRIDE - 1) for r in range(STRIDE))

UNSOLVED = 99


class ShapeTimeout(Exception):
    pass


def neighbors(bb: int) -> int:
    return ((bb << 1) & NOT_LEFT) | ((bb >> 1) & NOT_RIGHT) | (bb << STRIDE) | (bb >> STRIDE)


def components(mask: int) -> list[int]:
    out = []
    while mask:
        comp = mask & -mask
        while True:
            grown = (comp | neighbors(comp)) & mask
            if grown == comp:
                break
            comp = grown
        out.append(comp)
        mask ^= comp
    return out


class Solver:
    def __init__(self, deadline: float | None = None):
        self.memo: dict[int, int] = {}
        self.deadline = deadline
        self._calls = 0

    def rank(self, mask: int) -> int:
        if mask == 0:
            return 0
        cached = self.memo.get(mask)
        if cached is not None:
            return cached

        self._calls += 1
        if self.deadline is not None and self._calls % 4096 == 0 and time.monotonic() > self.deadline:
            raise ShapeTimeout()

        comps = components(mask)
        if len(comps) > 1:
            result = max(self.rank(c) for c in comps)
        else:
            result = UNSOLVED
            m = mask
            while m:
                bit = m & -m
                m ^= bit
                value = 1 + self.rank(mask ^ bit)
                if value < result:
                    result = value
                if result == 1:
                    break
        self.memo[mask] = result
        return result

    def sequence(self, mask: int) -> list[dict]:
        """Reconstruct one optimal cut sequence in the replay-engine format:
        a flat list of {"t": "c", "v": [[x, y]]} cuts. Every component of
        two or more vertices is resolved; single vertices are rank-1 leaves
        and need no cut (matching core_engine.replay_engine semantics)."""
        cuts: list[dict] = []
        comps = components(mask)
        if len(comps) > 1:
            for comp in comps:
                cuts.extend(self.sequence(comp))
            return cuts

        if mask == 0 or mask & (mask - 1) == 0:
            return cuts  # empty or a single vertex: nothing to cut

        target = self.rank(mask)
        m = mask
        while m:
            bit = m & -m
            m ^= bit
            if 1 + self.rank(mask ^ bit) == target:
                pos = bit.bit_length() - 1
                cuts.append({"t": "c", "v": [[pos // STRIDE, pos % STRIDE]]})
                cuts.extend(self.sequence(mask ^ bit))
                return cuts
        raise AssertionError("no optimal cut found; memo inconsistent")


def replay_rank(mask: int, cuts: list[dict]) -> int:
    """Independent check mirroring core_engine.replay_engine semantics:
    apply the flat cut list, matching each cut to the active fragment that
    contains it; rank = cut_size + max(child ranks); an unresolved fragment
    of >= 2 vertices poisons the result."""
    def rank_of(m: int, remaining: list[dict]) -> int:
        if m == 0:
            return 0
        if m & (m - 1) == 0:
            return 1
        for i, cut in enumerate(remaining):
            (x, y), = [tuple(v) for v in cut["v"]]
            bit = 1 << (x * STRIDE + y)
            if m & bit:
                rest = remaining[i + 1:]
                comps = components(m ^ bit)
                if not comps:
                    return 1
                return 1 + max(rank_of(c, rest) for c in comps)
        return 999999  # unresolved fragment
    return rank_of(mask, cuts)


def parse_shape(shape_str: str) -> int | None:
    bb = 0
    for pair in shape_str.split("|"):
        x, y = map(int, pair.split(","))
        if x >= STRIDE or y >= STRIDE:
            return None
        bb |= 1 << (x * STRIDE + y)
    return bb


def solve_batch_rust(rows: list, threads: int | None = None) -> dict:
    """Solve a batch of shapes with the Rust binary.

    Returns {hash: (rank, [{"t": "c", "v": [[x, y]]}, ...])}. Shapes the binary
    reports as skipped are absent from the result, so the caller can fall back.
    Ranks are re-verified against replay_rank by the caller, exactly as for the
    Python backend — the binary is never trusted blindly.
    """
    payload = "".join(f"{h}\t{shape}\n" for h, shape, _, _ in rows)
    cmd = [RUST_BINARY] + ([str(threads)] if threads else [])
    proc = subprocess.run(cmd, input=payload, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"rust solver failed: {proc.stderr.strip()[:200]}")

    out = {}
    for line in proc.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) >= 4 and parts[1] == "ok":
            cuts = [{"t": "c", "v": [[int(c.split(',')[0]), int(c.split(',')[1])]]}
                    for c in parts[3].split("|") if c]
            out[parts[0]] = (int(parts[2]), cuts)
    return out


def self_test() -> None:
    """Known base cases from Problem_Description.md, plus the brute-forced 4x4."""
    cases = [
        ("1x1", [(0, 0)], 1),
        ("1x3", [(0, y) for y in range(3)], 2),
        ("2x2", [(x, y) for x in range(2) for y in range(2)], 3),
        ("1x7", [(0, y) for y in range(7)], 3),
        ("4x4", [(x, y) for x in range(4) for y in range(4)], 7),
    ]
    for name, cells, expected in cases:
        bb = 0
        for x, y in cells:
            bb |= 1 << (x * STRIDE + y)
        solver = Solver()
        got = solver.rank(bb)
        assert got == expected, f"self-test {name}: expected {expected}, got {got}"
        seq = solver.sequence(bb)
        replayed = replay_rank(bb, seq)
        assert replayed == expected, f"self-test {name}: sequence replays to {replayed}"
    print("Self-test passed (1x1=1, 1x3=2, 2x2=3, 1x7=3, 4x4=7; sequences replay correctly)")


def run(max_cells: int, limit: int | None, budget: float | None,
        per_shape_timeout: float, dry_run: bool, backend: str = "auto",
        threads: int | None = None) -> None:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        """
        SELECT hash, shape_str, best_rank,
               LENGTH(shape_str) - LENGTH(REPLACE(shape_str, '|', '')) + 1 AS cells
        FROM subgraph_dictionary
        WHERE is_optimal = 0 AND shape_str IS NOT NULL AND cells BETWEEN 2 AND ?
        ORDER BY cells ASC
        """,
        (max_cells,),
    ).fetchall()
    conn.close()
    if limit:
        rows = rows[:limit]

    if backend == "auto":
        backend = "rust" if os.access(RUST_BINARY, os.X_OK) else "python"

    print(f"{len(rows)} non-optimal shapes with 2..{max_cells} cells"
          f" [backend: {backend}]" + (" (dry run)" if dry_run else ""))

    stats = {"confirmed": 0, "improved": 0, "inserted": 0, "conflict": 0,
             "timeout": 0, "skipped": 0}
    start = time.monotonic()
    run_deadline = start + budget if budget else None

    if not dry_run:
        from db.tablebase import upsert_exact_solution

    rust_results = {}
    if backend == "rust" and rows:
        t0 = time.monotonic()
        rust_results = solve_batch_rust(rows, threads)
        print(f"  rust solved {len(rust_results)}/{len(rows)} shapes in {time.monotonic() - t0:.1f}s")

    for i, (shape_hash, shape_str, db_rank, cells) in enumerate(rows):
        if run_deadline and time.monotonic() > run_deadline:
            print(f"Budget exhausted after {i} shapes.")
            break

        bb = parse_shape(shape_str)
        if bb is None:
            stats["skipped"] += 1
            continue

        cached = rust_results.get(shape_hash)
        if cached is not None:
            exact, seq = cached
        else:
            # Python fallback: rust skipped this shape, or python backend active
            solver = Solver(deadline=time.monotonic() + per_shape_timeout)
            try:
                exact = solver.rank(bb)
            except ShapeTimeout:
                stats["timeout"] += 1
                print(f"  [{cells:>2} cells] timeout after {per_shape_timeout:.0f}s — skipped")
                continue
            seq = solver.sequence(bb)

        # Every result is re-verified here, whichever backend produced it
        assert replay_rank(bb, seq) == exact, f"sequence check failed for {shape_hash}"

        if exact > db_rank:
            stats["conflict"] += 1
            print(f"  [{cells:>2} cells] CONFLICT: DB claims {db_rank}, proven optimum is {exact} ({shape_hash})")
            continue

        if dry_run:
            key = "confirmed" if exact == db_rank else "improved"
            stats[key] += 1
            if key == "improved":
                print(f"  [{cells:>2} cells] {db_rank} -> {exact}")
        else:
            status = upsert_exact_solution(shape_hash, shape_str, exact, seq)
            stats[status] += 1
            if status == "improved":
                print(f"  [{cells:>2} cells] {db_rank} -> {exact}")

    elapsed = time.monotonic() - start
    total = sum(stats.values())
    print(f"\n{total} shapes in {elapsed:.1f}s: "
          f"{stats['confirmed']} confirmed, {stats['improved']} improved, "
          f"{stats['inserted']} inserted, {stats['conflict']} conflicts, "
          f"{stats['timeout']} timeouts, {stats['skipped']} skipped")
    if dry_run:
        print("Dry run — nothing was written.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prove optimal ranks for small tablebase shapes.")
    parser.add_argument("--max-cells", type=int, default=18,
                        help="largest shape size to attempt (default 18; ~22 is minutes, 24+ can be slow)")
    parser.add_argument("--limit", type=int, default=None, help="process at most N shapes")
    parser.add_argument("--budget", type=float, default=None, help="overall time budget in seconds")
    parser.add_argument("--per-shape-timeout", type=float, default=30.0,
                        help="skip a shape after this many seconds (default 30)")
    parser.add_argument("--dry-run", action="store_true", help="solve and report, but write nothing")
    parser.add_argument("--backend", choices=["auto", "rust", "python"], default="auto",
                        help="auto uses the rust binary when built, else python (default auto)")
    parser.add_argument("--threads", type=int, default=None, help="worker threads for the rust backend")
    args = parser.parse_args()

    self_test()
    run(args.max_cells, args.limit, args.budget, args.per_shape_timeout, args.dry_run,
        args.backend, args.threads)
