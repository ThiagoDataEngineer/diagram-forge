/**
 * End-to-end tests — fluxo L402 completo com mock Lightning.
 * Rodar: npm run test:e2e
 *
 * Cobre: 402 gate → mock pay → analyze → benchmark → diff → share → short link
 */
import { describe, it, expect, beforeAll } from "vitest";
import { PRICE_SATS } from "../payment/l402.js";

const BASE = "http://localhost:3000";

// Repo that doesn't exist — P-3 cache bypass fails gracefully, so the L402 gate fires.
// Used for gate tests that must not accidentally cache real analysis results.
const GATE_REPO = "https://github.com/test-only/x-e2e-gate-nonexistent-abc123";

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  const contentType = r.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    // Server streams analysis via SSE. Extract the final "result" event.
    const text = await r.text();
    let lastResult: Record<string, unknown> | null = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const obj = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (obj.type === "result") lastResult = obj;
        } catch { /* skip malformed lines */ }
      }
    }
    return { status: r.status, body: lastResult };
  }

  return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> };
}

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getL402Token(
  tier: "basic" | "full" | "live" = "full",
  repoUrl = "https://github.com/meltano/meltano",
) {
  const { status, body } = await post("/analyze", { repo_url: repoUrl, tier });
  expect(status).toBe(402);
  const hash = body!.payment_hash as string;
  const macaroon = (body as unknown as { instructions: string[] })
    .instructions?.[2]?.match(/L402 ([^:]+):/)?.[1] ?? "";

  // Simula pagamento via mock
  const payRes = await post("/dev/pay", { payment_hash: hash });
  expect(payRes.status).toBe(200);
  const preimage = payRes.body!.preimage as string;

  return { macaroon, preimage, hash };
}

// ─── Suite 1: L402 gate ───────────────────────────────────────────────────────
// Uses GATE_REPO (non-existent) + tier "live" so neither free trial nor P-3 cache
// bypass intercepts — the L402 gate always fires for these requests.

describe("L402 gate", () => {
  it("retorna 402 com invoice, hash, macaroon e tier", async () => {
    const { status, body } = await post("/analyze", {
      repo_url: GATE_REPO,
      tier: "live", // live has no free trial; P-3 fails gracefully on fake URL
    });
    expect(status).toBe(402);
    expect(body!.payment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body!.invoice).toMatch(/^lnbc_mock_/);
    expect(body!.amount_sats).toBe(PRICE_SATS.live);
    expect(body!.tier).toBe("live");
    expect(body!.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  it("retorna 402 com preço correto para tier full", async () => {
    const { status, body } = await post("/analyze", {
      repo_url: GATE_REPO,
      tier: "full",
    });
    expect(status).toBe(402);
    expect(body!.amount_sats).toBe(PRICE_SATS.full);
  });

  it("free trial concede acesso no primeiro request basic por IP", async () => {
    // Use GATE_REPO so the trial fires but analysis fails fast (fake URL).
    // This avoids caching a real repo that would pollute later test suites via P-3 bypass.
    const { status } = await post("/analyze", {
      repo_url: GATE_REPO,
      tier: "basic",
    });
    // Trial granted → server attempts analysis → fails on fake repo → 500
    expect([200, 500]).toContain(status);
  });
});

// ─── Suite 2: Fluxo completo /analyze ─────────────────────────────────────────

describe("Fluxo completo /analyze (ETL — meltano/meltano)", () => {
  let graph: Record<string, unknown>;
  let viewId: string;
  let paidSats: number;

  beforeAll(async () => {
    const { macaroon, preimage } = await getL402Token("full");
    const auth = `L402 ${macaroon}:${preimage}`;
    const { status, body } = await post(
      "/analyze",
      { repo_url: "https://github.com/meltano/meltano", tier: "full" },
      { Authorization: auth }
    );
    expect(status).toBe(200);
    graph = body!.graph as Record<string, unknown>;
    viewId = body!.id as string;
    paidSats = body!.paid_sats as number;
  }, 120_000);

  it("retorna grafo com nodes e edges", () => {
    const nodes = graph.nodes as unknown[];
    const edges = graph.edges as unknown[];
    expect(nodes.length).toBeGreaterThan(5);
    expect(edges.length).toBeGreaterThan(3);
  });

  it("detecta componentes ETL esperados no meltano", () => {
    const nodes = graph.nodes as { label: string; type: string; technology: string }[];
    const labels = nodes.map(n => n.label.toLowerCase());
    const technologies = nodes.map(n => n.technology.toLowerCase());

    // Meltano tem: CLI, Core, Singer, dbt, database
    const hasEltCore = labels.some(l => l.includes("meltano") || l.includes("core") || l.includes("cli"));
    const hasSinger = technologies.some(t => t.includes("singer") || t.includes("singer protocol"));
    const hasDb = nodes.some(n => n.type === "database");

    expect(hasEltCore).toBe(true);
    expect(hasSinger).toBe(true);
    expect(hasDb).toBe(true);
  });

  it("confiança >= 60%", () => {
    expect(graph.confidence as number).toBeGreaterThanOrEqual(0.6);
  });

  it("tech_stack inclui Python e dbt", () => {
    const stack = (graph.tech_stack as string[]).map(s => s.toLowerCase());
    expect(stack.some(s => s.includes("python"))).toBe(true);
    expect(stack.some(s => s.includes("dbt"))).toBe(true);
  });

  it("paid_sats é 10000 (tier full)", () => {
    expect(paidSats).toBe(PRICE_SATS.full);
  });

  // ─── Benchmark sobre o grafo retornado ──────────────────────────────────────

  it("benchmark retorna 6 dimensões com score e evidence", async () => {
    const { status, body } = await post("/api/benchmark", { graph, format: "json" });
    expect(status).toBe(200);
    const dims = body!.dimensions as Record<string, { score: number; evidence: unknown[] }>;
    const expected = ["resilience", "observability", "security", "scalability", "simplicity", "async_coverage"];
    for (const dim of expected) {
      expect(dims[dim]).toBeDefined();
      expect(dims[dim].score).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(dims[dim].evidence)).toBe(true);
    }
    expect(body!.overall as number).toBeGreaterThan(0);
    expect(["A", "B", "C", "D", "F"]).toContain(body!.grade);
  });

  it("benchmark format=markdown retorna texto com headers", async () => {
    const r = await fetch(`${BASE}/api/benchmark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph, format: "markdown" }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/markdown/);
    const text = await r.text();
    expect(text).toMatch(/## /);
    expect(text).toMatch(/Resilience|Observability|Security/);
  });

  // ─── Diff: compara grafo consigo mesmo ──────────────────────────────────────

  it("diff de grafo idêntico retorna severity=none", async () => {
    if (!viewId) return;
    const { status, body } = await get(`/api/diff?a=${viewId}&b=${viewId}&format=json`);
    expect(status).toBe(200);
    expect(body!.summary).toBeDefined();
    const summary = body!.summary as { severity: string };
    expect(summary.severity).toBe("none");
  });
});

// ─── Suite 3: /api/share → /g/:id ────────────────────────────────────────────

describe("Share e short link", () => {
  it("POST /api/share salva grafo e retorna id de 8 chars", async () => {
    const minimalGraph = {
      nodes: [{ id: "api", label: "API", type: "backend", technology: "Node.js" }],
      edges: [],
      summary: "teste",
      tech_stack: ["Node.js"],
      confidence: 0.9,
      analysis_steps: 1,
    };
    const { status, body } = await post("/api/share", { graph: minimalGraph });
    expect(status).toBe(200);
    const id = body!.id as string;
    expect(id).toMatch(/^[0-9a-f]{8}$/);

    // Short link serve HTML do viewer com grafo embutido (200, não redirect)
    const r = await fetch(`${BASE}/g/${id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/html/);
    const html = await r.text();
    expect(html).toContain("window.__GRAPH_DATA__");
  });

  it("GET /g/<inexistente> retorna erro (não 200)", async () => {
    const r = await fetch(`${BASE}/g/naoexiste99`);
    // Must not return 200 — graph doesn't exist
    expect(r.status).not.toBe(200);
    expect([400, 404]).toContain(r.status);
  });
});

// ─── Suite 4: Validações de segurança ─────────────────────────────────────────

describe("Token replay protection", () => {
  it("rejeita preimage inválido (SHA256 não bate com payment_hash)", async () => {
    // Use GATE_REPO + tier "live" so the L402 gate fires (no trial, no cache bypass)
    const { macaroon } = await getL402Token("live", GATE_REPO);
    const fakePreimage = "0".repeat(64); // SHA256 não bate com o hash real
    const auth = `L402 ${macaroon}:${fakePreimage}`;

    const r = await post(
      "/analyze",
      { repo_url: GATE_REPO, tier: "live" },
      { Authorization: auth }
    );
    // Deve rejeitar: preimage inválido → 401 ou 402
    expect([401, 402]).toContain(r.status);
  }, 30_000);
});
