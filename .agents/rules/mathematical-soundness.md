---
description: Always enforce the mathematical foundations of the vertex k-ranking problem.
activation: always
---

# Mathematical Soundness

The core logic of HOWL revolves around finding the minimum vertex $k$-ranking (rank number) for $m \times n$ grid graphs. 

When working on any logic that calculates scores, ranks, or evaluates graphs, you must strictly adhere to the following mathematical laws:

## 1. The Separator Theorem (Score Calculation)
If a cut set $S$ removes vertices from graph $G$ and fragments it into subgraphs $G_1, G_2, \dots, G_p$, the rank is bounded by:
$$ \chi_r(G) \le |S| + \max_{i} (\chi_r(G_i)) $$

**Never hardcode ranks** that violate this top-down calculation logic. Even if a known theoretical lower bound exists in `Problem_Description.md`, we do not know if that lower bound is actually achievable for a given configuration. Stick to the derived bounds through cuts.

## 2. Canonical Hashing Invariance
The subgraph dictionary relies on canonical hashes (Dihedral group $D_4$). Any shape must hash to the exact same string regardless of its rotation ($0^\circ, 90^\circ, 180^\circ, 270^\circ$) or reflection. Do not alter canonical hashing without using the `update-canonical-hashing` skill.

## 3. Vaporization Equivalencies
- **Mirror Vaporization (Isomorphism)**: If a cut yields two identical subgraphs, solving one bounds the other.
- **Subset Vaporization (Containment)**: If subgraph $B$ fits entirely within subgraph $A$, then $\chi_r(B) \le \chi_r(A)$.

Never introduce UI logic or backend evaluation logic that double-counts or breaks these equivalencies.
