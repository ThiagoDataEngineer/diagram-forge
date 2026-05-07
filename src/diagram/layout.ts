import type { DiagramNode, DiagramEdge } from "../analyzer/agent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Point { x: number; y: number }

export interface LayoutNode extends DiagramNode {
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface LayoutEdge extends DiagramEdge {
  path: string;       // SVG cubic bezier path string
  labelPoint: Point;  // midpoint for label placement
  animDuration: string;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  viewBox: { x: number; y: number; width: number; height: number };
}

// ─── Layer assignment ─────────────────────────────────────────────────────────
// Left → right: CDN / Frontend → Gateway / Auth → Backend / Worker → Queue / Cache → DB / Storage / Monitoring / ML

const LAYER_ORDER: Record<string, number> = {
  cdn:          0,
  frontend:     1,
  auth:         2,
  gateway:      2,
  backend:      3,
  worker:       3,
  ml_model:     3,
  queue:        4,
  cache:        4,
  database:     5,
  storage:      5,
  monitoring:   5,
  external_api: 6,
  other:        3,
};

function assignLayer(node: DiagramNode): number {
  return LAYER_ORDER[node.type] ?? 3;
}

// ─── Node sizing ──────────────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 90;
const H_GAP  = 100;   // horizontal gap between layers
const V_GAP  = 40;    // vertical gap between nodes in same layer
const PADDING = 60;   // canvas padding

// ─── Layout Algorithm ─────────────────────────────────────────────────────────

export function computeLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[]
): Layout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], viewBox: { x: 0, y: 0, width: 400, height: 300 } };
  }

  // 1. Assign layers
  const layerMap = new Map<string, number>();
  for (const n of nodes) {
    layerMap.set(n.id, assignLayer(n));
  }

  // Refine: if a node only has incoming edges from higher layers, nudge it
  // (simple one-pass heuristic)
  for (const edge of edges) {
    const fromLayer = layerMap.get(edge.from) ?? 0;
    const toLayer   = layerMap.get(edge.to)   ?? 0;
    if (toLayer <= fromLayer) {
      layerMap.set(edge.to, fromLayer + 1);
    }
  }

  // 2. Group nodes by layer
  const layers = new Map<number, DiagramNode[]>();
  for (const node of nodes) {
    const l = layerMap.get(node.id) ?? 3;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(node);
  }

  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);

  // 3. Compute x per layer, y per position in layer
  const layoutNodes: LayoutNode[] = [];
  const nodePositions = new Map<string, LayoutNode>();

  let currentX = PADDING;
  for (const layerIdx of sortedLayers) {
    const layerNodes = layers.get(layerIdx)!;
    const totalH = layerNodes.length * NODE_H + (layerNodes.length - 1) * V_GAP;
    let currentY = PADDING;

    // Center the layer vertically later — for now stack from top
    for (let i = 0; i < layerNodes.length; i++) {
      const node = layerNodes[i];
      const ln: LayoutNode = {
        ...node,
        x: currentX,
        y: currentY,
        width:  NODE_W,
        height: NODE_H,
        layer:  layerIdx,
      };
      layoutNodes.push(ln);
      nodePositions.set(node.id, ln);
      currentY += NODE_H + V_GAP;
    }

    currentX += NODE_W + H_GAP;
    void totalH; // suppress unused warning
  }

  // 4. Vertical centering — find max height and center each layer
  const maxY = Math.max(...layoutNodes.map((n) => n.y + n.height)) + PADDING;
  for (const layerIdx of sortedLayers) {
    const inLayer = layoutNodes.filter((n) => n.layer === layerIdx);
    const layerH  = inLayer.length * NODE_H + (inLayer.length - 1) * V_GAP;
    const offsetY = (maxY - PADDING - layerH) / 2;
    for (const n of inLayer) {
      n.y += offsetY;
    }
  }

  // 5. Build edge paths as cubic bezier curves
  const layoutEdges: LayoutEdge[] = [];

  for (const edge of edges) {
    const from = nodePositions.get(edge.from);
    const to   = nodePositions.get(edge.to);

    if (!from || !to) continue;

    // Exit point: right-center of source; Entry point: left-center of target
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;

    // Handle same-layer edges (bend around)
    let path: string;
    if (Math.abs(x1 - x2) < 20) {
      // Same or very close layer — route below
      const bend = Math.max(from.y, to.y) + NODE_H + 30;
      const cx1  = x1 + 40;
      const cx2  = x2 + 40;
      path = `M ${x1} ${y1} C ${cx1} ${y1} ${cx1} ${bend} ${(x1 + x2) / 2} ${bend} S ${cx2} ${y2} ${x2} ${y2}`;
    } else {
      // Normal left-to-right cubic bezier
      const dx = Math.abs(x2 - x1) * 0.5;
      path = `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
    }

    // Animation speed: async = slower, WebSocket = fast, Lightning = very fast
    const durationMap: Record<string, string> = {
      WebSocket: "0.5s",
      Lightning: "0.3s",
      AMQP:      "1.2s",
      SQL:       "0.9s",
      Redis:     "0.6s",
      gRPC:      "0.5s",
      HTTP:      "0.8s",
      HTTPS:     "0.8s",
      Unknown:   "1.0s",
    };
    const animDuration = edge.async
      ? "1.4s"
      : (durationMap[edge.protocol] ?? "0.8s");

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    layoutEdges.push({
      ...edge,
      path,
      labelPoint: { x: midX, y: midY - 10 },
      animDuration,
    });
  }

  // 6. Compute viewBox
  const maxX = Math.max(...layoutNodes.map((n) => n.x + n.width)) + PADDING;
  const totalH = Math.max(...layoutNodes.map((n) => n.y + n.height)) + PADDING;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    viewBox: { x: 0, y: 0, width: maxX, height: totalH },
  };
}
