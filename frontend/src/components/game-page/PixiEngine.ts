import * as PIXI from "pixi.js";
import gsap from "gsap";
import { Graph, Vertex } from "../../state/gameSlice";
import { getLocalGraphFingerprint } from "../../state/gameSlice";
import { Palette } from "../../state/settingsSlice";
import { calculateBinPackLayout } from "../../utils/layoutUtils";
import { Particle, spawnExplosion, drawNode } from "./GridDrawer";

const BASE_CELL_SIZE = 20;
const MIN_CELL_SIZE = 8;

const isSameVertex = (a: Vertex, b: Vertex) => a.x === b.x && a.y === b.y;

export class PixiEngine {
  app: PIXI.Application;
  container: HTMLDivElement;
  stage: PIXI.Container;
  edgeGraphics: PIXI.Graphics;
  nodeContainer: PIXI.Container;
  particleContainer: PIXI.Container;
  glowContainer: PIXI.Container;
  wandContainer: PIXI.Container;

  nodes: Map<string, { x: number; y: number; vertex: Vertex; graphics: PIXI.Graphics; glowGraphics: PIXI.Graphics; isPendingCut: boolean; color: number }>;
  activeEdges: Set<string>;
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
  _edgesDirty: boolean = true;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.app = new PIXI.Application();
    this.stage = new PIXI.Container();
    this.edgeGraphics = new PIXI.Graphics();
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
    this.stage.addChild(this.edgeGraphics);
    this.stage.addChild(this.nodeContainer);
    this.stage.addChild(this.wandContainer);
    this.stage.addChild(this.particleContainer);

    this.nodes = new Map();
    this.activeEdges = new Set();
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
    if (this._edgesDirty) {
      this.edgeGraphics.clear();
      const edgeColor = this.palette?.border ?? 0x334155;
      for (const edgeKey of this.activeEdges) {
        const [fromKey, toKey] = edgeKey.split('-');
        const fromNode = this.nodes.get(fromKey);
        const toNode = this.nodes.get(toKey);
        if (fromNode && toNode) {
          const scaleAlpha = Math.min(fromNode.graphics.scale.x, toNode.graphics.scale.x);
          if (scaleAlpha > 0.01) {
            this.edgeGraphics.moveTo(fromNode.graphics.x, fromNode.graphics.y);
            this.edgeGraphics.lineTo(toNode.graphics.x, toNode.graphics.y);
            this.edgeGraphics.stroke({ color: edgeColor, width: 2, alpha: 0.4 * scaleAlpha });
          }
        }
      }
      this._edgesDirty = false;
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

  markEdgesDirty() {
    this._edgesDirty = true;
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
    onDeepDiveRequest?: (graphIndex: number) => void,
    vaporizeActionType: 'vaporize' | 'ignore' | 'subgraph' | null = null
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

    const graphMetas = graphs.map((graph) => {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const v of graph.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      if (graph.vertices.length === 0) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
      return { minX, maxX, minY, maxY, widthCells: maxX - minX + 1, heightCells: maxY - minY + 1, graphFingerprint: getLocalGraphFingerprint(graph) };
    });

    let maxWidthCells = 0;
    let maxHeightCells = 0;
    for (const m of graphMetas) {
      if (m.widthCells > maxWidthCells) maxWidthCells = m.widthCells;
      if (m.heightCells > maxHeightCells) maxHeightCells = m.heightCells;
    }
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
      let totalWidth = 0;
      let totalHeight = 0;
      for (const l of layouts) {
        const right = l.offsetX + l.pixelWidth;
        const bottom = l.offsetY + l.pixelHeight;
        if (right > totalWidth) totalWidth = right;
        if (bottom > totalHeight) totalHeight = bottom;
      }
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

      if (!isExecuting) {
        gsap.to(this.stage.position, { x: offsetX, y: offsetY, duration: 0.6, delay: layoutDelay, ease: "power2.out" });
        gsap.to(this.stage.scale, { x: targetScale, y: targetScale, duration: 0.6, delay: layoutDelay, ease: "power2.out" });
      }
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
        const wandScale = 1 / targetScale;

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
            fill: "#ffffff",
            dropShadow: {
              alpha: 0.5,
              blur: 2,
              color: 0x000000,
              distance: 1,
            }
          }
        });
        text.x = 28 - text.width / 2;
        text.y = 11 - text.height / 2;

        const wandGroup = new PIXI.Container();
        wandGroup.addChild(wandBg);
        wandGroup.addChild(text);

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
              fill: "#ffffff",
              dropShadow: {
                alpha: 0.5,
                blur: 2,
                color: 0x000000,
                distance: 1,
              }
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
          tooltipGroup.x = 28 - (tooltipText.width + tooltipPadX * 2) / 2;
          tooltipGroup.y = 26;
          tooltipGroup.alpha = 0;
          wandGroup.addChild(tooltipGroup);
        }

        let minYVertex = Infinity;
        for (const v of graph.vertices) {
          if (v.y < minYVertex) minYVertex = v.y;
        }
        const topRowVertices = graph.vertices.filter(v => v.y === minYVertex);
        const topRightVertex = topRowVertices.reduce((prev, curr) => (curr.x > prev.x ? curr : prev));

        const cornerX = layout.offsetX + (topRightVertex.x - meta.minX + 1) * this.cellSize;
        const cornerY = layout.offsetY + (topRightVertex.y - meta.minY) * this.cellSize;

        wandGroup.x = cornerX + 10 * wandScale - 28 * wandScale;
        wandGroup.y = cornerY - 20 * wandScale;

        wandGroup.scale.set(0);
        gsap.to(wandGroup.scale, { x: wandScale, y: wandScale, duration: 0.4, ease: "back.out(1.5)", delay: layoutDelay });

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
          gsap.to([node.graphics.scale, node.glowGraphics.scale], { x: 1, y: 1, duration: 0.4, delay: layoutDelay, ease: "back.out(1.7)", onUpdate: () => this.markEdgesDirty() });
        } else {
          if (!isExecuting) {
            gsap.to([node.graphics, node.glowGraphics], { x: targetX, y: targetY, duration: 0.6, ease: "power2.out", onUpdate: () => this.markEdgesDirty() });
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
        drawNode(node, this.cellSize, this.palette, isSelected, vaporizeActionType);
      });

    });

    this.activeEdges = activeEdges;

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
            onUpdate: () => this.markEdgesDirty(),
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
          gsap.to([node.graphics.scale, node.glowGraphics.scale], {
            x: 1.4,
            y: 1.4,
            duration: 0.15,
            yoyo: true,
            repeat: 1,
            ease: "power2.out",
            onUpdate: () => this.markEdgesDirty(),
            onComplete: () => {
              const shardColors = this.palette ? [this.palette.select, this.palette.selectBorder] : [node.color, 0xdcfce7];
              spawnExplosion(this.particleContainer, this.particles, this.dyingGraphics.size / 2, node.graphics.x, node.graphics.y, shardColors, readOnly);
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
          gsap.to([node.graphics.scale, node.glowGraphics.scale], {
            x: 1.4,
            y: 1.4,
            duration: 0.15,
            yoyo: true,
            repeat: 1,
            ease: "power2.out",
            onUpdate: () => this.markEdgesDirty(),
            onComplete: () => {
              const shardColors = this.palette ? [this.palette.tileA, this.palette.tileB] : [0x10b981, 0x34d399, 0xfcd34d];
              spawnExplosion(this.particleContainer, this.particles, this.dyingGraphics.size / 2, node.graphics.x, node.graphics.y, shardColors, readOnly);
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

    this._edgesDirty = true;
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
