# Diagram Forge — Technical Reference

> Deep-dive architecture, API reference, security model, and deployment guide.  
> For the product overview see [README.md](README.md).

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Agent Loop](#agent-loop)
3. [Payment Protocol (L402)](#payment-protocol-l402)
4. [API Reference](#api-reference)
5. [MCP Tools](#mcp-tools)
6. [Security Model](#security-model)
7. [Data Model](#data-model)
8. [Benchmark Scoring](#benchmark-scoring)
9. [Architecture Diff](#architecture-diff)
10. [Configuration](#configuration)
11. [Deployment](#deployment)
12. [Testing](#testing)
13. [Cost Model](#cost-model)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│   landing.html   ·   index.html (viewer)   ·   payment.html    │
│   CLI (cli.ts)   ·   MCP server (mcp/server.ts)                │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / stdio
┌────────────────────────────▼────────────────────────────────────┐
│                       EXPRESS SERVER (server.ts)                │
│                                                                 │
│  POST /analyze ──► L402 middleware ──► analyzeProject()        │
│  GET  /api/diff                   ──► diffGraphs()             │
│  POST /api/benchmark              ──► benchmarkGraph()         │
│  POST /api/analyze-image          ──► Claude Vision            │
│  GET  /api/graph                  ──► file serve (GRAPHS_DIR)  │
│  POST /stripe/checkout            ──► Stripe SDK               │
│  POST /stripe/webhook             ──► raw body + sig verify    │
└──────────┬───────────────────────────────────┬──────────────────┘
           │                                   │
┌──────────▼──────────┐             ┌──────────▼──────────┐
│   ANALYZER LAYER    │             │   PAYMENT LAYER     │
│                     │             │                     │
│ agent.ts            │             │ l402.ts             │
│  └► filesystem.ts   │             │  └► lightning.ts    │
│      (5 tools)      │             │      (LNbits/Mock)  │
│                     │             │ stripe.ts           │
│ diff.ts             │             │  └► Stripe SDK      │
│ benchmark.ts        │             └─────────────────────┘
│ clone.ts            │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│   STORAGE (files)   │
│                     │
│ data/graphs/*.json  │
│ (graph cache +      │
│  shared diagrams)   │
└─────────────────────┘
```

---

## Agent Loop

The core analysis engine is an **agentic Claude loop** in `src/analyzer/agent.ts`.

### Iterations by tier

| Tier | Max iterations | Deadline at |
|------|---------------|-------------|
| basic | 8 | 70% (step 5) |
| full | 12 | 70% (step 8) |
| live | 12 | 70% (step 8) |

### Tool sequence (typical)

```
1. detect_entry_points()
   → finds package.json, Dockerfile, pyproject.toml, go.mod…

2. list_directory(".", depth=2)
   → maps top-level structure

3. read_file("package.json")
   read_file("docker-compose.yml")
   read_file("src/config.ts")
   → extracts service names, ports, env vars

4. search_pattern("DATABASE_URL|REDIS_URL|KAFKA_BROKERS", "**/*.{ts,py,go}")
   search_pattern("new Redis|createClient|Pool", "**/*.ts")
   → traces data store connections

5. search_pattern("fetch|axios|httpClient|requests.get", "**/*.ts")
   → maps external API calls

6. finish_analysis(nodes, edges, summary, tech_stack, confidence)
   → returns ArchitectureGraph
```

### Prompt caching

The system prompt (tool definitions + instructions) is sent with `cache_control: { type: "ephemeral" }`. On repeated calls the cache hit rate is ~85%, reducing cost significantly.

```typescript
messages: [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },  // ← cached
      },
      { type: "text", text: `Analyze: ${projectRoot}` },
    ],
  },
]
```

---

## Payment Protocol (L402)

L402 is an HTTP 402-based micropayment protocol using the Lightning Network.

### Flow

```
Client                          Server                    Lightning Node
  │                               │                             │
  │  POST /analyze {repo_url}     │                             │
  │ ──────────────────────────►  │                             │
  │                               │  createInvoice(10,000 sats) │
  │                               │ ──────────────────────────► │
  │                               │ ◄────────────────────────── │
  │  402 + invoice + macaroon     │   payment_hash + bolt11     │
  │ ◄──────────────────────────  │                             │
  │                               │                             │
  │  [pays invoice via wallet]    │                             │
  │                               │                             │
  │  POST /analyze                │                             │
  │  Authorization: L402          │                             │
  │    <macaroon>:<preimage>      │                             │
  │ ──────────────────────────►  │                             │
  │                               │  verifyPreimage()           │
  │                               │  SHA256(preimage)==hash ✓  │
  │                               │  checkPaid(hash) ✓         │
  │  200 + graph                  │                             │
  │ ◄──────────────────────────  │                             │
```

### Macaroon structure

```
payload  = base64url( JSON({ payment_hash, expires_at, tier, sats }) )
sig      = HMAC-SHA256( MACAROON_SECRET, payload )
macaroon = payload + "." + sig
```

Verification uses `crypto.timingSafeEqual` to prevent timing attacks.

### Preimage verification

```typescript
// SHA256(preimage_bytes) must equal payment_hash
const hash = crypto.createHash("sha256")
  .update(Buffer.from(preimage, "hex"))
  .digest("hex");
return hash === payment_hash;
```

---

## API Reference

### `GET /health`

```json
{
  "status": "ok",
  "service": "diagram-forge",
  "version": "0.1.0",
  "tiers": { "basic": 2000, "full": 10000, "live": 25000 },
  "lightning_backend": "lnbits" | "mock"
}
```

---

### `POST /analyze`

Requires L402 payment.

**Request:**
```json
{
  "repo_url": "https://github.com/org/repo",
  "tier": "basic" | "full" | "live"
}
```

**Response (200):**
```json
{
  "ok": true,
  "tier": "full",
  "graph": { /* ArchitectureGraph */ },
  "paid_sats": 10000,
  "cached": false
}
```

**Without payment → 402:**
```json
{
  "error": "payment_required",
  "invoice": "lnbc500n1...",
  "payment_hash": "abc123...",
  "amount_sats": 10000,
  "expires_at": 1700000600
}
```
Headers: `WWW-Authenticate: L402 macaroon="...", invoice="lnbc..."`

---

### `POST /api/analyze-image`

No payment gate. Rate limited to 5/IP/day in production.

**Request:**
```json
{
  "image_base64": "<base64-encoded image>",
  "media_type": "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf",
  "hint": "This is a microservices diagram for a fintech app"
}
```

**Response (200):**
```json
{
  "ok": true,
  "graph": { /* ArchitectureGraph */ },
  "filename": "image-1700000000000.json",
  "view_url": "/view?file=image-1700000000000.json"
}
```

Image size limits (production, tier-aware):
- basic: 4 MB
- full: 8 MB
- live: 12 MB

---

### `GET /api/diff`

```
GET /api/diff?a=v1.json&b=v2.json&format=json|markdown
```

**Response (200, format=json):**
```json
{
  "summary": {
    "severity": "major" | "minor" | "none",
    "nodes_added": 2,
    "nodes_removed": 0,
    "nodes_changed": 1,
    "edges_added": 3,
    "edges_removed": 1,
    "old_nodes": 8,
    "new_nodes": 10,
    "confidence_old": 85,
    "confidence_new": 90,
    "confidence_delta": 5
  },
  "added_nodes": [ /* Node[] */ ],
  "removed_nodes": [ /* Node[] */ ],
  "changed_nodes": [ /* { node, change }[] */ ],
  "added_edges": [ /* EdgeDiff[] */ ],
  "removed_edges": [ /* EdgeDiff[] */ ],
  "added_patterns": ["Event-Driven", "Cache Layer"],
  "removed_patterns": []
}
```

---

### `POST /api/benchmark`

**Request:**
```json
{
  "graph": { /* ArchitectureGraph */ },
  "cost_context": { "PostgreSQL": 200, "Redis": 50 },
  "format": "json" | "markdown"
}
```

**Response (200):**
```json
{
  "overall": 72,
  "grade": "B",
  "dimensions": {
    "resilience":     { "score": 68, "weight": 25, "evidence": [...] },
    "observability":  { "score": 40, "weight": 20, "evidence": [...] },
    "security":       { "score": 75, "weight": 20, "evidence": [...] },
    "scalability":    { "score": 80, "weight": 20, "evidence": [...] },
    "simplicity":     { "score": 90, "weight": 10, "evidence": [...] },
    "async_coverage": { "score": 60, "weight": 5,  "evidence": [...] }
  },
  "calibration": {
    "percentile": 65,
    "reference_scores": [ /* comparison to microservices/monolith/serverless */ ]
  },
  "cost": { /* only if cost_context provided */
    "total_monthly_usd": 250,
    "entries": [...],
    "concentration_pct": 80,
    "spof_spend_pct": 30
  }
}
```

---

### `GET /api/graph`

```
GET /api/graph?file=my-graph.json
```

Serves graph JSON from `data/graphs/`. Path traversal blocked — only bare filenames allowed.

---

### `POST /stripe/checkout`

```json
{ "tier": "full", "repo_url": "https://github.com/org/repo" }
```

Returns: `{ "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }`

---

## MCP Tools

Run the MCP server: `npm run mcp`

Configure in `mcp.json`:
```json
{
  "mcpServers": {
    "diagram-forge": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"]
    }
  }
}
```

### `analyze_architecture`

```
Input:  file_path (string), tier ("basic"|"full"|"live")
Output: ArchitectureGraph JSON + saved filename
```

### `diff_architectures`

```
Input:  graph_a (ArchitectureGraph | filename),
        graph_b (ArchitectureGraph | filename),
        output_format ("json"|"markdown"|"both")
Output: ArchDiff JSON and/or Markdown report
```

### `analyze_from_image`

```
Input:  image_path (string), hint? (string)
Output: ArchitectureGraph JSON + saved filename
```

### `get_diagram_url`

```
Input:  filename (string)
Output: { url: "http://localhost:3000/view?file=..." }
```

### `benchmark_architecture`

```
Input:  graph (ArchitectureGraph), cost_context? (Record<string, number>),
        output_format ("json"|"markdown"|"both")
Output: BenchmarkResult
```

---

## Security Model

### Path traversal (Fix 1)

All file inputs go through `resolveGraphFile()`:
```typescript
function resolveGraphFile(input: string): string | null {
  if (!input || /[/\\]/.test(input) || input.includes("..")) return null;
  if (!/^[\w.-]+\.json$/.test(name)) return null;
  const resolved = path.join(GRAPHS_DIR, name);
  if (!resolved.startsWith(GRAPHS_DIR + path.sep)) return null;
  return resolved;
}
```

### SSRF prevention (Fix 2)

`repo_path` blocked in production (`LNBITS_URL` set). Remote URLs validated by `clone.ts` to only allow HTTPS GitHub/GitLab/Bitbucket.

### Symlink traversal (Fix 3)

`assertWithinRoot()` in `filesystem.ts` uses `lstatSync` (doesn't follow links) to detect symlinks, then `realpathSync` to resolve and re-validate against project root.

### Body size limits (Fix 4)

- Global JSON limit: `2mb`
- `/api/analyze-image`: own middleware at `12mb`, tier-aware at handler level

### Security headers (Fix 5)

Applied globally:
```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'...
Strict-Transport-Security: (production only)
```

### Rate limits (production only, when `LNBITS_URL` set)

| Endpoint | Limit |
|----------|-------|
| `/api/explain` | 7 / IP / day |
| `/analyze` | 3 / IP / day |
| `/api/analyze-image` | 5 / IP / day |

---

## Data Model

### ArchitectureGraph

```typescript
interface ArchitectureGraph {
  nodes: Node[];
  edges: Edge[];
  summary: string;
  tech_stack: string[];
  confidence: number;        // 0.0–1.0
  analysis_steps: number;
}

interface Node {
  id: string;                // lowercase_snake_case
  label: string;             // human-readable name
  type: NodeType;            // "frontend" | "backend" | "database" | "cache" |
                             //  "queue" | "storage" | "auth" | "gateway" |
                             //  "external_api" | "ml_model" | "worker" |
                             //  "cdn" | "monitoring" | "other"
  technology: string;        // "Next.js", "PostgreSQL", "Redis"…
  description?: string;
  metadata?: Record<string, unknown>;
}

interface Edge {
  from: string;              // source node id
  to: string;                // target node id
  protocol: Protocol;        // "HTTP" | "HTTPS" | "SQL" | "Redis" |
                             //  "gRPC" | "AMQP" | "WebSocket" | "GraphQL" |
                             //  "tRPC" | "Lightning" | "TCP" | "Unknown"
  direction: "unidirectional" | "bidirectional";
  async: boolean;
  label?: string;
}
```

### MacaroonPayload

```typescript
interface MacaroonPayload {
  payment_hash: string;
  expires_at: number;        // Unix seconds
  tier: "basic" | "full" | "live";
  sats: number;
}
```

---

## Benchmark Scoring

### Dimensions and weights

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| Resilience | 25% | SPOFs, redundancy, circuit breakers, monitoring presence |
| Observability | 20% | Monitoring nodes, async logging coverage |
| Security | 20% | Auth, API gateway, encrypted protocols |
| Scalability | 20% | Stateless design, CDN, queues, workers, caches |
| Simplicity | 10% | Node count bracket, edge density |
| Async Coverage | 5% | % of edges using async protocols |

### Severity thresholds

- **Major change:** ≥ 2 nodes removed OR ≥ 3 nodes added
- **Minor change:** any addition/removal/change
- **None:** identical graphs

### Architecture patterns detected

Event-Driven · API Gateway · Worker Pool (2+ workers) · Cache Layer · Polyglot Persistence (2+ DBs) · gRPC Services · Microservices (3+ backends) · Observability Layer · ML/AI Pipeline · CDN/Edge

---

## Configuration

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Lightning (production)
LNBITS_URL=https://your-lnbits.com
LNBITS_API_KEY=your-invoice-key
MACAROON_SECRET=$(openssl rand -hex 32)

# Stripe (optional — card payments)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Server
PORT=3000
CLAUDE_MODEL=claude-haiku-4-5-20251001   # optional override
```

---

## Deployment

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

```bash
docker build -t diagram-forge .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e LNBITS_URL=https://... \
  -e LNBITS_API_KEY=... \
  -e MACAROON_SECRET=... \
  diagram-forge
```

### Railway / Fly.io

```bash
# Railway
railway up

# Fly.io
fly launch
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

### Known production gaps (pre-launch checklist)

- [ ] Persist `invoiceStore` to Redis/SQLite (lost on restart)
- [ ] Multi-instance rate limiter (Redis backend)
- [ ] Graceful shutdown (drain in-flight analyses)
- [ ] Webhook endpoint registered in production Stripe dashboard
- [ ] LNbits instance configured with your node

---

## Testing

```bash
# All tests (requires server running on localhost:3000)
npm test

# Unit tests only (no server needed)
npm run test:unit

# Smoke tests only
npm run test:smoke

# Watch mode
npm run test:watch
```

### Test coverage

| Suite | Tests | Type |
|-------|-------|------|
| `unit/benchmark.test.ts` | 69 | Unit |
| `unit/diff.test.ts` | 36 | Unit |
| `unit/rate-limiter.test.ts` | 7 | Unit |
| `smoke.test.ts` | 33 | E2E smoke |
| **Total** | **145** | |

Smoke tests cover: health, static pages, graph/diff/benchmark APIs, analyze-image validation, L402 gate, path traversal prevention (5 attack vectors), security headers, body size enforcement.

---

## Cost Model

### Claude API (Haiku 4.5)

| | Rate |
|---|---|
| Input tokens | $0.80 / 1M |
| Output tokens | $4.00 / 1M |
| Cache read | $0.08 / 1M |

**Typical analysis cost:**
- ~20K input tokens (system prompt + tool results)
- ~3K output tokens (tool calls + final graph)
- ~15K cached tokens (85% cache hit rate on system prompt)
- **Total: ~$0.028 per full analysis**

### Revenue per analysis

| Tier | Revenue | Claude cost | Net |
|------|---------|-------------|-----|
| Lightning basic (2,000 sats) | ~$2.00 | $0.02 | **$1.98** |
| Lightning full (10,000 sats) | ~$10.00 | $0.03 | **$9.97** |
| Lightning live (25,000 sats) | ~$25.00 | $0.03 | **$24.97** |
| Stripe full ($15) | $14.27* | $0.03 | **$14.24** |
| Stripe live ($39) | $37.56* | $0.03 | **$37.53** |

*After Stripe fees (2.9% + $0.30)

---

## Recording Demo GIFs

The viewer has a built-in recorder (⏺ button in the toolbar). To convert to GIF:

```bash
# Install ffmpeg
brew install ffmpeg   # macOS
choco install ffmpeg  # Windows

# Convert WebM to GIF
ffmpeg -i recording.webm \
  -vf "fps=15,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 docs/demo-analyze.gif
```

Place GIFs in `docs/`:
- `docs/demo-analyze.gif` — full analysis flow
- `docs/demo-viewer.gif` — viewer interactions
- `docs/demo-image.gif` — image import
- `docs/demo-benchmark.gif` — benchmark scoring

---

*Diagram Forge · MIT License · [ShinyDapps](https://shinydapps.com)*
