import React from "react";
import "./DocsPage.css";
import { PathExample } from "../components/docs-page/PathExample";
import { StepVisualizer } from "../components/docs-page/StepVisualizer";
import { EliminationTreeExample } from "../components/docs-page/EliminationTree";

const DocsPage: React.FC = () => {
  return (
    <div className="docs-page">

      <div className="docs-header">
        <h1 className="docs-title">
          Welcome to HOWL
        </h1>
        <p className="docs-subtitle">
          A crowdsourced scientific tool disguised as a spatial puzzle. By playing the game, you are actively helping researchers solve an open mathematical problem in graph theory.
        </p>
      </div>

      <div className="docs-section-card">
        <h2 className="docs-heading-2">How to Play (The Casual Guide)</h2>
        <p>
          You start with an <strong>m &times; n</strong> rectangular grid of blocks. Your goal is to cut the grid down until only isolated, single blocks remain.
        </p>

        <ul className="docs-list">
          <li>
            <strong>The Cut:</strong> Select blocks to remove. This splits the board into disconnected pieces.
          </li>
          <li>
            <strong>The Score (Rank):</strong> Every block you cut adds to your Rank. Your final score is the highest accumulated sequence of cuts any single remaining piece inherited. <em>A lower rank is better!</em>
          </li>
        </ul>

        <div className="docs-features-grid">
          <div className="docs-feature-card">
            <div className="docs-feature-icon">🪄</div>
            <div className="docs-feature-text">See a shape the community has already solved? Click it to instantly "vaporize" it using the best score the community has ever found.</div>
          </div>
          <div className="docs-feature-card">
            <div className="docs-feature-icon">🧮</div>
            <div className="docs-feature-text">Sometimes, the backend knows a shape's score is mathematically perfect. This vaporizes the shape knowing it can never be improved.</div>
          </div>
          <div className="docs-feature-card">
            <div className="docs-feature-icon">🪞</div>
            <div className="docs-feature-text">If a cut creates identical subgraphs, you only need to solve one of them!</div>
          </div>
          <div className="docs-feature-card">
            <div className="docs-feature-icon">⊇</div>
            <div className="docs-feature-text">If one shape fits entirely inside another (under rotation or reflection), you only need to solve the larger one.</div>
          </div>
        </div>
      </div>

      <div className="docs-section">
        <h2 className="docs-heading-2">The Math Behind the Magic</h2>
        <p>
          While you are cutting shapes, the game engine is calculating <strong>Vertex k-Rankings</strong>. In graph theory, a k-ranking is a labeling of vertices using numbers from 1 to k, with a strict rule: <em>Any path connecting two vertices with the same number must pass through a vertex with a strictly greater number.</em>
        </p>

        <PathExample />
        <p className="docs-caption">
          Example: A valid ranking of a 1x5 path. Note how the two "1"s are separated by a "2", and the two "1"s on the edges are separated by a "3".
        </p>

        <p style={{ marginTop: '24px' }}>
          The <strong>Rank Number</strong> of a graph is the lowest possible number of labels required to rank it. For large grids, finding this exact number is an open mathematical problem. Naive computer algorithms quickly run out of memory. Humans, however, are exceptionally good at recognizing 2D spatial weaknesses.
        </p>

        <h3 style={{ marginTop: '32px' }}>The Top-Down Approach (Graph Separators)</h3>
        <p>
          Instead of guessing numbers from the bottom up, HOWL attacks the problem top-down. By selecting a "Cut Set", you are creating <em>minimal graph separators</em>. Because the resulting subgraphs are physically disconnected, they can share labels without breaking the path rule.
        </p>

        <StepVisualizer />

        <p>
          Mathematically, the rank of the original grid is bounded by the size of your cut plus the worst-case rank of the remaining pieces. By finding clever, efficient cuts, you are discovering new, scientifically valuable upper bounds for these grids!
        </p>
      </div>

      <div className="docs-section">
        <h2 className="docs-heading-2">The Three Views (Treedepth)</h2>
        <p>
          The math behind HOWL can be visualized in three distinct ways. The physical cuts you make are tracked by the <strong>Game Tree</strong>. If we collapse the identical cut nodes into a strict vertical hierarchy, we build an <strong>Elimination Tree</strong> (formally known as a Treedepth Decomposition). The vertical height of this tree is exactly your final score, representing the highest number needed for a valid <strong>k-ranking</strong>!
        </p>

        <EliminationTreeExample />

      </div>

      <div className="docs-section-card">
        <h2 className="docs-heading-2">Decoding the Leaderboards</h2>
        <p>
          Comparing a 4&times;4 score to a 100&times;100 score directly doesn't make sense. That's why the Matrix views offer advanced metrics to evaluate your score against mathematical theory:
        </p>
        <ul className="docs-list">
          <li>
            <strong>Perfection Gap:</strong> The difference between the community's Min Rank and the theoretical <strong>Lower Bound</strong>. A gap of 0 means the solution is proven mathematically perfect!

            <details style={{ marginTop: '12px', background: 'var(--bg-inset)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', userSelect: 'none' }}>
                View Exact Mathematical Formulas
              </summary>
              <div style={{ marginTop: '16px', fontSize: '0.95em', lineHeight: '1.6' }}>
                <p style={{ marginTop: 0 }}>
                  The lower bound <code>r(m,n)</code> is calculated recursively. <strong>Assume <code>m &le; n</code></strong>:
                </p>
                <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: 0 }}>
                  <li>
                    <strong>Paths (m = 1):</strong> Exact logarithmic bound.<br />
                    <code className="docs-math-code">r(1,n) = ⌊log<sub>2</sub>(n)⌋ + 1</code>
                  </li>
                  <li>
                    <strong>Ladder Grids (m = 2):</strong> Exact recursive formula.<br />
                    <code className="docs-math-code">r(2,n) = 2 + r(2, ⌈(n - 2) / 2⌉)</code>
                  </li>
                  <li>
                    <strong>Narrow Grids (m = 3, 4):</strong> Recursive lower limits.<br />
                    <code className="docs-math-code">r(3,n) ≥ 3 + r(3, ⌈(n - 3) / 2⌉)</code><br />
                    <code className="docs-math-code docs-math-code-block">r(4,n) ≥ 4 + r(4, ⌈(n - 4) / 2⌉)</code>
                  </li>
                  <li>
                    <strong>Large Grids (m ≥ 5):</strong> Evaluated as the stricter of the linear square-grid limit or its largest 4&times;n subgrid.<br />
                    <code className="docs-math-code">r(m,n) ≥ max( ⌈(5/3)m - (25/9)⌉, r(4,n) )</code>
                  </li>
                </ul>
              </div>
            </details>
          </li>
          <li>
            <strong>Linear Density (Rank / Longest Edge):</strong> This is the <strong>true scientific metric</strong>. Mathematicians have proven that the rank number scales linearly with the length of the grid's edge, not its area. By pushing Linear Density as low as possible, players are helping researchers discover the exact missing coefficients for these formulas.
          </li>
          <li>
            <strong>Log-Adjusted Density (Rank / (m + log<sub>2</sub>(n + 1))):</strong> A hybrid density scaling that dampens the penalty for extreme rectangles.
          </li>
        </ul>
      </div>

      <div className="docs-section">
        <h2 className="docs-heading-2">Real-World Applications</h2>
        <p>
          The Very Large-Scale Integration (VLSI) circuit layout originally motivated the study of k-ranking. A VLSI circuit consists of a large number of transistors and wires contained within a multi-layer chip. If we treat transistors as vertices and wires as edges in a graph, many graph properties map directly to circuit features.
        </p>
        <p>
          Finding minimal graph separators is a key step in minimizing VLSI layout area. Minimizing this physical area directly reduces hardware manufacturing expenses.
        </p>
        <p>
          Furthermore, the methods used to study these minimal separators are crucial for optimizing software algorithms. This includes parallel scheduling of multi-part product assembly, searching for corruptions in partially ordered data structures, parallel query processing, and matrix factorizations.
        </p>
      </div>

      <div className="docs-references">
        <h3 className="docs-references-title">References & Further Reading</h3>
        <ul className="docs-references-list">
          <li>
            <strong>[1]</strong> Chen, Sitan. <em>"On the Rank Number of Grid Graphs."</em> arXiv:1208.1814v3 [math.CO] (2013).
          </li>
          <li>
            <strong>[2]</strong> Alpert, H. <em>"Rank numbers of grid graphs."</em> Discrete Mathematics 310, no. 23 (2010): 3324-3333.
          </li>
          <li>
            <strong>[3]</strong> Leiserson, C.E. <em>"Area efficient graph layouts for VLSI."</em> In: Proc. 21st Ann. IEEE Symposium, FOCS (1980): 270-281.
          </li>
          <li>
            <strong>[4]</strong> Iyer, A.V., Ratliff, H.D., Vijayan, G. <em>"Optimal node ranking of trees."</em> Information Processing Letters 28 (1988): 225-229.
          </li>
        </ul>
      </div>

    </div>
  );
};

export default DocsPage;