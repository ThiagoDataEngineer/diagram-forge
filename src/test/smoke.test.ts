/**
 * Smoke tests — run against a live server on localhost:3000.
 * Start the server first: npm run dev
 * Then: npm test
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:3000";

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

// ── Health ──────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with service info", async () => {
    const { status, body } = await get("/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("diagram-forge");
  });
});

// ── Static pages ─────────────────────────────────────────────────────────────

describe("Static pages", () => {
  it("GET / returns 200 HTML", async () => {
    const r = await fetch(`${BASE}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/html/);
  });

  it("GET /view returns 200 HTML", async () => {
    const r = await fetch(`${BASE}/view`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/html/);
  });
});

// ── Graph API ─────────────────────────────────────────────────────────────────

describe("GET /api/graph", () => {
  it("returns 400 when file param missing", async () => {
    const { status } = await get("/api/graph");
    expect(status).toBe(400);
  });
});

// ── Diff API ─────────────────────────────────────────────────────────────────

describe("GET /api/diff", () => {
  it("returns diff with summary, added/removed nodes", async () => {
    const { status, body } = await get("/api/diff?a=mediawiki-graph.json&b=airflow-graph.json");
    expect(status).toBe(200);
    expect(body).toHaveProperty("summary");
    expect(body.summary).toHaveProperty("old_nodes");
    expect(body.summary).toHaveProperty("new_nodes");
    expect(body.summary).toHaveProperty("severity");
  });

  it("returns 400/404 when file param missing", async () => {
    const { status } = await get("/api/diff?a=mediawiki-graph.json");
    expect([400, 404]).toContain(status);
  });
});

// ── Benchmark API ─────────────────────────────────────────────────────────────

describe("POST /api/benchmark", () => {
  let testGraph: unknown;
  beforeAll(async () => {
    // Load a test graph via the benchmark GET endpoint, which resolves from GRAPHS_DIR
    const r = await fetch(`${BASE}/api/benchmark?file=mediawiki-graph.json`);
    const result = await r.json();
    // We need the raw graph — read it directly in tests by using a minimal fixture
    testGraph = {
      nodes: [
        { id: "web", label: "Web App", type: "frontend", technology: "React" },
        { id: "api", label: "API Server", type: "backend", technology: "Node.js" },
        { id: "db",  label: "Database",  type: "database", technology: "PostgreSQL" },
        { id: "gw",  label: "Gateway",   type: "gateway",  technology: "nginx" },
        { id: "mon", label: "Monitoring", type: "monitoring", technology: "Grafana" },
        { id: "auth", label: "Auth",     type: "auth",     technology: "JWT" },
      ],
      edges: [
        { from: "gw",  to: "web",  protocol: "HTTPS", direction: "unidirectional", async: false },
        { from: "web", to: "api",  protocol: "HTTP",  direction: "unidirectional", async: false },
        { from: "api", to: "db",   protocol: "SQL",   direction: "unidirectional", async: false },
        { from: "api", to: "auth", protocol: "HTTP",  direction: "unidirectional", async: false },
        { from: "api", to: "mon",  protocol: "HTTP",  direction: "unidirectional", async: false },
      ],
      summary: "Test architecture",
      tech_stack: ["React", "Node.js", "PostgreSQL"],
      confidence: 0.9,
    };
    // Validate benchmark GET works for coverage
    expect(result).toHaveProperty("overall");
  });

  it("returns all 6 scoring dimensions", async () => {
    const { status, body } = await post("/api/benchmark", { graph: testGraph });
    expect(status).toBe(200);
    expect(typeof body.overall).toBe("number");
    expect(body.overall).toBeGreaterThanOrEqual(0);
    expect(body.overall).toBeLessThanOrEqual(100);
    expect(body).toHaveProperty("grade");
    const dims = body.dimensions;
    expect(dims).toHaveProperty("resilience");
    expect(dims).toHaveProperty("observability");
    expect(dims).toHaveProperty("security");
    expect(dims).toHaveProperty("scalability");
    expect(dims).toHaveProperty("simplicity");
    expect(dims).toHaveProperty("async_coverage");
  });

  it("includes evidence array per dimension", async () => {
    const { body } = await post("/api/benchmark", { graph: testGraph });
    const dim = body.dimensions.resilience;
    expect(Array.isArray(dim.evidence)).toBe(true);
    expect(dim.evidence.length).toBeGreaterThan(0);
    expect(dim.evidence[0]).toHaveProperty("factor");
    expect(dim.evidence[0]).toHaveProperty("impact");
  });

  it("includes calibration with percentile", async () => {
    const { body } = await post("/api/benchmark", { graph: testGraph });
    expect(body.calibration).toHaveProperty("percentile");
    expect(body.calibration).toHaveProperty("reference_scores");
    expect(Array.isArray(body.calibration.reference_scores)).toBe(true);
  });

  it("includes cost analysis when cost_context provided", async () => {
    const { body } = await post("/api/benchmark", {
      graph: testGraph,
      cost_context: { MySQL: 200, Memcached: 50 },
    });
    expect(body.cost).toBeDefined();
    expect(body.cost).toHaveProperty("total_monthly_usd");
    expect(body.cost).toHaveProperty("entries");
  });

  it("returns markdown when format=markdown", async () => {
    const r = await fetch(`${BASE}/api/benchmark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: testGraph, format: "markdown" }),
    });
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).toMatch(/##/);
    expect(text).toMatch(/Overall Score/);
  });

  it("returns 400 when graph missing", async () => {
    const { status } = await post("/api/benchmark", {});
    expect(status).toBe(400);
  });
});

describe("GET /api/benchmark", () => {
  it("returns benchmark for known file", async () => {
    const { status, body } = await get("/api/benchmark?file=mediawiki-graph.json");
    expect(status).toBe(200);
    expect(body).toHaveProperty("overall");
  });

  it("returns 400 when file param missing", async () => {
    const { status } = await get("/api/benchmark");
    expect(status).toBe(400);
  });
});

// ── Analyze-image route ───────────────────────────────────────────────────────

describe("POST /api/analyze-image", () => {
  it("returns 400 when image_base64 missing", async () => {
    const { status, body } = await post("/api/analyze-image", { media_type: "image/jpeg" });
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns 400 for unsupported media_type", async () => {
    const { status, body } = await post("/api/analyze-image", {
      image_base64: "AAAA",
      media_type: "image/bmp",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unsupported/);
  });

  it("returns 500 (not 404) when API key missing — route is registered", async () => {
    const { status } = await post("/api/analyze-image", {
      image_base64: "AAAA",
      media_type: "image/jpeg",
    });
    // 400 = missing field (good), 500 = no API key (good), 404 = route missing (bad)
    expect(status).not.toBe(404);
  });
});

// ── Explain API ───────────────────────────────────────────────────────────────

describe("POST /api/explain", () => {
  it("returns 400 when node missing", async () => {
    const { status } = await post("/api/explain", { graph: { nodes: [], edges: [] } });
    expect(status).toBe(400);
  });

  it("returns 500 (not 404) when API key missing — route is registered", async () => {
    const { status } = await post("/api/explain", {
      node: { id: "test", label: "Test", type: "backend" },
      graph: { nodes: [], edges: [] },
    });
    expect(status).not.toBe(404);
  });
});

// ── L402 gate on /analyze ─────────────────────────────────────────────────────

describe("POST /analyze", () => {
  it("returns 402 Payment Required (L402 gate active)", async () => {
    const { status } = await post("/analyze", { repo_url: "https://github.com/test/repo" });
    expect(status).toBe(402);
  });

  it("402 body includes invoice and payment_hash", async () => {
    const { body } = await post("/analyze", { repo_url: "https://github.com/test/repo" });
    expect(body).toHaveProperty("invoice");
    expect(body).toHaveProperty("payment_hash");
  });
});

// ── Security: path traversal prevention ──────────────────────────────────────

describe("Security — path traversal (Fix 1)", () => {
  const traversals = [
    "../../../../etc/passwd",
    "../../../package.json",
    "/etc/passwd",
    "..%2F..%2Fetc%2Fpasswd",
    "foo/../../etc/shadow",
  ];

  for (const attack of traversals) {
    it(`blocks path traversal: ${attack.slice(0, 30)}`, async () => {
      const { status } = await get(`/api/graph?file=${encodeURIComponent(attack)}`);
      // Must NOT return 200 (that would mean we served the file)
      expect(status).not.toBe(200);
      expect([400, 404]).toContain(status);
    });
  }

  it("blocks traversal in /api/diff ?a= param", async () => {
    const { status } = await get("/api/diff?a=../../package.json&b=mediawiki-graph.json");
    expect(status).not.toBe(200);
  });

  it("blocks traversal in /api/benchmark ?file= param", async () => {
    const { status } = await get("/api/benchmark?file=../../../../etc/passwd");
    expect(status).not.toBe(200);
  });
});

// ── Security: response headers (Fix 5) ────────────────────────────────────────

describe("Security — response headers (Fix 5)", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sets X-Frame-Options", async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.headers.get("x-frame-options")).toBeTruthy();
  });

  it("sets Content-Security-Policy", async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.headers.get("content-security-policy")).toBeTruthy();
  });

  it("sets Referrer-Policy", async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.headers.get("referrer-policy")).toBeTruthy();
  });
});

// ── Security: body size enforcement (Fix 4) ───────────────────────────────────

describe("Security — image body size (Fix 4)", () => {
  it("rejects requests larger than global 2mb JSON limit on non-image routes", async () => {
    const big = "x".repeat(3 * 1024 * 1024); // 3 MB
    const r = await fetch(`${BASE}/api/benchmark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: { nodes: [], edges: [] }, padding: big }),
    });
    // Express rejects with 413 or connection reset
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
