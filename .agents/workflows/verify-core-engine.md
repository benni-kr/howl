---
description: Automated workflow to verify the mathematical soundness of the pure python core engine.
---

# Verify Core Engine

This workflow runs the mathematical tests for the pure python `core_engine` package to ensure the Graph Separator Theorem logic remains unbroken.

## Steps

1. Navigate to the `core_engine` directory.
2. Run `pytest tests/` (or the equivalent test runner configured in the project).
3. Verify that all $D_4$ Canonical Hashing tests pass (ensuring that rotation and reflection invariance is preserved).
4. Verify that the Replay Engine correctly calculates known base cases (e.g., $1 \times 1$ grid = rank 1).
5. If any tests fail, STOP. Use the `verify-math-logic` skill to diagnose the violation of the Separator Theorem. Do not proceed to benchmark or deployment until the math is sound.
