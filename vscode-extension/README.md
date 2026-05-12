# Diagram Forge — AI Architecture Diagrams

**Open any GitHub repo in VS Code → Claude maps the codebase → interactive diagram in your browser.**  
First analysis free. Pay per use with Lightning — no account, no subscription.

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-extension-journey.gif"
    alt="Diagram Forge — open panel, pick tier, pay with Lightning, Claude analyzes, diagram ready"
    width="360"
  />
</p>

<p align="center">
  <sub>Open panel · pick tier · pay with Lightning · Claude explores your code · diagram ready</sub>
</p>

---

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-viewer.gif"
    alt="Diagram Forge interactive viewer — animated particle flows, node inspector, minimap, export"
    width="720"
  />
</p>

<p align="center">
  <sub>The result: an animated architecture diagram your whole team can navigate, inspect, and share</sub>
</p>

---

## Quick Start

1. **Open any project** with a GitHub remote in VS Code
2. **Click the Diagram Forge icon** in the Activity Bar → click **Analyze Repo**
3. **Pick your tier** and optionally enter a promo code → click **Analyze**
4. **Pay the Lightning invoice** — the panel polls automatically and starts analysis on confirmation
5. **Click "Open Interactive Diagram"** when the panel shows "Diagram ready"

> **First time?** Just click Analyze — the first request is free, no wallet needed.  
> **Have [Alby](https://getalby.com/)?** WebLN fires automatically. No copy-paste.

---

## Pricing

| Tier | Price | What Claude does |
|------|-------|-----------------|
| **Free** | $0 | One analysis per IP per day — no wallet, no promo code needed |
| **Basic** | 2,000 sats (~$2) | 8 iterations — top files, main services, key connections |
| **Full** | 10,000 sats (~$10) | Complete analysis — all services, connections, monorepos, all protocols |
| **Live** | 25,000 sats (~$25) | Deep agentic exploration — maximum breadth and confidence |

Pay once. The diagram link (`/g/:id`) is permanent — share it forever.

**Promo code?** Enter it before clicking Analyze — runs fully free.

---

## Paying with Lightning

The panel shows a BOLT11 invoice the moment you click Analyze:

- **Alby** — WebLN fires automatically, no copy-paste needed
- **Any other wallet** — Wallet of Satoshi · Phoenix · Muun — copy the invoice and paste

Once payment confirms the diagram starts automatically. If your wallet confirms but the panel doesn't advance, expand _"Paid but nothing happened?"_ and paste the 64-char payment proof from your wallet history.

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-personas-paying.gif"
    alt="Dev, CTO, AI agent, startup founder — anyone pays with Lightning, everyone gets the same diagram"
    width="720"
  />
</p>

<p align="center">
  <sub>Dev · CTO · AI Agent · Startup Founder — any wallet, any device, one diagram</sub>
</p>

---

## Connect GitHub _(optional)_

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-github-connect.gif"
    alt="GitHub connect — before and after linking your account"
    width="320"
  />
</p>

Click **Connect GitHub** in the panel to link your account via OAuth. The extension then detects your active repo automatically instead of asking you to paste a URL.

**Scope requested:** `public_repo` only — read access to public repositories. No write permissions, no private repo access. Your token is stored in VS Code's encrypted secret storage and is never sent to Diagram Forge servers.

To unlink: click **Disconnect** in the panel, or run `Diagram Forge: Disconnect GitHub Account` from the Command Palette.

---

## What the Diagram Shows

After analysis, **Open Interactive Diagram** opens a browser tab with a live view of your architecture:

- **Animated particle flows** — colored by protocol: HTTP, SQL, gRPC, WebSocket, message queue…
- **80+ official logos** — React, PostgreSQL, Redis, Kafka, Terraform, Kubernetes… with brand colors
- **Node inspector** — click any service: IN/OUT connections, criticality badge, "Explain deeper" (AI)
- **Architecture Benchmark** — 6-dimension score: Resilience, Security, Observability, Scalability…
- **Diff** — compare two snapshots over time; added/removed services highlighted
- **Export** — SVG · PNG · Markdown · Draw.io · Excalidraw
- **Share link** — permanent `/g/:id` URL, works for your whole team

---

## Supported Stacks

**Web & backend** — TypeScript · JavaScript · Python · Java · Go · Rust · Ruby · Scala

**Data & ML** — Jupyter · dbt · Apache Airflow · Spark · Databricks

**Infrastructure** — Terraform · Docker Compose · Kubernetes · Helm

**Mobile & other** — React Native · Flutter · Monorepos (Turborepo, Nx, Lerna) · and more

---

## Privacy & Security

| What happens | Detail |
|---|---|
| **Code access** | Repo cloned over HTTPS into an isolated server process. No SSH keys or credentials needed. |
| **Retention** | Cloned repo deleted immediately after analysis — typically within 1–2 minutes. |
| **What is stored** | Only the graph JSON: node names, edge types, summary text. No source code, no file contents. |
| **Infrastructure** | Backend: [Render](https://render.com) (US). Graph data: [Supabase](https://supabase.com) (US). Both SOC 2 Type II certified. |
| **GitHub OAuth** | Optional. `public_repo` scope only. Token in VS Code encrypted secret storage — never reaches Diagram Forge servers. |
| **Private repos** | Not supported — analysis clones via public GitHub URL only. |
| **LGPD / GDPR** | No personal data collected. No account, no email. Server logs retained 7 days. |

> **Corporate use:** This extension sends your public repository URL to a third-party server. Review with your security team before using on proprietary codebases.

---

## Troubleshooting

**Analysis takes 30–60 s to start** — Server sleeps after 15 min idle (Render free tier). Cold start is normal; a 3-minute timeout is in place — just try again.

**"Access blocked" or "Forbidden"** — Corporate proxy blocking `diagram-forge.onrender.com`. Try a personal network or mobile hotspot.

**"Free daily limit reached"** — One free analysis per IP per day. Pay with Lightning or wait until midnight UTC.

**"Promo code invalid or expired"** — Check spelling. Leave the field blank to use the free daily tier instead.

**Repo not detected** — No GitHub remote in the open project. The extension will prompt for a URL. Click **Connect GitHub** to enable automatic detection.

**Large repo timeout** — Repos with >1,000 files can take 2–3 minutes on Full tier. The progress bar and file list advance as Claude iterates.

---

## Links

- [forge.l402kit.com](https://forge.l402kit.com) — web app
- [ThiagoDataEngineer/diagram-forge](https://github.com/ThiagoDataEngineer/diagram-forge) — open source
- [GitHub Issues](https://github.com/ThiagoDataEngineer/diagram-forge/issues) — bugs & feedback

---

Built with Claude · Paid via Lightning L402 ⚡
