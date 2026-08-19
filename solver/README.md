# solver — exact vertex-ranking solver

Proves the optimal rank of small shapes in the HOWL tablebase, and repairs
entries whose recorded rank is worse than the true optimum.

## Why this exists

Neither players nor the neural network can establish optimality. Both only ever
produce **upper bounds**: a solution of rank 6 does not rule out that 5 is
possible. The one exception is the `rank <= 4` induction in the RL pipeline —
every shape of rank 3 or less is in the seed, so a shape absent from it has rank
at least 4, and a solution achieving 4 is therefore exact.

Above rank 4 nothing gets marked `is_optimal`, no matter how much play happens.
The pile of unproven entries only ever grows. This solver is the only component
that can settle them, by exhaustive search.

That matters twice over:

- **Proven ranks become hard MCTS cutoffs** (`query_tablebase` prunes on
  `is_optimal`), instead of merely clamping a value estimate.
- **Wrong ranks get corrected.** On the current tablebase a substantial share of
  mid-size entries turned out to be suboptimal — the solver repairs data as much
  as it certifies it, and the corrected cut sequences flow straight into the
  game's magic wand.

## Usage

No virtualenv, no torch, no cargo required — the Python implementation uses only
the standard library.

```bash
python3 solver/verify_tablebase.py --dry-run     # solve and report, write nothing
python3 solver/verify_tablebase.py               # verify and repair the tablebase
python3 solver/verify_tablebase.py --max-cells 26 --budget 3600
python3 solver/verify_tablebase.py --db path/to/howl.db
```

For a large speedup, build the optional Rust backend once:

```bash
cd solver/rust && cargo build --release
```

`--backend auto` (the default) uses the binary when present and falls back to
Python otherwise. `--backend python` forces the reference implementation.

Runs are **idempotent and incremental**: already-proven shapes are filtered out
by the query, so a repeat run only processes what has been added since. Running
it periodically after training or heavy play is the intended workflow.

## Layout

```
solver/
├── verify_tablebase.py   driver + Python reference implementation
├── tablebase_writer.py   database access (stdlib sqlite3 only)
└── rust/                 optional Rust backend, ~130x faster (see its README)
```

## Design boundaries

- **Shares no code with the RL pipeline.** No torch, no MCTS, no environment.
  The solver is a peer producer of tablebase knowledge alongside AlphaWolf and
  the players, not a part of either.
- **Never computes canonical hashes.** It only writes back under hashes that
  `core_engine.hashing` already produced, so there is exactly one implementation
  of D4 canonicalization in the project and nothing can drift from it.
- **Never trusts the Rust binary blindly.** Every cut sequence it returns is
  replayed in Python by `replay_rank` (mirroring `core_engine.replay_engine`
  semantics) before anything is written.
- **Never silently overwrites.** If the database claims a rank *below* a proven
  optimum — impossible unless the data is corrupt — the entry is reported as a
  `conflict` and left untouched.

## Correctness

- A self-test runs on every invocation, checking the base cases from
  `docs/Problem_Description.md`: 1x1 = 1, 1x3 = 2, 2x2 = 3, 1x7 = 3, plus a
  brute-forced 4x4 = 7.
- The Python and Rust implementations were compared on 600 real shapes:
  600/600 identical ranks, 600/600 sequences replaying to the proven rank.

## Reach

Cost grows exponentially with shape size — the number of distinct sub-shapes is
roughly `2^n / 4`. Shapes up to ~26 cells are practical; beyond ~30 cells no
backend will finish. That is fine: large shapes recur too rarely to be valuable
tablebase entries, and full grids are MCTS territory anyway.
