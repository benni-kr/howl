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
  textContainer: PIXI.Container;
  gridLinesContainer: PIXI.Container;

  nodes: Map<string, {
    x: number; y: number; vertex: Vertex;
    graphics: PIXI.Graphics; glowGraphics: PIXI.Graphics;
    isPendingCut: boolean; color: number;
    graphIndex: number;
    _drawnPendingCut: boolean;
    _drawnSelected: boolean;
    _drawnVaporizeType: string | null;
    _drawnCellSize: number;
    _drawnPaletteId: number;
  }>;
  activeEdges: Set<string>;
  particles: Particle[];
  dyingGraphics: Set<PIXI.Graphics>;
  _blurFilter: PIXI.BlurFilter;
  _textCache: Map<string, PIXI.Text>;

  onNodePointerDown?: (vertex: Vertex, graphIndex: number, shiftKey: boolean) => void;
  onNodePointerEnter?: (vertex: Vertex, graphIndex: number) => void;
  onPointerUp?: () => void;
  onGraphClick?: (graphIndex: number) => void;
  onDeepDiveRequest?: (graphIndex: number) => void;
  onAutoSolve?: (graphIndex: number) => void;
  onIgnoreDuplicate?: (graphIndex: number) => void;

  cellSize: number = BASE_CELL_SIZE;
  splitView: boolean = false;
  selectedGraphIndex: number | null = null;
  isDestroyed: boolean = false;
  palette: Palette | null = null;
  _activeExplosions: number = 0;
  _edgesDirty: boolean = true;

  _isManualCamera: boolean = false;
  _isPanning: boolean = false;
  _panStart: { x: number, y: number } = { x: 0, y: 0 };
  _stageStart: { x: number, y: number } = { x: 0, y: 0 };
  _minScale: number = 0.05;
  _activePointers: Map<number, { x: number, y: number }> = new Map();
  _initialPinchDistance: number = 0;
  _initialPinchScale: number = 0;
  onCameraManualOverride?: (isManual: boolean) => void;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.app = new PIXI.Application();
    this.stage = new PIXI.Container();
    this.edgeGraphics = new PIXI.Graphics();
    this.nodeContainer = new PIXI.Container();
    this.particleContainer = new PIXI.Container();
    this.glowContainer = new PIXI.Container();
    this.wandContainer = new PIXI.Container();
    this.textContainer = new PIXI.Container();
    this.textContainer.eventMode = "none";
    this.textContainer.interactiveChildren = false;
    this.gridLinesContainer = new PIXI.Container();
    this.gridLinesContainer.eventMode = "none";
    this.gridLinesContainer.interactiveChildren = false;

    this._blurFilter = new PIXI.BlurFilter();
    this._blurFilter.blur = 12;
    this._blurFilter.quality = 4;
    this._blurFilter.padding = 100;
    this.glowContainer.filters = [this._blurFilter];

    this.stage.addChild(this.glowContainer);
    this.stage.addChild(this.edgeGraphics);
    this.stage.addChild(this.nodeContainer);
    this.stage.addChild(this.gridLinesContainer);
    this.stage.addChild(this.textContainer);
    this.stage.addChild(this.wandContainer);
    this.stage.addChild(this.particleContainer);

    this.nodes = new Map();
    this.activeEdges = new Set();
    this.particles = [];
    this.dyingGraphics = new Set();
    this._textCache = new Map();
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

    this.stage.on("pointerdown", (e) => {
      this._activePointers.set(e.pointerId, { x: e.global.x, y: e.global.y });

      // Two-finger touch for mobile pan/zoom
      if (this._activePointers.size === 2) {
        this._isPanning = true;
        const pts = Array.from(this._activePointers.values());
        this._initialPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this._initialPinchScale = this.stage.scale.x;
        this._panStart = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        this._stageStart = { x: this.stage.position.x, y: this.stage.position.y };
      } 
      // Initiate pan on desktop only if cmd/ctrl is held
      else if (e.metaKey || e.ctrlKey) {
        this._isPanning = true;
        this._panStart = { x: e.global.x, y: e.global.y };
        this._stageStart = { x: this.stage.position.x, y: this.stage.position.y };
      }
    });

    this.stage.on("globalpointermove", (e) => {
      if (this._activePointers.has(e.pointerId)) {
        this._activePointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      }

      if (this._isPanning) {
        if (!this._isManualCamera) {
          this._isManualCamera = true;
          this.onCameraManualOverride?.(true);
          gsap.killTweensOf(this.stage.position);
          gsap.killTweensOf(this.stage.scale);
        }

        if (this._activePointers.size === 2) {
          // Pinch-to-zoom + pan
          const pts = Array.from(this._activePointers.values());
          const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          const currentCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

          if (this._initialPinchDistance > 0) {
            let zoomScale = currentDist / this._initialPinchDistance;
            
            // Limit scale
            const newScaleRaw = this._initialPinchScale * zoomScale;
            let newScale = newScaleRaw;
            if (newScale > 10) newScale = 10;
            if (newScale < this._minScale) newScale = this._minScale;

            this.stage.scale.set(newScale);

            // Pan offset
            const dx = currentCenter.x - this._panStart.x;
            const dy = currentCenter.y - this._panStart.y;
            
            // Adjust position so that the zoom is centered around the initial pinch point
            // This requires calculating where the original center would be at the new scale
            const scaleRatio = newScale / this._initialPinchScale;
            const scaledStageStartX = this._panStart.x - (this._panStart.x - this._stageStart.x) * scaleRatio;
            const scaledStageStartY = this._panStart.y - (this._panStart.y - this._stageStart.y) * scaleRatio;

            this.stage.position.set(scaledStageStartX + dx, scaledStageStartY + dy);
          }
        } else {
          // Single-finger (with Cmd/Ctrl) or single-mouse pan
          const dx = e.global.x - this._panStart.x;
          const dy = e.global.y - this._panStart.y;
          this.stage.position.set(this._stageStart.x + dx, this._stageStart.y + dy);
        }
      }
    });

    const pointerUpHandler = (e: PIXI.FederatedPointerEvent) => {
      this._activePointers.delete(e.pointerId);
      if (this._activePointers.size < 2) {
        if (this._isPanning && this._activePointers.size === 1) {
          // If we lift one finger during a pinch, reset pan anchor to the remaining finger to avoid jumping
          const remainingPt = Array.from(this._activePointers.values())[0];
          this._panStart = { x: remainingPt.x, y: remainingPt.y };
          this._stageStart = { x: this.stage.position.x, y: this.stage.position.y };
        } else if (this._activePointers.size === 0) {
          this._isPanning = false;
        }
      }
      this.onPointerUp?.();
    };

    this.stage.on("pointerup", pointerUpHandler);
    this.stage.on("pointerupoutside", pointerUpHandler);

    this.app.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      
      if (!this._isManualCamera) {
        this._isManualCamera = true;
        this.onCameraManualOverride?.(true);
        gsap.killTweensOf(this.stage.position);
        gsap.killTweensOf(this.stage.scale);
      }

      const point = new PIXI.Point(e.offsetX, e.offsetY);
      const localPoint = this.stage.toLocal(point);

      // Scroll up/down controls zoom in/out
      let zoomScale = e.deltaY > 0 ? 0.9 : 1.1;
      
      // Limit scale to avoid extreme zooms
      const currentScale = this.stage.scale.x;
      if (currentScale * zoomScale > 10) zoomScale = 10 / currentScale;
      if (currentScale * zoomScale < this._minScale) zoomScale = this._minScale / currentScale;

      const newScaleX = this.stage.scale.x * zoomScale;
      const newScaleY = this.stage.scale.y * zoomScale;
      
      this.stage.scale.set(newScaleX, newScaleY);
      
      const newLocalPoint = this.stage.toGlobal(localPoint);
      this.stage.position.x += point.x - newLocalPoint.x;
      this.stage.position.y += point.y - newLocalPoint.y;
    }, { passive: false });
  }

  resetCamera() {
    this._isManualCamera = false;
    this.onCameraManualOverride?.(false);
    // Returning true tells the caller we successfully reset state, they should re-sync
    return true;
  }

  resize(width: number, height: number) {
    this.app.renderer.resize(width, height);
  }

  update() {
    if (this._edgesDirty) {
      this.edgeGraphics.clear();
      const edgeColor = this.palette?.border ?? 0x334155;
      let hasEdges = false;
      for (const edgeKey of this.activeEdges) {
        const [fromKey, toKey] = edgeKey.split('-');
        const fromNode = this.nodes.get(fromKey);
        const toNode = this.nodes.get(toKey);
        if (fromNode && toNode) {
          const scaleAlpha = Math.min(fromNode.graphics.scale.x, toNode.graphics.scale.x);
          if (scaleAlpha > 0.01) {
            this.edgeGraphics.moveTo(fromNode.graphics.x, fromNode.graphics.y);
            this.edgeGraphics.lineTo(toNode.graphics.x, toNode.graphics.y);
            hasEdges = true;
          }
        }
      }
      if (hasEdges) {
        this.edgeGraphics.stroke({ color: edgeColor, width: 2, alpha: 0.4 });
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
    vaporizeActionType: 'vaporize' | 'ignore' | 'subgraph' | null = null,
    showGridIndices: boolean = false,
    showCoordinateSystem: boolean = false,
    showGridLines: boolean = false
  ) {
    this.palette = palette;
    this.splitView = splitView;
    this.selectedGraphIndex = selectedGraphIndex;
    this.onNodePointerDown = onNodePointerDown;
    this.onNodePointerEnter = onNodePointerEnter;
    this.onPointerUp = onPointerUp;
    this.onGraphClick = onGraphClick;
    this.onAutoSolve = onAutoSolve;
    this.onIgnoreDuplicate = onIgnoreDuplicate;
    this.onDeepDiveRequest = onDeepDiveRequest;

    let totalVertexCount = 0;
    graphs.forEach(g => totalVertexCount += g.vertices.length);
    bankedGraphs.forEach(g => totalVertexCount += g.vertices.length);

    if (totalVertexCount > 2500) {
      this.glowContainer.filters = [];
    } else {
      if (totalVertexCount > 900) {
        this._blurFilter.quality = 1;
        this._blurFilter.blur = 6;
        this._blurFilter.padding = 10;
      } else if (totalVertexCount > 200) {
        this._blurFilter.quality = 2;
        this._blurFilter.blur = 8;
        this._blurFilter.padding = 20;
      } else {
        this._blurFilter.quality = 3;
        this._blurFilter.blur = 10;
        this._blurFilter.padding = 40;
      }
      this.glowContainer.filters = [this._blurFilter];
    }

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
      this._minScale = targetScale;
      const offsetX = -minX * targetScale + (width - vWidth * targetScale) / 2;
      const offsetY = -minY * targetScale + (height - vHeight * targetScale) / 2;

      if (!isExecuting) {
        if (!this._isManualCamera) {
          gsap.to(this.stage.position, { x: offsetX, y: offsetY, duration: 0.6, delay: layoutDelay, ease: "power2.out" });
          gsap.to(this.stage.scale, { x: targetScale, y: targetScale, duration: 0.6, delay: layoutDelay, ease: "power2.out" });
        }
      }
    }

    this.wandContainer.removeChildren();
    // We pool text objects now, so don't clear textContainer here.
    this.gridLinesContainer.removeChildren();

    const seenHashes = new Set<string>();
    const usedTextKeys = new Set<string>();
    
    const pendingCutKeys = new Set<string>();
    pendingCutSet.forEach(v => pendingCutKeys.add(`${v.x},${v.y}`));
    
    const bankedVertexKeys = new Set<string>();
    bankedGraphs.forEach(g => {
      g.vertices.forEach(v => bankedVertexKeys.add(`${v.x},${v.y}`));
    });
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

      if ((showCoordinateSystem || showGridLines) && graphs.length === 1) {
        const gridColor = document.documentElement.dataset.theme === 'light' ? 0x1f2937 : 0xffffff;
        const textScale = Math.max(8, this.cellSize * 0.4) / 32;
        const minXPixel = layout.offsetX;
        const maxXPixel = layout.offsetX + meta.widthCells * this.cellSize;
        const minYPixel = layout.offsetY;
        const maxYPixel = layout.offsetY + meta.heightCells * this.cellSize;

        if (showCoordinateSystem) {
          const axisOffset = 5;
          const originX = minXPixel - axisOffset;
          const originY = minYPixel - axisOffset;

          for (let x = meta.minX; x <= meta.maxX; x++) {
            const text = new PIXI.Text({
               text: (x - meta.minX).toString(),
               style: { fontFamily: "sans-serif", fontSize: 32, fill: gridColor }
            });
            text.scale.set(textScale);
            text.alpha = 0.6;
            text.x = layout.offsetX + (x - meta.minX) * this.cellSize + this.cellSize / 2 - text.width / 2;
            text.y = originY - text.height - 4;
            this.gridLinesContainer.addChild(text);
          }
          for (let y = meta.minY; y <= meta.maxY; y++) {
            const text = new PIXI.Text({
               text: (y - meta.minY).toString(),
               style: { fontFamily: "sans-serif", fontSize: 32, fill: gridColor }
            });
            text.scale.set(textScale);
            text.alpha = 0.6;
            text.x = originX - text.width - 6;
            text.y = layout.offsetY + (y - meta.minY) * this.cellSize + this.cellSize / 2 - text.height / 2;
            this.gridLinesContainer.addChild(text);
          }

          const gridGfx = new PIXI.Graphics();
          gridGfx.alpha = 0.5;
          const arrowOffset = 10;

          // Main axes paths
          gridGfx.moveTo(maxXPixel + arrowOffset - 8, originY);
          gridGfx.lineTo(originX, originY);
          gridGfx.lineTo(originX, maxYPixel + arrowOffset - 8);
          gridGfx.stroke({ color: gridColor, alpha: 1.0, width: 1.5 });

          // m arrow (filled triangle)
          gridGfx.moveTo(maxXPixel + arrowOffset, originY);
          gridGfx.lineTo(maxXPixel + arrowOffset - 8, originY - 4);
          gridGfx.lineTo(maxXPixel + arrowOffset - 8, originY + 4);
          gridGfx.fill({ color: gridColor, alpha: 1.0 });

          // n arrow (filled triangle)
          gridGfx.moveTo(originX, maxYPixel + arrowOffset);
          gridGfx.lineTo(originX - 4, maxYPixel + arrowOffset - 8);
          gridGfx.lineTo(originX + 4, maxYPixel + arrowOffset - 8);
          gridGfx.fill({ color: gridColor, alpha: 1.0 });

          // Label for X-axis (m)
          const labelM = new PIXI.Text({ text: "m", style: { fontFamily: "sans-serif", fontSize: 32, fill: gridColor, fontStyle: "italic" } });
          labelM.scale.set(textScale);
          labelM.alpha = 0.6;
          labelM.x = maxXPixel + arrowOffset - labelM.width / 2;
          labelM.y = originY - labelM.height - 4;
          this.gridLinesContainer.addChild(labelM);

          // Label for Y-axis (n)
          const labelN = new PIXI.Text({ text: "n", style: { fontFamily: "sans-serif", fontSize: 32, fill: gridColor, fontStyle: "italic" } });
          labelN.scale.set(textScale);
          labelN.alpha = 0.6;
          labelN.x = originX - labelN.width - 6;
          labelN.y = maxYPixel + arrowOffset - labelN.height / 2;
          this.gridLinesContainer.addChild(labelN);

          this.gridLinesContainer.addChild(gridGfx);
        }

        if (showGridLines) {
          const linesHalfGfx = new PIXI.Graphics(); linesHalfGfx.alpha = 0.5;
          const linesQuarterGfx = new PIXI.Graphics(); linesQuarterGfx.alpha = 0.35;
          const linesOtherGfx = new PIXI.Graphics(); linesOtherGfx.alpha = 0.2;

          const drawDashedLine = (gfx: PIXI.Graphics, x1: number, y1: number, x2: number, y2: number, dashLength: number, spaceLength: number, strokeOptions: any) => {
             const dx = x2 - x1;
             const dy = y2 - y1;
             const distance = Math.sqrt(dx * dx + dy * dy);
             const numDashes = Math.floor(distance / (dashLength + spaceLength));
             const dashX = (dx / distance) * dashLength;
             const dashY = (dy / distance) * dashLength;
             const spaceX = (dx / distance) * spaceLength;
             const spaceY = (dy / distance) * spaceLength;

             let cx = x1;
             let cy = y1;

             for (let i = 0; i < numDashes; i++) {
               gfx.moveTo(cx, cy);
               gfx.lineTo(cx + dashX, cy + dashY);
               cx += dashX + spaceX;
               cy += dashY + spaceY;
             }
             
             const remaining = distance - numDashes * (dashLength + spaceLength);
             if (remaining > 0) {
               const finalDash = Math.min(remaining, dashLength);
               gfx.moveTo(cx, cy);
               gfx.lineTo(cx + (dx / distance) * finalDash, cy + (dy / distance) * finalDash);
             }
             
             gfx.stroke(strokeOptions);
          };

          const drawFractions = (sizePixels: number, sizeCells: number, isX: boolean) => {
             if (sizeCells < 2) return;
             
             let maxDivisor = 1;
             let current = 2;
             while (current <= sizeCells / 2) {
                 maxDivisor = current;
                 current *= 2;
             }
             if (maxDivisor < 2) maxDivisor = 2;

             let fractions: number[] = [];
             for (let div = 2; div <= maxDivisor; div *= 2) {
                 for (let i = 1; i < div; i += 2) {
                     fractions.push(i / div);
                 }
             }

             for (const frac of fractions) {
               const pixelOffset = sizePixels * frac;
               
               const isHalf = Math.abs(frac - 1/2) < 0.01;
               const isQuarter = Math.abs((frac * 4) - Math.round(frac * 4)) < 0.01 && !isHalf;
               
               let width = 1.5;
               let dashLength = 2; 
               let spaceLength = 4;
               let targetGfx = linesOtherGfx;

               if (isHalf) { targetGfx = linesHalfGfx; width = 2; dashLength = 8; spaceLength = 6; }
               else if (isQuarter) { targetGfx = linesQuarterGfx; dashLength = 2; spaceLength = 4; }
               else { dashLength = 2; spaceLength = 5; }
               
               const gfxOptions = { color: gridColor, alpha: 1.0, width };
               const lineExtension = 8;
               const labelOffset = 6;

               if (isX) {
                 drawDashedLine(targetGfx, minXPixel + pixelOffset, minYPixel, minXPixel + pixelOffset, maxYPixel + lineExtension, dashLength, spaceLength, gfxOptions);
               } else {
                 drawDashedLine(targetGfx, minXPixel, minYPixel + pixelOffset, maxXPixel + lineExtension, minYPixel + pixelOffset, dashLength, spaceLength, gfxOptions);
               }

               let num = Math.round(frac * maxDivisor);
               const isSmallestDivision = (num % 2 !== 0);

               if (!isSmallestDivision || frac === 1/2) {
                 let numSimp = Math.round(frac * maxDivisor);
                 let denSimp = maxDivisor;
                 while(numSimp % 2 === 0 && denSimp % 2 === 0) { numSimp /= 2; denSimp /= 2; }
                 const fracStr = `${numSimp}/${denSimp}`;

                 const fracText = new PIXI.Text({ text: fracStr, style: { fontFamily: "sans-serif", fontSize: 24, fill: gridColor }});
                 fracText.scale.set(textScale * 0.7);
                 fracText.alpha = 0.7;

                 if (isX) {
                   fracText.x = minXPixel + pixelOffset - fracText.width / 2;
                   fracText.y = maxYPixel + labelOffset + 4;
                 } else {
                   fracText.x = maxXPixel + labelOffset + 6;
                   fracText.y = minYPixel + pixelOffset - fracText.height / 2;
                 }
                 this.gridLinesContainer.addChild(fracText);
               }
             }
          };

          drawFractions(meta.widthCells * this.cellSize, meta.widthCells, true);
          drawFractions(meta.heightCells * this.cellSize, meta.heightCells, false);

          this.gridLinesContainer.addChild(linesOtherGfx);
          this.gridLinesContainer.addChild(linesQuarterGfx);
          this.gridLinesContainer.addChild(linesHalfGfx);
        }
      }

      if (showGridIndices && graphs.length === 1 && totalVertexCount <= 2500) {
        const gridColor = document.documentElement.dataset.theme === 'light' ? 0x1f2937 : 0xffffff;
        const textScale = Math.max(5, this.cellSize * 0.25) / 32;
        graph.vertices.forEach(vertex => {
          const key = `${vertex.x},${vertex.y}`;
          usedTextKeys.add(key);
          let text = this._textCache.get(key);
          if (!text) {
            text = new PIXI.Text({
               text: key,
               style: { fontFamily: "sans-serif", fontSize: 32, fill: gridColor }
            });
            this._textCache.set(key, text);
            this.textContainer.addChild(text);
          } else {
            text.style.fill = gridColor;
          }
          text.scale.set(textScale);
          text.alpha = 0.4;
          const targetX = layout.offsetX + (vertex.x - meta.minX) * this.cellSize + this.cellSize / 2;
          const targetY = layout.offsetY + (vertex.y - meta.minY) * this.cellSize + this.cellSize / 2;
          text.x = targetX - text.width / 2;
          text.y = targetY - text.height / 2;
        });
      }

      if (optRank && optRank.best_rank !== 999999 && !isExecuting && pendingCutSet.length === 0 && !isUntouchedFirstGraph && totalVertexCount <= 2500) {
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
        const isPendingCut = pendingCutKeys.has(key);

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
            graphIndex,
            _drawnPendingCut: !isPendingCut,
            _drawnSelected: !isSelected,
            _drawnVaporizeType: "none",
            _drawnCellSize: -1,
            _drawnPaletteId: -1,
          };
          node.graphics.x = targetX;
          node.graphics.y = targetY;
          node.glowGraphics.x = targetX;
          node.glowGraphics.y = targetY;
          node.graphics.eventMode = "static";
          node!.graphics.cursor = "pointer";
          
          node!.graphics.on("pointerdown", (e) => {
            this._activePointers.set(e.pointerId, { x: e.global.x, y: e.global.y });

            if (e.pointerId !== undefined && (node!.graphics as any).hasPointerCapture?.(e.pointerId)) {
              (node!.graphics as any).releasePointerCapture(e.pointerId);
            }
            
            if (e.metaKey || e.ctrlKey) {
              return; // Let stage handle desktop panning
            }

            if (this._activePointers.size >= 2) {
              return; // Let stage handle multi-touch panning
            }

            e.stopPropagation();

            if (this.isDestroyed) return;
            const currentGraphIndex = node!.graphIndex;
            if (readOnly) {
              if (node!.isPendingCut && this.onDeepDiveRequest) {
                this.onDeepDiveRequest(currentGraphIndex);
              }
              return;
            }

            if (!this.splitView || currentGraphIndex === this.selectedGraphIndex) {
              this.onNodePointerDown?.(vertex, currentGraphIndex, e.shiftKey);
            } else {
              this.onGraphClick?.(currentGraphIndex);
            }
          });

          node!.graphics.on("pointerenter", () => {
            if (readOnly || this.splitView || this.isDestroyed || this._isPanning) return;
            this.onNodePointerEnter?.(vertex, node!.graphIndex);
          });
          this.nodeContainer.addChild(node.graphics);
          this.glowContainer.addChild(node.glowGraphics);
          this.nodes.set(key, node);

          node.graphics.scale.set(0);
          node.glowGraphics.scale.set(0);
          gsap.to([node.graphics.scale, node.glowGraphics.scale], { x: 1, y: 1, duration: 0.4, delay: layoutDelay, ease: "back.out(1.7)", onUpdate: () => this.markEdgesDirty() });
        } else {
          node.graphIndex = graphIndex;
          if (!isExecuting) {
            gsap.to([node.graphics, node.glowGraphics], { x: targetX, y: targetY, duration: 0.6, ease: "power2.out", onUpdate: () => this.markEdgesDirty() });
          }
        }

        node.isPendingCut = isPendingCut;
        
        const paletteId = this.palette?.tileA ?? 0;
        const needsRedraw = 
          node._drawnPendingCut !== isPendingCut ||
          node._drawnSelected !== isSelected ||
          node._drawnVaporizeType !== vaporizeActionType ||
          node._drawnCellSize !== this.cellSize ||
          node._drawnPaletteId !== paletteId;

        if (needsRedraw) {
          drawNode(node, this.cellSize, this.palette, isSelected, vaporizeActionType);
          node._drawnPendingCut = isPendingCut;
          node._drawnSelected = isSelected;
          node._drawnVaporizeType = vaporizeActionType;
          node._drawnCellSize = this.cellSize;
          node._drawnPaletteId = paletteId;
        }
      });

    });

    for (const [key, text] of this._textCache.entries()) {
      if (!usedTextKeys.has(key)) {
        this.textContainer.removeChild(text);
        text.destroy();
        this._textCache.delete(key);
      }
    }

    this.activeEdges = activeEdges;

    for (const [key, node] of this.nodes.entries()) {
      if (!activeKeys.has(key)) {
        const isBanked = bankedVertexKeys.has(key);

        this.dyingGraphics.add(node.graphics);
        this.dyingGraphics.add(node.glowGraphics);
        gsap.killTweensOf(node.graphics);
        gsap.killTweensOf(node.glowGraphics);

        if (totalVertexCount > 2500) {
          this.nodeContainer.removeChild(node.graphics);
          this.glowContainer.removeChild(node.glowGraphics);
          this.dyingGraphics.delete(node.graphics);
          this.dyingGraphics.delete(node.glowGraphics);
          node.graphics.destroy();
          node.glowGraphics.destroy();
        } else if (isBanked) {
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
              spawnExplosion(this.particleContainer, this.particles, this.dyingGraphics.size / 2, node.graphics.x, node.graphics.y, shardColors, readOnly, totalVertexCount);
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
              spawnExplosion(this.particleContainer, this.particles, this.dyingGraphics.size / 2, node.graphics.x, node.graphics.y, shardColors, readOnly, totalVertexCount);
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
