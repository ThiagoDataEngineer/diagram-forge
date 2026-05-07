import { describe, it, expect } from "vitest";
import { diffGraphs, diffToMarkdown } from "../../analyzer/diff.js";
import type { ArchitectureGraph } from "../../analyzer/agent.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const node = (id: string, type: string, tech = "Node.js", label?: string): any =>
  ({ id, label: label ?? id, type, technology: tech });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edge = (from: string, to: string, protocol = "HTTP", async_ = false): any =>
  ({ from, to, protocol, direction: "unidirectional", async: async_ });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const graph = (nodes: any[], edges: any[] = [], confidence = 0.9): ArchitectureGraph =>
  ({ nodes, edges, summary: "", tech_stack: [], confidence, analysis_steps: 1 }) as unknown as ArchitectureGraph;

// ── diffGraphs — nodes ────────────────────────────────────────────────────────

describe("diffGraphs — identical graphs", () => {
  it("returns severity none and all counts zero", () => {
    const g = graph([node("a", "backend"), node("b", "database")], [edge("a", "b", "SQL")]);
    const d = diffGraphs(g, g);
    expect(d.summary.severity).toBe("none");
    expect(d.summary.nodes_added).toBe(0);
    expect(d.summary.nodes_removed).toBe(0);
    expect(d.summary.nodes_changed).toBe(0);
    expect(d.summary.edges_added).toBe(0);
    expect(d.summary.edges_removed).toBe(0);
    expect(d.added_nodes).toHaveLength(0);
    expect(d.removed_nodes).toHaveLength(0);
    expect(d.changed_nodes).toHaveLength(0);
  });
});

describe("diffGraphs — added nodes", () => {
  it("detects 1 added node (severity minor)", () => {
    const old_ = graph([node("a", "backend")]);
    const new_ = graph([node("a", "backend"), node("b", "database")]);
    const d = diffGraphs(old_, new_);
    expect(d.added_nodes).toHaveLength(1);
    expect(d.added_nodes[0].id).toBe("b");
    expect(d.summary.severity).toBe("minor");
  });

  it("detects 3 added nodes (severity major)", () => {
    const old_ = graph([node("a", "backend")]);
    const new_ = graph([node("a", "backend"), node("b", "backend"), node("c", "backend"), node("d", "backend")]);
    const d = diffGraphs(old_, new_);
    expect(d.added_nodes).toHaveLength(3);
    expect(d.summary.severity).toBe("major");
  });
});

describe("diffGraphs — removed nodes", () => {
  it("detects 1 removed node (severity minor)", () => {
    const old_ = graph([node("a", "backend"), node("b", "cache")]);
    const new_ = graph([node("a", "backend")]);
    const d = diffGraphs(old_, new_);
    expect(d.removed_nodes).toHaveLength(1);
    expect(d.removed_nodes[0].id).toBe("b");
    expect(d.summary.severity).toBe("minor");
  });

  it("detects 2 removed nodes (severity major)", () => {
    const old_ = graph([node("a", "backend"), node("b", "cache"), node("c", "queue")]);
    const new_ = graph([node("a", "backend")]);
    const d = diffGraphs(old_, new_);
    expect(d.removed_nodes).toHaveLength(2);
    expect(d.summary.severity).toBe("major");
  });
});

describe("diffGraphs — changed nodes", () => {
  it("detects type change and includes correct change description", () => {
    const old_ = graph([node("svc", "backend")]);
    const new_ = graph([node("svc", "gateway")]);
    const d = diffGraphs(old_, new_);
    expect(d.changed_nodes).toHaveLength(1);
    expect(d.changed_nodes[0].change).toBe("type: backend → gateway");
  });

  it("detects technology change", () => {
    const old_ = graph([node("svc", "backend", "Node.js")]);
    const new_ = graph([node("svc", "backend", "Go")]);
    const d = diffGraphs(old_, new_);
    expect(d.changed_nodes).toHaveLength(1);
    expect(d.changed_nodes[0].change).toBe("tech: Node.js → Go");
  });

  it("detects connectivity change (degree change)", () => {
    const old_ = graph([node("a", "backend"), node("b", "database")], [edge("a", "b", "SQL")]);
    const new_ = graph([node("a", "backend"), node("b", "database")], []);
    const d = diffGraphs(old_, new_);
    expect(d.changed_nodes.some(n => n.change?.startsWith("connections:"))).toBe(true);
  });

  it("type change takes priority over tech change", () => {
    const old_ = graph([node("svc", "backend", "Node.js")]);
    const new_ = graph([node("svc", "gateway", "Go")]);
    const d = diffGraphs(old_, new_);
    expect(d.changed_nodes[0].change).toMatch(/^type:/);
  });
});

// ── diffGraphs — edges ────────────────────────────────────────────────────────

describe("diffGraphs — edges", () => {
  it("detects added edge with labels", () => {
    const old_ = graph([node("a", "backend", "X", "A"), node("b", "database", "Y", "B")]);
    const new_ = graph([node("a", "backend", "X", "A"), node("b", "database", "Y", "B")], [edge("a", "b", "SQL")]);
    const d = diffGraphs(old_, new_);
    expect(d.added_edges).toHaveLength(1);
    expect(d.added_edges[0].from).toBe("a");
    expect(d.added_edges[0].from_label).toBe("A");
    expect(d.added_edges[0].protocol).toBe("SQL");
  });

  it("detects removed edge", () => {
    const e = edge("a", "b", "HTTP");
    const old_ = graph([node("a", "backend"), node("b", "backend")], [e]);
    const new_ = graph([node("a", "backend"), node("b", "backend")]);
    const d = diffGraphs(old_, new_);
    expect(d.removed_edges).toHaveLength(1);
    expect(d.removed_edges[0].to).toBe("b");
  });

  it("treats same from/to with different protocol as remove + add", () => {
    const old_ = graph([node("a", "backend"), node("b", "backend")], [edge("a", "b", "HTTP")]);
    const new_ = graph([node("a", "backend"), node("b", "backend")], [edge("a", "b", "gRPC")]);
    const d = diffGraphs(old_, new_);
    expect(d.removed_edges).toHaveLength(1);
    expect(d.added_edges).toHaveLength(1);
  });
});

// ── diffGraphs — patterns ─────────────────────────────────────────────────────

describe("diffGraphs — pattern detection", () => {
  it("detects Event-Driven when queue added", () => {
    const old_ = graph([node("a", "backend")]);
    const new_ = graph([node("a", "backend"), node("q", "queue")]);
    const d = diffGraphs(old_, new_);
    expect(d.added_patterns).toContain("Event-Driven");
  });

  it("detects API Gateway pattern", () => {
    const old_ = graph([node("a", "backend")]);
    const new_ = graph([node("a", "backend"), node("gw", "gateway")]);
    const d = diffGraphs(old_, new_);
    expect(d.added_patterns).toContain("API Gateway");
  });

  it("detects Worker Pool when 2+ workers added", () => {
    const old_ = graph([]);
    const new_ = graph([node("w1", "worker"), node("w2", "worker")]);
    const d = diffGraphs(old_, new_);
    expect(d.added_patterns).toContain("Worker Pool");
  });

  it("does NOT detect Worker Pool with only 1 worker", () => {
    const old_ = graph([]);
    const new_ = graph([node("w1", "worker")]);
    const d = diffGraphs(old_, new_);
    expect(d.added_patterns).not.toContain("Worker Pool");
  });

  it("detects Cache Layer", () => {
    const old_ = graph([node("a", "backend")]);
    const new_ = graph([node("a", "backend"), node("c", "cache")]);
    expect(diffGraphs(old_, new_).added_patterns).toContain("Cache Layer");
  });

  it("detects Polyglot Persistence (2+ databases)", () => {
    const old_ = graph([]);
    const new_ = graph([node("db1", "database"), node("db2", "database")]);
    expect(diffGraphs(old_, new_).added_patterns).toContain("Polyglot Persistence");
  });

  it("detects gRPC Services via edge protocol", () => {
    const old_ = graph([node("a", "backend"), node("b", "backend")]);
    const new_ = graph([node("a", "backend"), node("b", "backend")], [edge("a", "b", "gRPC")]);
    expect(diffGraphs(old_, new_).added_patterns).toContain("gRPC Services");
  });

  it("detects Microservices with 3+ backends", () => {
    const old_ = graph([]);
    const new_ = graph([node("a", "backend"), node("b", "backend"), node("c", "backend")]);
    expect(diffGraphs(old_, new_).added_patterns).toContain("Microservices");
  });

  it("detects Observability Layer", () => {
    const old_ = graph([node("a", "backend")]);
    const new_ = graph([node("a", "backend"), node("m", "monitoring")]);
    expect(diffGraphs(old_, new_).added_patterns).toContain("Observability Layer");
  });

  it("detects ML/AI Pipeline", () => {
    const old_ = graph([]);
    const new_ = graph([node("m", "ml_model")]);
    expect(diffGraphs(old_, new_).added_patterns).toContain("ML/AI Pipeline");
  });

  it("detects CDN / Edge", () => {
    const old_ = graph([]);
    const new_ = graph([node("c", "cdn")]);
    expect(diffGraphs(old_, new_).added_patterns).toContain("CDN / Edge");
  });

  it("reports removed patterns when they disappear", () => {
    const old_ = graph([node("q", "queue"), node("a", "backend")]);
    const new_ = graph([node("a", "backend")]);
    expect(diffGraphs(old_, new_).removed_patterns).toContain("Event-Driven");
  });
});

// ── diffGraphs — confidence ────────────────────────────────────────────────────

describe("diffGraphs — confidence", () => {
  it("computes confidence delta correctly", () => {
    const old_ = graph([], [], 0.7);
    const new_ = graph([], [], 0.9);
    const d = diffGraphs(old_, new_);
    expect(d.summary.confidence_old).toBe(70);
    expect(d.summary.confidence_new).toBe(90);
    expect(d.summary.confidence_delta).toBe(20);
  });

  it("handles missing confidence (defaults to 0)", () => {
    const old_ = { nodes: [], edges: [], summary: "", tech_stack: [] } as unknown as ArchitectureGraph;
    const new_ = graph([], [], 0.8);
    const d = diffGraphs(old_, new_);
    expect(d.summary.confidence_old).toBe(0);
    expect(d.summary.confidence_delta).toBe(80);
  });
});

// ── diffToMarkdown ─────────────────────────────────────────────────────────────

describe("diffToMarkdown", () => {
  it("includes custom labels in header", () => {
    const d = diffGraphs(graph([]), graph([]));
    const md = diffToMarkdown(d, "v1.0", "v2.0");
    expect(md).toMatch(/v1\.0.*v2\.0/);
  });

  it("includes Added Services section when nodes added", () => {
    const old_ = graph([node("a", "backend")]);
    const new_ = graph([node("a", "backend"), node("b", "cache")]);
    const md = diffToMarkdown(diffGraphs(old_, new_));
    expect(md).toMatch(/Added Services/);
    expect(md).toContain("b");
  });

  it("includes Removed Services section with warning", () => {
    const old_ = graph([node("a", "backend"), node("b", "cache")]);
    const new_ = graph([node("a", "backend")]);
    const md = diffToMarkdown(diffGraphs(old_, new_));
    expect(md).toMatch(/Removed Services/);
    expect(md).toMatch(/decommissioning/);
  });

  it("includes Changed Services section", () => {
    const old_ = graph([node("svc", "backend")]);
    const new_ = graph([node("svc", "gateway")]);
    const md = diffToMarkdown(diffGraphs(old_, new_));
    expect(md).toMatch(/Changed Services/);
    expect(md).toMatch(/backend.*gateway/);
  });

  it("includes New Connections section", () => {
    const old_ = graph([node("a", "backend"), node("b", "database")]);
    const new_ = graph([node("a", "backend"), node("b", "database")], [edge("a", "b", "SQL")]);
    const md = diffToMarkdown(diffGraphs(old_, new_));
    expect(md).toMatch(/New Connections/);
    expect(md).toContain("SQL");
  });

  it("includes No Structural Changes when identical", () => {
    const g = graph([node("a", "backend")]);
    const md = diffToMarkdown(diffGraphs(g, g));
    expect(md).toMatch(/No Structural Changes/);
  });

  it("includes Architecture Pattern Changes section", () => {
    const old_ = graph([]);
    const new_ = graph([node("q", "queue")]);
    const md = diffToMarkdown(diffGraphs(old_, new_));
    expect(md).toMatch(/Pattern Changes/);
    expect(md).toContain("Event-Driven");
  });
});
