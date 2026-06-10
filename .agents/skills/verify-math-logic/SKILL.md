---
name: verify-math-logic
description: Helps verify if a proposed code change violates the Graph Separator Theorem or vertex k-ranking definitions. Use this when modifying core_engine/graph_logic.py, core_engine/replay_engine.py, or alphawolf/envs/.
---

# Verify Mathematical Logic Skill

When modifying the graph engine or evaluating logic, follow these steps to ensure mathematical soundness:

## 1. Verify the Top-Down Calculation
The core ranking logic states: `Rank = |Cut Set| + max(Rank(Subgraphs))`.
- Ensure you never return a rank that ignores the number of cuts made.
- If a cut entirely obliterates a graph (leaving no remaining vertices), the rank for that branch is `999999` (an invalid/dead end), unless the original graph was simply $1 \times 1$.

## 2. Verify Vaporization Equivalencies
If you introduce logic to "auto-solve" a shape:
- Does it correctly handle Subset Containment? If shape $B$ fits inside shape $A$, its rank can be bounded by $A$'s rank.
- Does it correctly handle Isomorphism? Identical graphs yield the same rank.

## 3. Test Base Cases
Mentally or via code, test the known base cases:
- A $1 \times 1$ grid evaluates to Rank 1.
- A $1 \times 3$ grid evaluates to Rank 2.
- A $2 \times 2$ grid evaluates to Rank 3.

## 4. How to provide code changes
- If modifying python classes like `GridGraph` or `TreeNode`, explicitly state in your explanation how the mathematical boundaries are preserved.
- Run tests using the `/verify-core-engine` workflow before concluding the task.
