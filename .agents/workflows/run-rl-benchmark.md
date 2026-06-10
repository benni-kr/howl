---
description: Automated workflow to benchmark a challenger PyTorch model against the baseline gauntlet.
---

# Run RL Benchmark

This workflow evaluates a newly trained AlphaWolf model against the baseline.

## Steps

1. Activate the Python virtual environment for the RL engine or ensure the correct dependencies are loaded.
2. Run `python alphawolf/benchmark.py`.
3. Analyze the output:
   - Note the **Cumulative Rank**. Did the challenger score lower (better) than the baseline?
   - Note the **Trajectory Nodes** (Node Expansions). Did the challenger use fewer expansions to reach the same or better score?
4. If the script reports "PROMOTED", confirm that `models/checkpoints/best_model.pt` was successfully overwritten.
5. Create an artifact or summarize the benchmark results for the user, highlighting the performance delta.
