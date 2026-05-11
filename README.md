# ⚡ Diagram Forge

> **Your repo → living architecture diagram in seconds.**  
> Powered by Claude AI · Paid via Lightning L402 · No sign-up required.

<p align="center">
  <img src="docs/demo-analyze.gif" alt="Diagram Forge demo — repo analysis to interactive diagram" width="720"/>
</p>

<p align="center">
  <a href="https://github.com/ThiagoDataEngineer/diagram-forge/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-7C3AED" alt="License"/></a>
  <img src="https://img.shields.io/badge/powered_by-Claude_AI-A855F7" alt="Claude AI"/>
  <img src="https://img.shields.io/badge/payments-Lightning_L402-F59E0B" alt="Lightning L402"/>
  <img src="https://img.shields.io/badge/polyglot-15%2B_stacks-22C55E" alt="Polyglot"/>
  <img src="https://img.shields.io/badge/tests-0_1_5_passing-22C55E" alt="Tests"/>
</p>

---

## What it does

Diagram Forge points at any GitHub repository (or local path, or an image of a whiteboard) and returns a **living, interactive architecture diagram** — complete with animated data-flow particles, node inspection, benchmarking, and exports to every format you need.

No account. No monthly subscription. Pay per analysis with a Lightning wallet.

**Live:** [forge.l402kit.com](https://forge.l402kit.com)

---

## Demo

### Analyze a GitHub repo

<p align="center">
  <img src="docs/demo-analyze.gif" alt="Analyzing a GitHub repo end-to-end" width="720"/>
</p>

### Interactive viewer — pan, zoom, inspect, export

<p align="center">
  <img src="docs/demo-viewer.gif" alt="Interactive diagram viewer" width="720"/>
</p>

### Import from an image (whiteboard, screenshot, Visio, PDF)

<p align="center">
  <img src="docs/demo-image.gif" alt="Import architecture from image" width="720"/>
</p>

### Benchmark your architecture

<p align="center">
  <img src="docs/demo-benchmark.gif" alt="Architecture benchmark scoring" width="720"/>
</p>

---

## Features

| | |
|---|---|
| **Agentic Analysis** | Claude autonomously explores your repo — reads configs, traces imports, detects services, maps connections. Works with any stack. |
| **SSE Streaming** | Real-time progress events as Claude works — see each tool call, file read, and iteration as it happens. |
| **Living Diagrams** | Animated particle flow per protocol (HTTP blue, SQL green, gRPC orange…). Pan, zoom, drag. |
| **80+ Official Logos** | React, PostgreSQL, Redis, Kafka, Terraform… all rendered from Simple Icons with brand colors. |
| **Node Inspector** | Click any service: IN/OUT flows, criticality badge, 2nd-degree neighbors, "Explain deeper" (AI). |
| **Architecture Diff** | Compare two snapshots — added/removed services highlighted in green/red, pattern drift report. |
| **Benchmark** | Score on 6 Well-Architected dimensions: Resilience, Observability, Security, Scalability, Simplicity, Async Coverage. Evidence-based. |
| **Image Import** | Upload a whiteboard photo, screenshot, or PDF — Claude Vision extracts the graph. |
| **Export Everything** | SVG · PNG · JSON · Markdown · draw.io · Excalidraw |
| **VS Code Extension** | Analyze repos directly inside VS Code. GitHub OAuth for private repos. |
| **MCP Integration** | Use Diagram Forge as a tool inside Claude Desktop, Cursor, or any MCP-compatible AI. |
| **Pay Per Use** | No subscription. 2,000 sats for a quick scan, 10,000 sats for a full repo. |

---

## Pricing

> Pay once per analysis. No recurring charges. No account.

| Tier | Price | What you get |
|------|-------|-------------|
| **Basic** | 2,000 sats (~$2.00) | Quick scan — up to 10 key files, main services detected. **First analysis per IP is free.** |
| **Full** | 10,000 sats (~$10.00) | Complete repo analysis — all services, connections, monorepos, notebooks, benchmark, diff, share link |
| **Live** | 25,000 sats (~$25.00) | Full analysis + animated SVG particle flows, minimap, built-in screen recorder |

Payment via **Lightning Network** (L402 protocol). Any wallet: Alby, Phoenix, Wallet of Satoshi, Muun.

Same repo + same commit SHA = **free replay, always.**

---

## Quick Start

### Use online

```
https://forge.l402kit.com
```

### Run locally

```bash
git clone https://github.com/ThiagoDataEngineer/diagram-forge
cd diagram-forge
npm install

# Add your Anthropic API key
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

npm run dev
# → http://localhost:3000
```

### VS Code Extension

Search **"Diagram Forge"** in the VS Code Marketplace, or:

```bash
code --install-extension ShinyDapps.diagram-forge
```

Open the sidebar panel → connect GitHub → paste a repo URL → generate diagram.

### MCP (Claude Desktop / Cursor)

Add to your `mcp.json`:

```json
{
  "mcpServers": {
    "diagram-forge": {
      "command": "npx",
      "args": ["tsx", "/path/to/diagram-forge/src/mcp/server.ts"]
    }
  }
}
```

Then ask Claude: *"Analyze the architecture of my project at ~/my-repo"*

---

## How It Works

```
GitHub URL / local path / image
        │
        ▼
   Claude (agentic loop)
   ──► SSE progress stream (real-time)
   ──► list_directory / read_file / search_pattern
   ──► finish_analysis
        │
        ▼
  ArchitectureGraph { nodes, edges, summary, tech_stack }
        │
        ▼
  Interactive Viewer
  (particles · official logos · inspector · benchmark · diff · exports)
```

Payment is verified via **L402** before the analysis runs — the server issues a Lightning invoice, the client pays, sends the preimage back, and the analysis proceeds. No accounts, no cookies, no tracking.

---

## Architecture Diff in CI/CD

```bash
# Save current architecture snapshot
curl https://forge.l402kit.com/analyze \
  -H "Authorization: L402 <macaroon>:<preimage>" \
  -d '{"repo_url":"https://github.com/you/repo","tier":"full"}' \
  | jq .graph > graphs/v2.json

# Compare
curl "https://forge.l402kit.com/api/diff?a=v1.json&b=v2.json&format=markdown"
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `LIGHTNING_ADDRESS` | Production | LNURL address for managed Lightning (e.g. `user@primal.net`). Omit for mock backend (dev). |
| `BLINK_API_KEY` + `BLINK_WALLET_ID` | Production (alt) | Blink (Strike) Lightning backend |
| `LNBITS_URL` + `LNBITS_API_KEY` | Production (alt) | LNbits self-hosted backend |
| `MACAROON_SECRET` | Production | 32-byte hex secret for L402 token signing |
| `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` | OAuth | GitHub OAuth app credentials |
| `SUPABASE_URL` + `SUPABASE_KEY` | Recommended | Persistent trial/share/idem store (falls back to in-memory) |
| `STRIPE_SECRET_KEY` | Optional | Stripe card payments alongside Lightning |
| `PORT` | No | Server port (default 3000) |
| `TEST_MOCK_LIGHTNING` | Test | Set `"true"` to force mock Lightning backend in tests |

---

## Test Suite

```bash
npm run test:smoke     # 37 smoke tests — API contract, L402 gate, OAuth scope
npm run test:e2e       # Full L402 flow: 402 → pay → analyze → benchmark → diff → share
npm run test:ui        # 36 Puppeteer UI tests — browser flows as a human user
npm run test           # All suites
```

All tests run against a locally-spawned server with mock Lightning (no real payments in CI).

---

## Supported Stacks

<p>
  TypeScript · JavaScript · Python · Java · Scala · Go · Rust · Ruby · 
  Jupyter · Databricks · Spark · dbt · Airflow · 
  Terraform · Docker Compose · Kubernetes · Helm · 
  React Native · Flutter · iOS · Android ·
  Monorepos (Turborepo, Nx, Lerna) · GraphQL · gRPC
</p>

---

## Export Formats

<table>
<tr>
<td><b>SVG</b><br/>Animated, scalable. Perfect for presentations.</td>
<td><b>PNG</b><br/>Static snapshot. Drop into any doc.</td>
</tr>
<tr>
<td><b>draw.io</b><br/>Open in diagrams.net for manual editing.</td>
<td><b>Excalidraw</b><br/>Hand-drawn style. Great for sketches.</td>
</tr>
<tr>
<td><b>Markdown</b><br/>Full report: diagram + risk analysis + tech stack breakdown.</td>
<td><b>JSON</b><br/>Raw graph data. Feed into CI/CD pipelines.</td>
</tr>
</table>

---

## License

MIT · Built by ShinyDapps

---

> *"The best architecture documentation is the one that writes itself."*

> To record the demo GIFs: open the viewer, click **⏺ Record** in the toolbar, perform the action, stop recording, convert with `ffmpeg -i demo.webm -vf fps=12,scale=720:-1 demo.gif`.
