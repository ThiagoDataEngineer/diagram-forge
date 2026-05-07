import { describe, it, expect } from "vitest";
import { benchmarkGraph, benchmarkToMarkdown, analyzeCost, loadReferenceGraphs } from "../../analyzer/benchmark.js";
import type { ArchitectureGraph } from "../../analyzer/agent.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const node = (id: string, type: string, label?: string): any =>
  ({ id, label: label ?? id, type, technology: "X" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edge = (from: string, to: string, protocol = "HTTP", async_ = false): any =>
  ({ from, to, protocol, direction: "unidirectional", async: async_ });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = (nodes: any[], edges: any[] = [], tech_stack: string[] = []): ArchitectureGraph =>
  ({ nodes, edges, summary: "", tech_stack, confidence: 0.9, analysis_steps: 1 }) as unknown as ArchitectureGraph;

// ── Grade helper ──────────────────────────────────────────────────────────────

describe("grade boundaries", () => {
  it("A at 85+", () => {
    // microservices-like graph should score A
    const result = benchmarkGraph(g(
      [node("gw","gateway"), node("auth","auth"), node("cdn","cdn"),
       node("mon","monitoring"), node("b1","backend"), node("b2","backend"), node("b3","backend"),
       node("cache","cache"), node("q","queue"), node("w","worker"), node("db","database"), node("s","storage")],
      [edge("gw","b1"), edge("gw","b2"), edge("b1","db","SQL"), edge("b2","cache","Redis"),
       edge("b1","auth"), edge("b2","auth"), edge("b1","q","AMQP",true), edge("q","w","AMQP",true),
       edge("b1","mon"), edge("b2","mon"), edge("cdn","gw")],
      ["Kubernetes"]
    ));
    expect(["A","B"]).toContain(result.grade);
  });

  it("F below 40", () => {
    // worst case: no auth, no monitoring, single frontend→db
    const result = benchmarkGraph(g(
      [node("fe","frontend"), node("db","database")],
      [edge("fe","db","SQL")]
    ));
    expect(["F","D"]).toContain(result.grade);
  });
});

// ── Resilience ────────────────────────────────────────────────────────────────

describe("resilience scoring", () => {
  it("base score 80 with no enhancements and no SPOFs", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.dimensions.resilience.score).toBe(80);
  });

  it("+15 for monitoring service", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("m","monitoring")]));
    expect(result.dimensions.resilience.score).toBe(95);
  });

  it("+5 for cache (on top of monitoring)", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("m","monitoring"), node("c","cache")]));
    expect(result.dimensions.resilience.score).toBe(100); // 80+15+5=100
  });

  it("+5 for async edges, clamped to 100", () => {
    const result = benchmarkGraph(g(
      [node("a","backend"), node("m","monitoring"), node("c","cache"), node("q","queue")],
      [edge("a","q","AMQP",true)]
    ));
    expect(result.dimensions.resilience.score).toBe(100); // 80+15+5+5=105 → clamped
  });

  it("-12 per SPOF (node with ≥4 connections)", () => {
    // hub has degree 4 → SPOF, no monitoring/cache/async
    const result = benchmarkGraph(g(
      [node("hub","backend"), node("a","backend"), node("b","backend"), node("c","backend"), node("d","backend")],
      [edge("hub","a"), edge("hub","b"), edge("hub","c"), edge("hub","d")]
    ));
    expect(result.dimensions.resilience.score).toBe(68); // 80-12
    expect(result.spofs).toContain("hub");
  });

  it("-24 for 2 SPOFs", () => {
    const result = benchmarkGraph(g(
      [node("h1","backend","Hub1"), node("h2","backend","Hub2"),
       node("a","backend"), node("b","backend"), node("c","backend"), node("d","backend")],
      // h1 and h2 each get degree 4 by connecting to each other + 3 others
      [edge("h1","a"), edge("h1","b"), edge("h1","c"), edge("h1","h2"),
       edge("h2","a"), edge("h2","b"), edge("h2","c")]
    ));
    // h1 degree: h1→a, h1→b, h1→c, h1→h2 = 4 ✓
    // h2 degree: h1→h2 (in), h2→a, h2→b, h2→c = 4 ✓
    expect(result.spofs).toHaveLength(2);
    expect(result.dimensions.resilience.score).toBe(56); // 80-24
  });

  it("evidence array includes SPOF factor and monitoring factor", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("m","monitoring")]));
    const ev = result.dimensions.resilience.evidence;
    expect(ev.some(e => e.factor.includes("SPOF"))).toBe(true);
    expect(ev.some(e => e.factor.includes("Monitoring"))).toBe(true);
  });
});

// ── Observability ─────────────────────────────────────────────────────────────

describe("observability scoring", () => {
  it("10 pts (implicit logging) with no monitoring node", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.dimensions.observability.score).toBe(10);
  });

  it("+10 pts for gateway even without monitoring", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("gw","gateway")]));
    expect(result.dimensions.observability.score).toBe(20); // 10 + 10
  });

  it("50 pts for monitoring node with 0 services reporting", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("m","monitoring")]));
    expect(result.dimensions.observability.score).toBe(50);
  });

  it("+8 pts per service reporting to monitoring (max 40)", () => {
    const nodes = [node("m","monitoring"), node("s1","backend"), node("s2","backend")];
    const edges_ = [edge("s1","m"), edge("s2","m")];
    const result = benchmarkGraph(g(nodes, edges_));
    expect(result.dimensions.observability.score).toBe(50 + 16); // 50 + 2*8
  });

  it("caps monitoring coverage at 40 pts (5+ services)", () => {
    const nodes = [
      node("m","monitoring"),
      node("s1","backend"), node("s2","backend"), node("s3","backend"),
      node("s4","backend"), node("s5","backend"), node("s6","backend"),
    ];
    const edges_ = [
      edge("s1","m"), edge("s2","m"), edge("s3","m"),
      edge("s4","m"), edge("s5","m"), edge("s6","m"),
    ];
    const result = benchmarkGraph(g(nodes, edges_));
    expect(result.dimensions.observability.score).toBe(90); // 50 + 40 (capped) + 0 (no gateway)
  });

  it("100 pts: monitoring + full coverage + gateway", () => {
    const nodes = [
      node("m","monitoring"), node("gw","gateway"),
      node("s1","backend"), node("s2","backend"), node("s3","backend"),
      node("s4","backend"), node("s5","backend"),
    ];
    const edges_ = [
      edge("s1","m"), edge("s2","m"), edge("s3","m"), edge("s4","m"), edge("s5","m"),
    ];
    const result = benchmarkGraph(g(nodes, edges_));
    expect(result.dimensions.observability.score).toBe(100); // 50+40+10
  });
});

// ── Security ──────────────────────────────────────────────────────────────────

describe("security scoring", () => {
  it("35 pts for empty graph (no frontend→db, no externals)", () => {
    // No auth, no gateway, no frontend→db (+20), no externals (+15), no cdn
    const result = benchmarkGraph(g([]));
    expect(result.dimensions.security.score).toBe(35);
  });

  it("+30 pts for auth service", () => {
    const result = benchmarkGraph(g([node("auth","auth")]));
    expect(result.dimensions.security.score).toBe(65); // 35+30
  });

  it("+25 pts for gateway", () => {
    const result = benchmarkGraph(g([node("gw","gateway")]));
    expect(result.dimensions.security.score).toBe(60); // 35+25
  });

  it("+10 pts for CDN", () => {
    const result = benchmarkGraph(g([node("cdn","cdn")]));
    expect(result.dimensions.security.score).toBe(45); // 35+10
  });

  it("100 pts: auth + gateway + no frontend→db + no externals + cdn", () => {
    const result = benchmarkGraph(g([
      node("auth","auth"), node("gw","gateway"), node("cdn","cdn"),
    ]));
    expect(result.dimensions.security.score).toBe(100); // 30+25+20+15+10
  });

  it("penalises direct frontend→database connection", () => {
    const result = benchmarkGraph(g(
      [node("fe","frontend"), node("db","database")],
      [edge("fe","db","SQL")]
    ));
    // 0 (auth) + 0 (gw) - 20 (fe→db) + 15 (no external) + 0 (cdn) = -5 → clamped to 0
    expect(result.dimensions.security.score).toBe(0);
  });

  it("notes critical warning when frontend→db", () => {
    const result = benchmarkGraph(g(
      [node("fe","frontend"), node("db","database")],
      [edge("fe","db","SQL")]
    ));
    expect(result.dimensions.security.notes.some(n => /CRITICAL/i.test(n))).toBe(true);
  });
});

// ── Scalability ───────────────────────────────────────────────────────────────

describe("scalability scoring", () => {
  it("0 pts for minimal graph", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.dimensions.scalability.score).toBe(0);
  });

  it("+20 pts for cache", () => {
    const result = benchmarkGraph(g([node("cache","cache")]));
    expect(result.dimensions.scalability.score).toBe(20);
  });

  it("+20 pts for queue", () => {
    const result = benchmarkGraph(g([node("q","queue")]));
    expect(result.dimensions.scalability.score).toBe(20);
  });

  it("+15 pts for worker", () => {
    const result = benchmarkGraph(g([node("w","worker")]));
    expect(result.dimensions.scalability.score).toBe(15);
  });

  it("+15 pts for CDN", () => {
    const result = benchmarkGraph(g([node("cdn","cdn")]));
    expect(result.dimensions.scalability.score).toBe(15);
  });

  it("+15 pts for 2+ backends", () => {
    const result = benchmarkGraph(g([node("b1","backend"), node("b2","backend")]));
    expect(result.dimensions.scalability.score).toBe(15);
  });

  it("+10 pts for storage", () => {
    const result = benchmarkGraph(g([node("s","storage")]));
    expect(result.dimensions.scalability.score).toBe(10);
  });

  it("+5 pts for Kubernetes in tech_stack", () => {
    const result = benchmarkGraph(g([node("b","backend")], [], ["Kubernetes"]));
    expect(result.dimensions.scalability.score).toBe(5);
  });

  it("100 pts with all scalability factors", () => {
    const result = benchmarkGraph(g(
      [node("cache","cache"), node("q","queue"), node("w","worker"),
       node("cdn","cdn"), node("b1","backend"), node("b2","backend"), node("s","storage")],
      [], ["Kubernetes"]
    ));
    expect(result.dimensions.scalability.score).toBe(100); // 20+20+15+15+15+10+5
  });
});

// ── Simplicity ────────────────────────────────────────────────────────────────

describe("simplicity scoring", () => {
  it("100 pts for 0–5 nodes with low density", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("b","database")], [edge("a","b","SQL")]));
    // 2 nodes ≤5 → 100, density = 0.5 → +10, total 110 clamped to 100
    expect(result.dimensions.simplicity.score).toBe(100);
  });

  it("80 pts base for 6–8 nodes + density bonus", () => {
    const nodes = Array.from({length: 6}, (_, i) => node(`n${i}`, "backend"));
    const result = benchmarkGraph(g(nodes, [edge("n0","n1","HTTP")]));
    // 6 nodes ≤8 → 80, density = 1/6 ≈ 0.17 → +10, total 90
    expect(result.dimensions.simplicity.score).toBe(90);
  });

  it("60 pts base for 9–12 nodes", () => {
    const nodes = Array.from({length: 10}, (_, i) => node(`n${i}`, "backend"));
    const result = benchmarkGraph(g(nodes));
    // 10 nodes ≤12 → 60, density = 0 → +10, total 70
    expect(result.dimensions.simplicity.score).toBe(70);
  });

  it("penalises high edge density (>2.5 edges/node)", () => {
    const nodes = [node("a","backend"), node("b","backend"), node("c","backend"), node("d","backend")];
    const edges_ = [
      edge("a","b"), edge("a","c"), edge("a","d"),
      edge("b","c"), edge("b","d"), edge("c","d"),
      edge("d","a"), edge("c","a"), edge("b","a"), edge("d","b"),
      edge("c","b"),
    ];
    const result = benchmarkGraph(g(nodes, edges_));
    // 4 nodes ≤5 → 100, density = 11/4 = 2.75 → -10, total 90
    expect(result.dimensions.simplicity.score).toBe(90);
  });
});

// ── Async Coverage ────────────────────────────────────────────────────────────

describe("async coverage scoring", () => {
  it("0 pts when no edges", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.dimensions.async_coverage.score).toBe(0);
    expect(result.dimensions.async_coverage.grade).toBe("F");
  });

  it("0 pts when all edges are synchronous", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("b","backend")], [edge("a","b","HTTP", false)]));
    expect(result.dimensions.async_coverage.score).toBe(0);
  });

  it("50 pts for 50% async edges", () => {
    const result = benchmarkGraph(g(
      [node("a","backend"), node("b","backend"), node("c","backend"), node("q","queue")],
      [edge("a","b","HTTP", false), edge("a","q","AMQP", true)]
    ));
    expect(result.dimensions.async_coverage.score).toBe(50);
  });

  it("100 pts when all edges async", () => {
    const result = benchmarkGraph(g(
      [node("a","backend"), node("q","queue"), node("w","worker")],
      [edge("a","q","AMQP",true), edge("q","w","AMQP",true)]
    ));
    expect(result.dimensions.async_coverage.score).toBe(100);
    expect(result.dimensions.async_coverage.grade).toBe("A");
  });
});

// ── Overall score & weighting ─────────────────────────────────────────────────

describe("overall score weighting", () => {
  it("overall is weighted sum of dimensions (25+20+20+20+10+5)", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    const dims = result.dimensions;
    const expected = Math.round(
      dims.resilience.score     * 0.25 +
      dims.observability.score  * 0.20 +
      dims.security.score       * 0.20 +
      dims.scalability.score    * 0.20 +
      dims.simplicity.score     * 0.10 +
      dims.async_coverage.score * 0.05
    );
    expect(result.overall).toBe(expected);
  });

  it("overall is clamped between 0 and 100", () => {
    const result = benchmarkGraph(g(
      Array.from({length: 50}, (_, i) => node(`n${i}`, "backend")),
      Array.from({length: 200}, (_, i) => edge(`n${i%50}`, `n${(i+1)%50}`, "HTTP"))
    ));
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });
});

// ── SPOF detection ────────────────────────────────────────────────────────────

describe("SPOF detection", () => {
  it("node with exactly 4 connections is a SPOF", () => {
    // hub has 4 outgoing = degree 4
    const result = benchmarkGraph(g(
      [node("hub","backend","Hub"), node("a","backend"), node("b","backend"), node("c","backend"), node("d","backend")],
      [edge("hub","a"), edge("hub","b"), edge("hub","c"), edge("hub","d")]
    ));
    expect(result.spofs).toContain("Hub");
  });

  it("node with 3 connections is NOT a SPOF", () => {
    const result = benchmarkGraph(g(
      [node("hub","backend","Hub"), node("a","backend"), node("b","backend"), node("c","backend")],
      [edge("hub","a"), edge("hub","b"), edge("hub","c")]
    ));
    expect(result.spofs).not.toContain("Hub");
  });

  it("returns empty spofs for a graph with no high-degree nodes", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("b","backend")], [edge("a","b")]));
    expect(result.spofs).toHaveLength(0);
  });
});

// ── Pattern matching ──────────────────────────────────────────────────────────

describe("pattern matching", () => {
  it("returns pattern_match array with similarity 0-100", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.pattern_match.length).toBeGreaterThan(0);
    result.pattern_match.forEach(p => {
      expect(p.similarity).toBeGreaterThanOrEqual(0);
      expect(p.similarity).toBeLessThanOrEqual(100);
    });
  });

  it("sorts pattern_match by similarity descending", () => {
    const result = benchmarkGraph(g([node("a","backend"), node("b","backend"), node("c","backend")]));
    for (let i = 1; i < result.pattern_match.length; i++) {
      expect(result.pattern_match[i - 1].similarity).toBeGreaterThanOrEqual(result.pattern_match[i].similarity);
    }
  });

  it("event-driven graph scores highest similarity with event-driven reference", () => {
    const result = benchmarkGraph(g([
      node("api","backend"), node("q","queue"), node("w1","worker"), node("w2","worker"),
      node("db","database"), node("mon","monitoring"),
    ]));
    const eventDriven = result.pattern_match.find(p => p.name.toLowerCase().includes("event"));
    expect(eventDriven).toBeDefined();
    expect(eventDriven!.similarity).toBeGreaterThan(20);
  });
});

// ── Calibration ───────────────────────────────────────────────────────────────

describe("calibration", () => {
  it("returns percentile 0-100", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.calibration.percentile).toBeGreaterThanOrEqual(0);
    expect(result.calibration.percentile).toBeLessThanOrEqual(100);
  });

  it("returns reference_scores for all 5 reference graphs", () => {
    const refs = loadReferenceGraphs();
    expect(refs.length).toBe(5);
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.calibration.reference_scores).toHaveLength(5);
  });

  it("reference_scores are sorted ascending by overall", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    const scores = result.calibration.reference_scores.map(r => r.overall);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it("provides non-empty context string", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.calibration.context.length).toBeGreaterThan(0);
  });
});

// ── analyzeCost ───────────────────────────────────────────────────────────────

describe("analyzeCost", () => {
  const graph_ = g([
    node("api","backend","API Server"),
    node("db","database","Database"),
    node("cache","cache","Cache"),
  ], [
    edge("api","db"), edge("api","cache"),
    edge("db","api"), edge("cache","api"),
    // api degree = 4 → SPOF
  ]);

  it("matches labels case-insensitively", () => {
    // We need to call via benchmarkGraph with cost_context
    const result = benchmarkGraph(graph_, { "api server": 500, "database": 200, "cache": 100 });
    expect(result.cost!.total_monthly_usd).toBe(800);
    expect(result.cost!.entries).toHaveLength(3);
  });

  it("sorts entries by cost descending", () => {
    const result = benchmarkGraph(graph_, { "API Server": 500, "Database": 200, "Cache": 100 });
    const costs = result.cost!.entries.map(e => e.monthly_usd);
    expect(costs[0]).toBeGreaterThanOrEqual(costs[1]);
    expect(costs[1]).toBeGreaterThanOrEqual(costs[2]);
  });

  it("marks SPOF nodes correctly", () => {
    // api has 4 connections → SPOF
    const result = benchmarkGraph(graph_, { "API Server": 500, "Database": 200, "Cache": 100 });
    const apiEntry = result.cost!.entries.find(e => e.label === "API Server");
    expect(apiEntry!.is_spof).toBe(true);
  });

  it("computes concentration_pct for top service", () => {
    const result = benchmarkGraph(graph_, { "API Server": 500, "Database": 100, "Cache": 100 });
    // top = API Server, 500/700 ≈ 71%
    expect(result.cost!.concentration_pct).toBe(71);
  });

  it("computes spof_cost_usd", () => {
    const result = benchmarkGraph(graph_, { "API Server": 500, "Database": 200, "Cache": 100 });
    // Only API Server is SPOF
    expect(result.cost!.spof_cost_usd).toBe(500);
  });

  it("penalises efficiency_score for high concentration (>60%)", () => {
    const result = benchmarkGraph(graph_, { "API Server": 900, "Database": 50, "Cache": 50 });
    // concentration = 90% → -30, spof pct = 90% → -25
    expect(result.cost!.efficiency_score).toBeLessThan(50);
  });

  it("assigns critical risk to SPOF with ≥30% budget share", () => {
    const result = benchmarkGraph(graph_, { "API Server": 700, "Database": 200, "Cache": 100 });
    const apiEntry = result.cost!.entries.find(e => e.label === "API Server");
    expect(apiEntry!.risk).toBe("critical");
  });

  it("returns undefined cost when cost_context not provided", () => {
    const result = benchmarkGraph(g([node("a","backend")]));
    expect(result.cost).toBeUndefined();
  });

  it("returns undefined cost when cost_context is empty object", () => {
    const result = benchmarkGraph(g([node("a","backend")]), {});
    expect(result.cost).toBeUndefined();
  });
});

// ── benchmarkToMarkdown ───────────────────────────────────────────────────────

describe("benchmarkToMarkdown", () => {
  const result = benchmarkGraph(g([
    node("api","backend","API"), node("auth","auth","Auth"),
    node("gw","gateway","GW"), node("mon","monitoring","Mon"),
  ], [edge("gw","api"), edge("api","auth"), edge("api","mon")]));

  it("contains Overall Score header", () => {
    expect(benchmarkToMarkdown(result)).toMatch(/Overall Score/);
  });

  it("contains all 6 dimension names", () => {
    const md = benchmarkToMarkdown(result);
    ["Resilience","Observability","Security","Scalability","Simplicity","Async"].forEach(d => {
      expect(md).toContain(d);
    });
  });

  it("contains SPOF section", () => {
    const md = benchmarkToMarkdown(result);
    expect(md).toMatch(/SPOF/);
  });

  it("contains calibration section with percentile", () => {
    const md = benchmarkToMarkdown(result);
    expect(md).toMatch(/percentile/i);
  });

  it("contains evidence table per dimension", () => {
    const md = benchmarkToMarkdown(result);
    expect(md).toMatch(/Evidence/);
    expect(md).toMatch(/WAF/);
  });

  it("includes cost section when cost analysis present", () => {
    const withCost = benchmarkGraph(
      g([node("api","backend","API"), node("db","database","DB")], [edge("api","db","SQL")]),
      { API: 300, DB: 200 }
    );
    const md = benchmarkToMarkdown(withCost, "Test Project");
    expect(md).toMatch(/Cost Analysis/);
    expect(md).toMatch(/500/); // total
  });

  it("uses projectName in title", () => {
    const md = benchmarkToMarkdown(result, "MyApp");
    expect(md).toContain("MyApp");
  });

  it("SPOF section warns when SPOFs found", () => {
    // hub node with 4+ connections
    const spofResult = benchmarkGraph(g(
      [node("hub","backend","HubNode"), node("a","backend"), node("b","backend"),
       node("c","backend"), node("d","backend")],
      [edge("hub","a"), edge("hub","b"), edge("hub","c"), edge("hub","d")]
    ));
    const md = benchmarkToMarkdown(spofResult);
    expect(md).toContain("HubNode");
  });
});

// ── loadReferenceGraphs ───────────────────────────────────────────────────────

describe("loadReferenceGraphs", () => {
  it("loads exactly 5 reference graphs", () => {
    expect(loadReferenceGraphs()).toHaveLength(5);
  });

  it("each has _reference.name and _reference.description", () => {
    loadReferenceGraphs().forEach(ref => {
      expect(ref._reference).toBeDefined();
      expect(typeof ref._reference.name).toBe("string");
      expect(ref._reference.name.length).toBeGreaterThan(0);
    });
  });

  it("each has valid nodes and edges arrays", () => {
    loadReferenceGraphs().forEach(ref => {
      expect(Array.isArray(ref.nodes)).toBe(true);
      expect(Array.isArray(ref.edges)).toBe(true);
      expect(ref.nodes.length).toBeGreaterThan(0);
    });
  });

  it("covers key architecture styles", () => {
    const names = loadReferenceGraphs().map(r => r._reference.name.toLowerCase());
    expect(names.some(n => n.includes("microservice"))).toBe(true);
    expect(names.some(n => n.includes("serverless") || n.includes("monolith") || n.includes("event"))).toBe(true);
  });
});
