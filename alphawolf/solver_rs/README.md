# howl_solver — exact vertex-ranking solver

A standalone Rust binary that computes the **provably optimal** rank (treedepth)
of small HOWL shapes, plus one optimal cut sequence per shape.

It exists because neither players nor the neural network can prove optimality:
both only ever produce upper bounds, and the `rank <= 4` induction in
`db/tablebase.py` cannot reach further. This solver settles shapes exactly, so
their entries can carry `is_optimal = True` — which turns them into hard MCTS
cutoffs and into guaranteed-best magic wand solutions in the game.

## Build

```bash
cargo build --release        # from this directory
```

No external crates — `std` only, so the build works offline. Rust is **optional**
for the project as a whole: `exact_solver.py --backend python` runs the same
algorithm without any Rust toolchain, just ~130x slower.

## Protocol

Tab-separated, one shape per line. Coordinates are origin-normalized, exactly as
`core_engine.hashing` produces them in `shape_str`.

```
stdin    <hash>\t<shape_str>              abc123\t0,0|0,1|1,0
stdout   <hash>\tok\t<rank>\t<cuts>       abc123\tok\t2\t0,0
         <hash>\tskip\t<reason>           abc123\tskip\tbbox exceeds 128 bits
```

`<cuts>` is a `|`-separated list of `x,y` coordinates in cut order, and may be
empty (a single vertex needs no cut). Shapes whose bounding box does not fit a
128-bit board are reported as `skip`; the Python caller falls back to its
arbitrary-precision implementation for those.

Optional first argument: worker thread count (defaults to available parallelism).

```bash
printf 'a\t0,0|0,1|1,0\n' | ./target/release/howl_solver
# a	ok	2	0,0
```

## Design boundary

The binary deliberately knows **nothing** about hashing or the database:

- Hashes are passed through untouched, so `core_engine.hashing` stays the single
  source of truth for canonical D4 hashing and no second implementation can drift
  from it.
- All database writes go through `db.tablebase.upsert_exact_solution` on the
  Python side.
- Every result is re-verified in Python by `exact_solver.replay_rank`, which
  mirrors `core_engine.replay_engine` semantics, before anything is written. The
  binary is never trusted blindly.

## Correctness

- `exact_solver.py` implements the same algorithm in Python and serves as the
  golden reference. Verified equal on 600 real shapes: 600/600 identical ranks,
  600/600 sequences replaying to the proven rank.
- `exact_solver.py --self-test` (run automatically on every invocation) checks
  the base cases from `docs/Problem_Description.md`: 1x1 = 1, 1x3 = 2, 2x2 = 3,
  1x7 = 3, plus the brute-forced 4x4 = 7.

## Algorithm

Exhaustive recursion over `u128` bitboards with memoization:

```
rank(empty)          = 0
rank(single vertex)  = 1
rank(disconnected)   = max over components          (separator theorem)
rank(connected)      = 1 + min over v of rank(G - v)
```

Components are found by flood fill using shifted-mask adjacency. The memo uses a
multiply-shift hasher — the default SipHash dominates runtime when the table is
hit millions of times per shape. Shapes are processed in parallel across threads;
each shape gets its own memo, since bitboard values are only meaningful relative
to that shape's stride.

Cost grows exponentially with shape size. Practical reach on 8 cores: shapes up
to ~26 cells in minutes for the whole tablebase; individual larger shapes vary
widely, since a shape that fractures early is far cheaper than a dense one.
