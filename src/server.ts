import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const PKG_VERSION: string = (_require("../package.json") as { version: string }).version;
import crypto from "crypto";
import QRCode from "qrcode";
import pinoHttp from "pino-http";
import { z } from "zod";
import { log } from "./logger.js";
import {
  analyzeRequests,
  analyzeDuration,
  analyzeTokensIn,
  analyzeTokensOut,
  lightningInvoices,
  register as metricsRegister,
} from "./metrics.js";
import { createLightningBackend, isProductionLightning, MockLightningBackend } from "./payment/lightning.js";
import { l402 as kitL402, ManagedProvider } from "l402-kit";
import { l402 as mockL402, PRICE_SATS } from "./payment/l402.js";
import { analyzeProject } from "./analyzer/agent.js";
import { cloneRepo } from "./analyzer/clone.js";
import { getLocalSha, getRemoteSha, getCachedGraph, setCachedGraph } from "./cache/graph-cache.js";
import { renderSVG } from "./diagram/svg.js";
import { diffGraphs, diffToMarkdown } from "./analyzer/diff.js";
import { benchmarkGraph, benchmarkToMarkdown } from "./analyzer/benchmark.js";
import type { ArchitectureGraph } from "./analyzer/agent.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "2mb" })); // default limit; analyze-image has its own middleware

const PORT = Number(process.env.PORT ?? 3000);
const lightning = createLightningBackend();
const managedProvider = ManagedProvider.fromAddress(
  process.env.LIGHTNING_ADDRESS ?? "pinkfalcon21@primal.net",
  {
    registerDirectory: {
      url: "https://diagram-forge.dev/analyze",
      name: "Diagram Forge — Architecture Analysis",
      priceSats: PRICE_SATS.full,
      description: "AI-powered living architecture diagrams from any repo",
      category: "ai",
    },
  }
);

// 4.1: Structured request logging — redacts Authorization header automatically
app.use(pinoHttp({
  logger: log,
  genReqId: () => crypto.randomUUID(),
  customLogLevel: (_req, res) => res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

// Serve vendored JS (dagre layout library — served locally to avoid CDN blocking)
app.use(express.static(path.resolve(process.cwd(), "public"), { maxAge: "1d" }));

// ─── Security headers ─────────────────────────────────────────────────────────
// Fix 5: add baseline security headers on every response

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // CSP: allow inline scripts/styles (needed for viewer), block objects/embeds/frames
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https://img.shields.io https://cdn.simpleicons.org; " +
    "connect-src 'self' https://api.coingecko.com; frame-src 'none'; object-src 'none'; base-uri 'self';"
  );
  if (isProductionLightning()) {
    // HSTS only in prod (HTTPS guaranteed)
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  next();
});

// ─── Request type with L402 attached ─────────────────────────────────────────

type AuthedRequest = express.Request & { l402?: { payment_hash: string; expires_at: number; tier: string; sats: number } };

// ─── In-memory invoice store (hash → preimage, for mock polling) ─────────────
// In production this would be a DB or Redis.
const invoiceStore = new Map<string, { paid: boolean; preimage?: string }>();

// ─── Stripe paid sessions (sessionId → tier) ──────────────────────────────────
// Populated by the Stripe webhook; consumed once by /analyze.
const stripeSessionStore = new Map<string, { tier: "basic" | "full" | "live"; repoUrl?: string }>();

// ─── 3.3: Idempotency store ───────────────────────────────────────────────────
// Prevents duplicate analyses from double-clicks or retried requests.
// Key: `${Idempotency-Key}:${payment_hash}` — cross-user safe.
type IdemEntry = { status: "running" } | { status: "done"; result: unknown };
const idemStore = new Map<string, { entry: IdemEntry; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of idemStore) if (v.expiresAt < now) idemStore.delete(k);
}, 60_000).unref();

// ─── 3.1: Zod schema for /analyze request body ───────────────────────────────
const AnalyzeBodySchema = z.object({
  repo_url:   z.string().url().max(500).optional(),
  repo_path:  z.string().max(1000).optional(),
  tier:       z.enum(["basic", "full", "live"]).optional(),
  promo_code: z.string().max(64).optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Landing page
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../src/viewer/landing.html"));
});

// Payment page
app.get("/pay", (_req, res) => {
  res.sendFile(path.join(__dirname, "../src/viewer/payment.html"));
});

// 4.3: Honest health — reflects real backend state
app.get("/health", (_req, res) => {
  const backend = process.env.BLINK_API_KEY ? "blink" : process.env.LNBITS_URL ? "lnbits" : process.env.LIGHTNING_ADDRESS ? "managed" : "mock";
  const ok = backend !== "mock" || true; // mock is always "ok" for dev; extend with circuit breaker state later
  res.status(200).json({
    status: ok ? "ok" : "degraded",
    service: "diagram-forge",
    version: PKG_VERSION,
    tiers: PRICE_SATS,
    lightning_backend: backend,
    uptime_s: Math.floor(process.uptime()),
    idem_store_size: idemStore.size,
  });
});

// Pricing info
app.get("/pricing", (_req, res) => {
  res.json({
    tiers: {
      basic: {
        description: "Quick scan — up to 10 key files, main services detected",
        lightning_sats: PRICE_SATS.basic,
        card_usd: "5.00",
      },
      full: {
        description: "Full repo analysis — all services, connections, monorepos, notebooks",
        lightning_sats: PRICE_SATS.full,
        card_usd: "15.00",
      },
      live: {
        description: "Full analysis + animated SVG diagram with official logos",
        lightning_sats: PRICE_SATS.live,
        card_usd: "39.00",
      },
    },
    note: "Lightning prices are lower — no credit card processing fees.",
    lightning_protocol: "L402 (HTTP 402 + Lightning Network)",
    card_processor: "Stripe",
  });
});

// ─── POST /analyze — main paid endpoint ───────────────────────────────────────
// Body: { repo_path?: string, repo_url?: string, tier?: "basic"|"full"|"live" }
// Without payment → 402. With valid L402 → runs Claude agent.

app.post(
  "/analyze",
  // ── Stripe auth check — runs before L402 middleware ──────────────────────
  (req: AuthedRequest, _res, next) => {
    const authHeader = req.headers["authorization"] ?? "";
    const match = authHeader.match(/^Stripe\s+(.+)$/i);
    if (match) {
      const sessionId = match[1].trim();
      const entry = stripeSessionStore.get(sessionId);
      if (entry) {
        stripeSessionStore.delete(sessionId); // one-time use
        (req as AuthedRequest).l402 = {
          payment_hash: `stripe_${sessionId}`,
          expires_at: Math.floor(Date.now() / 1000) + 7200,
          tier: entry.tier,
          sats: 0,
        };
      }
    }
    next();
  },
  // ── Promo code check — bypasses L402 if valid ───────────────────────────
  async (req: AuthedRequest, res, next) => {
    if ((req as AuthedRequest).l402) return next();
    const code = req.body?.promo_code as string | undefined;
    if (code) {
      const result = await redeemPromo(code);
      if (result.valid) {
        const tier = result.tier ?? (req.body?.tier as "basic" | "full" | "live") ?? "basic";
        (req as AuthedRequest).l402 = {
          payment_hash: `promo_${code.toUpperCase()}_${Date.now()}`,
          expires_at: Math.floor(Date.now() / 1000) + 7200,
          tier,
          sats: 0,
        };
        log.info({ code: code.toUpperCase(), tier }, "promo code redeemed");
      } else {
        // Return 402 with promo_error so the landing can show a specific message
        res.status(402).json({ error: "promo_invalid", promo_error: result.reason });
        return;
      }
    }
    next();
  },
  (req: AuthedRequest, res, next) => {
    // If already authenticated via Stripe or promo, skip L402 gate
    if ((req as AuthedRequest).l402) return next();
    const tier = (req.body?.tier as "basic" | "full" | "live") ?? "full";
    if (isProductionLightning() || process.env.LIGHTNING_ADDRESS) {
      return kitL402({ priceSats: PRICE_SATS[tier], lightning: managedProvider })(req, res, next);
    }
    return mockL402({ lightning, tier, memo: "Diagram Forge — repo analysis" })(req, res, next);
  },
  async (req: AuthedRequest, res) => {
    // Rate limit (prod only — skip in mock/dev mode)
    if (isProductionLightning()) {
      const ip = req.ip ?? "unknown";
      const { ok, remaining } = analyzeAllowed(ip);
      if (!ok) {
        res.status(429).json({
          error: "daily_limit_reached",
          message: "Free analysis limit (3/day) reached. Upgrade to a paid tier.",
          remaining: 0,
        });
        return;
      }
      res.setHeader("X-Analyze-Remaining", remaining);
    }

    // 3.1: Zod validation
    const parsed = AnalyzeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      return;
    }

    const { repo_path, repo_url } = parsed.data;
    const tier = parsed.data.tier ?? "full";

    // Fix 2: block local path analysis in production — only remote URLs allowed
    if (repo_path && isProductionLightning()) {
      res.status(400).json({ error: "Local path analysis is not available in production. Use a GitHub URL." });
      return;
    }

    if (!repo_path && !repo_url) {
      res.status(400).json({ error: "repo_path or repo_url is required" });
      return;
    }

    // 3.3: Idempotency — prevent duplicate analyses from retried requests
    const idemKey = req.headers["idempotency-key"] as string | undefined;
    const paymentHash = (req as AuthedRequest).l402?.payment_hash ?? "";
    const idemStoreKey = idemKey ? `${idemKey}:${paymentHash}` : null;
    if (idemStoreKey) {
      const existing = idemStore.get(idemStoreKey);
      if (existing) {
        if (existing.entry.status === "running") {
          res.status(409).json({ error: "duplicate_request", message: "Analysis already in progress for this idempotency key." });
          return;
        }
        if (existing.entry.status === "done") {
          res.json(existing.entry.result);
          return;
        }
      }
      idemStore.set(idemStoreKey, { entry: { status: "running" }, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    }

    let cloneCleanup: (() => void) | null = null;
    let absPath: string;
    const timer = analyzeDuration.startTimer({ tier });

    try {
      // ── Cache check before cloning / analyzing ─────────────────────────────
      const identifier = repo_url ?? repo_path!;
      const sha = repo_url
        ? getRemoteSha(repo_url)
        : getLocalSha(path.resolve(repo_path!));

      if (sha) {
        const cached = getCachedGraph(identifier, sha);
        if (cached) {
          log.info({ identifier, sha: sha.slice(0, 8) }, "cache hit");
          const result = { ok: true, tier, graph: cached, paid_sats: PRICE_SATS[tier], cached: true };
          if (idemStoreKey) idemStore.set(idemStoreKey, { entry: { status: "done", result }, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
          timer({ status: "cached" });
          analyzeRequests.inc({ status: "cached", tier });
          res.json(result);
          return;
        }
      }

      if (repo_url) {
        const { localPath, cleanup } = await cloneRepo(repo_url, (msg) => log.info(msg));
        absPath = localPath;
        cloneCleanup = cleanup;
      } else {
        absPath = path.resolve(repo_path!);
        if (!fs.existsSync(absPath)) {
          res.status(404).json({ error: "Path not found" });
          return;
        }
      }

      log.info({ absPath, tier }, "starting analysis");

      const graph = await analyzeProject(absPath, {
        tier,
        onProgress: (msg) => log.info(msg),
        onTokenUsage: (inTok, outTok) => {
          analyzeTokensIn.inc(inTok);
          analyzeTokensOut.inc(outTok);
          log.info({ input_tokens: inTok, output_tokens: outTok }, "token usage");
        },
      });

      if (sha) setCachedGraph(identifier, sha, graph);

      const result = { ok: true, tier, graph, paid_sats: PRICE_SATS[tier] };
      if (idemStoreKey) idemStore.set(idemStoreKey, { entry: { status: "done", result }, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
      timer({ status: "success" });
      analyzeRequests.inc({ status: "success", tier });
      res.json(result);
    } catch (err) {
      log.error({ err }, "analysis error");
      timer({ status: "error" });
      analyzeRequests.inc({ status: "error", tier });
      if (idemStoreKey) idemStore.delete(idemStoreKey); // allow retry on error
      res.status(500).json({
        error: "analysis_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      cloneCleanup?.();
    }
  }
);

// ─── POST /diagram — render graph JSON → animated SVG ────────────────────────
// Tier "live" only. Accepts the graph JSON returned by /analyze.

app.post(
  "/diagram",
  (req: AuthedRequest, res, next) => {
    if (isProductionLightning() || process.env.LIGHTNING_ADDRESS) {
      return kitL402({ priceSats: PRICE_SATS.live, lightning: managedProvider })(req, res, next);
    }
    return mockL402({ lightning, tier: "live", memo: "Diagram Forge — SVG render" })(req, res, next);
  },
  (req: AuthedRequest, res) => {
    const graph = req.body?.graph as ArchitectureGraph | undefined;

    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      res.status(400).json({
        error: "invalid_graph",
        message: "Body must contain { graph: { nodes, edges, ... } } from /analyze",
      });
      return;
    }

    try {
      const svg = renderSVG(graph);
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Content-Disposition", 'inline; filename="diagram.svg"');
      res.send(svg);
    } catch (err) {
      res.status(500).json({
        error: "render_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// ─── GET /diagram/preview — render from saved graph file (dev shortcut) ───────

app.get("/diagram/preview", (req, res) => {
  const filePath = (req.query.file as string) ?? "graph.json";
  const absPath  = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    res.status(404).send(`File not found: ${absPath}`);
    return;
  }

  try {
    const graph = JSON.parse(fs.readFileSync(absPath, "utf-8")) as ArchitectureGraph;
    const svg   = renderSVG(graph);
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

// ─── GET /api/qr — generate QR code data URI from Lightning invoice ──────────

app.get("/api/qr", async (req, res) => {
  const invoice = req.query.invoice as string;
  if (!invoice) { res.status(400).send("invoice param required"); return; }
  try {
    const dataUri = await QRCode.toDataURL(invoice.toUpperCase(), {
      errorCorrectionLevel: "M",
      margin: 1,
      color: { dark: "#000000", light: "#FFFFFF" },
      width: 300,
    });
    res.setHeader("Content-Type", "text/plain");
    res.send(dataUri);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

// ─── GET /api/invoice-status/:hash — payment polling ─────────────────────────

app.get("/api/invoice-status/:hash", async (req, res) => {
  const { hash } = req.params;

  try {
    const paid = await lightning.checkPaid(hash);
    if (paid) {
      // For mock backend: recover the preimage from store
      const stored = invoiceStore.get(hash);
      res.json({ paid: true, preimage: stored?.preimage ?? null });
    } else {
      res.json({ paid: false });
    }
  } catch {
    res.status(503).json({ error: "lightning_unavailable" });
  }
});

import { saveShare, getShare } from "./db/shares.js";
import { redeemPromo } from "./db/promo.js";

// ─── POST /api/share — save graph, return short ID ───────────────────────────

const GRAPHS_DIR = path.resolve(process.cwd(), "data", "graphs");

// ─── Fix 1: safe graph file resolver — blocks path traversal ─────────────────
// Only allows bare filenames that resolve inside GRAPHS_DIR.
// Rejects any input containing path separators or ".." components.

function resolveGraphFile(input: string): string | null {
  // Only accept bare filenames — no slashes, no dots as path separators
  if (!input || /[/\\]/.test(input) || input.includes("..")) return null;
  // Only .json files
  const name = input.endsWith(".json") ? input : input + ".json";
  // Validate characters: alphanumeric, hyphens, underscores, dots
  if (!/^[\w.-]+\.json$/.test(name)) return null;
  const resolved = path.join(GRAPHS_DIR, name);
  // Belt-and-suspenders: confirm the result is still under GRAPHS_DIR
  if (!resolved.startsWith(GRAPHS_DIR + path.sep) && resolved !== GRAPHS_DIR) return null;
  return resolved;
}

app.post("/api/share", async (req, res) => {
  const { graph } = req.body as { graph?: ArchitectureGraph };
  if (!graph || !Array.isArray(graph.nodes)) {
    res.status(400).json({ error: "invalid_graph" });
    return;
  }

  const id = crypto.randomBytes(4).toString("hex");
  const payload = { ...graph, _shared_at: new Date().toISOString() };

  try {
    await saveShare(id, payload);
  } catch {
    // Supabase unavailable — fall back to local file
    fs.mkdirSync(GRAPHS_DIR, { recursive: true });
    fs.writeFileSync(path.join(GRAPHS_DIR, `${id}.json`), JSON.stringify(payload), "utf-8");
  }

  res.json({ id, url: `/g/${id}` });
});

// ─── GET /g/:id — short link → viewer ────────────────────────────────────────

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Diagram not found — Diagram Forge</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0D1117;color:#E6EDF3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{text-align:center;max-width:420px}.icon{font-size:48px;margin-bottom:20px}.title{font-size:24px;font-weight:800;margin-bottom:10px}
.sub{font-size:15px;color:#768390;line-height:1.6;margin-bottom:28px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px}
</style></head>
<body><div class="box">
  <div class="icon">⚡</div>
  <div class="title">Diagram not found</div>
  <div class="sub">This diagram link has expired or doesn't exist.<br/>Share links are permanent for paid analyses — generate a new one to share.</div>
  <a class="btn" href="https://forge.l402kit.com">← Analyze a repo</a>
</div></body></html>`;

app.get("/g/:id", async (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]{4,32}$/.test(id)) {
    res.status(404).set("Content-Type", "text/html").send(NOT_FOUND_HTML);
    return;
  }

  let graph: ArchitectureGraph | null = null;

  // Try Supabase first, fall back to local file
  graph = await getShare(id);
  if (!graph) {
    const graphPath = path.join(GRAPHS_DIR, `${id}.json`);
    if (fs.existsSync(graphPath)) {
      try { graph = JSON.parse(fs.readFileSync(graphPath, "utf-8")); } catch { /* ignore */ }
    }
  }

  if (!graph) {
    res.status(404).set("Content-Type", "text/html").send(NOT_FOUND_HTML);
    return;
  }

  const viewerPath = path.join(__dirname, "../src/viewer/index.html");
  let html = fs.readFileSync(viewerPath, "utf-8");
  html = html.replace(
    "const GRAPH_DATA = window.__GRAPH_DATA__ || null;",
    `window.__GRAPH_DATA__ = ${JSON.stringify(graph)};\nconst GRAPH_DATA = window.__GRAPH_DATA__ || null;`
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ─── GET /view — interactive HTML viewer ─────────────────────────────────────
// ?file=graph.json  → loads graph from local file and embeds in viewer
// ?demo             → shows demo graph (no file needed)

app.get("/view", (req, res) => {
  const viewerPath = path.join(__dirname, "../src/viewer/index.html");
  let html = fs.readFileSync(viewerPath, "utf-8");

  let graph: ArchitectureGraph | null = null;

  if (req.query.file) {
    const absPath = path.resolve(req.query.file as string);
    if (fs.existsSync(absPath)) {
      try { graph = JSON.parse(fs.readFileSync(absPath, "utf-8")); } catch { /* use demo */ }
    }
  }

  // Inject graph data as JS variable before closing </script>
  const injection = graph
    ? `\n  window.__GRAPH_DATA__ = ${JSON.stringify(graph)};\n`
    : `\n  window.__GRAPH_DATA__ = null;\n`;

  html = html.replace("const GRAPH_DATA = window.__GRAPH_DATA__ || null;",
    injection + "const GRAPH_DATA = window.__GRAPH_DATA__ || null;");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ─── GET /api/diff — compare two saved graph snapshots ───────────────────────
// ?a=slug-v1.json&b=slug-v2.json[&format=json|markdown]
// Returns ArchDiff JSON or markdown report.
// Designed for CI/CD pipelines and MCP agents.

app.get("/api/diff", (req, res) => {
  const fileA  = req.query.a      as string | undefined;
  const fileB  = req.query.b      as string | undefined;
  const format = (req.query.format as string | undefined) ?? "json";

  if (!fileA || !fileB) {
    res.status(400).json({ error: "Both ?a= and ?b= graph file params are required" });
    return;
  }

  const loadGraph = (filename: string): ArchitectureGraph | null => {
    const p = resolveGraphFile(filename);
    if (!p || !fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
  };

  const graphA = loadGraph(fileA);
  const graphB = loadGraph(fileB);

  if (!graphA) { res.status(404).json({ error: `Graph not found: ${fileA}` }); return; }
  if (!graphB) { res.status(404).json({ error: `Graph not found: ${fileB}` }); return; }

  const diff = diffGraphs(graphA, graphB);

  if (format === "markdown") {
    const md = diffToMarkdown(
      diff,
      path.basename(fileA, ".json"),
      path.basename(fileB, ".json")
    );
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(md);
    return;
  }

  res.json(diff);
});

// ─── GET /api/benchmark — benchmark a saved graph file ───────────────────────
// GET  /api/benchmark?file=graph.json[&format=json|markdown]
// POST /api/benchmark   body: { graph: ArchitectureGraph }[&format=json|markdown]

app.get("/api/benchmark", (req, res) => {
  const file   = req.query.file   as string | undefined;
  const format = (req.query.format as string | undefined) ?? "json";

  if (!file) {
    res.status(400).json({ error: "file param required (e.g. ?file=graph.json)" });
    return;
  }

  const p = resolveGraphFile(file);
  let graph: ArchitectureGraph | null = null;
  if (p && fs.existsSync(p)) {
    try { graph = JSON.parse(fs.readFileSync(p, "utf-8")); } catch { /* handled below */ }
  }

  if (!graph) {
    res.status(404).json({ error: `Graph not found: ${path.basename(file)}` });
    return;
  }

  const costContext = req.query.cost ? JSON.parse(req.query.cost as string) : undefined;
  const result = benchmarkGraph(graph, costContext);

  if (format === "markdown") {
    const md = benchmarkToMarkdown(result, path.basename(file, ".json"));
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(md);
    return;
  }

  res.json(result);
});

app.post("/api/benchmark", (req, res) => {
  const { graph, cost_context, format: bodyFormat } = req.body as { graph?: ArchitectureGraph; cost_context?: Record<string, number>; format?: string };
  const format = (req.query.format as string | undefined) ?? bodyFormat ?? "json";

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    res.status(400).json({ error: "Body must contain { graph: { nodes, edges, ... } }" });
    return;
  }

  const result = benchmarkGraph(graph, cost_context);

  if (format === "markdown") {
    const md = benchmarkToMarkdown(result);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(md);
    return;
  }

  res.json(result);
});

// ─── GET /api/graph — serve graph JSON for viewer fetch ──────────────────────

app.get("/api/graph", (req, res) => {
  const file = req.query.file as string;
  if (!file) {
    res.status(400).json({ error: "file param required" });
    return;
  }
  // Fix 1: resolveGraphFile enforces GRAPHS_DIR boundary
  const absPath = resolveGraphFile(file);
  if (!absPath || !fs.existsSync(absPath)) {
    res.status(404).json({ error: "Graph not found" });
    return;
  }
  try {
    const graph = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 4.2: Prometheus metrics endpoint — always requires token
app.get("/metrics", async (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (!token || req.query.token !== token) {
    res.status(401).end();
    return;
  }
  res.setHeader("Content-Type", metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

import { makeRateLimiter } from "./utils/rate-limiter.js";
import {
  isStripeAvailable,
  createStripeCheckout,
  getStripeSession,
  constructStripeEvent,
  issueStripeMacaroon,
  PRICE_USD,
} from "./payment/stripe.js";

const explainAllowed  = makeRateLimiter(7);   // 7 free explains/IP/day
const analyzeAllowed  = makeRateLimiter(3);   // 3 free analyses/IP/day

// ─── Explain node deeply ──────────────────────────────────────────────────────
app.post("/api/explain", async (req, res) => {
  const { node, graph } = req.body as { node: Record<string, unknown>; graph: { nodes: unknown[]; edges: unknown[] } };

  // Rate limit (skip in dev/mock mode)
  if (isProductionLightning()) {
    const ip = req.ip ?? "unknown";
    const { ok, remaining } = explainAllowed(ip);
    if (!ok) {
      res.status(429).json({
        error: "daily_limit_reached",
        message: `Free explain limit (7/day) reached. Upgrade to full tier for unlimited explains.`,
        remaining: 0,
      });
      return;
    }
    res.setHeader("X-Explain-Remaining", remaining);
  }
  if (!node) { res.status(400).json({ error: "node required" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "ANTHROPIC_API_KEY not set" }); return; }

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const nodeList = (graph?.nodes ?? []) as Array<Record<string, unknown>>;
  const edgeList = (graph?.edges ?? []) as Array<Record<string, unknown>>;
  const connections = edgeList.filter((e: Record<string, unknown>) => e.from === node.id || e.to === node.id);

  const prompt = `You are analyzing an architecture diagram node. Give a concise but deep technical explanation (3-5 sentences) of what this component does, why it exists in this architecture, and any important operational concerns (scaling, failure modes, security).

Node: ${JSON.stringify(node, null, 2)}
Direct connections: ${JSON.stringify(connections, null, 2)}
Total nodes in system: ${nodeList.length}

Respond with plain prose only — no markdown headers, no bullet points.`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as { type: string; text: string }).text;
    res.json({ explanation: text });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/analyze-image — extract architecture from a diagram image ─────
// Body: { image_base64: string, media_type: "image/jpeg"|"image/png"|"image/webp"|"image/gif"|"application/pdf", hint?: string }
// Returns: ArchitectureGraph JSON
// No L402 gate in dev mode; same "full" tier in prod.

const IMAGE_ANALYZE_PROMPT = `You are an expert software architect analyzing an architecture diagram image.

Extract every visible component, service, database, queue, and connection from the diagram.
Return ONLY a valid JSON object — no markdown fences, no explanatory text, just the raw JSON.

Schema:
{
  "nodes": [
    {
      "id": "lowercase_snake_case_unique_id",
      "label": "Human readable name exactly as shown in the diagram",
      "type": "frontend|backend|database|cache|queue|storage|auth|gateway|external_api|ml_model|worker|cdn|monitoring|other",
      "technology": "Technology name (infer from label/icon if possible, or 'Unknown')",
      "description": "One sentence: what this component does in this architecture"
    }
  ],
  "edges": [
    {
      "from": "node_id",
      "to": "node_id",
      "protocol": "HTTP|HTTPS|SQL|Redis|gRPC|AMQP|WebSocket|GraphQL|tRPC|Lightning|unknown",
      "direction": "unidirectional|bidirectional",
      "label": "label on the arrow if visible, otherwise omit",
      "async": false
    }
  ],
  "summary": "Two to three sentences describing the overall architecture and its purpose.",
  "tech_stack": ["Technology1", "Technology2"],
  "confidence": 0.0
}

Rules:
- confidence: 0.9 = clear digital diagram, 0.7 = legible whiteboard, 0.5 = rough sketch
- If an arrow has no label, infer protocol from the node types (frontend→backend = HTTP, backend→database = SQL, etc.)
- direction: bidirectional if the arrow has arrows on both ends or there are two arrows between the same pair
- async: true if the connection goes through a queue or is labeled "async", "event", "publish", "subscribe"
- Extract EVERY component visible, even if partially obscured
- For hand-drawn diagrams, use spatial grouping and box labels to infer services
- type "other" is acceptable for ambiguous components`;

// Fix 4: per-route JSON limit for image payloads — tier-aware at handler level
// Dev: 12 MB (no auth). Prod: basic=4 MB, full=8 MB, live=12 MB.
const IMAGE_SIZE_LIMIT_BY_TIER: Record<string, number> = {
  basic: 4 * 1024 * 1024,
  full:  8 * 1024 * 1024,
  live: 12 * 1024 * 1024,
};

const imageAllowed = makeRateLimiter(5); // 5 image analyses/IP/day in prod

app.post("/api/analyze-image", express.json({ limit: "12mb" }), async (req: AuthedRequest, res) => {
  // Rate limit + size enforcement in production
  if (isProductionLightning()) {
    const ip = req.ip ?? "unknown";
    const { ok } = imageAllowed(ip);
    if (!ok) {
      res.status(429).json({ error: "daily_limit_reached", message: "Image analysis limit (5/day) reached." });
      return;
    }
    const tier = (req.l402?.tier as string | undefined) ?? "basic";
    const maxBytes = IMAGE_SIZE_LIMIT_BY_TIER[tier] ?? IMAGE_SIZE_LIMIT_BY_TIER.basic;
    const b64 = (req.body as Record<string, unknown>).image_base64;
    const byteLen = typeof b64 === "string" ? Math.ceil(b64.length * 0.75) : 0;
    if (byteLen > maxBytes) {
      res.status(413).json({
        error: "image_too_large",
        message: `Image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit for ${tier} tier. Upgrade for larger images.`,
        limit_mb: Math.round(maxBytes / 1024 / 1024),
        tier,
      });
      return;
    }
  }
  const { image_base64, media_type, hint } = req.body as {
    image_base64?: string;
    media_type?: string;
    hint?: string;
  };

  if (!image_base64) {
    res.status(400).json({ error: "image_base64 is required" });
    return;
  }

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
  const mtype = (media_type ?? "image/jpeg") as typeof allowed[number];
  if (!allowed.includes(mtype)) {
    res.status(400).json({ error: `Unsupported media_type. Allowed: ${allowed.join(", ")}` });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });
    return;
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });

    const userContent: Parameters<typeof client.messages.create>[0]["messages"][0]["content"] = [
      {
        type: "image",
        source: { type: "base64", media_type: mtype as "image/jpeg", data: image_base64 },
      },
      {
        type: "text",
        text: hint
          ? `${IMAGE_ANALYZE_PROMPT}\n\nAdditional context from the user: ${hint}`
          : IMAGE_ANALYZE_PROMPT,
      },
    ];

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: userContent }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text.trim();

    // Strip accidental markdown fences
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let graph: ArchitectureGraph;
    try {
      graph = JSON.parse(jsonText);
    } catch {
      res.status(500).json({
        error: "model_parse_error",
        message: "Claude returned non-JSON. Try with a clearer image.",
        raw: raw.slice(0, 500),
      });
      return;
    }

    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      res.status(500).json({ error: "invalid_graph", message: "Extracted graph missing nodes or edges." });
      return;
    }

    // Ensure required fields have defaults
    graph.tech_stack   = graph.tech_stack   ?? [];
    graph.summary      = graph.summary      ?? "Architecture extracted from image.";
    graph.confidence   = graph.confidence   ?? 0.7;
    (graph as unknown as Record<string, unknown>).analysis_steps = 1;
    (graph as unknown as Record<string, unknown>)._source = "image";

    // Save to data/graphs/
    const slug     = `image-${Date.now()}`;
    const filename = `${slug}.json`;
    fs.mkdirSync(GRAPHS_DIR, { recursive: true });
    fs.writeFileSync(path.join(GRAPHS_DIR, filename), JSON.stringify(graph, null, 2));

    res.json({ ok: true, graph, filename, view_url: `/view?file=${filename}` });
  } catch (err) {
    console.error("[analyze-image]", err);
    res.status(500).json({ error: "analysis_failed", message: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Stripe routes ───────────────────────────────────────────────────────────

// POST /stripe/checkout — create Stripe Checkout Session
app.post("/stripe/checkout", async (req, res) => {
  if (!isStripeAvailable()) {
    res.status(503).json({ error: "stripe_unavailable", message: "Stripe is not configured on this server." });
    return;
  }

  const { tier = "full", repo_url } = req.body as { tier?: string; repo_url?: string };
  const validTiers = ["basic", "full", "live"] as const;
  const safeTier = validTiers.includes(tier as typeof validTiers[number])
    ? (tier as typeof validTiers[number])
    : "full";

  const origin = `${req.protocol}://${req.get("host")}`;
  const successUrl = `${origin}/stripe/success?session_id={CHECKOUT_SESSION_ID}&repo_url=${encodeURIComponent(repo_url ?? "")}`;
  const cancelUrl  = `${origin}/pay?tier=${safeTier}&repo_url=${encodeURIComponent(repo_url ?? "")}`;

  try {
    const { url, sessionId } = await createStripeCheckout({
      tier: safeTier,
      repoUrl: repo_url,
      successUrl,
      cancelUrl,
    });
    res.json({ url, sessionId, tier: safeTier, price_usd: (PRICE_USD[safeTier] / 100).toFixed(2) });
  } catch (err) {
    res.status(500).json({ error: "stripe_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// POST /stripe/webhook — Stripe event webhook (raw body required)
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    if (!sig) { res.status(400).json({ error: "missing stripe-signature header" }); return; }

    let event;
    try {
      event = constructStripeEvent(req.body as Buffer, sig);
    } catch (err) {
      res.status(400).json({ error: "webhook_verification_failed", message: String(err) });
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Record<string, unknown>;
      const meta = (session["metadata"] ?? {}) as Record<string, string>;
      if (session["payment_status"] === "paid") {
        const tier = (meta["tier"] ?? "full") as "basic" | "full" | "live";
        const id   = session["id"] as string;
        stripeSessionStore.set(id, { tier, repoUrl: meta["repo_url"] });
        console.log(`[stripe] Session ${id} paid — tier: ${tier}`);
      }
    }

    res.json({ received: true });
  }
);

// GET /stripe/success — redirect page after Stripe Checkout
// Verifies payment, issues macaroon, returns auto-submit page
app.get("/stripe/success", async (req, res) => {
  const sessionId = req.query.session_id as string | undefined;
  const repoUrl   = req.query.repo_url   as string | undefined;

  if (!sessionId) {
    res.status(400).send("Missing session_id parameter.");
    return;
  }

  let tier: "basic" | "full" | "live" = "full";

  try {
    if (isStripeAvailable()) {
      const session = await getStripeSession(sessionId);
      const meta = (session["metadata"] ?? {}) as Record<string, string>;
      if (session["payment_status"] !== "paid") {
        res.status(402).send("<p>Payment not confirmed yet — please wait a moment and refresh.</p>");
        return;
      }
      tier = (meta["tier"] ?? "full") as typeof tier;
      const repoFromMeta = meta["repo_url"];
      const finalRepo    = repoUrl || repoFromMeta || "";

      // Register in stripeSessionStore (webhook may have already done this)
      if (!stripeSessionStore.has(sessionId)) {
        stripeSessionStore.set(sessionId, { tier, repoUrl: finalRepo });
      }

      // Return auto-submit page
      const safeRepo    = finalRepo.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const safeTier    = tier.replace(/</g, "&lt;");
      const safeSession = sessionId.replace(/</g, "&lt;");

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Analyzing… — Diagram Forge</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:#0D1117;color:#E6EDF3;font-family:'Inter',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px}
.check{width:72px;height:72px;border-radius:50%;background:rgba(34,197,94,.15);border:2px solid rgba(34,197,94,.4);display:flex;align-items:center;justify-content:center;font-size:32px;animation:pop .4s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
h2{font-size:22px;font-weight:800}
p{font-size:14px;color:#768390}
.bar{width:220px;height:3px;background:#1C2128;border-radius:3px;overflow:hidden}
.fill{height:100%;background:linear-gradient(90deg,#7C3AED,#A855F7);border-radius:3px;animation:prog 2.5s linear forwards}
@keyframes prog{from{width:0}to{width:100%}}
</style>
</head>
<body>
<div class="check">✓</div>
<h2>Payment confirmed!</h2>
<p id="status">Starting analysis…</p>
<div class="bar"><div class="fill"></div></div>
<script>
(async () => {
  const status = document.getElementById('status');
  try {
    status.textContent = 'Analyzing repository…';
    const r = await fetch('/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Stripe ${safeSession}',
      },
      body: JSON.stringify({ repo_url: '${safeRepo}', tier: '${safeTier}' }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      status.textContent = 'Error: ' + (d.message || d.error || r.status);
      return;
    }
    const d = await r.json();
    sessionStorage.setItem('df-graph', JSON.stringify(d.graph));
    status.textContent = 'Done! Redirecting…';
    setTimeout(() => { window.location.href = '/view?from=session'; }, 800);
  } catch (err) {
    status.textContent = 'Network error: ' + err.message;
  }
})();
</script>
</body>
</html>`);
    } else {
      // Stripe not configured (dev mode) — show macaroon page
      const macaroon = issueStripeMacaroon(sessionId, tier);
      res.json({ ok: true, macaroon, tier, message: "Stripe not configured — dev mode" });
    }
  } catch (err) {
    res.status(500).send("Stripe verification failed: " + (err instanceof Error ? err.message : String(err)));
  }
});

// ─── 1.5: Dev-only simulate payment — requires ENABLE_DEV_PAY=1 ─────────────
// Never exposed without explicit opt-in regardless of Lightning mode.

const DEV_PAY_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_PAY === "1";

if (DEV_PAY_ENABLED) {
  log.warn("/dev/pay endpoint enabled — DO NOT use in production");
  app.post("/dev/pay", (req, res) => {
    const { payment_hash } = req.body as { payment_hash?: string };
    if (!payment_hash) {
      res.status(400).json({ error: "payment_hash required" });
      return;
    }

    if (lightning instanceof MockLightningBackend) {
      const preimage = lightning.markPaid(payment_hash) ?? undefined;
      // Store preimage so /api/invoice-status can return it to the polling page
      invoiceStore.set(payment_hash, { paid: true, preimage });
      res.json({ ok: true, message: "Invoice marked as paid (mock mode)", preimage });
    } else {
      res.status(400).json({ error: "Only available in mock/dev mode" });
    }
  });
}

// ─── GitHub OAuth ────────────────────────────────────────────────────────────
// GET /auth/github        → redirect to GitHub
// GET /auth/github/callback → exchange code, return repo list to landing

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID     ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";
const GITHUB_REDIRECT_URI  = process.env.GITHUB_REDIRECT_URI  ?? "https://diagram-forge.onrender.com/auth/github/callback";

app.get("/auth/github", (_req, res) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(503).json({ error: "GitHub OAuth not configured" });
    return;
  }
  const params = new URLSearchParams({
    client_id:    GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope:        "repo",
    state:        crypto.randomBytes(8).toString("hex"),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/auth/github/callback", async (req, res) => {
  const code  = req.query.code  as string | undefined;
  const error = req.query.error as string | undefined;

  if (error || !code) {
    res.redirect(`/?gh_error=${encodeURIComponent(error ?? "cancelled")}`);
    return;
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri:  GITHUB_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      res.redirect(`/?gh_error=${encodeURIComponent(tokenData.error ?? "token_exchange_failed")}`);
      return;
    }

    // Fetch user repos (first 100, sorted by recent push)
    const reposRes = await fetch(
      "https://api.github.com/user/repos?sort=pushed&per_page=100&type=owner",
      { headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "diagram-forge" } }
    );
    const repos = await reposRes.json() as Array<{ full_name: string; private: boolean; pushed_at: string }>;

    const list = Array.isArray(repos)
      ? repos.map(r => ({ full_name: r.full_name, private: r.private, pushed_at: r.pushed_at }))
      : [];

    // Return a small page that posts repos to the opener and closes itself
    const safeList = JSON.stringify(list).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html>
<head><title>Connecting…</title></head>
<body>
<script>
try {
  window.opener.postMessage({ type: 'gh_repos', repos: ${safeList} }, '*');
} catch(e) {}
window.close();
</script>
<p>Closing…</p>
</body>
</html>`);
  } catch (err) {
    log.error({ err }, "github oauth error");
    res.redirect(`/?gh_error=server_error`);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const p = String(PORT).padEnd(5);
  console.log(`
╔══════════════════════════════════════════════════╗
║  ⚡  DIAGRAM FORGE  v0.1.0                       ║
║  AI-powered living architecture diagrams         ║
║  Paid via Lightning L402                         ║
╠══════════════════════════════════════════════════╣
║  🌐 Viewer:   http://localhost:${p}               ║
║               GET  /view?file=graph.json         ║
║               GET  /view          (demo mode)    ║
╠══════════════════════════════════════════════════╣
║  🔍 Analyze:  POST /analyze                      ║
║  🖼  SVG:      POST /diagram                     ║
║  🔀 Diff:     GET  /api/diff?a=v1&b=v2           ║
║  📊 Benchmark: GET  /api/benchmark?file=...      ║
║  📊 Graph:    GET  /api/graph?file=...           ║
║  💚 Health:   GET  /health                       ║
${DEV_PAY_ENABLED ? "║  🧪 Dev pay:  POST /dev/pay  (ENABLE_DEV_PAY=1)  ║\n" : ""}╚══════════════════════════════════════════════════╝
  `);
});

export default app;
