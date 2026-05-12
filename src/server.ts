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
import { hasTrial, setTrial, getIdem, setIdemRunning, setIdemDone, deleteIdem, startStoreCleanup } from "./db/stores.js";
import rateLimit from "express-rate-limit";

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
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
// Serve demo GIFs and docs assets for the landing page
app.use("/docs", express.static(path.resolve(process.cwd(), "docs"), { maxAge: "1h" }));

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

// ─── 3.2: Rate limiting (in-memory, resets on restart) ───────────────────────
const perMinuteLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many requests. Please slow down." },
});
const perDayLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Daily limit reached. Try again tomorrow." },
});
app.use("/analyze", perMinuteLimiter, perDayLimiter);
app.use("/diagram", perMinuteLimiter);
app.use("/api/", perMinuteLimiter);

// ─── Request type with L402 attached ─────────────────────────────────────────

type AuthedRequest = express.Request & {
  l402?: { payment_hash: string; expires_at: number; tier: string; sats: number };
  _prefetchedSha?: string | null;
  _prefetchedGraph?: unknown;
};

// ─── P-3: Cache-bypass store — deduplicate SHA lookups across middlewares ─────
// Nothing persisted here; the SHA is attached to the request object instead.

// ─── In-memory invoice store (hash → preimage, for mock polling) ─────────────
// Dev/mock only — production uses Lightning wallet for preimage delivery.
const invoiceStore = new Map<string, { paid: boolean; preimage?: string }>();

// ─── Stripe paid sessions (sessionId → tier) ──────────────────────────────────
// Populated by the Stripe webhook; consumed once by /analyze.
const stripeSessionStore = new Map<string, { tier: "basic" | "full" | "live" }>();

const IDEM_TTL_MS = 2 * 60 * 60 * 1000; // 2h for completed results

// Start persistent store cleanup (preimage_claims + idem_store expiry)
startStoreCleanup();

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
    idem_store: "supabase",
  });
});

// Pricing info
app.get("/pricing", (_req, res) => {
  res.json({
    tiers: {
      basic: {
        description: "First look — top 10 files, main services detected. Free on first use per IP.",
        lightning_sats: PRICE_SATS.basic,
        card_usd: "12.00",
        features: ["Architecture diagram", "Node inspect", "80+ tech logos", "Export SVG/PNG"],
        excludes: ["Benchmark score", "Diff engine", "Persistent share link"],
        first_use: "free",
      },
      full: {
        description: "Complete repo — all services, connections, monorepos, data pipelines.",
        lightning_sats: PRICE_SATS.full,
        card_usd: "29.00",
        features: ["Everything in Basic", "Full codebase scan", "Architecture benchmark (6 dimensions)", "Diff engine (compare snapshots)", "Persistent share link (/g/:id)"],
        excludes: [],
      },
      live: {
        description: "Full analysis + animated particle flows for teams and presentations.",
        lightning_sats: PRICE_SATS.live,
        card_usd: "69.00",
        features: ["Everything in Full", "Animated SVG particle flows", "Protocol-colored edges", "Minimap + pan/zoom"],
        excludes: [],
      },
    },
    trial: "Basic tier is free on first analysis per IP. Revisiting the same repo (same commit SHA) is always free.",
    note: "Lightning prices are lower — no credit card processing fees.",
    lightning_protocol: "L402 (HTTP 402 + Lightning Network)",
    card_processor: "Stripe",
  });
});

// Saves graph to Supabase and, as a fallback, to the local GRAPHS_DIR so that
// /api/diff and /g/:id can resolve the file even when Supabase is not configured.
async function persistShare(viewId: string, graph: Record<string, unknown>): Promise<void> {
  const payload = { ...graph, _shared_at: new Date().toISOString() };
  await saveShare(viewId, payload as Parameters<typeof saveShare>[1]).catch(() => {});
  // Local fallback — always write so resolveGraphFile() can find it for /api/diff
  try {
    fs.mkdirSync(GRAPHS_DIR, { recursive: true });
    fs.writeFileSync(path.join(GRAPHS_DIR, `${viewId}.json`), JSON.stringify(payload), "utf-8");
  } catch { /* non-critical */ }
}

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
          payment_hash: `promo_${code.toUpperCase()}_${crypto.randomBytes(8).toString("hex")}`,
          expires_at: Math.floor(Date.now() / 1000) + 7200,
          tier,
          sats: 0,
        };
        log.info({ code_hash: crypto.createHash("sha256").update(code).digest("hex").slice(0, 12), tier }, "promo code redeemed");
        track("promo_redeemed", { tier, ip: req.ip });
      } else {
        // Return 402 with promo_error so the landing can show a specific message
        res.status(402).json({ error: "promo_invalid", promo_error: result.reason });
        return;
      }
    }
    next();
  },
  // ── P-3: Cache bypass — if same SHA already analyzed, skip payment ─────────
  async (req: AuthedRequest, _res, next) => {
    if (req.l402) return next(); // already authed
    const repoUrl = req.body?.repo_url as string | undefined;
    if (!repoUrl) return next();
    try {
      const sha = getRemoteSha(repoUrl);
      req._prefetchedSha = sha;
      if (sha) {
        const cached = getCachedGraph(repoUrl, sha);
        if (cached) {
          req._prefetchedGraph = cached;
          req.l402 = {
            payment_hash: `cache_${sha.slice(0, 16)}`,
            expires_at:   Math.floor(Date.now() / 1000) + 3600,
            tier:         (req.body?.tier as string) ?? "full",
            sats:         0,
          };
          log.info({ repo: repoUrl, sha: sha.slice(0, 8) }, "cache bypass — no payment needed");
          track("cache_hit", { tier: req.body?.tier, ip: req.ip, repoUrl });
        }
      }
    } catch { /* non-critical — let normal flow handle it */ }
    next();
  },
  // ── P-1: Free trial — one basic analysis per IP (first-time users) ──────────
  async (req: AuthedRequest, _res, next) => {
    if (req.l402) return next(); // already authed
    const tier = (req.body?.tier as "basic" | "full" | "live") ?? "basic";
    if (tier !== "basic") return next(); // trial only on basic
    const ip = req.ip ?? "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
    if (!(await hasTrial(ipHash))) {
      await setTrial(ipHash);
      req.l402 = {
        payment_hash: `trial_${ipHash.slice(0, 16)}_${crypto.randomBytes(4).toString("hex")}`,
        expires_at:   Math.floor(Date.now() / 1000) + 3600,
        tier:         "basic",
        sats:         0,
      };
      log.info({ ip_hash: ipHash.slice(0, 12) }, "free trial granted");
      track("trial_granted", { tier: "basic", ip });
    }
    next();
  },
  (req: AuthedRequest, res, next) => {
    // If already authenticated via Stripe, promo, cache-bypass, or trial, skip L402 gate
    if ((req as AuthedRequest).l402) return next();
    const tier = (req.body?.tier as "basic" | "full" | "live") ?? "full";
    if (isProductionLightning()) {
      return kitL402({ priceSats: PRICE_SATS[tier], lightning: managedProvider })(req, res, next);
    }
    return mockL402({ lightning, tier, memo: "Diagram Forge — repo analysis" })(req, res, next);
  },
  async (req: AuthedRequest, res) => {
    // Rate limit only free requests (trial + cache bypass).
    // Promo codes, real L402 payments, and Stripe bypass this limit.
    const isFreeRequest = req.l402 &&
      (req.l402.payment_hash.startsWith("trial_") || req.l402.payment_hash.startsWith("cache_"));
    if (isProductionLightning() && isFreeRequest) {
      const ip = req.ip ?? "unknown";
      const { ok, remaining } = analyzeAllowed(ip);
      if (!ok) {
        res.status(429).json({
          error: "daily_limit_reached",
          message: "Free analysis limit reached for today. Use a promo code or pay via Lightning.",
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
      const existing = await getIdem(idemStoreKey);
      if (existing) {
        if (existing.status === "running") {
          res.status(409).json({ error: "duplicate_request", message: "Analysis already in progress for this idempotency key." });
          return;
        }
        if (existing.status === "done") {
          res.json(existing.result);
          return;
        }
      }
      await setIdemRunning(idemStoreKey, Date.now() + IDEM_TTL_MS);
    }

    let cloneCleanup: (() => void) | null = null;
    let absPath: string;
    const timer = analyzeDuration.startTimer({ tier });

    try {
      // ── Cache check — use prefetched result from cache-bypass middleware if available ──
      const identifier = repo_url ?? repo_path!;

      // P-3: if cache-bypass middleware already found the cached graph, return immediately
      if (req._prefetchedGraph) {
        const viewId = crypto.randomBytes(4).toString("hex");
        await persistShare(viewId, req._prefetchedGraph);
        const result = { ok: true, id: viewId, tier, graph: req._prefetchedGraph, paid_sats: 0, cached: true };
        if (idemStoreKey) await setIdemDone(idemStoreKey, result, Date.now() + IDEM_TTL_MS);
        timer({ status: "cached" });
        analyzeRequests.inc({ status: "cached", tier });
        res.json(result);
        return;
      }

      const sha = req._prefetchedSha !== undefined
        ? req._prefetchedSha
        : repo_url
          ? getRemoteSha(repo_url)
          : getLocalSha(path.resolve(repo_path!));

      if (sha) {
        const cached = getCachedGraph(identifier, sha);
        if (cached) {
          log.info({ identifier, sha: sha.slice(0, 8) }, "cache hit");
          const viewId = crypto.randomBytes(4).toString("hex");
          await persistShare(viewId, cached);
          const result = { ok: true, id: viewId, tier, graph: cached, paid_sats: PRICE_SATS[tier], cached: true };
          if (idemStoreKey) await setIdemDone(idemStoreKey, result, Date.now() + IDEM_TTL_MS);
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

      // ── SSE: open stream before the agent loop starts ─────────────────────
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // disable nginx/Fly.io proxy buffering
      res.flushHeaders();

      const sseWrite = (payload: unknown) => {
        try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* client disconnected */ }
      };

      const graph = await analyzeProject(absPath, {
        tier,
        onProgress: (msg) => log.info(msg),
        onProgressEvent: sseWrite,
        onTokenUsage: (inTok, outTok) => {
          analyzeTokensIn.inc(inTok);
          analyzeTokensOut.inc(outTok);
          log.info({ input_tokens: inTok, output_tokens: outTok }, "token usage");
        },
      });

      if (sha) setCachedGraph(identifier, sha, graph);

      const tierFeatures = {
        benchmark: tier !== "basic",
        diff: tier !== "basic",
        share_link: tier !== "basic",
        animated: tier === "live",
      };
      const viewId = crypto.randomBytes(4).toString("hex");
      await persistShare(viewId, graph as Record<string, unknown>);
      const result = { ok: true, id: viewId, tier, graph, paid_sats: PRICE_SATS[tier], tier_features: tierFeatures, viewerUrl: `/view?file=${viewId}` };
      if (idemStoreKey) await setIdemDone(idemStoreKey, result, Date.now() + IDEM_TTL_MS);
      timer({ status: "success" });
      analyzeRequests.inc({ status: "success", tier });
      track("analyze_completed", { tier, ip: req.ip, repoUrl: repo_url, meta: { nodes: graph.nodes.length, edges: graph.edges.length } });
      sseWrite({ type: "result", ...result });
      res.end();
    } catch (err) {
      log.error({ err }, "analysis error");
      timer({ status: "error" });
      analyzeRequests.inc({ status: "error", tier });
      track("analyze_error", { tier, ip: req.ip, repoUrl: repo_url });
      if (idemStoreKey) await deleteIdem(idemStoreKey); // allow retry on error
      // If SSE headers already sent, send error as SSE event; otherwise fall back to JSON
      const clientMsg = err instanceof Error && err.message.startsWith("REPO_")
        ? err.message
        : "Analysis failed. Please try again or contact support.";
      if (res.headersSent) {
        try { res.write(`data: ${JSON.stringify({ type: "error", message: clientMsg })}\n\n`); } catch { /* ignore */ }
        res.end();
      } else {
        res.status(500).json({ error: "analysis_failed", message: clientMsg });
      }
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
    if (isProductionLightning()) {
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
      log.error({ err }, "render failed");
      res.status(500).json({ error: "render_failed", message: "Diagram render failed." });
    }
  }
);

// ─── GET /diagram/preview — render from saved graph file (dev shortcut) ───────

app.get("/diagram/preview", (req, res) => {
  const absPath = resolveGraphFile((req.query.file as string) ?? "graph.json");

  if (!absPath || !fs.existsSync(absPath)) {
    res.status(404).send("File not found");
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
      // Return preimage only in dev/mock mode — in production the client's
      // Lightning wallet holds the preimage; exposing it here would allow
      // anyone who intercepted the payment_hash to steal the L402 credential.
      const preimage = !isProductionLightning()
        ? (invoiceStore.get(hash)?.preimage ?? null)
        : null;
      res.json({ paid: true, preimage });
    } else {
      res.json({ paid: false });
    }
  } catch {
    res.status(503).json({ error: "lightning_unavailable" });
  }
});

import { saveShare, getShare } from "./db/shares.js";
import { redeemPromo } from "./db/promo.js";
import { track } from "./db/analytics.js";
import { supabase } from "./db/supabase.js";

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
  const { graph, tier } = req.body as { graph?: ArchitectureGraph; tier?: string };
  if (!graph || !Array.isArray(graph.nodes)) {
    res.status(400).json({ error: "invalid_graph" });
    return;
  }
  // Share links are a Full/Live feature — not available on Basic tier
  if (tier === "basic") {
    res.status(403).json({
      error: "tier_required",
      message: "Share links require Full or Live tier. Upgrade to share your diagram.",
      upgrade_url: "/pricing",
    });
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

  track("share_created", { tier, ip: req.ip });
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
  track("share_viewed", { ip: req.ip, meta: { share_id: id } });

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
    const absPath = resolveGraphFile(req.query.file as string);
    if (absPath && fs.existsSync(absPath)) {
      try { graph = JSON.parse(fs.readFileSync(absPath, "utf-8")); } catch { /* use demo */ }
    }
  }

  // Inject graph data as JS variable before closing </script>
  const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const injection = graph
    ? `\n  window.__GRAPH_DATA__ = ${safeJson(graph)};\n`
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
  if (isProductionLightning() && !diffAllowed(req.ip ?? "")) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests. Try again tomorrow." });
    return;
  }
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

  if (!graphA) { res.status(404).json({ error: "graph_not_found", param: "a" }); return; }
  if (!graphB) { res.status(404).json({ error: "graph_not_found", param: "b" }); return; }

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
  if (isProductionLightning() && !benchmarkAllowed(req.ip ?? "")) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests. Try again tomorrow." });
    return;
  }
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

  let costContext: Record<string, number> | undefined;
  if (req.query.cost) {
    try {
      const parsed = JSON.parse(req.query.cost as string);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        costContext = parsed as Record<string, number>;
      }
    } catch { /* ignore malformed cost param */ }
  }
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
    log.error({ err }, "graph read failed");
    res.status(500).json({ error: "graph_read_failed" });
  }
});

// 4.2: Prometheus metrics endpoint — always requires token
app.get("/metrics", async (req, res) => {
  const token = process.env.METRICS_TOKEN;
  const provided = String(req.query.token ?? "");
  const validMetrics = !!token && provided.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  if (!validMetrics) {
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
const diffAllowed     = makeRateLimiter(20);  // 20/IP/day — no payment but CPU-bounded
const benchmarkAllowed = makeRateLimiter(20); // 20/IP/day
const checkoutAllowed = makeRateLimiter(10);  // 10 Stripe checkout attempts/IP/day

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
    const block = msg.content[0] as { type: string; text?: string } | undefined;
    const text = block?.type === "text" && block.text ? block.text : "";
    if (!text) { res.status(500).json({ error: "empty_response" }); return; }
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
  if (isProductionLightning() && !checkoutAllowed(req.ip ?? "")) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests. Try again tomorrow." });
    return;
  }
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
    track("stripe_checkout", { tier: safeTier, ip: req.ip, repoUrl: repo_url });
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
        stripeSessionStore.set(id, { tier });
        track("stripe_paid", { tier });
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
        stripeSessionStore.set(sessionId, { tier });
      }

      // Return auto-submit page — embed values as JSON object (safe in JS context)
      const pageData = JSON.stringify({ repo_url: finalRepo, tier, session: sessionId });

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
const __d = ${pageData};
(async () => {
  const status = document.getElementById('status');
  try {
    status.textContent = 'Analyzing repository…';
    const r = await fetch('/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Stripe ' + __d.session,
      },
      body: JSON.stringify({ repo_url: __d.repo_url, tier: __d.tier }),
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
    status.textContent = 'Network error: ' + (err instanceof Error ? err.message : String(err));
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

// CSRF protection: store valid states for 10 minutes
const oauthStateStore = new Map<string, number>();
// VS Code-initiated OAuth states — these redirect to vscode:// instead of the web popup
const vsCodeOauthStates = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [s, exp] of oauthStateStore) if (exp < now) oauthStateStore.delete(s);
  for (const [s, exp] of vsCodeOauthStates) if (exp < now) vsCodeOauthStates.delete(s);
}, 60_000).unref();

app.get("/auth/github", (_req, res) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(503).json({ error: "GitHub OAuth not configured" });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  oauthStateStore.set(state, Date.now() + 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id:    GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope:        "public_repo",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// VS Code extension OAuth entry point — redirects back to vscode:// URI after auth
app.get("/auth/github/vscode", (_req, res) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(503).json({ error: "GitHub OAuth not configured" });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  vsCodeOauthStates.set(state, Date.now() + 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id:    GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope:        "public_repo",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/auth/github/callback", async (req, res) => {
  const code  = req.query.code  as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;

  if (error || !code) {
    res.redirect(`/?gh_error=${encodeURIComponent(error ?? "cancelled")}`);
    return;
  }

  // CSRF check: state must have been issued by /auth/github and not expired
  if (!state || !oauthStateStore.has(state)) {
    res.redirect(`/?gh_error=invalid_state`);
    return;
  }
  oauthStateStore.delete(state); // one-time use

  try {
    const ghTimeout = (ms: number) => AbortSignal.timeout(ms);

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
      signal: ghTimeout(10_000),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      res.redirect(`/?gh_error=${encodeURIComponent(tokenData.error ?? "token_exchange_failed")}`);
      return;
    }

    // VS Code extension flow: redirect back to vscode:// URI with the token
    if (vsCodeOauthStates.has(state!)) {
      vsCodeOauthStates.delete(state!);
      res.redirect(`vscode://ShinyDapps.diagram-forge/auth/github?token=${encodeURIComponent(tokenData.access_token)}`);
      return;
    }

    // Fetch user repos (first 100, sorted by recent push)
    const reposRes = await fetch(
      "https://api.github.com/user/repos?sort=pushed&per_page=100&type=owner",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "diagram-forge" },
        signal: ghTimeout(10_000),
      }
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

// ─── GET /api/admin/stats — funnel analytics ─────────────────────────────────

app.get("/api/admin/stats", async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  const provided = String(req.headers["x-admin-secret"] ?? "");
  const valid = !!secret && provided.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!valid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!supabase) {
    res.status(503).json({ error: "supabase_unavailable" });
    return;
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // last 30 days

  const [byEvent, byTier, daily] = await Promise.all([
    supabase.from("events").select("event, count", { count: "exact", head: false })
      .gte("created_at", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        const counts: Record<string, number> = {};
        (data ?? []).forEach((r) => {
          const ev = r["event"] as string;
          counts[ev] = (counts[ev] ?? 0) + 1;
        });
        return counts;
      }),
    supabase.from("events").select("tier, event")
      .eq("event", "analyze_completed")
      .gte("created_at", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        const counts: Record<string, number> = {};
        (data ?? []).forEach((r) => {
          const t = (r["tier"] as string) ?? "unknown";
          counts[t] = (counts[t] ?? 0) + 1;
        });
        return counts;
      }),
    supabase.from("events").select("created_at, event")
      .gte("created_at", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        const counts: Record<string, number> = {};
        (data ?? []).forEach((r) => {
          const day = (r["created_at"] as string).slice(0, 10);
          counts[day] = (counts[day] ?? 0) + 1;
        });
        return counts;
      }),
  ]);

  const trials = byEvent["trial_granted"] ?? 0;
  const completed = byEvent["analyze_completed"] ?? 0;
  const stripePaid = byEvent["stripe_paid"] ?? 0;

  res.json({
    period: "last_30_days",
    by_event: byEvent,
    analyze_by_tier: byTier,
    daily_events: daily,
    funnel: {
      trials,
      completed,
      stripe_paid: stripePaid,
      trial_to_complete_pct: trials ? ((completed / trials) * 100).toFixed(1) + "%" : "n/a",
    },
  });
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

process.on("SIGTERM", () => {
  log.info("SIGTERM received — shutting down gracefully");
  process.exit(0);
});

export default app;
