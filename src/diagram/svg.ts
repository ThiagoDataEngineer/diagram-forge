import type { ArchitectureGraph } from "../analyzer/agent.js";
import { computeLayout } from "./layout.js";
import { logoImageTag, NODE_THEME } from "./logos.js";
import type { LayoutNode, LayoutEdge } from "./layout.js";

// ─── Protocol colors for edges ────────────────────────────────────────────────

const PROTOCOL_COLOR: Record<string, string> = {
  HTTP:       "#6366F1",
  HTTPS:      "#6366F1",
  WebSocket:  "#10B981",
  gRPC:       "#F59E0B",
  AMQP:       "#F97316",
  SQL:        "#3B82F6",
  Redis:      "#EF4444",
  GraphQL:    "#E10098",
  tRPC:       "#2596BE",
  Lightning:  "#792EE5",
  TCP:        "#64748B",
  Unknown:    "#9CA3AF",
};

// ─── CSS animations ───────────────────────────────────────────────────────────

function buildStyles(edges: LayoutEdge[]): string {
  // Generate unique keyframe per edge for different speeds
  const keyframes = new Set<string>();
  for (const e of edges) {
    keyframes.add(e.animDuration);
  }

  const kfBlocks = [...keyframes]
    .map((dur) => {
      const name = `flow_${dur.replace(".", "_").replace("s", "")}`;
      return `@keyframes ${name} { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }`;
    })
    .join("\n");

  return `
    <style>
      /* ── Base ── */
      .node-box {
        filter: drop-shadow(0 2px 6px rgba(0,0,0,0.10));
        transition: filter 0.2s;
        cursor: pointer;
      }
      .node-box:hover { filter: drop-shadow(0 4px 16px rgba(0,0,0,0.20)); }

      .node-label {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        font-weight: 600;
        pointer-events: none;
      }
      .node-tech {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 10px;
        font-weight: 400;
        opacity: 0.7;
        pointer-events: none;
      }
      .node-type-badge {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        pointer-events: none;
      }

      /* ── Edges ── */
      .edge-path {
        fill: none;
        stroke-width: 2;
        stroke-linecap: round;
      }
      .edge-path-bg {
        fill: none;
        stroke-width: 6;
        stroke-linecap: round;
        opacity: 0.06;
      }
      .edge-label {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 10px;
        font-weight: 500;
      }

      /* ── Flow animations ── */
      ${kfBlocks}
      ${[...keyframes]
        .map((dur) => {
          const name = `flow_${dur.replace(".", "_").replace("s", "")}`;
          return `.anim-${name} { animation: ${name} ${dur} linear infinite; }`;
        })
        .join("\n")}

      /* ── Arrowhead ── */
      marker { overflow: visible; }

      /* ── Title ── */
      .diagram-title {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 15px;
        font-weight: 700;
        fill: #1E293B;
      }
      .diagram-subtitle {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 11px;
        fill: #64748B;
      }
    </style>`;
}

// ─── Arrowhead markers per protocol ──────────────────────────────────────────

function buildDefs(edges: LayoutEdge[]): string {
  const protocols = new Set(edges.map((e) => e.protocol));
  const markers = [...protocols]
    .map((proto) => {
      const color = PROTOCOL_COLOR[proto] ?? "#9CA3AF";
      return `
      <marker id="arrow-${proto}" markerWidth="8" markerHeight="8"
              refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L8,3 z" fill="${color}" />
      </marker>`;
    })
    .join("\n");

  return `<defs>${markers}</defs>`;
}

// ─── Render a single node ─────────────────────────────────────────────────────

function renderNode(node: LayoutNode): string {
  const theme = NODE_THEME[node.type] ?? NODE_THEME.other;
  const { x, y, width: w, height: h } = node;

  const logoTag = logoImageTag(node.technology, x + w - 36, y + 8, 24) ?? "";

  const badgeW = Math.min(node.type.replace("_", " ").length * 7 + 12, 80);

  return `
  <g class="node-box" data-id="${node.id}" data-type="${node.type}">
    <!-- Shadow rect (offset) -->
    <rect x="${x + 2}" y="${y + 3}" width="${w}" height="${h}"
          rx="10" fill="rgba(0,0,0,0.06)" />

    <!-- Main box -->
    <rect x="${x}" y="${y}" width="${w}" height="${h}"
          rx="10" fill="${theme.bg}" stroke="${theme.border}" stroke-width="1.5" />

    <!-- Top accent bar -->
    <rect x="${x}" y="${y}" width="${w}" height="4"
          rx="10" fill="${theme.border}" />
    <rect x="${x}" y="${y + 4}" width="${w}" height="4"
          fill="${theme.border}" />

    <!-- Type badge -->
    <rect x="${x + 10}" y="${y + 14}" width="${badgeW}" height="16"
          rx="4" fill="${theme.badge}" opacity="0.15" />
    <text class="node-type-badge" x="${x + 10 + badgeW / 2}" y="${y + 26}"
          fill="${theme.badge}" text-anchor="middle">
      ${node.type.replace("_", " ")}
    </text>

    <!-- Logo -->
    ${logoTag}

    <!-- Label -->
    <text class="node-label" x="${x + w / 2}" y="${y + 52}"
          fill="${theme.text}" text-anchor="middle">
      ${truncate(node.label, 18)}
    </text>

    <!-- Tech -->
    <text class="node-tech" x="${x + w / 2}" y="${y + 68}"
          fill="${theme.text}" text-anchor="middle">
      ${truncate(node.technology, 22)}
    </text>
  </g>`;
}

// ─── Render a single edge ─────────────────────────────────────────────────────

function renderEdge(edge: LayoutEdge): string {
  const color = PROTOCOL_COLOR[edge.protocol] ?? "#9CA3AF";
  const animName = `flow_${edge.animDuration.replace(".", "_").replace("s", "")}`;
  const dashArray = edge.async ? "6 6" : "8 4";
  const markerEnd = `url(#arrow-${edge.protocol})`;

  const bidir =
    edge.direction === "bidirectional"
      ? `<path class="edge-path" d="${edge.path}"
              stroke="${color}" stroke-dasharray="${dashArray}"
              stroke-dashoffset="0" opacity="0.4"
              marker-start="url(#arrow-${edge.protocol})"
              style="animation: ${animName} ${edge.animDuration} linear infinite reverse;" />`
      : "";

  const labelTag = edge.label
    ? `<text class="edge-label" x="${edge.labelPoint.x}" y="${edge.labelPoint.y}"
          fill="${color}" text-anchor="middle"
          style="background:white; paint-order:stroke; stroke:white; stroke-width:3px;">
        ${edge.label}
      </text>`
    : "";

  const protoTag = `
    <text class="edge-label" x="${edge.labelPoint.x}" y="${edge.labelPoint.y + (edge.label ? 12 : 0)}"
          fill="${color}" text-anchor="middle" opacity="0.75"
          style="font-size:9px; paint-order:stroke; stroke:white; stroke-width:3px;">
      ${edge.protocol}${edge.async ? " ⟳" : ""}
    </text>`;

  return `
  <g class="edge-group" data-from="${edge.from}" data-to="${edge.to}" data-proto="${edge.protocol}">
    <!-- Background glow -->
    <path class="edge-path-bg" d="${edge.path}" stroke="${color}" />

    <!-- Animated dash -->
    <path class="edge-path anim-${animName}" d="${edge.path}"
          stroke="${color}" stroke-dasharray="${dashArray}"
          marker-end="${markerEnd}" />

    ${bidir}
    ${labelTag}
    ${protoTag}
  </g>`;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function renderLegend(x: number, y: number): string {
  const protocols = [
    { proto: "HTTP/S", color: "#6366F1" },
    { proto: "WebSocket", color: "#10B981" },
    { proto: "SQL", color: "#3B82F6" },
    { proto: "Redis", color: "#EF4444" },
    { proto: "AMQP", color: "#F97316" },
    { proto: "Lightning", color: "#792EE5" },
  ];

  const items = protocols.map((p, i) => `
    <line x1="${x + 8}" y1="${y + 14 + i * 18}" x2="${x + 32}" y2="${y + 14 + i * 18}"
          stroke="${p.color}" stroke-width="2" stroke-dasharray="6 3" />
    <text font-family="Inter, system-ui, sans-serif" font-size="10" fill="#475569"
          x="${x + 38}" y="${y + 18 + i * 18}">${p.proto}</text>`).join("");

  return `
  <g class="legend">
    <rect x="${x}" y="${y}" width="120" height="${20 + protocols.length * 18}"
          rx="8" fill="white" stroke="#E2E8F0" stroke-width="1" opacity="0.9" />
    <text font-family="Inter, system-ui, sans-serif" font-size="10" font-weight="600"
          fill="#64748B" x="${x + 8}" y="${y + 12}">CONNECTIONS</text>
    ${items}
  </g>`;
}

// ─── Main renderer ────────────────────────────────────────────────────────────

export function renderSVG(graph: ArchitectureGraph): string {
  const layout = computeLayout(graph.nodes, graph.edges);
  const { viewBox: vb, nodes, edges } = layout;

  // Add padding for title and legend
  const titleH = 50;
  const totalW = Math.max(vb.width + 160, 600);   // extra room for legend
  const totalH = vb.height + titleH + 20;

  const svgNodes  = nodes.map(renderNode).join("\n");
  const svgEdges  = edges.map(renderEdge).join("\n");
  const styles    = buildStyles(edges);
  const defs      = buildDefs(edges);
  const legend    = renderLegend(totalW - 140, titleH + 10);

  const confidence = `${(graph.confidence * 100).toFixed(0)}%`;
  const stack = graph.tech_stack.slice(0, 5).join(" · ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${totalW}" height="${totalH}"
     viewBox="0 0 ${totalW} ${totalH}">

  ${styles}
  ${defs}

  <!-- Background -->
  <rect width="${totalW}" height="${totalH}" fill="#F8FAFC" />
  <!-- Subtle dot grid -->
  <defs>
    <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="#CBD5E1" opacity="0.5" />
    </pattern>
  </defs>
  <rect width="${totalW}" height="${totalH}" fill="url(#dots)" />

  <!-- Title bar -->
  <rect width="${totalW}" height="${titleH}" fill="white" stroke="#E2E8F0" stroke-width="1" />
  <!-- Diagram Forge branding -->
  <rect x="0" y="0" width="4" height="${titleH}" fill="#6366F1" />
  <text class="diagram-title" x="20" y="22">Architecture Diagram</text>
  <text class="diagram-subtitle" x="20" y="38">${escapeXml(stack)}${stack ? "  ·  " : ""}confidence ${confidence}</text>
  <text class="diagram-subtitle" x="${totalW - 16}" y="30"
        text-anchor="end" opacity="0.5">Diagram Forge · powered by Claude</text>

  <!-- Diagram content (shifted down by titleH) -->
  <g transform="translate(0, ${titleH})">
    <!-- Edges (drawn below nodes) -->
    ${svgEdges}
    <!-- Nodes -->
    ${svgNodes}
  </g>

  <!-- Legend (always visible, on the right) -->
  ${legend}
</svg>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
