# HOWL: The Mathematical Foundation

## Overview
HOWL (Hyper Optimizing Wolf's Logic) is a gamified, crowdsourced scientific tool designed to solve an open mathematical problem in graph theory: finding the **minimum vertex $k$-ranking** (also known as the rank number) for $m \times n$ grid graphs. 

While the game presents this as a spatial puzzle of cutting and shrinking grids, the underlying engine is rigorously calculating graph separators to bound the rank number. This document explains the formal mathematics behind the game, including treedepth decompositions and theoretical lower bounds.

---

## The Vertex $k$-Ranking Problem

### Formal Definition
Given a simple, undirected graph $G = (V, E)$, a **vertex $k$-ranking** is a labeling (or coloring) of the vertices using integers from $1$ to $k$, defined as a function:
$$c: V \to \{1, 2, \dots, k\}$$

Such that the following strict condition holds:
**If two vertices $u$ and $v$ have the same label ($c(u) = c(v)$), then every path connecting $u$ and $v$ must contain at least one vertex $w$ with a strictly greater label ($c(w) > c(u)$).**

### The Rank Number $\chi_r(G)$
A graph can have many valid rankings. The goal is to find the most efficient one. The **rank number**, denoted as $\chi_r(G)$, is the minimum integer $k$ for which a valid vertex $k$-ranking exists for the graph $G$.

For example:
* A single isolated vertex ($1 \times 1$ grid) has a rank number of **1**.
* A path graph of 3 vertices ($1 \times 3$ grid) has a rank number of **2** (e.g., labels: 1, 2, 1).

---

## Application to Grid Graphs ($m \times n$)

HOWL focuses specifically on 2D grid graphs. While the rank number is known for paths, cycles, and trees, determining the exact minimum rank number for arbitrary $m \times n$ grids is computationally difficult (the general problem is NP-hard). 

As the grid size increases, the search space for valid rankings explodes combinatorially. Naive brute-force algorithms quickly run out of memory and time, which is why HOWL crowdsources human spatial intuition to find optimal solutions.

---

## The "Top-Down" Approach & Treedepth

Instead of trying to label the graph from the bottom up ($1, 2, 3\dots$), HOWL approaches the problem top-down using **Graph Separators** (the "Cuts"). This top-down process mathematically constructs a **Treedepth Decomposition** (or Elimination Tree).

### The Separator Theorem
If you remove a set of vertices $S$ (the cut set) from a graph $G$, the graph fragments into a set of disconnected subgraphs $G_1, G_2, \dots, G_p$. 

Because there are no edges connecting these subgraphs, they can share labels without violating the ranking condition, *provided* that all vertices in the cut set $S$ are assigned the highest unique labels.

Mathematically, the rank of the original graph $G$ is bounded by:
$$\chi_r(G) \le |S| + \max_{i} (\chi_r(G_i))$$

Where:
* $|S|$ is the number of vertices removed (the size of the cut).
* $\max(\chi_r(G_i))$ is the maximum rank among all the resulting disconnected subgraphs.

### How This Translates to Gameplay
1. **The Grid:** The player starts with an $m \times n$ graph with a base rank of $0$.
2. **The Cut:** The player selects $C$ vertices to remove (the cut set). 
3. **The Subgraphs:** The graph breaks into smaller pieces. These pieces inherit a new base score: `parent_score + C`.
4. **The Base Case:** When a subgraph is reduced to a single $1 \times 1$ node, it is mathematically solved. Its final rank is its `inherited_score + 1`.
5. **The Objective:** The player's final score for the run is the highest rank achieved by any node on the board. The goal is to find the sequence of cuts that keeps this maximum number as low as possible.

---

## Gameplay Mechanics: Batch Actions & Shortcuts

Human players are exceptionally good at recognizing 2D spatial patterns and symmetries. HOWL introduces automated "Batch Actions" to speed up gameplay by leveraging graph theory shortcuts:

### 1. The Subgraph Dictionary (Magic Wand Vaporization)
Because graphs frequently break down into the same common shapes (e.g., $2 \times 2$ squares, L-shapes), HOWL maintains a crowdsourced **Subgraph Dictionary**. Every shape solved by any player is hashed (invariant of rotation and reflection) and cached. If a player encounters a known shape, they can "vaporize" it. Mathematically, this simply short-circuits the recursive $\max(\chi_r(G_i))$ calculation by substituting the known optimal upper bound from the database.

### 2. Isomorphic Duplicates (Mirror Vaporization)
If a cut fragments a graph into two identical subgraphs, the player only needs to solve one of them. Because disconnected components can share labels perfectly, solving one subgraph proves the rank bound for both.

### 3. Subgraph Containment (Subset Vaporization)
If a cut creates two subgraphs $A$ and $B$, and shape $B$ fits entirely inside shape $A$ (under rotation or reflection), then mathematically, the rank of $B$ can never exceed the rank of $A$. Thus, the player only needs to solve the larger bounding shape $A$, and shape $B$ can be vaporized for free.

---

## Theoretical Lower Bounds & "The Abacus"

While players discover **Upper Bounds** by making cuts, mathematicians have discovered rigid **Lower Bounds** formulas for standard rectangular grids. These bounds are used in the leaderboard matrix, to show how far off the current best scores are from the theoretical minimum, or the other way around: Where the lower bound may not be optimal!

Assume $m \le n$:
* **Paths ($m=1$):** $r(1,n) = \lfloor\log_2(n)\rfloor + 1$
* **Ladders ($m=2$):** $r(2,n) = 2 + r(2, \lceil(n - 2) / 2\rceil)$
* **Large Grids ($m \ge 5$):** $r(m,n) \ge \max( \lceil\frac{5}{3}m - \frac{25}{9}\rceil, r(4,n) )$
