import type { ArchitectureGraph } from "./agent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NodeDiff {
  id: string;
  label: string;
  type: string;
  technology: string;
  change?: string;
}

export interface EdgeDiff {
  from: string;
  from_label: string;
  to: string;
  to_label: string;
  protocol: string;
  label?: string;
}

export interface ArchDiff {
  summary: {
    old_nodes: number;
    new_nodes: number;
    old_edges: number;
    new_edges: number;
    nodes_added: number;
    nodes_removed: number;
    nodes_changed: number;
    edges_added: number;
    edges_removed: number;
    confidence_old: number;
    confidence_new: number;
    confidence_delta: number;
    severity: "none" | "minor" | "major";
  };
  added_nodes: NodeDiff[];
  removed_nodes: NodeDiff[];
  changed_nodes: NodeDiff[];
  added_edges: EdgeDiff[];
  removed_edges: EdgeDiff[];
  added_patterns: string[];
  removed_patterns: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectPatterns(nodes: ArchitectureGraph["nodes"], edges: ArchitectureGraph["edges"]): string[] {
  const p: string[] = [];
  if (nodes.some(n => n.type === "queue"))                          p.push("Event-Driven");
  if (nodes.some(n => n.type === "gateway"))                        p.push("API Gateway");
  if (nodes.filter(n => n.type === "worker").length >= 2)           p.push("Worker Pool");
  if (nodes.some(n => n.type === "cache"))                          p.push("Cache Layer");
  if (nodes.filter(n => n.type === "database").length >= 2)         p.push("Polyglot Persistence");
  if (edges.some(e => e.protocol === "gRPC"))                       p.push("gRPC Services");
  if (nodes.filter(n => n.type === "backend").length >= 3)          p.push("Microservices");
  if (nodes.some(n => n.type === "monitoring"))                     p.push("Observability Layer");
  if (nodes.some(n => n.type === "ml_model"))                       p.push("ML/AI Pipeline");
  if (nodes.some(n => n.type === "cdn"))                            p.push("CDN / Edge");
  return p;
}

function edgeDegrees(nodes: ArchitectureGraph["nodes"], edges: ArchitectureGraph["edges"]): Record<string, number> {
  const d: Record<string, number> = {};
  nodes.forEach(n => { d[n.id] = 0; });
  edges.forEach(e => {
    if (d[e.from] !== undefined) d[e.from]++;
    if (d[e.to]   !== undefined) d[e.to]++;
  });
  return d;
}

function edgeKey(e: { from: string; to: string; protocol: string }): string {
  return `${e.from}->${e.to}:${e.protocol}`;
}

function nodeLabel(id: string, g: ArchitectureGraph): string {
  return g.nodes.find(n => n.id === id)?.label ?? id;
}

// ─── Main diff function ───────────────────────────────────────────────────────

export function diffGraphs(oldG: ArchitectureGraph, newG: ArchitectureGraph): ArchDiff {
  const oldIds = new Set(oldG.nodes.map(n => n.id));
  const newIds = new Set(newG.nodes.map(n => n.id));

  const addedNodes: NodeDiff[] = newG.nodes
    .filter(n => !oldIds.has(n.id))
    .map(n => ({ id: n.id, label: n.label, type: n.type, technology: n.technology }));

  const removedNodes: NodeDiff[] = oldG.nodes
    .filter(n => !newIds.has(n.id))
    .map(n => ({ id: n.id, label: n.label, type: n.type, technology: n.technology }));

  const oldDeg = edgeDegrees(oldG.nodes, oldG.edges);
  const newDeg = edgeDegrees(newG.nodes, newG.edges);

  const changedNodes: NodeDiff[] = newG.nodes
    .filter(n => {
      if (!oldIds.has(n.id)) return false;
      const oldNode = oldG.nodes.find(o => o.id === n.id)!;
      return oldDeg[n.id] !== newDeg[n.id] || oldNode.type !== n.type || oldNode.technology !== n.technology;
    })
    .map(n => {
      const oldNode = oldG.nodes.find(o => o.id === n.id)!;
      let change = "connectivity changed";
      if (oldNode.type !== n.type)               change = `type: ${oldNode.type} → ${n.type}`;
      else if (oldNode.technology !== n.technology) change = `tech: ${oldNode.technology} → ${n.technology}`;
      else if (oldDeg[n.id] !== newDeg[n.id])    change = `connections: ${oldDeg[n.id]} → ${newDeg[n.id]}`;
      return { id: n.id, label: n.label, type: n.type, technology: n.technology, change };
    });

  const oldEK = new Set(oldG.edges.map(edgeKey));
  const newEK = new Set(newG.edges.map(edgeKey));

  const addedEdges: EdgeDiff[] = newG.edges
    .filter(e => !oldEK.has(edgeKey(e)))
    .map(e => ({ from: e.from, from_label: nodeLabel(e.from, newG), to: e.to, to_label: nodeLabel(e.to, newG), protocol: e.protocol, label: e.label }));

  const removedEdges: EdgeDiff[] = oldG.edges
    .filter(e => !newEK.has(edgeKey(e)))
    .map(e => ({ from: e.from, from_label: nodeLabel(e.from, oldG), to: e.to, to_label: nodeLabel(e.to, oldG), protocol: e.protocol, label: e.label }));

  const oldPat = new Set(detectPatterns(oldG.nodes, oldG.edges));
  const newPat = new Set(detectPatterns(newG.nodes, newG.edges));
  const addedPatterns   = [...newPat].filter(p => !oldPat.has(p));
  const removedPatterns = [...oldPat].filter(p => !newPat.has(p));

  const confOld   = Math.round((oldG.confidence ?? 0) * 100);
  const confNew   = Math.round((newG.confidence ?? 0) * 100);
  const confDelta = confNew - confOld;

  const hasChanges = addedNodes.length || removedNodes.length || changedNodes.length || addedEdges.length || removedEdges.length;
  const severity: "none" | "minor" | "major" =
    removedNodes.length >= 2 || addedNodes.length >= 3 ? "major" :
    hasChanges ? "minor" : "none";

  return {
    summary: {
      old_nodes: oldG.nodes.length,
      new_nodes: newG.nodes.length,
      old_edges: oldG.edges.length,
      new_edges: newG.edges.length,
      nodes_added: addedNodes.length,
      nodes_removed: removedNodes.length,
      nodes_changed: changedNodes.length,
      edges_added: addedEdges.length,
      edges_removed: removedEdges.length,
      confidence_old: confOld,
      confidence_new: confNew,
      confidence_delta: confDelta,
      severity,
    },
    added_nodes: addedNodes,
    removed_nodes: removedNodes,
    changed_nodes: changedNodes,
    added_edges: addedEdges,
    removed_edges: removedEdges,
    added_patterns: addedPatterns,
    removed_patterns: removedPatterns,
  };
}

// ─── Markdown report ─────────────────────────────────────────────────────────

export function diffToMarkdown(diff: ArchDiff, labelA = "v1", labelB = "v2"): string {
  const s = diff.summary;
  const now = new Date().toISOString().slice(0, 10);
  const sevColor = s.severity === "major" ? "red" : s.severity === "minor" ? "yellow" : "brightgreen";
  const sevLabel = s.severity === "major" ? "major%20change" : s.severity === "minor" ? "minor%20change" : "no%20changes";
  const sign = (n: number) => (n >= 0 ? "+" : "") + n;

  let md = `# Architecture Diff — ${labelA} → ${labelB}

![Changes](https://img.shields.io/badge/changes-${sevLabel}-${sevColor}) ![Added](https://img.shields.io/badge/added-${s.nodes_added}%20services-22C55E) ![Removed](https://img.shields.io/badge/removed-${s.nodes_removed}%20services-EF4444) ![Generated](https://img.shields.io/badge/generated-${now}-lightgrey)

> Generated by **[Diagram Forge](https://diagram-forge.dev)**

---

## Summary

| Metric | ${labelA} | ${labelB} | Delta |
|--------|--------|-------|-------|
| Services | ${s.old_nodes} | ${s.new_nodes} | \`${sign(s.new_nodes - s.old_nodes)}\` |
| Connections | ${s.old_edges} | ${s.new_edges} | \`${sign(s.new_edges - s.old_edges)}\` |
| Confidence | ${s.confidence_old}% | ${s.confidence_new}% | \`${sign(s.confidence_delta)}%\` |

`;

  if (diff.added_nodes.length) {
    md += `## ✅ Added Services (${diff.added_nodes.length})\n\n`;
    md += `| Service | Type | Technology |\n|---------|------|------------|\n`;
    md += diff.added_nodes.map(n => `| **${n.label}** | \`${n.type}\` | ${n.technology} |`).join("\n") + "\n\n";
  }

  if (diff.removed_nodes.length) {
    md += `## ❌ Removed Services (${diff.removed_nodes.length})\n\n`;
    md += `| Service | Type | Technology |\n|---------|------|------------|\n`;
    md += diff.removed_nodes.map(n => `| ~~${n.label}~~ | \`${n.type}\` | ${n.technology} |`).join("\n") + "\n\n";
    md += `> ⚠️ Ensure removed services have no undocumented dependents before decommissioning.\n\n`;
  }

  if (diff.changed_nodes.length) {
    md += `## 🔄 Changed Services (${diff.changed_nodes.length})\n\n`;
    md += `| Service | Change |\n|---------|--------|\n`;
    md += diff.changed_nodes.map(n => `| **${n.label}** | ${n.change} |`).join("\n") + "\n\n";
  }

  if (diff.added_edges.length) {
    md += `## 🔗 New Connections (${diff.added_edges.length})\n\n`;
    md += `| From | To | Protocol | Description |\n|------|----|----------|-------------|\n`;
    md += diff.added_edges.map(e => `| ${e.from_label} | ${e.to_label} | \`${e.protocol}\` | ${e.label ?? "—"} |`).join("\n") + "\n\n";
  }

  if (diff.removed_edges.length) {
    md += `## 🔌 Removed Connections (${diff.removed_edges.length})\n\n`;
    md += `| From | To | Protocol |\n|------|----|----------|\n`;
    md += diff.removed_edges.map(e => `| ~~${e.from_label}~~ | ~~${e.to_label}~~ | \`${e.protocol}\` |`).join("\n") + "\n\n";
  }

  if (diff.added_patterns.length || diff.removed_patterns.length) {
    md += `## 🏗️ Architecture Pattern Changes\n\n`;
    diff.added_patterns.forEach(p => { md += `- ✅ **New pattern**: ${p}\n`; });
    diff.removed_patterns.forEach(p => { md += `- ❌ **Removed pattern**: ${p}\n`; });
    md += "\n";
  }

  if (s.severity === "none") {
    md += `## ✅ No Structural Changes\n\nBoth snapshots are structurally identical.\n\n`;
  }

  md += `---\n\n*Generated by [Diagram Forge](https://diagram-forge.dev) — compare architecture snapshots over time.*\n`;
  return md;
}
