import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import * as PIXI from "pixi.js";
import gsap from "gsap";
import { useSelector } from "react-redux";

import type { Graph, Vertex } from "../../state/gameSlice";
import { getLocalGraphFingerprint } from "../../state/gameSlice";
import { SettingsState, selectActivePalette, Palette } from "../../state/settingsSlice";
import { calculateBinPackLayout } from "../../utils/layoutUtils";

type RootState = {
  game: {
    activeGraph: Graph | null;
    bankedGraphs: Graph[];
    recentCutGraphs: Graph[];
  };
};

export type PixiVisualizerHandle = {
  animateCut: (cutSet: Vertex[]) => Promise<void>;
};

type PixiVisualizerProps = {
  width: number;
  height: number;
  splitView: boolean;
  onSelectGraph?: (index: number) => void;
  selectedGraphIndex?: number | null;
  onPendingCutSetChange: (cutSet: Vertex[]) => void;
  resetToken: number;
  bankedGraphs: Graph[];
  settings: SettingsState;
  isExecuting?: boolean;
  optimalRanks?: Map<string, { best_rank: number, is_optimal: boolean, discovered_by?: string | null, hash: string }>;
  onAutoSolve?: (graphIndex: number) => void;
  onIgnoreDuplicate?: (graphIndex: number) => void;
  hasCutsApplied?: boolean;
  overrideState?: { activeGraph: Graph | null; recentCutGraphs: Graph[] };
  readOnly?: boolean;
  onDeepDiveRequest?: (graphIndex: number) => void;
  overridePendingCutSet?: Vertex[];
};

const BASE_CELL_SIZE = 20;
const MIN_CELL_SIZE = 8;

const isSameVertex = (a: Vertex, b: Vertex) => a.x === b.x && a.y === b.y;

class Particle {
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

class PixiEngine {
  app: PIXI.Application;
  container: HTMLDivElement;
  stage: PIXI.Container;
  edgeContainer: PIXI.Container;
  nodeContainer: PIXI.Container;
  particleContainer: PIXI.Container;
  glowContainer: PIXI.Container;
  wandContainer: PIXI.Container;

  nodes: Map<string, { x: number; y: number; vertex: Vertex; graphics: PIXI.Graphics; glowGraphics: PIXI.Graphics; isPendingCut: boolean; color: number }>;
  edges: { from: string; to: string; graphics: PIXI.Graphics }[];
  particles: Particle[];
  dyingGraphics: Set<PIXI.Graphics>;

  onNodePointerDown?: (vertex: Vertex, graphIndex: number, shiftKey: boolean) => void;
  onNodePointerEnter?: (vertex: Vertex, graphIndex: number) => void;
  onPointerUp?: () => void;
  onGraphClick?: (graphIndex: number) => void;
  onDeepDiveRequest?: (graphIndex: number) => void;
  onAutoSolve?: (graphIndex: number) => void;
  onIgnoreDuplicate?: (graphIndex: number) => void;

  cellSize: number = BASE_CELL_SIZE;
  splitView: boolean = false;
  isDestroyed: boolean = false;
  palette: Palette | null = null;
  _activeExplosions: number = 0;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.app = new PIXI.Application();
    this.stage = new PIXI.Container();
    this.edgeContainer = new PIXI.Container();
    this.nodeContainer = new PIXI.Container();
    this.particleContainer = new PIXI.Container();
    this.glowContainer = new PIXI.Container();
    this.wandContainer = new PIXI.Container();

    const blurFilter = new PIXI.BlurFilter();
    blurFilter.blur = 12;
    blurFilter.quality = 4;
    blurFilter.padding = 100;
    this.glowContainer.filters = [blurFilter];

    this.stage.addChild(this.glowContainer);
    this.stage.addChild(this.edgeContainer);
    this.stage.addChild(this.nodeContainer);
    this.stage.addChild(this.wandContainer);
    this.stage.addChild(this.particleContainer);

    this.nodes = new Map();
    this.edges = [];
    this.particles = [];
    this.dyingGraphics = new Set();
  }

  async init(width: number, height: number) {
    await this.app.init({
      width,
      height,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: true,
    });
    if (this.isDestroyed) {
      return;
    }
    this.container.appendChild(this.app.canvas);
    this.app.stage.addChild(this.stage);
    this.app.ticker.add(this.update.bind(this));

    this.stage.eventMode = "static";
    this.stage.hitArea = new PIXI.Rectangle(-10000, -10000, 20000, 20000);
    this.stage.on("pointerup", () => this.onPointerUp?.());
    this.stage.on("pointerupoutside", () => this.onPointerUp?.());
  }

  resize(width: number, height: number) {
    this.app.renderer.resize(width, height);
  }

  update() {
    for (const edge of this.edges) {
      const fromNode = this.nodes.get(edge.from);
      const toNode = this.nodes.get(edge.to);
      if (fromNode && toNode) {
        const scaleAlpha = Math.min(fromNode.graphics.scale.x, toNode.graphics.scale.x);
        edge.graphics.clear();
        if (scaleAlpha > 0.01) {
          edge.graphics.moveTo(fromNode.graphics.x, fromNode.graphics.y);
          edge.graphics.lineTo(toNode.graphics.x, toNode.graphics.y);
          edge.graphics.stroke({ color: this.palette?.border ?? 0x334155, width: 2, alpha: 0.4 * scaleAlpha });
        }
      } else {
        edge.graphics.clear();
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p.update()) {
        this.particleContainer.removeChild(p.graphics);
        p.graphics.destroy();
        this.particles.splice(i, 1);
      }
    }
  }

  spawnExplosion(x: number, y: number, colors: number[]) {
    for (let i = 0; i < 15; i++) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 2 + Math.random() * 3;
      const speed = 2 + Math.random() * 3;
      const p = new Particle(x, y, color, size, speed);
      this.particleContainer.addChild(p.graphics);
      this.particles.push(p);
    }
  }

  drawNode(node: { vertex: Vertex; graphics: PIXI.Graphics; glowGraphics: PIXI.Graphics; isPendingCut: boolean; color: number }, isSelected: boolean = false) {
    node.graphics.clear();
    node.glowGraphics.clear();

    const isLightTile = (node.vertex.x + node.vertex.y) % 2 === 0;

    let color = 0x000000;
    if (this.palette) {
      if (node.isPendingCut) {
        color = this.palette.select;
      } else {
        color = isLightTile ? this.palette.tileA : this.palette.tileB;
      }
    }

    node.color = color;

    const size = this.cellSize - 2;
    node.graphics
      .roundRect(-size / 2, -size / 2, size, size, 4)
      .fill({ color: node.color, alpha: 1.0 })
      .stroke({ width: 1, color: node.isPendingCut && this.palette ? this.palette.selectBorder : (this.palette?.border ?? 0x1f2937), alignment: 0 });

    if (this.palette) {
      if (node.isPendingCut) {
        const padding = 2;
        node.glowGraphics
          .roundRect(-this.cellSize / 2 - padding, -this.cellSize / 2 - padding, this.cellSize + padding * 2, this.cellSize + padding * 2, 6)
          .fill({ color: this.palette.selectGlow, alpha: 0.6 });
      } else if (isSelected) {
        const padding = 4;
        node.glowGraphics
          .roundRect(-this.cellSize / 2 - padding, -this.cellSize / 2 - padding, this.cellSize + padding * 2, this.cellSize + padding * 2, 8)
          .fill({ color: this.palette.highlight, alpha: 0.6 });
      }
    }
  }

  syncState(
    graphs: Graph[],
    pendingCutSet: Vertex[],
    splitView: boolean,
    selectedGraphIndex: number | null,
    width: number,
    height: number,
    bankedGraphs: Graph[],
    palette: Palette,
    optimalRanks: Map<string, { best_rank: number, is_optimal: boolean, discovered_by?: string | null, hash: string }>,
    onNodePointerDown?: (vertex: Vertex, graphIndex: number, shiftKey: boolean) => void,
    onNodePointerEnter?: (vertex: Vertex, graphIndex: number) => void,
    onPointerUp?: () => void,
    onGraphClick?: (graphIndex: number) => void,
    onAutoSolve?: (graphIndex: number) => void,
    onIgnoreDuplicate?: (graphIndex: number) => void,
    isExecuting: boolean = false,
    hasCutsApplied: boolean = false,
    readOnly: boolean = false,
    onDeepDiveRequest?: (graphIndex: number) => void
  ) {
    this.palette = palette;
    this.splitView = splitView;
    this.onNodePointerDown = onNodePointerDown;
    this.onNodePointerEnter = onNodePointerEnter;
    this.onPointerUp = onPointerUp;
    this.onGraphClick = onGraphClick;
    this.onAutoSolve = onAutoSolve;
    this.onIgnoreDuplicate = onIgnoreDuplicate;
    this.onDeepDiveRequest = onDeepDiveRequest;
    this.splitView = splitView;

    // If no graphs are provided, we don't need to change the layout or camera,
    // we just let the cleanup loop delete all remaining nodes (which triggers explosions)

    const graphMetas = graphs.map((graph) => {
      const xs = graph.vertices.map((v) => v.x);
      const ys = graph.vertices.map((v) => v.y);
      const minX = xs.length ? Math.min(...xs) : 0;
      const maxX = xs.length ? Math.max(...xs) : 0;
      const minY = ys.length ? Math.min(...ys) : 0;
      const maxY = ys.length ? Math.max(...ys) : 0;
      return { minX, maxX, minY, maxY, widthCells: maxX - minX + 1, heightCells: maxY - minY + 1, graphFingerprint: getLocalGraphFingerprint(graph) };
    });

    const maxWidthCells = graphs.length > 0 ? Math.max(...graphMetas.map((m) => m.widthCells)) : 0;
    const maxHeightCells = graphs.length > 0 ? Math.max(...graphMetas.map((m) => m.heightCells)) : 0;
    const fitCellSize = Math.min(
      width / Math.max(1, maxWidthCells),
      height / Math.max(1, maxHeightCells)
    );
    this.cellSize = Math.max(MIN_CELL_SIZE, Math.min(BASE_CELL_SIZE, fitCellSize));
    const paddingPixels = Math.max(this.cellSize * 1.5, 12);
    const maxRowWidth = Math.max(240, width * 0.9);

    const layouts = calculateBinPackLayout(graphs, this.cellSize, maxRowWidth, paddingPixels);

    const activeKeys = new Set<string>();
    const activeEdges = new Set<string>();

    graphs.forEach((graph) => {
      graph.vertices.forEach((vertex) => {
        activeKeys.add(`${vertex.x},${vertex.y}`);
      });
      graph.edges.forEach((edge) => {
        const k1 = `${edge.from.x},${edge.from.y}`;
        const k2 = `${edge.to.x},${edge.to.y}`;
        const edgeKey = k1 < k2 ? `${k1}-${k2}` : `${k2}-${k1}`;
        activeEdges.add(edgeKey);
      });
    });

    let hasExplodingNodes = false;
    for (const key of this.nodes.keys()) {
      if (!activeKeys.has(key)) {
        const node = this.nodes.get(key);
        if (node) {
          const isBanked = bankedGraphs.some((g) => g.vertices.some((v) => isSameVertex(v, node.vertex)));
          if (!isBanked) {
            hasExplodingNodes = true;
            break;
          }
        }
      }
    }

    if (hasExplodingNodes) {
      this._activeExplosions++;
    }
    const layoutDelay = (hasExplodingNodes || this._activeExplosions > 0) ? 0.4 : 0;

    let targetScale = 1;

    if (graphs.length > 0) {
      const totalWidth = layouts.length > 0 ? Math.max(...layouts.map((l) => l.offsetX + l.pixelWidth)) : 0;
      const totalHeight = layouts.length > 0 ? Math.max(...layouts.map((l) => l.offsetY + l.pixelHeight)) : 0;
      const viewPadding = Math.max(this.cellSize, 16);
      const vWidth = totalWidth + viewPadding * 2;
      const vHeight = totalHeight + viewPadding * 2;
      const minX = -viewPadding;
      const minY = -viewPadding;

      const scaleX = width / vWidth;
      const scaleY = height / vHeight;
      targetScale = Math.min(scaleX, scaleY);
      const offsetX = -minX * targetScale + (width - vWidth * targetScale) / 2;
      const offsetY = -minY * targetScale + (height - vHeight * targetScale) / 2;

      // ANIMATION ORCHESTRATION: 
      // If `isExecuting` is true (Phase 1 & Phase 2 of cut), the camera and remaining nodes 
      // are completely frozen in place. This ensures subgraphs do not slide around while explosions are happening.
      if (!isExecuting) {
        gsap.to(this.stage.position, { x: offsetX, y: offsetY, duration: 0.6, delay: layoutDelay, ease: "power2.out" });
        gsap.to(this.stage.scale, { x: targetScale, y: targetScale, duration: 0.6, delay: layoutDelay, ease: "power2.out" });
      }
      // Note: we'll render wands after we place all nodes
    }

    this.wandContainer.removeChildren();

    const seenHashes = new Set<string>();
    if (splitView && optimalRanks) {
      bankedGraphs.forEach(bg => {
        const h = optimalRanks.get(getLocalGraphFingerprint(bg))?.hash;
        if (h) seenHashes.add(h);
      });
    }

    graphs.forEach((graph, graphIndex) => {
      const meta = graphMetas[graphIndex];
      const layout = layouts[graphIndex];

      const isSelected = splitView && selectedGraphIndex === graphIndex;

      const isUntouchedFirstGraph = graphIndex === 0 && !hasCutsApplied;
      const optRank = optimalRanks.get(meta.graphFingerprint);

      if (optRank && optRank.best_rank !== 999999 && !isExecuting && pendingCutSet.length === 0 && !isUntouchedFirstGraph) {
        const wandScale = 1 / targetScale; // Inverse scale so it stays a subtle size regardless of camera zoom

        const wandBg = new PIXI.Graphics();
        wandBg.roundRect(0, 0, 56, 22, 11);
        wandBg.fill({ color: this.palette?.tileA ?? 0x334155, alpha: 0.95 });
        wandBg.stroke({ width: 2, color: this.palette?.highlight ?? 0x10b981, alpha: 0.8 });

        const icon = optRank.is_optimal ? '🧮' : '🪄';
        const textStr = `${icon} [${optRank.best_rank}]`;
        const text = new PIXI.Text({
          text: textStr,
          style: {
            fontFamily: "sans-serif",
            fontSize: 12,
            fontWeight: "bold",
            fill: this.palette?.highlight ?? 0x10b981,
          }
        });
        text.x = 28 - text.width / 2;
        text.y = 11 - text.height / 2;

        const wandGroup = new PIXI.Container();
        wandGroup.addChild(wandBg);
        wandGroup.addChild(text);

        // Discoverer tooltip (hidden by default)
        let tooltipGroup: PIXI.Container | null = null;
        const discovererName = optRank.discovered_by;
        if (discovererName) {
          tooltipGroup = new PIXI.Container();
          const tooltipText = new PIXI.Text({
            text: `by ${discovererName}`,
            style: {
              fontFamily: "sans-serif",
              fontSize: 9,
              fontStyle: "italic",
              fill: this.palette?.highlight ?? 0x10b981,
            }
          });
          const tooltipPadX = 6;
          const tooltipPadY = 3;
          const tooltipBg = new PIXI.Graphics();
          tooltipBg.roundRect(0, 0, tooltipText.width + tooltipPadX * 2, tooltipText.height + tooltipPadY * 2, 6);
          tooltipBg.fill({ color: this.palette?.tileA ?? 0x334155, alpha: 0.9 });
          tooltipText.x = tooltipPadX;
          tooltipText.y = tooltipPadY;
          tooltipGroup.addChild(tooltipBg);
          tooltipGroup.addChild(tooltipText);
          // Center below the wand badge
          tooltipGroup.x = 28 - (tooltipText.width + tooltipPadX * 2) / 2;
          tooltipGroup.y = 26;
          tooltipGroup.alpha = 0;
          wandGroup.addChild(tooltipGroup);
        }

        // Calculate the top-right-most vertex of this specific graph
        const minYVertex = Math.min(...graph.vertices.map(v => v.y));
        const topRowVertices = graph.vertices.filter(v => v.y === minYVertex);
        const topRightVertex = topRowVertices.reduce((prev, curr) => (curr.x > prev.x ? curr : prev));

        // Convert grid coordinates to Pixi pixel coordinates
        // The right edge of the tile is +1 cell size in X
        const cornerX = layout.offsetX + (topRightVertex.x - meta.minX + 1) * this.cellSize;
        const cornerY = layout.offsetY + (topRightVertex.y - meta.minY) * this.cellSize;

        // Position hovering just off the top-right corner of the physical tile, accounting for inverted scale
        wandGroup.x = cornerX + 10 * wandScale - 28 * wandScale; // centered over the corner with slight offset
        wandGroup.y = cornerY - 20 * wandScale;

        // Animate entrance to its inverse-scaled size
        wandGroup.scale.set(0);
        gsap.to(wandGroup.scale, { x: wandScale, y: wandScale, duration: 0.4, ease: "back.out(1.5)", delay: layoutDelay });

        // Interactions
        wandGroup.eventMode = "static";
        wandGroup.cursor = "pointer";
        wandGroup.on("pointerdown", (e) => {
          e.stopPropagation();
          if (readOnly) {
            this.onDeepDiveRequest?.(graphIndex);
          } else {
            this.onAutoSolve?.(graphIndex);
          }
        });
        wandGroup.on("pointerover", () => {
          gsap.to(wandGroup.scale, { x: wandScale * 1.15, y: wandScale * 1.15, duration: 0.2 });
          if (tooltipGroup) {
            gsap.to(tooltipGroup, { alpha: 1, duration: 0.15 });
          }
        });
        wandGroup.on("pointerout", () => {
          gsap.to(wandGroup.scale, { x: wandScale, y: wandScale, duration: 0.2 });
          if (tooltipGroup) {
            gsap.to(tooltipGroup, { alpha: 0, duration: 0.15 });
          }
        });

        this.wandContainer.addChild(wandGroup);
      }

      graph.vertices.forEach((vertex) => {
        const key = `${vertex.x},${vertex.y}`;

        const targetX = layout.offsetX + (vertex.x - meta.minX) * this.cellSize + this.cellSize / 2;
        const targetY = layout.offsetY + (vertex.y - meta.minY) * this.cellSize + this.cellSize / 2;
        const isPendingCut = pendingCutSet.some((v) => isSameVertex(v, vertex));

        let node = this.nodes.get(key);
        if (!node) {
          node = {
            vertex,
            x: targetX,
            y: targetY,
            graphics: new PIXI.Graphics(),
            glowGraphics: new PIXI.Graphics(),
            isPendingCut,
            color: 0,
          };
          node.graphics.x = targetX;
          node.graphics.y = targetY;
          node.glowGraphics.x = targetX;
          node.glowGraphics.y = targetY;
          node.graphics.eventMode = "static";
          node!.graphics.cursor = "pointer";
          node!.graphics.on("pointerdown", (e) => {
            e.stopPropagation();
            if (e.pointerId !== undefined && (node!.graphics as any).hasPointerCapture?.(e.pointerId)) {
              (node!.graphics as any).releasePointerCapture(e.pointerId);
            }
            if (readOnly) {
              if (node!.isPendingCut && this.onDeepDiveRequest) {
                this.onDeepDiveRequest(graphIndex);
              }
              return;
            }
            if (!this.splitView) {
              this.onNodePointerDown?.(vertex, graphIndex, e.shiftKey);
            } else {
              this.onGraphClick?.(graphIndex);
            }
          });
          node!.graphics.on("pointerenter", () => {
            if (readOnly || this.splitView) return;
            this.onNodePointerEnter?.(vertex, graphIndex);
          });
          this.nodeContainer.addChild(node.graphics);
          this.glowContainer.addChild(node.glowGraphics);
          this.nodes.set(key, node);

          node.graphics.scale.set(0);
          node.glowGraphics.scale.set(0);
          gsap.to([node.graphics.scale, node.glowGraphics.scale], { x: 1, y: 1, duration: 0.4, delay: layoutDelay, ease: "back.out(1.7)" });
        } else {
          if (!isExecuting) {
            gsap.to([node.graphics, node.glowGraphics], { x: targetX, y: targetY, duration: 0.6, ease: "power2.out" });
          }

          node!.graphics.off("pointerdown");
          node!.graphics.on("pointerdown", (e) => {
            e.stopPropagation();
            if (e.pointerId !== undefined && (node!.graphics as any).hasPointerCapture?.(e.pointerId)) {
              (node!.graphics as any).releasePointerCapture(e.pointerId);
            }
            if (readOnly) {
              if (node!.isPendingCut && this.onDeepDiveRequest) {
                this.onDeepDiveRequest(graphIndex);
              }
              return;
            }
            if (!this.splitView) {
              this.onNodePointerDown?.(vertex, graphIndex, e.shiftKey);
            } else {
              this.onGraphClick?.(graphIndex);
            }
          });
          node!.graphics.off("pointerenter");
          node!.graphics.on("pointerenter", () => {
            if (readOnly || this.splitView) return;
            this.onNodePointerEnter?.(vertex, graphIndex);
          });
        }

        node.isPendingCut = isPendingCut;
        this.drawNode(node, isSelected);
      });

      graph.edges.forEach((edge) => {
        const k1 = `${edge.from.x},${edge.from.y}`;
        const k2 = `${edge.to.x},${edge.to.y}`;
        const edgeKey = k1 < k2 ? `${k1}-${k2}` : `${k2}-${k1}`;
        activeEdges.add(edgeKey);

        if (!this.edges.find((e) => e.from === k1 && e.to === k2 || e.from === k2 && e.to === k1)) {
          const g = new PIXI.Graphics();
          this.edgeContainer.addChild(g);
          this.edges.push({ from: k1, to: k2, graphics: g });
        }
      });
    });

    for (const [key, node] of this.nodes.entries()) {
      if (!activeKeys.has(key)) {
        const isBanked = bankedGraphs.some((g) => g.vertices.some((v) => isSameVertex(v, node.vertex)));

        this.dyingGraphics.add(node.graphics);
        this.dyingGraphics.add(node.glowGraphics);
        gsap.killTweensOf(node.graphics);
        gsap.killTweensOf(node.glowGraphics);

        if (isBanked) {
          gsap.to([node.graphics.scale, node.glowGraphics.scale], {
            x: 0,
            y: 0,
            duration: 0.3,
            ease: "back.in(1.5)",
            onComplete: () => {
              this.nodeContainer.removeChild(node.graphics);
              this.glowContainer.removeChild(node.glowGraphics);
              gsap.killTweensOf(node.graphics);
              gsap.killTweensOf(node.glowGraphics);
              this.dyingGraphics.delete(node.graphics);
              this.dyingGraphics.delete(node.glowGraphics);
              node.graphics.destroy();
              node.glowGraphics.destroy();
            },
          });
        } else if (node.isPendingCut) {
          // ANIMATION ORCHESTRATION (Phase 1):
          // Cut nodes scale up (0.15s) and down (0.15s), taking exactly 0.3s to complete before spawning particles.
          gsap.to([node.graphics.scale, node.glowGraphics.scale], {
            x: 1.4,
            y: 1.4,
            duration: 0.15,
            yoyo: true,
            repeat: 1,
            ease: "power2.out",
            onComplete: () => {
              const shardColors = this.palette ? [this.palette.select, this.palette.selectBorder] : [node.color, 0xdcfce7];
              this.spawnExplosion(node.graphics.x, node.graphics.y, shardColors);
              this.nodeContainer.removeChild(node.graphics);
              this.glowContainer.removeChild(node.glowGraphics);
              gsap.killTweensOf(node.graphics);
              gsap.killTweensOf(node.glowGraphics);
              this.dyingGraphics.delete(node.graphics);
              this.dyingGraphics.delete(node.glowGraphics);
              node.graphics.destroy();
              node.glowGraphics.destroy();
              this._activeExplosions = Math.max(0, this._activeExplosions - 1);
            },
          });
        } else {
          // ANIMATION ORCHESTRATION (Phase 2):
          // 1x1 subgraphs scale up (0.15s) and down (0.15s) using the identical timing to cut nodes (0.3s).
          gsap.to([node.graphics.scale, node.glowGraphics.scale], {
            x: 1.4,
            y: 1.4,
            duration: 0.15,
            yoyo: true,
            repeat: 1,
            ease: "power2.out",
            onComplete: () => {
              const shardColors = this.palette ? [this.palette.tileA, this.palette.tileB] : [0x10b981, 0x34d399, 0xfcd34d];
              this.spawnExplosion(node.graphics.x, node.graphics.y, shardColors);
              this.nodeContainer.removeChild(node.graphics);
              this.glowContainer.removeChild(node.glowGraphics);
              gsap.killTweensOf(node.graphics);
              gsap.killTweensOf(node.glowGraphics);
              this.dyingGraphics.delete(node.graphics);
              this.dyingGraphics.delete(node.glowGraphics);
              node.graphics.destroy();
              node.glowGraphics.destroy();
              this._activeExplosions = Math.max(0, this._activeExplosions - 1);
            },
          });
        }

        this.nodes.delete(key);
      }
    }

    for (let i = this.edges.length - 1; i >= 0; i--) {
      const edge = this.edges[i];
      const edgeKey = edge.from < edge.to ? `${edge.from}-${edge.to}` : `${edge.to}-${edge.from}`;
      if (!activeEdges.has(edgeKey)) {
        this.edgeContainer.removeChild(edge.graphics);
        edge.graphics.destroy();
        this.edges.splice(i, 1);
      }
    }
  }

  destroy() {
    this.isDestroyed = true;
    gsap.globalTimeline.clear();
    try {
      this.app.destroy(true, true);
    } catch (e) {
      console.warn("PixiJS destroy error", e);
    }
  }
}

const PixiVisualizer = forwardRef<PixiVisualizerHandle, PixiVisualizerProps>(
  (
    {
      width,
      height,
      splitView,
      onSelectGraph,
      selectedGraphIndex,
      onPendingCutSetChange,
      resetToken,
      bankedGraphs = [],
      settings,
      isExecuting = false,
      optimalRanks = new Map(),
      onAutoSolve,
      onIgnoreDuplicate,
      hasCutsApplied = false,
      overrideState,
      readOnly = false,
      onDeepDiveRequest,
      overridePendingCutSet,
    },
    ref
  ) => {
    const reduxGameState = useSelector((state: RootState) => state.game);
    const { activeGraph, recentCutGraphs } = overrideState || reduxGameState;
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<PixiEngine | null>(null);
    const [pendingCutSet, setPendingCutSet] = useState<Vertex[]>([]);

    const displayGraphs = useMemo(() => {
      if (recentCutGraphs.length > 0) {
        const graphs = [activeGraph, ...recentCutGraphs];
        return graphs.filter((graph): graph is Graph => Boolean(graph));
      }
      return activeGraph ? [activeGraph] : [];
    }, [activeGraph, recentCutGraphs]);

    const isDraggingRef = useRef(false);
    const dragTargetStateRef = useRef(true);
    const lastClickedVertexRef = useRef<Vertex | null>(null);

    const onNodePointerDown = useCallback((vertex: Vertex, graphIndex: number, shiftKey: boolean) => {
      if (graphIndex !== 0) return;
      isDraggingRef.current = true;

      setPendingCutSet((prev) => {
        let newSet = [...prev];

        if (shiftKey && lastClickedVertexRef.current) {
          // Bresenham's line algorithm
          const x0 = lastClickedVertexRef.current.x;
          const y0 = lastClickedVertexRef.current.y;
          const x1 = vertex.x;
          const y1 = vertex.y;
          
          const dx = Math.abs(x1 - x0);
          const dy = Math.abs(y1 - y0);
          const sx = x0 < x1 ? 1 : -1;
          const sy = y0 < y1 ? 1 : -1;
          let err = dx - dy;
          
          let cx = x0;
          let cy = y0;
          
          const linePoints: Vertex[] = [];
          while (true) {
            linePoints.push({ x: cx, y: cy });
            if (cx === x1 && cy === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
              err -= dy;
              cx += sx;
            }
            if (e2 < dx) {
              err += dx;
              cy += sy;
            }
          }

          // Filter linePoints to those that exist in the active graph
          const activeVertices = displayGraphs[0]?.vertices || [];
          const validLinePoints = linePoints.filter((lp) => 
            activeVertices.some((av) => isSameVertex(av, lp))
          );

          // Add all valid points to the selection
          for (const lp of validLinePoints) {
            if (!newSet.some((item) => isSameVertex(item, lp))) {
              newSet.push(lp);
            }
          }
          dragTargetStateRef.current = true; // Dragging from a line selection defaults to selecting
        } else {
          const isSelected = prev.some((item) => isSameVertex(item, vertex));
          dragTargetStateRef.current = !isSelected;
          if (isSelected) {
            newSet = prev.filter((item) => !isSameVertex(item, vertex));
          } else {
            newSet.push(vertex);
          }
        }

        return newSet;
      });

      lastClickedVertexRef.current = vertex;
    }, [displayGraphs]);

    const onNodePointerEnter = useCallback((vertex: Vertex, graphIndex: number) => {
      if (graphIndex !== 0 || !isDraggingRef.current) return;
      const forceSelect = dragTargetStateRef.current;
      setPendingCutSet((prev) => {
        const isSelected = prev.some((item) => isSameVertex(item, vertex));
        if (isSelected && !forceSelect) {
          return prev.filter((item) => !isSameVertex(item, vertex));
        } else if (!isSelected && forceSelect) {
          return [...prev, vertex];
        }
        return prev;
      });
    }, []);

    const onPointerUp = useCallback(() => {
      isDraggingRef.current = false;
    }, []);

    useEffect(() => {
      if (!containerRef.current) return;
      let isMounted = true;
      const engine = new PixiEngine(containerRef.current);
      engine.init(width, height).then(() => {
        if (!isMounted) return;
        engineRef.current = engine;
        engine.syncState(
          displayGraphs,
          pendingCutSet,
          splitView,
          selectedGraphIndex ?? null,
          width,
          height,
          bankedGraphs,
          selectActivePalette({ settings }),
          optimalRanks,
          onNodePointerDown,
          onNodePointerEnter,
          onPointerUp,
          (graphIndex) => {
            onSelectGraph?.(graphIndex);
          },
          (graphIndex) => {
            onAutoSolve?.(graphIndex);
          },
          (graphIndex) => {
            onIgnoreDuplicate?.(graphIndex);
          },
          isExecuting,
          hasCutsApplied,
          readOnly,
          onDeepDiveRequest
        );
      });

      return () => {
        isMounted = false;
        engine.destroy();
        engineRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Resize
    useEffect(() => {
      if (engineRef.current) {
        engineRef.current.resize(width, height);
        engineRef.current.syncState(
          displayGraphs,
          overridePendingCutSet || pendingCutSet,
          splitView,
          selectedGraphIndex ?? null,
          width,
          height,
          bankedGraphs,
          selectActivePalette({ settings }),
          optimalRanks,
          onNodePointerDown,
          onNodePointerEnter,
          onPointerUp,
          (graphIndex) => {
            onSelectGraph?.(graphIndex);
          },
          (graphIndex) => {
            onAutoSolve?.(graphIndex);
          },
          (graphIndex) => {
            onIgnoreDuplicate?.(graphIndex);
          },
          isExecuting,
          hasCutsApplied,
          readOnly,
          onDeepDiveRequest
        );
      }
    }, [width, height, displayGraphs, pendingCutSet, overridePendingCutSet, splitView, selectedGraphIndex, bankedGraphs, settings, optimalRanks, onSelectGraph, onAutoSolve, onIgnoreDuplicate, onNodePointerDown, onNodePointerEnter, onPointerUp, isExecuting, hasCutsApplied, readOnly, onDeepDiveRequest]);

    useEffect(() => {
      onPendingCutSetChange?.(pendingCutSet);
    }, [onPendingCutSetChange, pendingCutSet]);

    useEffect(() => {
      if (resetToken !== undefined) {
        setPendingCutSet([]);
        lastClickedVertexRef.current = null;
      }
    }, [resetToken]);

    useEffect(() => {
      if (splitView) {
        setPendingCutSet([]);
        lastClickedVertexRef.current = null;
      }
    }, [splitView]);



    useImperativeHandle(
      ref,
      () => ({
        animateCut: (cutSet: Vertex[]) =>
          new Promise((resolve) => {
            if (cutSet.length === 0) {
              resolve();
              return;
            }
            // Trigger explosion immediately for cut set by setting them to be removed
            // Wait, they are removed when displayGraphs updates!
            // We just wait a tiny bit to allow the state change to propagate, 
            // or just resolve immediately so Redux removes them and the engine spawns particles automatically!
            setTimeout(resolve, 50);
          }),
      }),
      []
    );

    return (
      <div 
        ref={containerRef} 
        style={{ 
          width, 
          height, 
          background: "transparent", 
          overflow: "hidden", 
          touchAction: "none" 
        }} 
      />
    );
  }
);

PixiVisualizer.displayName = "PixiVisualizer";

export default PixiVisualizer;
