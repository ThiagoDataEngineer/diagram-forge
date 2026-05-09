# Diagram Forge — AI Architecture Diagrams ⚡

> Open any GitHub repo in VS Code → Claude analyzes the codebase → interactive architecture diagram in your browser. Pay per use via Lightning Network. First analysis free.

---

### The extension — 4 steps, no config

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-extension-journey.gif"
    alt="Diagram Forge VS Code extension — idle, tier selection, analysis, result"
    width="320"
  />
</p>

<p align="center"><sub>Idle → pick a tier → Claude analyzes → diagram ready</sub></p>

---

### The result — an interactive living diagram

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-viewer.gif"
    alt="Diagram Forge interactive viewer — nodes, edges, particle flows, minimap"
    width="720"
  />
</p>

<p align="center"><sub>Pan · zoom · click any node · export SVG/PNG · share link</sub></p>

---

## Quick Start

1. **Install** the extension from the VS Code Marketplace
2. **Open any project** with a GitHub remote — or any folder
3. **Click the Diagram Forge icon** in the Activity Bar (left sidebar)
4. **Click "Analyze Repo"**
5. **Choose your tier** and optionally enter a promo code
6. **Pay with Lightning** (or use a promo code for free access)
7. **Click "Open Interactive Diagram"** to view your result in the browser

---

## Analysis Tiers

| Tier | Price | What you get |
|------|-------|-------------|
| **Basic** | 2,000 sats (~$2) | Quick scan — top files, main services detected, 8 Claude iterations |
| **Full** | 10,000 sats (~$10) | Complete repo — all services, connections, monorepos, 12 iterations |
| **Live ✦** | 25,000 sats (~$25) | Deep analysis — full agentic exploration, maximum Claude depth |

No subscription, no account. Pay per analysis, keep the diagram forever via share link.

---

## Free tier

Every IP gets one free analysis per day — no promo code needed. Just click Analyze and the first request runs at no cost.

**Have a promo code?** Enter it in the "Promo code" field before clicking Analyze. The analysis runs free, no Lightning wallet needed.

---

## Paying with Lightning

Lightning Network is a Bitcoin payment layer that enables instant, near-zero fee payments.

**Don't have a Lightning wallet?** Get started in 2 minutes:
- **[Wallet of Satoshi](https://www.walletofsatoshi.com/)** — simplest, mobile, custodial
- **[Phoenix](https://phoenix.acinq.co/)** — mobile, self-custodial
- **[Alby](https://getalby.com/)** — browser extension, works directly in VS Code

Fund it with a small amount of Bitcoin and paste or scan the invoice when prompted. The diagram starts automatically once payment confirms — no button needed.

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

**Analysis takes 30–60 seconds to start** — The server may be sleeping (free tier cold start). The progress bar begins moving once it wakes. A 3-minute timeout is in place; if it fires, try again immediately.

**"Access blocked" or "Forbidden" error** — Your corporate network or proxy is blocking the analysis server. Try on a personal network or mobile hotspot.

**"Free daily limit reached"** — One free analysis per IP per day. Use a Lightning payment to continue, or wait until midnight UTC.

**"Promo code is invalid or expired"** — Check spelling. Leave the field blank to use the standard free trial instead.

**Repo not detected** — If your project has no GitHub remote, the extension prompts you to paste a public GitHub URL manually. Private repos are not supported.

**Analysis times out on large repos** — Repos with >1,000 files can take 2–3 minutes on the Full tier. The progress bar advances every ~15 seconds as Claude explores the codebase.

---

## Links

- **Web app**: [forge.l402kit.com](https://forge.l402kit.com)
- **GitHub**: [ThiagoDataEngineer/diagram-forge](https://github.com/ThiagoDataEngineer/diagram-forge)
- **L402 protocol**: [l402kit.com](https://l402kit.com)
- **Issues**: [GitHub Issues](https://github.com/ThiagoDataEngineer/diagram-forge/issues)

---

Built with Claude · Paid via Lightning ⚡