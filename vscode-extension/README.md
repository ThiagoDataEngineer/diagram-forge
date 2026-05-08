# Diagram Forge — AI Architecture Diagrams ⚡

> Paste any GitHub URL → Claude analyzes the codebase → interactive architecture diagram in seconds. Pay per use via Lightning Network.

![Diagram Forge Extension Demo](https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/vscode-extension/media/demo-extension.gif)

---

## What it does

Diagram Forge analyzes any GitHub repository with Claude AI and generates an **interactive, animated architecture diagram** showing:

- Every service, database, queue, and API detected
- Connections between components with protocol labels (HTTP, SQL, gRPC, WebSocket…)
- Official logos for 80+ technologies (React, PostgreSQL, Redis, Kafka…)
- Animated particle flows colored by protocol type

The diagram opens in your browser with pan/zoom, node inspection, minimap, and SVG/PNG export.

---

## Quick Start

1. **Install** the extension from the VS Code Marketplace
2. **Open any project** with a GitHub remote — or any folder
3. **Click the Diagram Forge icon** in the Activity Bar (left sidebar)
4. **Click "Analyze Repo"**
5. **Choose your tier** and optionally enter a promo code
6. **Pay with Lightning** (or use a promo code for free access)
7. **View your diagram** — opens automatically in the browser

---

## Analysis Tiers

| Tier | Price | What you get |
|------|-------|-------------|
| **Basic** | 100 sats (~$0.10) | Quick scan — top 10 files, main services detected |
| **Full** | 500 sats (~$0.50) | Complete repo — all services, connections, monorepos |
| **Live ✦** | 1000 sats (~$1.00) | Full analysis + animated SVG with particle flows |

Prices in Lightning sats. No subscription, no account — pay per analysis.

---

## Paying with Lightning

Lightning Network is a Bitcoin payment layer that enables instant, near-zero fee payments.

**Don't have a Lightning wallet?** Get started in 2 minutes:
- **[Wallet of Satoshi](https://www.walletofsatoshi.com/)** — simplest, mobile, custodial
- **[Phoenix](https://phoenix.acinq.co/)** — mobile, self-custodial
- **[Alby](https://getalby.com/)** — browser extension, works directly in VS Code

After installing a wallet, fund it with a small amount of Bitcoin and scan the invoice QR when prompted.

**Have a promo code?** Enter it in the "Promo code" field before clicking Analyze — the analysis runs free, no wallet needed.

---

## Features

- **Agentic analysis** — Claude autonomously explores your codebase with filesystem tools. No config files, no annotations needed.
- **80+ tech logos** — auto-detected from your code using Simple Icons
- **Animated diagram** — particles flow along edges in real time, colored by protocol
- **Interactive viewer** — pan, zoom, click nodes, inspect connections, minimap
- **Export** — SVG, PNG, Markdown, Draw.io
- **Share links** — `/g/:id` shareable URLs for each diagram
- **Architecture Benchmark** — 6-dimension quality score (scalability, security, observability…)
- **Diff engine** — compare two diagram snapshots over time

---

## Supported Languages & Stacks

TypeScript · JavaScript · Python · Java · Go · Rust · Ruby · Scala · Jupyter · dbt · Terraform · Kubernetes · Docker Compose · Airflow · Monorepos · and more

---

## Privacy

- Your code is **cloned temporarily** on a secure server, analyzed, then deleted
- Only the **graph JSON** (node/edge metadata, no source code) is stored if you use share links
- No account, no data retention beyond the diagram itself

---

## Troubleshooting

**"Not Found" error** — Update the extension to the latest version (v0.1.2+). Older versions used an incorrect endpoint.

**Analysis times out** — Large repos (>1000 files) can take 60–90s on the Full tier. The progress bar updates as Claude explores the codebase.

**Can't pay with Lightning** — Use a promo code if you have one, or install [Wallet of Satoshi](https://www.walletofsatoshi.com/) to get started with Lightning in under 2 minutes.

---

## Links

- **Web app**: [forge.l402kit.com](https://forge.l402kit.com)
- **GitHub**: [ThiagoDataEngineer/diagram-forge](https://github.com/ThiagoDataEngineer/diagram-forge)
- **L402 protocol**: [l402kit.com](https://l402kit.com)
- **Issues**: [GitHub Issues](https://github.com/ThiagoDataEngineer/diagram-forge/issues)

---

Built with Claude · Paid via Lightning ⚡
