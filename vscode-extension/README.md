# Diagram Forge — AI Architecture Diagrams

> Open any GitHub repo in VS Code → Claude analyzes the codebase → interactive architecture diagram in your browser.  
> **First analysis free.** Pay per use via Lightning Network — no account, no subscription.

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-extension-journey.gif"
    alt="Diagram Forge — idle, tier selection, Lightning payment, Claude analysis, diagram ready"
    width="320"
  />
</p>

<p align="center"><sub>Open panel · pick tier · pay with Lightning · Claude explores your code · diagram ready</sub></p>

---

> **What you get: a living diagram your whole team can navigate.**

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
2. **Open any project** with a GitHub remote
3. **Click the Diagram Forge icon** in the Activity Bar
4. **Click "Analyze Repo"** — first request is free, no wallet needed
5. **Pick a tier** and optionally enter a promo code, then click **Analyze**
6. **Pay the Lightning invoice** (or wait for free/promo to run) — the panel polls automatically
7. **Click "Open Interactive Diagram"** when the panel shows "Diagram ready"

> **Have [Alby](https://getalby.com/) installed?** WebLN fires automatically — the invoice resolves without leaving VS Code.

---

## Analysis Tiers

| Tier | Price | What Claude does |
|------|-------|-----------------|
| **Basic** | 2,000 sats (~$2) | 8 iterations — top files, main services, key connections |
| **Full** | 10,000 sats (~$10) | 12 iterations — full repo, monorepos, all protocols |
| **Live** | 25,000 sats (~$25) | Deep agentic exploration — maximum breadth and confidence |

Pay once per analysis. The diagram link (`/g/:id`) is permanent — share it forever.

---

## Free Tier

Every IP gets **one free analysis per day** — no promo code, no wallet required. Just click Analyze.

**Promo code?** Enter it before clicking Analyze — runs fully free.

---

## Paying with Lightning

The panel shows a Lightning invoice (BOLT11) as soon as you click Analyze. Options:

- **Alby** — WebLN fires automatically inside VS Code, no copy-paste
- **Other wallets** — Wallet of Satoshi · Phoenix · Muun · any BOLT11 wallet  
  Copy the invoice from the panel and paste into your wallet

Once payment confirms, analysis starts automatically. No manual step needed.

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-personas-paying.gif"
    alt="Anyone pays via Lightning — dev, CTO, AI agent, startup founder — same diagram for everyone"
    width="720"
  />
</p>

<p align="center"><sub>Dev · CTO · AI Agent · Startup Founder — any wallet, any device, same result</sub></p>

---

## Connect GitHub _(optional)_

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-github-connect.gif"
    alt="GitHub connect — before and after linking your account"
    width="320"
  />
</p>

Click **Connect GitHub** in the panel to link your account via OAuth.

This is optional — the extension works with any public repo URL. Connecting GitHub enables automatic repo detection instead of asking you to paste a URL.

**What the extension requests:** only the `public_repo` scope — read access to public repositories. No write permissions, no private repo access. Your token is stored in VS Code's encrypted secret storage and is never sent to Diagram Forge servers.

To unlink: click **Disconnect** in the panel, or run `Diagram Forge: Disconnect GitHub Account` from the Command Palette.

---

## What You Get in the Viewer

After analysis, clicking **Open Interactive Diagram** opens a browser tab with:

- **Animated particle flows** — colored by protocol (HTTP, SQL, gRPC, WebSocket…)
- **80+ official logos** — React, PostgreSQL, Redis, Kafka, Terraform… with brand colors
- **Node inspector** — click any service to see its connections, criticality, and "Explain deeper"
- **Architecture Benchmark** — 6-dimension quality score (Resilience, Security, Observability…)
- **Diff** — compare two architecture snapshots
- **Export** — SVG, PNG, Markdown, Draw.io, Excalidraw
- **Share link** — permanent `/g/:id` URL

---

## Supported Languages & Stacks

TypeScript · JavaScript · Python · Java · Go · Rust · Ruby · Scala · Jupyter · dbt · Terraform · Kubernetes · Docker Compose · Airflow · Monorepos · and more

---

## Privacy & Security

| What happens | Detail |
|---|---|
| **Code access** | Your repo is cloned over HTTPS into an isolated server process. No SSH keys or credentials needed. |
| **Retention** | The cloned repo is deleted immediately after analysis — typically within 1–2 minutes. |
| **What is stored** | Only the graph JSON (node names, edge types, summary text). No source code, no file contents. |
| **Where** | Backend on [Render](https://render.com) (US). Graph data on [Supabase](https://supabase.com) (US). Both SOC 2 Type II. |
| **GitHub OAuth** | Optional. `public_repo` scope only. Token stored in VS Code encrypted secret storage — never sent to Diagram Forge servers. |
| **Private repos** | Not supported — analysis runs via public GitHub URL. |
| **LGPD / GDPR** | No personal data collected. No account, no email, no IP stored beyond standard server logs (7-day retention). |

> **Corporate use:** This extension sends your public repository URL to a third-party server for analysis. Review with your security team before use on proprietary codebases.

---

## Troubleshooting

**Analysis takes 30–60 s to start** — The server sleeps after 15 min idle (Render free tier). Cold start is normal. A 3-minute timeout retries automatically.

**"Access blocked" or "Forbidden"** — Corporate proxy blocking `diagram-forge.onrender.com`. Try a personal network or mobile hotspot.

**"Free daily limit reached"** — One free analysis per IP per day. Pay with Lightning to continue, or wait until midnight UTC.

**"Promo code is invalid or expired"** — Check spelling. Leave the field blank to use the free daily trial.

**Repo not detected** — No GitHub remote in the open project. The extension will ask for a URL, or click **Connect GitHub** for automatic detection.

**Large repos timeout** — Repos with >1,000 files can take 2–3 minutes on Full tier. The progress bar advances per Claude iteration.

---

## Links

- **Web app**: [forge.l402kit.com](https://forge.l402kit.com)
- **GitHub**: [ThiagoDataEngineer/diagram-forge](https://github.com/ThiagoDataEngineer/diagram-forge)
- **Issues**: [GitHub Issues](https://github.com/ThiagoDataEngineer/diagram-forge/issues)

---

Built with Claude · Paid via Lightning L402
