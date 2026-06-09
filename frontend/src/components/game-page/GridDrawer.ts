import * as PIXI from "pixi.js";
import { Vertex } from "../../state/gameSlice";
import { Palette } from "../../state/settingsSlice";

export class Particle {
  graphics: PIXI.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  rotationSpeed: number;

  constructor(x: number, y: number, color: number, size: number, speed: number) {
    this.graphics = new PIXI.Graphics();
    this.graphics.rect(-size / 2, -size / 2, size, size).fill(color);
    this.graphics.x = x;
    this.graphics.y = y;
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * speed;
    this.vy = (Math.random() - 0.5) * speed - speed * 0.2;
    this.maxLife = 15 + Math.random() * 15;
    this.life = this.maxLife;
    this.rotationSpeed = (Math.random() - 0.5) * 0.2;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.2; // subtle gravity
    this.graphics.x = this.x;
    this.graphics.y = this.y;
    this.graphics.rotation += this.rotationSpeed;
    this.life--;
    this.graphics.alpha = this.life / this.maxLife;
    return this.life > 0;
  }
}

export function spawnExplosion(
  particleContainer: PIXI.Container,
  particles: Particle[],
  dyingCount: number,
  x: number,
  y: number,
  colors: number[],
  readOnly: boolean = false
) {
  const maxParticles = 600;
  let baseCount = readOnly ? 8 : 15;

  // Scale down particles per node dynamically based on how many nodes are exploding simultaneously
  if (dyingCount > 10) {
    const divisor = dyingCount / 10;
    baseCount = Math.max(1, Math.floor(baseCount / divisor));
  }

  const spawnCount = Math.min(baseCount, maxParticles - particles.length);
  if (spawnCount <= 0) return;

  for (let i = 0; i < spawnCount; i++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 2 + Math.random() * 3;
    const speed = 2 + Math.random() * 3;
    const p = new Particle(x, y, color, size, speed);
    particleContainer.addChild(p.graphics);
    particles.push(p);
  }
}

export function drawNode(
  node: { vertex: Vertex; graphics: PIXI.Graphics; glowGraphics: PIXI.Graphics; isPendingCut: boolean; color: number },
  cellSize: number,
  palette: Palette | null,
  isSelected: boolean = false,
  vaporizeActionType: 'vaporize' | 'ignore' | 'subgraph' | null = null
) {
  node.graphics.clear();
  node.glowGraphics.clear();

  const isLightTile = (node.vertex.x + node.vertex.y) % 2 === 0;

  let color = 0x000000;
  if (palette) {
    if (node.isPendingCut) {
      if (vaporizeActionType) {
        color = isLightTile ? palette.tileA : palette.tileB;
      } else {
        color = palette.select;
      }
    } else {
      color = isLightTile ? palette.tileA : palette.tileB;
    }
  }

  node.color = color;

  const size = cellSize - 2;
  node.graphics
    .roundRect(-size / 2, -size / 2, size, size, 4)
    .fill({ color: node.color, alpha: 1.0 })
    .stroke({ width: 1, color: node.isPendingCut && palette && !vaporizeActionType ? palette.selectBorder : (palette?.border ?? 0x1f2937), alignment: 0 });

  if (palette) {
    if (node.isPendingCut) {
      if (vaporizeActionType) {
        const padding = 6;
        const glowColor = vaporizeActionType === 'vaporize' ? palette.select : palette.highlight;
        node.glowGraphics
          .roundRect(-cellSize / 2 - padding, -cellSize / 2 - padding, cellSize + padding * 2, cellSize + padding * 2, 8)
          .fill({ color: glowColor, alpha: 0.95 });
      } else {
        const padding = 2;
        node.glowGraphics
          .roundRect(-cellSize / 2 - padding, -cellSize / 2 - padding, cellSize + padding * 2, cellSize + padding * 2, 6)
          .fill({ color: palette.selectGlow, alpha: 0.6 });
      }
    } else if (isSelected) {
      const padding = 4;
      node.glowGraphics
        .roundRect(-cellSize / 2 - padding, -cellSize / 2 - padding, cellSize + padding * 2, cellSize + padding * 2, 8)
        .fill({ color: palette.highlight, alpha: 0.6 });
    }
  }
}
