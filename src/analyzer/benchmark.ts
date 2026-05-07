import path from "path";
import fs from "fs";
import type { ArchitectureGraph } from "./agent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvidenceFactor {
  factor: string;       // human-readable name
  found: boolean;       // was this detected in the graph?
  impact: number;       // points added (positive) or subtracted (negative)
  detail?: string;      // optional extra context
}

export interface DimensionScore {
  name: string;
  waf_pillar: string;   // AWS Well-Architected Framework pillar
  score: number;        // 0-100
  max_possible: number; // theoretical max with this graph's topology
  grade: "A" | "B" | "C" | "D" | "F";
  notes: string[];
  evidence: EvidenceFactor[];
}

// CostContext: map of node label (case-insensitive) → monthly cost in USD
export type CostContext = Record<string, number>;

export interface CostEntry {
  label: string;
  monthly_usd: number;
  pct_of_total: number;
  is_spof: boolean;
  connections: number;
  risk: "critical" | "high" | "medium" | "low";
}

export interface CostAnalysis {
  total_monthly_usd: number;
  entries: CostEntry[];          // sorted by cost desc
  top_cost_service: string;
  concentration_pct: number;     // % of budget in the most expensive service
  spof_cost_usd: number;         // total monthly cost locked in SPOF nodes
  spof_cost_pct: number;         // % of total budget in SPOFs
  efficiency_score: number;      // 0-100
  insights: string[];
}

export interface CalibrationPoint {
  name: string;
  overall: number;
}

export interface BenchmarkResult {
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  methodology: string;    // one-line explanation of scoring basis
  dimensions: {
    resilience: DimensionScore;
    observability: DimensionScore;
    security: DimensionScore;
    scalability: DimensionScore;
    simplicity: DimensionScore;
    async_coverage: DimensionScore;
  };
  spofs: string[];
  pattern_match: Array<{
    name: string;
    similarity: number;
    description: string;
  }>;
  calibration: {
    percentile: number;                  // you score better than X% of reference patterns
    reference_scores: CalibrationPoint[]; // all reference pattern scores
    bracket_lower?: CalibrationPoint;    // nearest reference below
    bracket_upper?: CalibrationPoint;    // nearest reference above
    context: string;                     // human interpretation
  };
  insights: string[];
  cost?: CostAnalysis;
}

type ReferenceGraph = ArchitectureGraph & {
  _reference: { name: string; description: string };
};

// ─── Grade helper ─────────────────────────────────────────────────────────────

function toGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

// ─── Reference graph loader ───────────────────────────────────────────────────

export function loadReferenceGraphs(): ReferenceGraph[] {
  const dir = path.join(process.cwd(), "data", "reference-graphs");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const graphs: ReferenceGraph[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const parsed = JSON.parse(raw) as ReferenceGraph;
      if (parsed._reference && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        graphs.push(parsed);
      }
    } catch {
      // skip malformed files
    }
  }

  return graphs;
}

// ─── Degree map helper ────────────────────────────────────────────────────────

function buildDegreeMap(graph: ArchitectureGraph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const n of graph.nodes) deg.set(n.id, 0);
  for (const e of graph.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to,   (deg.get(e.to)   ?? 0) + 1);
  }
  return deg;
}

// ─── Scoring: Resilience ─────────────────────────────────────────────────────
// WAF Pillar: Reliability
// Basis: Google SRE book ch.3 (eliminating SPOFs), AWS WAF Reliability pillar REL 6/7

function scoreResilience(graph: ArchitectureGraph, spofLabels: string[]): DimensionScore {
  const evidence: EvidenceFactor[] = [];
  const notes: string[] = [];
  let score = 80; // base score — a functional architecture is assumed reliable unless proven otherwise

  // SPOFs: -12 each. Threshold ≥4 connections from AWS WAF REL 6 (avoid single points of failure)
  const spofCount = spofLabels.length;
  const spofPenalty = spofCount * 12;
  evidence.push({
    factor: `SPOF nodes (≥4 connections)`,
    found: spofCount > 0,
    impact: -spofPenalty,
    detail: spofCount > 0
      ? `${spofLabels.slice(0, 3).join(", ")}${spofCount > 3 ? `… +${spofCount - 3} more` : ""}`
      : "None detected",
  });
  score -= spofPenalty;
  if (spofCount > 0) notes.push(`${spofCount} SPOF${spofCount > 1 ? "s" : ""} detected — reduce coupling or add redundancy`);

  // Monitoring: +15 — SRE golden signal prerequisite; can't recover what you can't observe
  const hasMonitor = graph.nodes.some((n) => n.type === "monitoring");
  evidence.push({ factor: "Monitoring service", found: hasMonitor, impact: hasMonitor ? 15 : 0,
    detail: hasMonitor ? "Enables failure detection and faster MTTR" : "Add Prometheus, Datadog, or CloudWatch" });
  if (hasMonitor) { score += 15; notes.push("Monitoring present — faster MTTR"); }
  else notes.push("No monitoring — add observability to detect failures early");

  // Cache: +5 — reduces blast radius of DB pressure events
  const hasCache = graph.nodes.some((n) => n.type === "cache");
  evidence.push({ factor: "Cache layer (blast radius reduction)", found: hasCache, impact: hasCache ? 5 : 0 });
  if (hasCache) { score += 5; notes.push("Cache reduces DB blast radius under pressure"); }

  // Async paths: +5 — async connections isolate failure propagation (circuit breaker pattern)
  const hasAsync = graph.edges.some((e) => e.async);
  evidence.push({ factor: "Async connections (failure isolation)", found: hasAsync, impact: hasAsync ? 5 : 0,
    detail: hasAsync ? "Async paths prevent synchronous failure cascade" : "All connections synchronous — failures cascade" });
  if (hasAsync) score += 5;

  const maxPossible = 80 + 15 + 5 + 5; // base + monitor + cache + async (ignoring SPOF bonuses)
  score = clamp(score);
  return { name: "Resilience", waf_pillar: "Reliability (WAF REL)", score, max_possible: clamp(maxPossible), grade: toGrade(score), notes, evidence };
}

// ─── Scoring: Observability ───────────────────────────────────────────────────
// WAF Pillar: Operational Excellence
// Basis: AWS WAF OPS 7 (understand workload health), Google SRE ch.6 monitoring distributed systems

function scoreObservability(graph: ArchitectureGraph): DimensionScore {
  const evidence: EvidenceFactor[] = [];
  const notes: string[] = [];
  let score = 0;

  const monitorNode = graph.nodes.find((n) => n.type === "monitoring");
  const hasGateway  = graph.nodes.some((n) => n.type === "gateway");

  // Dedicated monitoring node: +50 — foundation, without this nothing else matters
  evidence.push({ factor: "Dedicated monitoring service", found: !!monitorNode, impact: monitorNode ? 50 : 10,
    detail: monitorNode ? "Centralised metric/log collection" : "Fallback: 10 pts (assumed implicit logging)" });
  if (monitorNode) {
    score += 50;
    notes.push("Monitoring service present — foundation for observability");
    // Coverage: edges TO monitoring / total services × 40 pts max
    // Formula: min(connections_to_monitor × 8, 40) — 5 services reporting = full coverage
    const edgesToMonitor = graph.edges.filter((e) => e.to === monitorNode.id).length;
    const coveragePts = Math.min(edgesToMonitor * 8, 40);
    score += coveragePts;
    evidence.push({ factor: `Monitoring coverage (${edgesToMonitor} services reporting)`,
      found: edgesToMonitor > 0, impact: coveragePts,
      detail: `${edgesToMonitor} × 8 pts = ${coveragePts} (max 40 — 5 services full coverage)` });
    if (edgesToMonitor >= 3) notes.push(`${edgesToMonitor} services report metrics — good coverage`);
    else if (edgesToMonitor > 0) notes.push(`Only ${edgesToMonitor} service(s) send metrics — wire up more`);
    else notes.push("Monitoring node exists but no services report to it");
  } else {
    score += 10; // implicit logging assumption
    notes.push("No monitoring service — add Prometheus, Datadog, or CloudWatch");
  }

  // API gateway implies access logging and health endpoints
  evidence.push({ factor: "API gateway (access logs + health endpoint)", found: hasGateway, impact: hasGateway ? 10 : 0 });
  if (hasGateway) { score += 10; notes.push("Gateway provides centralised access logs"); }

  const maxPossible = 100; // 50 + 40 coverage + 10 gateway
  score = clamp(score);
  return { name: "Observability", waf_pillar: "Operational Excellence (WAF OPS)", score, max_possible: maxPossible, grade: toGrade(score), notes, evidence };
}

// ─── Scoring: Security ────────────────────────────────────────────────────────
// WAF Pillar: Security
// Basis: AWS WAF SEC 1–5, OWASP Top 10 (A01 Broken Access Control, A02 Crypto Failures)

function scoreSecurity(graph: ArchitectureGraph): DimensionScore {
  const evidence: EvidenceFactor[] = [];
  const notes: string[] = [];
  let score = 0;

  const hasAuth    = graph.nodes.some((n) => n.type === "auth");
  const hasGateway = graph.nodes.some((n) => n.type === "gateway");
  const hasCdn     = graph.nodes.some((n) => n.type === "cdn");

  // Auth: +30 — WAF SEC 2 (Manage identities for humans and machines)
  evidence.push({ factor: "Authentication service (WAF SEC 2)", found: hasAuth, impact: hasAuth ? 30 : 0,
    detail: hasAuth ? "Identity layer enforces access control" : "No auth service — OWASP A01 risk" });
  if (hasAuth) { score += 30; notes.push("Auth layer present — access control enforced"); }
  else notes.push("No auth service — critical gap before production exposure");

  // Gateway: +25 — WAF SEC 5 (Protect networks), centralised TLS, rate-limiting
  evidence.push({ factor: "API gateway (TLS termination + rate limiting)", found: hasGateway, impact: hasGateway ? 25 : 0 });
  if (hasGateway) { score += 25; notes.push("Gateway centralises ingress, TLS, and rate-limiting"); }
  else notes.push("No API gateway — services directly exposed");

  // No frontend → DB: +20 — OWASP A01, direct DB access from client = critical
  const frontendIds = graph.nodes.filter((n) => n.type === "frontend").map((n) => n.id);
  const databaseIds = graph.nodes.filter((n) => n.type === "database").map((n) => n.id);
  const directFtoDB = graph.edges.some((e) => frontendIds.includes(e.from) && databaseIds.includes(e.to));
  evidence.push({ factor: "No direct frontend→database connection (OWASP A01)", found: !directFtoDB, impact: !directFtoDB ? 20 : -20,
    detail: directFtoDB ? "CRITICAL: frontend bypasses backend logic" : "Data access properly mediated through backend" });
  if (!directFtoDB) { score += 20; notes.push("No direct frontend→DB — data access mediated"); }
  else { score -= 20; notes.push("CRITICAL: Frontend connects directly to database"); }

  // External API via gateway: +15 — egress control, WAF SEC 5
  const gatewayIds = graph.nodes.filter((n) => n.type === "gateway").map((n) => n.id);
  const extApiIds  = graph.nodes.filter((n) => n.type === "external_api").map((n) => n.id);
  let extViaGw = false;
  if (extApiIds.length === 0) {
    extViaGw = true; // nothing to protect
    evidence.push({ factor: "External API egress control (N/A)", found: true, impact: 15, detail: "No external APIs — 15 pts awarded" });
    score += 15;
  } else if (gatewayIds.length > 0) {
    extViaGw = extApiIds.every((id) =>
      graph.edges.some((e) => (e.to === id || e.from === id) && (gatewayIds.includes(e.from) || gatewayIds.includes(e.to)))
    );
    evidence.push({ factor: "External API traffic via gateway (WAF SEC 5)", found: extViaGw, impact: extViaGw ? 15 : 0 });
    if (extViaGw) { score += 15; notes.push("External APIs routed through gateway — egress controlled"); }
    else notes.push("Some external APIs bypass gateway — route all egress through it");
  }

  // CDN: +10 — DDoS mitigation, hides origin (WAF SEC 5)
  evidence.push({ factor: "CDN (DDoS mitigation + origin shielding)", found: hasCdn, impact: hasCdn ? 10 : 0 });
  if (hasCdn) { score += 10; notes.push("CDN provides DDoS mitigation"); }

  const maxPossible = 100; // 30+25+20+15+10
  score = clamp(score);
  return { name: "Security", waf_pillar: "Security (WAF SEC)", score, max_possible: maxPossible, grade: toGrade(score), notes, evidence };
}

// ─── Scoring: Scalability ─────────────────────────────────────────────────────
// WAF Pillar: Performance Efficiency + Cost Optimization
// Basis: AWS WAF PERF 1–4, Twelve-Factor App (stateless processes, concurrency)

function scoreScalability(graph: ArchitectureGraph): DimensionScore {
  const evidence: EvidenceFactor[] = [];
  const notes: string[] = [];
  let score = 0;

  const hasCache     = graph.nodes.some((n) => n.type === "cache");
  const hasQueue     = graph.nodes.some((n) => n.type === "queue");
  const hasWorker    = graph.nodes.some((n) => n.type === "worker");
  const hasCdn       = graph.nodes.some((n) => n.type === "cdn");
  const hasStorage   = graph.nodes.some((n) => n.type === "storage");
  const backendCount = graph.nodes.filter((n) => n.type === "backend").length;
  const hasK8s       = graph.tech_stack.some((t) => /k8s|kubernetes|cluster|eks|gke|aks/i.test(t));

  // Cache: +20 — reduces DB load, read-heavy workloads: 10x throughput gain documented (Redis benchmarks)
  evidence.push({ factor: "Cache layer (read throughput, DB offload)", found: hasCache, impact: hasCache ? 20 : 0,
    detail: hasCache ? "Read-heavy: cache can handle 10× more req/s than DB at same cost" : "All reads hit DB — bottleneck under load" });
  if (hasCache) { score += 20; notes.push("Cache reduces DB load — higher read throughput"); }
  else notes.push("No cache — DB is read bottleneck");

  // Queue: +20 — decoupling = burst absorption, Twelve-Factor App factor 7 (port binding)
  evidence.push({ factor: "Message queue (burst absorption, decoupling)", found: hasQueue, impact: hasQueue ? 20 : 0,
    detail: hasQueue ? "Decouples producers from consumers — absorbs traffic bursts" : "Synchronous coupling — producers block on consumer availability" });
  if (hasQueue) { score += 20; notes.push("Queue absorbs bursts and decouples services"); }
  else notes.push("No queue — synchronous coupling limits throughput ceiling");

  // Workers: +15 — horizontal scaling of async tasks
  evidence.push({ factor: "Worker pool (async horizontal scaling)", found: hasWorker, impact: hasWorker ? 15 : 0 });
  if (hasWorker) { score += 15; notes.push("Workers enable horizontal scaling of async tasks"); }

  // CDN: +15 — offloads static traffic, reduces origin load 80%+ for media-heavy apps
  evidence.push({ factor: "CDN (static traffic offload, global latency)", found: hasCdn, impact: hasCdn ? 15 : 0,
    detail: hasCdn ? "Offloads static assets — origin sees only dynamic traffic" : undefined });
  if (hasCdn) { score += 15; notes.push("CDN offloads static traffic — global performance"); }

  // Multiple backends: +15 — independent scaling per domain, WAF PERF 2
  evidence.push({ factor: `Multiple backends (${backendCount}) — independent scaling`, found: backendCount >= 2, impact: backendCount >= 2 ? 15 : 0,
    detail: backendCount >= 2 ? `${backendCount} services scale independently` : "Single backend — all traffic scales together" });
  if (backendCount >= 2) { score += 15; notes.push(`${backendCount} backends scale independently`); }
  else if (backendCount === 1) notes.push("Single backend — split hot paths for independent scaling");

  // Storage: +10 — AWS S3-class object storage decouples data volume from compute
  evidence.push({ factor: "Object storage (infinite data scalability)", found: hasStorage, impact: hasStorage ? 10 : 0 });
  if (hasStorage) { score += 10; notes.push("Object storage scales data volume independently of compute"); }

  // K8s: +5 — HPA (Horizontal Pod Autoscaler)
  evidence.push({ factor: "Container orchestration (HPA autoscaling)", found: hasK8s, impact: hasK8s ? 5 : 0 });
  if (hasK8s) { score += 5; notes.push("Kubernetes enables automated horizontal autoscaling"); }

  const maxPossible = 100; // 20+20+15+15+15+10+5
  score = clamp(score);
  return { name: "Scalability", waf_pillar: "Performance Efficiency (WAF PERF)", score, max_possible: maxPossible, grade: toGrade(score), notes, evidence };
}

// ─── Scoring: Simplicity ─────────────────────────────────────────────────────
// WAF Pillar: Operational Excellence
// Basis: KISS principle, Accelerate (Forsgren et al.) — cognitive load inversely correlated with DORA metrics

function scoreSimplicity(graph: ArchitectureGraph): DimensionScore {
  const evidence: EvidenceFactor[] = [];
  const notes: string[] = [];
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  // Node count bracket — cognitive load research: Miller's Law (7±2 chunks), Accelerate ch.5
  const nodeScore = nodeCount <= 5 ? 100 : nodeCount <= 8 ? 80 : nodeCount <= 12 ? 60 : nodeCount <= 18 ? 40 : nodeCount <= 25 ? 25 : 15;
  evidence.push({ factor: `Service count (${nodeCount} nodes)`, found: true, impact: nodeScore,
    detail: `Cognitive load bracket: ≤5→100, ≤8→80, ≤12→60, ≤18→40, ≤25→25, >25→15` });
  let score = nodeScore;

  // Edge density — low density = easy to reason about (≤1.0: each service has one main partner)
  const density = nodeCount > 0 ? edgeCount / nodeCount : 0;
  let densityAdj = 0;
  if      (density <= 1.0) { densityAdj = 10; notes.push("Low edge density — easy to reason about"); }
  else if (density <= 1.5) { densityAdj = 5;  notes.push("Moderate density — manageable complexity"); }
  else if (density > 2.5)  { densityAdj = -10; notes.push("High edge density — consider consolidation"); }
  evidence.push({ factor: `Edge density (${density.toFixed(1)} edges/node)`, found: true, impact: densityAdj,
    detail: `≤1.0 = +10, ≤1.5 = +5, >2.5 = -10. Basis: fan-out complexity metric` });
  score += densityAdj;

  if      (nodeCount <= 5)  notes.push("Minimal architecture — lowest operational overhead");
  else if (nodeCount <= 8)  notes.push("Compact — easy to onboard engineers");
  else if (nodeCount <= 12) notes.push("Medium complexity — document service ownership");
  else notes.push(`${nodeCount} nodes — use domain grouping to manage cognitive load`);

  score = clamp(score);
  return { name: "Simplicity", waf_pillar: "Operational Excellence (WAF OPS)", score, max_possible: 110, grade: toGrade(score), notes, evidence };
}

// ─── Scoring: Async Coverage ─────────────────────────────────────────────────
// WAF Pillar: Performance Efficiency
// Basis: AWS SQS/SNS best practices, Martin Fowler (Patterns of Enterprise Integration)

function scoreAsyncCoverage(graph: ArchitectureGraph): DimensionScore {
  const evidence: EvidenceFactor[] = [];
  const total = graph.edges.length;

  if (total === 0) {
    return { name: "Async Coverage", waf_pillar: "Performance Efficiency (WAF PERF)", score: 0, max_possible: 100,
      grade: "F", notes: ["No edges defined"], evidence: [] };
  }

  const asyncCount = graph.edges.filter((e) => e.async === true).length;
  const pct = Math.round((asyncCount / total) * 100);
  const score = clamp(pct);

  evidence.push({ factor: `Async edges (${asyncCount} of ${total} total)`, found: asyncCount > 0, impact: score,
    detail: `${pct}% = ${asyncCount}/${total} connections marked async. Score = raw percentage.` });

  const notes: string[] = [];
  if (pct === 0)      notes.push("0% async — all connections synchronous, limits throughput ceiling");
  else if (pct < 25)  notes.push(`${pct}% async — add queues for expensive/slow operations`);
  else if (pct < 60)  notes.push(`${pct}% async — good mix; consider making more write paths async`);
  else                notes.push(`${pct}% async — strong foundation for high-throughput workloads`);

  return { name: "Async Coverage", waf_pillar: "Performance Efficiency (WAF PERF)", score, max_possible: 100, grade: toGrade(score), notes, evidence };
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

function jaccardMultiset(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const x of a) countA.set(x, (countA.get(x) ?? 0) + 1);
  for (const x of b) countB.set(x, (countB.get(x) ?? 0) + 1);

  const allKeys = new Set([...countA.keys(), ...countB.keys()]);
  let intersection = 0;
  let unionVal = 0;
  for (const k of allKeys) {
    const ca = countA.get(k) ?? 0;
    const cb = countB.get(k) ?? 0;
    intersection += Math.min(ca, cb);
    unionVal += Math.max(ca, cb);
  }
  return unionVal === 0 ? 0 : intersection / unionVal;
}

function computeSimilarity(graph: ArchitectureGraph, ref: ReferenceGraph): number {
  // node_type_overlap: Jaccard of type multisets (50%)
  const typesA = graph.nodes.map((n) => n.type);
  const typesB = ref.nodes.map((n) => n.type);
  const typeScore = jaccardMultiset(typesA, typesB);

  // edge_protocol_overlap: Jaccard of protocol sets (30%)
  const protsA = [...new Set(graph.edges.map((e) => e.protocol))];
  const protsB = [...new Set(ref.edges.map((e) => e.protocol))];
  const allProts = new Set([...protsA, ...protsB]);
  const setA = new Set(protsA);
  const setB = new Set(protsB);
  let inter = 0;
  for (const p of allProts) {
    if (setA.has(p) && setB.has(p)) inter++;
  }
  const protScore = allProts.size === 0 ? 0 : inter / allProts.size;

  // scale similarity: 1 - abs(na - nb) / max(na, nb) (20%)
  const na = graph.nodes.length;
  const nb = ref.nodes.length;
  const scaleScore = na === 0 && nb === 0
    ? 1
    : 1 - Math.abs(na - nb) / Math.max(na, nb);

  return Math.round((typeScore * 0.5 + protScore * 0.3 + scaleScore * 0.2) * 100);
}

// ─── Insight generator ────────────────────────────────────────────────────────

function generateInsights(
  graph: ArchitectureGraph,
  dimensions: BenchmarkResult["dimensions"],
  spofs: string[],
  patternMatch: BenchmarkResult["pattern_match"]
): string[] {
  const insights: string[] = [];

  // Observability
  if (dimensions.observability.score < 40) {
    insights.push("No observability layer — add a monitoring service to detect failures early");
  }

  // SPOFs
  const degreeMap = buildDegreeMap(graph);
  for (const node of graph.nodes) {
    const deg = degreeMap.get(node.id) ?? 0;
    if (deg >= 4) {
      insights.push(
        `${node.label} (${deg} connections) is a SPOF — consider read replicas or caching layer`
      );
    }
  }

  // Async coverage
  if (dimensions.async_coverage.score === 0) {
    insights.push("0% async coverage — synchronous-only architecture limits scalability under load");
  }

  // Security — auth
  if (dimensions.security.score < 30) {
    insights.push("Missing auth layer — add authentication service before exposing to production");
  }

  // Pattern match gap
  if (patternMatch.length > 0) {
    const best = patternMatch[0];
    const missingMonitor = !graph.nodes.some((n) => n.type === "monitoring");
    if (missingMonitor) {
      insights.push(
        `Most similar to ${best.name} (${best.similarity}%) but lacks dedicated monitoring`
      );
    } else if (best.similarity < 50) {
      insights.push(
        `Low pattern match (${best.similarity}% with ${best.name}) — architecture may be ad hoc; consider a standard reference pattern`
      );
    }
  }

  // Scalability — no cache
  if (!graph.nodes.some((n) => n.type === "cache") && dimensions.scalability.score < 55) {
    insights.push("No caching layer — add Redis or Memcached to reduce database load under traffic spikes");
  }

  // Queue
  if (!graph.nodes.some((n) => n.type === "queue") && dimensions.async_coverage.score < 30) {
    insights.push("No message queue — adding SQS or RabbitMQ will decouple services and absorb traffic bursts");
  }

  // Security — gateway
  if (!graph.nodes.some((n) => n.type === "gateway")) {
    insights.push("No API gateway — services are directly exposed; add a gateway for routing, rate-limiting, and TLS");
  }

  // Return top 5
  return insights.slice(0, 5);
}

// ─── Calibration against reference patterns ──────────────────────────────────

function calibrate(score: number, refs: ReferenceGraph[]): BenchmarkResult["calibration"] {
  if (refs.length === 0) {
    return { percentile: 50, reference_scores: [], context: "No reference patterns loaded for calibration." };
  }

  // Pre-compute overall scores for all reference graphs (without cost context)
  const refScores: CalibrationPoint[] = refs.map((r) => {
    const deg   = buildDegreeMap(r);
    const spofs = r.nodes.filter((n) => (deg.get(n.id) ?? 0) >= 4).map((n) => n.label);
    const res   = scoreResilience(r, spofs);
    const obs   = scoreObservability(r);
    const sec   = scoreSecurity(r);
    const sca   = scoreScalability(r);
    const sim   = scoreSimplicity(r);
    const asy   = scoreAsyncCoverage(r);
    const overall = clamp(Math.round(
      res.score * 0.25 + obs.score * 0.20 + sec.score * 0.20 +
      sca.score * 0.20 + sim.score * 0.10 + asy.score * 0.05
    ));
    return { name: r._reference.name, overall };
  }).sort((a, b) => a.overall - b.overall);

  // Percentile rank: how many reference patterns score below this?
  const below   = refScores.filter((r) => r.overall < score).length;
  const percentile = Math.round((below / refScores.length) * 100);

  // Bracket: nearest reference below and above
  const lower = [...refScores].reverse().find((r) => r.overall <= score);
  const upper = refScores.find((r) => r.overall > score);

  // Context sentence
  let context = "";
  if (!lower && upper) {
    context = `Scores below all reference patterns (best: ${upper.name} at ${upper.overall}).`;
  } else if (lower && !upper) {
    context = `Scores above all reference patterns (best: ${lower.name} at ${lower.overall}).`;
  } else if (lower && upper) {
    context = `Sits between ${lower.name} (${lower.overall}) and ${upper.name} (${upper.overall}) reference patterns.`;
  }

  return { percentile, reference_scores: refScores, bracket_lower: lower, bracket_upper: upper, context };
}

// ─── Cost analysis ───────────────────────────────────────────────────────────

export function analyzeCost(
  graph: ArchitectureGraph,
  costContext: CostContext,
  degreeMap: Map<string, number>,
  spofLabels: string[]
): CostAnalysis {
  const spofSet = new Set(spofLabels);
  const total = Object.values(costContext).reduce((s, v) => s + v, 0);

  const entries: CostEntry[] = graph.nodes
    .filter((n) => {
      const key = Object.keys(costContext).find(
        (k) => k.toLowerCase() === n.label.toLowerCase() || k.toLowerCase() === n.id.toLowerCase()
      );
      return key !== undefined;
    })
    .map((n) => {
      const key = Object.keys(costContext).find(
        (k) => k.toLowerCase() === n.label.toLowerCase() || k.toLowerCase() === n.id.toLowerCase()
      )!;
      const monthly_usd   = costContext[key];
      const pct_of_total  = total > 0 ? Math.round((monthly_usd / total) * 100) : 0;
      const is_spof       = spofSet.has(n.label);
      const connections   = degreeMap.get(n.id) ?? 0;
      const risk: CostEntry["risk"] =
        is_spof && pct_of_total >= 30 ? "critical" :
        is_spof || pct_of_total >= 40 ? "high" :
        pct_of_total >= 20             ? "medium" : "low";
      return { label: n.label, monthly_usd, pct_of_total, is_spof, connections, risk };
    })
    .sort((a, b) => b.monthly_usd - a.monthly_usd);

  const top = entries[0];
  const concentration_pct = top ? top.pct_of_total : 0;
  const spofEntries       = entries.filter((e) => e.is_spof);
  const spof_cost_usd     = spofEntries.reduce((s, e) => s + e.monthly_usd, 0);
  const spof_cost_pct     = total > 0 ? Math.round((spof_cost_usd / total) * 100) : 0;

  // Efficiency score: penalise concentration and SPOF spend
  let eff = 100;
  if (concentration_pct > 60) eff -= 30;
  else if (concentration_pct > 40) eff -= 20;
  else if (concentration_pct > 25) eff -= 10;
  if (spof_cost_pct > 60) eff -= 25;
  else if (spof_cost_pct > 40) eff -= 15;
  else if (spof_cost_pct > 20) eff -= 8;
  const efficiency_score = clamp(eff);

  // Insights
  const costInsights: string[] = [];
  if (top && concentration_pct > 40) {
    costInsights.push(
      `$${top.monthly_usd.toLocaleString()}/mo (${concentration_pct}% of budget) concentrated in ${top.label} — high cost concentration risk`
    );
  }
  if (spof_cost_usd > 0) {
    costInsights.push(
      `$${spof_cost_usd.toLocaleString()}/mo (${spof_cost_pct}% of budget) tied to SPOF nodes — failure here = both outage AND wasted spend`
    );
  }
  for (const e of entries) {
    if (e.connections <= 1 && e.monthly_usd >= 100) {
      costInsights.push(
        `${e.label} costs $${e.monthly_usd.toLocaleString()}/mo but has only ${e.connections} connection — verify it's earning its place`
      );
    }
  }
  const noMonitoringCost = !graph.nodes.some((n) => n.type === "monitoring") && total > 0;
  if (noMonitoringCost) {
    costInsights.push(
      `Spending $${total.toLocaleString()}/mo with no monitoring — you can't optimise what you can't observe`
    );
  }

  return {
    total_monthly_usd: total,
    entries,
    top_cost_service: top?.label ?? "",
    concentration_pct,
    spof_cost_usd,
    spof_cost_pct,
    efficiency_score,
    insights: costInsights.slice(0, 4),
  };
}

// ─── Main benchmark function ─────────────────────────────────────────────────

export function benchmarkGraph(graph: ArchitectureGraph, costContext?: CostContext): BenchmarkResult {
  // Compute SPOF labels (nodes with degree >= 4)
  const degreeMap = buildDegreeMap(graph);
  const spofs = graph.nodes
    .filter((n) => (degreeMap.get(n.id) ?? 0) >= 4)
    .map((n) => n.label);

  // Score each dimension
  const resilience    = scoreResilience(graph, spofs);
  const observability = scoreObservability(graph);
  const security      = scoreSecurity(graph);
  const scalability   = scoreScalability(graph);
  const simplicity    = scoreSimplicity(graph);
  const async_coverage = scoreAsyncCoverage(graph);

  const dimensions = { resilience, observability, security, scalability, simplicity, async_coverage };

  // Weighted overall score
  const overall = clamp(
    Math.round(
      resilience.score     * 0.25 +
      observability.score  * 0.20 +
      security.score       * 0.20 +
      scalability.score    * 0.20 +
      simplicity.score     * 0.10 +
      async_coverage.score * 0.05
    )
  );
  const grade = toGrade(overall);

  // Pattern matching
  const refs = loadReferenceGraphs();
  const pattern_match = refs
    .map((ref) => ({
      name: ref._reference.name,
      similarity: computeSimilarity(graph, ref),
      description: ref._reference.description,
    }))
    .sort((a, b) => b.similarity - a.similarity);

  // Insights
  const insights = generateInsights(graph, dimensions, spofs, pattern_match);

  // Calibration against reference patterns
  const calibration = calibrate(overall, refs);

  // Cost analysis (optional)
  const cost =
    costContext && Object.keys(costContext).length > 0
      ? analyzeCost(graph, costContext, degreeMap, spofs)
      : undefined;

  const methodology =
    "Scores are evidence-based: each factor maps to AWS Well-Architected Framework pillars (Reliability, Security, " +
    "Operational Excellence, Performance Efficiency). Weights: Resilience 25%, Observability 20%, Security 20%, " +
    "Scalability 20%, Simplicity 10%, Async 5%. Calibrated against 5 reference architecture patterns.";

  return { overall, grade, methodology, dimensions, spofs, pattern_match, calibration, insights, cost };
}

// ─── Markdown report ─────────────────────────────────────────────────────────

export function benchmarkToMarkdown(result: BenchmarkResult, projectName = "Architecture"): string {
  const gradeColors: Record<string, string> = {
    A: "brightgreen",
    B: "green",
    C: "yellow",
    D: "orange",
    F: "red",
  };

  function scoreBar(score: number): string {
    const filled = Math.round(score / 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  }

  function gradeBadge(grade: string, label: string, score: number): string {
    const color = gradeColors[grade] ?? "lightgrey";
    return `![${label}](https://img.shields.io/badge/${encodeURIComponent(label)}-${score}%25%20${grade}-${color})`;
  }

  const overallBadge = gradeBadge(result.grade, "Overall", result.overall);
  const gradeColor   = gradeColors[result.grade] ?? "lightgrey";

  const dims = result.dimensions;
  const dimRows = [
    ["Resilience",     dims.resilience],
    ["Observability",  dims.observability],
    ["Security",       dims.security],
    ["Scalability",    dims.scalability],
    ["Simplicity",     dims.simplicity],
    ["Async Coverage", dims.async_coverage],
  ] as Array<[string, DimensionScore]>;

  const tableRows = dimRows
    .map(([, d]) => `| **${d.name}** | \`${scoreBar(d.score)}\` | ${d.score} | **${d.grade}** |`)
    .join("\n");

  const spofSection =
    result.spofs.length > 0
      ? `## ⚠️ Single Points of Failure\n\n${result.spofs.map((s) => `- **${s}**`).join("\n")}\n`
      : `## ✅ No SPOFs Detected\n\nNo nodes with 4+ connections found.\n`;

  const patternRows = result.pattern_match
    .slice(0, 3)
    .map((p) => `| **${p.name}** | ${p.similarity}% | ${p.description.slice(0, 80)}... |`)
    .join("\n");

  const insightList = result.insights
    .map((i, idx) => `- [ ] **${idx + 1}.** ${i}`)
    .join("\n");

  const dimensionDetails = dimRows
    .map(([, d]) => {
      const noteList = d.notes.map((n) => `  - ${n}`).join("\n");
      const evRows = d.evidence.map((e) =>
        `| ${e.factor} | ${e.found ? "✅" : "❌"} | \`${e.impact >= 0 ? "+" : ""}${e.impact}\` | ${e.detail ?? "—"} |`
      ).join("\n");
      const evidenceTable = d.evidence.length > 0
        ? `\n\n**Evidence** _(${d.waf_pillar})_\n\n| Factor | Detected | Impact | Detail |\n|--------|:--------:|-------:|--------|\n${evRows}`
        : "";
      return `### ${d.name}\n\n\`${scoreBar(d.score)}\` **${d.score}/${d.max_possible}** — Grade **${d.grade}**\n\n${noteList}${evidenceTable}`;
    })
    .join("\n\n");

  const now = new Date().toISOString().split("T")[0];

  // Cost section (optional)
  let costSection = "";
  if (result.cost) {
    const c = result.cost;
    const riskIcon = (r: string) =>
      r === "critical" ? "🔴" : r === "high" ? "🟠" : r === "medium" ? "🟡" : "🟢";

    const costRows = c.entries
      .map((e) =>
        `| **${e.label}** | $${e.monthly_usd.toLocaleString()}/mo | ${e.pct_of_total}% | ${e.connections} | ${e.is_spof ? "⚠️ SPOF" : "—"} | ${riskIcon(e.risk)} ${e.risk} |`
      )
      .join("\n");

    const effBar   = scoreBar(c.efficiency_score);
    const costInsights = c.insights.map((i) => `- ⚡ ${i}`).join("\n");

    costSection = `
---

## 💰 Cost Analysis

**Total: $${c.total_monthly_usd.toLocaleString()}/mo**  ·  Cost Efficiency: \`${effBar}\` ${c.efficiency_score}/100

| Service | Cost | % Budget | Connections | SPOF | Risk |
|---------|------|:--------:|:-----------:|------|------|
${costRows}

${c.spof_cost_usd > 0 ? `> ⚠️ **$${c.spof_cost_usd.toLocaleString()}/mo (${c.spof_cost_pct}% of budget) is tied to SPOF nodes** — these are simultaneously your biggest reliability risk and your biggest spend.\n` : ""}
${costInsights}
`;
  }

  // Calibration section
  const cal = result.calibration;
  const calRefRows = cal.reference_scores
    .map((r) => `| ${r.name} | ${scoreBar(r.overall)} | ${r.overall} |`)
    .join("\n");
  const calSection = cal.reference_scores.length > 0 ? `
---

## 📐 Calibration Against Reference Patterns

> **${cal.context}**

Your score (**${result.overall}**) ranks in the **${cal.percentile}th percentile** across ${cal.reference_scores.length} reference architecture patterns.

| Reference Pattern | Score Bar | Score |
|------------------|-----------|------:|
${calRefRows}
| **Your Architecture** | \`${scoreBar(result.overall)}\` | **${result.overall}** |

` : "";

  return `# 📊 Architecture Benchmark — ${projectName}

${overallBadge} ![Grade](https://img.shields.io/badge/grade-${result.grade}-${gradeColor}) ![Generated](https://img.shields.io/badge/generated-${now}-lightgrey)

## Summary

**Overall Score: ${result.overall}/100 — ${result.grade}**

> ${result.methodology}

| Dimension | Score Bar | Score | Grade |
|-----------|-----------|------:|-------|
${tableRows}

---

${spofSection}
---

## 🔍 Pattern Match (top 3)

| Pattern | Similarity | Description |
|---------|:----------:|-------------|
${patternRows}

---

## 💡 Actionable Insights

${insightList}

---

## Dimension Details

${dimensionDetails}
${calSection}${costSection}
---

> Generated by **[Diagram Forge](https://diagram-forge.dev)** — AI-powered architecture diagrams · ${now}
`;
}
