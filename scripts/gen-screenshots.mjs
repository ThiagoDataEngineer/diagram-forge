import puppeteer from "puppeteer";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../vscode-extension/media");
await mkdir(OUT, { recursive: true });

const PANEL_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: #CCCCCC;
  background: #1E1E1E;
  padding: 12px;
  width: 280px;
}
.logo { display:flex;align-items:center;gap:8px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #3e3e42; }
.logo-text { font-weight:700;font-size:13px;letter-spacing:.3px;color:#fff; }
.logo-sub { font-size:10px;color:#888;margin-top:1px; }
.logo-icon { width:22px;height:22px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px; }
button.primary {
  width:100%;padding:8px 12px;background:#7c3aed;color:#fff;
  border:none;border-radius:6px;font-size:12px;font-weight:600;
  cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;
}
button.secondary { width:100%;padding:7px 12px;background:transparent;color:#ccc;border:1px solid #444;border-radius:6px;font-size:11px;cursor:pointer; }
.card { background:#252526;border:1px solid #3e3e42;border-radius:8px;padding:12px;margin-bottom:10px; }
.label { font-size:10px;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px; }
.tier-group { display:flex;gap:6px;margin:6px 0 10px; }
.tier-btn { flex:1;padding:6px 4px;border:1px solid #444;border-radius:5px;background:transparent;color:#ccc;font-size:10px;cursor:pointer;text-align:center; }
.tier-btn.active { border-color:#7c3aed;background:rgba(124,58,237,.15);color:#a855f7; }
.tier-name { font-weight:700;display:block; }
.tier-price { color:#888;font-size:9px; }
.dot { width:7px;height:7px;border-radius:50%;flex-shrink:0; }
.dot.purple { background:#7c3aed; }
.dot.green { background:#22c55e; }
.status-row { display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:8px; }
.progress { height:3px;background:#21262d;border-radius:3px;overflow:hidden;margin:10px 0; }
.progress-bar { height:100%;background:linear-gradient(90deg,#7c3aed,#a855f7);border-radius:3px; }
.hint { font-size:10px;color:#888;line-height:1.4; }
.summary-text { font-size:11px;line-height:1.5;color:#888;margin:8px 0; }
.confidence { font-size:10px;color:#888; }
.confidence span { color:#22c55e;font-weight:700; }
.amount-badge { display:inline-flex;align-items:center;gap:4px;background:rgba(124,58,237,.15);color:#a855f7;border:1px solid rgba(124,58,237,.3);border-radius:20px;padding:3px 10px;font-size:12px;font-weight:700;margin-bottom:10px; }
.invoice-box { background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:9px;font-family:monospace;color:#8b949e;word-break:break-all;max-height:48px;overflow:hidden;margin:8px 0; }
input[type=text] { width:100%;padding:5px 8px;background:#252526;color:#ccc;border:1px solid #444;border-radius:5px;font-size:11px;font-family:monospace;letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px;box-sizing:border-box; }
`;

const states = [
  {
    name: "01-idle",
    label: "Idle — ready to analyze",
    html: `
      <div class="hint" style="margin-bottom:12px">Open a GitHub repo in VS Code, then click <strong style="color:#ccc">Analyze</strong> to generate an interactive architecture diagram.</div>
      <button class="primary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="13 2 13 9 20 9"/><path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/></svg>
        Analyze Repo
      </button>
    `,
  },
  {
    name: "02-confirming",
    label: "Confirming — repo detected, pick tier",
    html: `
      <div class="card">
        <div class="label">Repository</div>
        <div style="font-size:11px;word-break:break-all;margin-bottom:10px;color:#a855f7">https://github.com/vercel/next.js</div>
        <div class="label">Analysis tier</div>
        <div class="tier-group">
          <div class="tier-btn active"><span class="tier-name">Basic</span><span class="tier-price">100 sats</span></div>
          <div class="tier-btn"><span class="tier-name">Full</span><span class="tier-price">500 sats</span></div>
          <div class="tier-btn"><span class="tier-name">Live ✦</span><span class="tier-price">1000 sats</span></div>
        </div>
        <div class="label" style="margin-top:4px">Promo code (optional)</div>
        <input type="text" placeholder="e.g. PRIMAL" style="margin-bottom:10px"/>
        <button class="primary">⚡ Analyze</button>
      </div>
    `,
  },
  {
    name: "03-analyzing",
    label: "Analyzing — Claude exploring codebase",
    html: `
      <div class="card">
        <div class="status-row"><div class="dot purple"></div><span>Analyzing with Claude…</span></div>
        <div class="progress"><div class="progress-bar" style="width:45%"></div></div>
        <div class="hint">Step 5 — detecting services, connections, protocols…</div>
      </div>
    `,
  },
  {
    name: "04-done",
    label: "Done — diagram ready",
    html: `
      <div class="card" style="border-color:rgba(34,197,94,.3)">
        <div class="status-row"><div class="dot green"></div><span style="font-weight:700;color:#fff">Diagram ready</span></div>
        <div class="summary-text">Next.js monorepo with 14 services: App Router frontend, API routes, Vercel Edge Functions, PostgreSQL via Prisma, Redis cache, and S3 storage. CI via GitHub Actions.</div>
        <div class="confidence">Confidence: <span>91%</span></div>
        <button class="primary" style="margin-top:10px">Open Interactive Diagram ↗</button>
      </div>
      <button class="secondary" style="margin-top:4px">Analyze another repo</button>
    `,
  },
];

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 304, height: 500, deviceScaleFactor: 2 });

const frames = [];

for (const state of states) {
  const height = state.name === "02-confirming" ? 340
    : state.name === "04-done" ? 320
    : state.name === "03-analyzing" ? 200
    : 160;

  await page.setContent(`<!DOCTYPE html>
<html><head><style>${PANEL_CSS}</style></head>
<body style="min-height:${height}px">
<div class="logo">
  <div class="logo-icon">⚡</div>
  <div>
    <div class="logo-text">Diagram Forge</div>
    <div class="logo-sub">AI Architecture Diagrams ⚡</div>
  </div>
</div>
<div id="root">${state.html}</div>
</body></html>`);

  await page.setViewport({ width: 304, height: height + 56, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 100));

  const file = path.join(OUT, `${state.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  frames.push({ file, label: state.label });
  console.log(`✅ ${state.name}.png`);
}

await browser.close();

// Generate GIF using canvas + gif-encoder alternative: write frame list
console.log("\nFrames gerados:");
frames.forEach(f => console.log(` ${f.file} — ${f.label}`));
console.log("\nPara GIF animado, instale: npm install gifencoder canvas");
console.log("Ou use: ffmpeg -f image2 -r 1 vscode-extension/media/%02d*.png output.gif");
