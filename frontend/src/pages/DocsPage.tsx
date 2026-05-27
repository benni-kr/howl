import React from "react";

const DocsPage: React.FC = () => {
  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', width: '100%', lineHeight: '1.6' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '24px' }}>HOWL: Game Rules</h1>
      
      <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '32px' }}>
        HOWL is a mathematical puzzle game based on the cutting of rectangular grids into smaller squares.
      </p>

      <div style={{ background: 'var(--bg-card)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginBottom: '32px' }}>
        <h2 style={{ marginTop: 0 }}>The Goal</h2>
        <p>
          You start with an <strong style={{color: 'var(--text-main)'}}>m &times; n</strong> rectangular grid. 
          Your objective is to completely divide this grid into squares in a sequence of moves.
        </p>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <h2>The Rules of Cutting</h2>
        <ul style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <li>
            In a single move, you can select any number of identical sub-grids (rectangles of the same dimensions) 
            and cut a single square from one end of each of them.
          </li>
          <li>
            The size of the square you cut must exactly match the shorter side of the rectangle. 
            For example, if you have a 3&times;5 rectangle, you can only cut a 3&times;3 square, leaving a 3&times;2 rectangle.
          </li>
          <li>
            You can make multiple cuts in parallel in a single move as long as they apply to identical rectangles!
          </li>
        </ul>
      </div>

      <div style={{ background: 'var(--bg-inset)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginBottom: '32px' }}>
        <h2 style={{ marginTop: 0 }}>Scoring</h2>
        <p>
          Your score (the "Rank") is the total number of moves (or cuts) it takes to reduce the entire original grid into only squares.
        </p>
        <p>
          A lower rank is better! Try to find the most efficient parallel cutting sequence to beat the leaderboard.
        </p>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <h2>Mathematical Background</h2>
        <p>
          HOWL is based on a problem from combinatorial geometry and recreational mathematics. It explores the shortest possible sequence of parallel square-cuts to reduce an integer-sided rectangle to squares.
        </p>
      </div>
    </div>
  );
};

export default DocsPage;
