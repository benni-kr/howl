import React from "react";
import { PathExample } from "../components/docs-page/PathExample";
import { StepVisualizer } from "../components/docs-page/StepVisualizer";
import { EliminationTreeExample } from "../components/docs-page/EliminationTree";

const DocsPage: React.FC = () => {
  return (
    <div style={{ padding: '40px 24px', maxWidth: '1000px', margin: '0 auto', width: '100%', lineHeight: '1.7', color: 'var(--text-main)' }}>

      <div style={{ marginBottom: '40px', textAlign: 'center' }}>
        <h1 style={{ display: 'inline-block', fontSize: '2.5rem', marginBottom: '16px', background: 'linear-gradient(to right, var(--tile-selected), var(--tile-primary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent' }}>
          Welcome to HOWL
        </h1>
        <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>
          A crowdsourced scientific tool disguised as a spatial puzzle. By playing the game, you are actively helping researchers solve an open mathematical problem in graph theory.
        </p>
      </div>

      <div style={{ background: 'var(--bg-card)', padding: '32px', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginBottom: '40px' }}>
        <h2 style={{ marginTop: 0, borderBottom: '2px solid var(--bg-inset)', paddingBottom: '12px' }}>How to Play (The Casual Guide)</h2>
        <p>
          You start with an <strong>m &times; n</strong> rectangular grid of blocks. Your goal is to cut the grid down until only isolated, single blocks remain.
        </p>

        <ul style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
          <li>
            <strong>The Cut:</strong> Select blocks to remove. This splits the board into disconnected pieces.
          </li>
          <li>
            <strong>The Score (Rank):</strong> Every block you cut adds to your Rank. Your final score is the highest accumulated sequence of cuts any single remaining piece inherited. <em>A lower rank is better!</em>
          </li>
          <li>
            <strong>The Magic Wand:</strong> See a shape the community has already solved? Click it with the Magic Wand to instantly "vaporize" it using the best score the community has ever found.
          </li>
          <li>
            <strong>The Microscope:</strong> Sometimes, the backend knows a shape's score is mathematically perfect. The Microscope vaporizes the shape knowing it can never be improved.
          </li>
        </ul>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ borderBottom: '2px solid var(--bg-inset)', paddingBottom: '12px' }}>The Math Behind the Magic</h2>
        <p>
          While you are cutting shapes, the game engine is calculating <strong>Vertex k-Rankings</strong>. In graph theory, a k-ranking is a labeling of vertices using numbers from 1 to k, with a strict rule: <em>Any path connecting two vertices with the same number must pass through a vertex with a strictly greater number.</em>
        </p>

        <PathExample />
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
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

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ borderBottom: '2px solid var(--bg-inset)', paddingBottom: '12px' }}>The Three Views (Treedepth)</h2>
        <p>
          The math behind HOWL can be visualized in three distinct ways. The physical cuts you make are tracked by the <strong>Game Tree</strong>. If we collapse the identical cut nodes into a strict vertical hierarchy, we build an <strong>Elimination Tree</strong> (formally known as a Treedepth Decomposition). The vertical height of this tree is exactly your final score, representing the highest number needed for a valid <strong>k-ranking</strong>!
        </p>

        <EliminationTreeExample />

      </div>

      <div style={{ background: 'var(--bg-card)', padding: '32px', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginBottom: '40px' }}>
        <h2 style={{ marginTop: 0, borderBottom: '2px solid var(--bg-inset)', paddingBottom: '12px' }}>Decoding the Leaderboards</h2>
        <p>
          Comparing a 4&times;4 score to a 100&times;100 score directly doesn't make sense. That's why the Matrix views offer two distinct <strong>Density</strong> metrics:
        </p>
        <ul style={{ paddingLeft: '24px', marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <li>
            <strong>Area Density (Rank / Total Blocks):</strong> This is a fun, intuitive gamer metric. It answers: <em>How efficient were my cuts relative to the sheer mass of the board?</em>
          </li>
          <li>
            <strong>Linear Density (Rank / Longest Edge):</strong> This is the <strong>true scientific metric</strong>. Mathematicians have proven that the rank number scales linearly with the length of the grid's edge, not its area. For example, the lower bound for an m &times; m grid has been proven to scale at roughly <sup>5</sup>&frasl;<sub>3</sub> m. By pushing Linear Density as low as possible, players are helping researchers discover the exact missing coefficients for these formulas.
          </li>
        </ul>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ borderBottom: '2px solid var(--bg-inset)', paddingBottom: '12px' }}>Real-World Applications</h2>
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

      <div style={{ marginTop: '64px', borderTop: '1px solid var(--border-subtle)', paddingTop: '32px' }}>
        <h3 style={{ color: 'var(--text-muted)' }}>References & Further Reading</h3>
        <ul style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '20px' }}>
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