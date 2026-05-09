import * as vscode from "vscode";
import * as crypto from "crypto";
import { L402Challenge } from "./client";

type PanelState =
  | { type: "idle"; githubConnected?: boolean }
  | { type: "detecting" }
  | { type: "confirming"; repoUrl: string; tier: "basic" | "full" | "live"; promoCode?: string }
  | { type: "paying"; challenge: L402Challenge; preimage?: string; paidConfirmed?: boolean }
  | { type: "analyzing"; step: number; repoUrl: string }
  | { type: "done"; viewerUrl: string; summary: string; confidence: number }
  | { type: "error"; message: string };

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _state: PanelState = { type: "idle" };

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._buildHtml();
    webviewView.webview.onDidReceiveMessage((msg: { command: string; payload?: unknown }) => {
      if (msg.command === "analyze") {
        vscode.commands.executeCommand("diagramForge.analyze");
      } else if (msg.command === "openViewer") {
        const state = this._state as { type: "done"; viewerUrl: string };
        vscode.env.openExternal(vscode.Uri.parse(state.viewerUrl));
      } else if (msg.command === "copyInvoice") {
        const state = this._state as { type: "paying"; challenge: L402Challenge };
        vscode.env.clipboard.writeText(state.challenge.invoice);
        vscode.window.showInformationMessage("⚡ Invoice copied — paste into your Lightning wallet");
      } else if (msg.command === "openBenchmark") {
        vscode.commands.executeCommand("diagramForge.openBenchmark");
      } else if (msg.command === "openDiff") {
        vscode.commands.executeCommand("diagramForge.openDiff");
      } else if (msg.command === "preimageChange") {
        const state = this._state as { type: "paying"; challenge: L402Challenge; preimage?: string };
        this.setState({ ...state, preimage: msg.payload as string });
      } else if (msg.command === "submitPreimage") {
        vscode.commands.executeCommand("diagramForge.submitPreimage");
      } else if (msg.command === "tierChange") {
        const state = this._state as { type: "confirming"; repoUrl: string; tier: string; promoCode?: string };
        this.setState({ ...state, tier: msg.payload as "basic" | "full" | "live" });
      } else if (msg.command === "promoChange") {
        const state = this._state as { type: "confirming"; repoUrl: string; tier: "basic" | "full" | "live"; promoCode?: string };
        this.setState({ ...state, promoCode: msg.payload as string });
      } else if (msg.command === "confirm") {
        vscode.commands.executeCommand("diagramForge.analyzeConfirmed");
      } else if (msg.command === "connectGitHub") {
        vscode.commands.executeCommand("diagramForge.connectGitHub");
      } else if (msg.command === "disconnectGitHub") {
        vscode.commands.executeCommand("diagramForge.disconnectGitHub");
      }
    });
  }

  setState(state: PanelState): void {
    this._state = state;
    this._view?.webview.postMessage({ type: "state", state });
  }

  getState(): PanelState { return this._state; }

  setGitHubConnected(connected: boolean): void {
    const current = this._state;
    if (current.type === "idle") {
      this.setState({ type: "idle", githubConnected: connected });
    }
  }

  focus(): void {
    this._view?.show?.(true);
  }

  private _buildHtml(): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src https://raw.githubusercontent.com data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, #1e1e1e);
    padding: 12px;
    min-height: 100vh;
  }
  .logo {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 16px; padding-bottom: 12px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
  }
  .logo svg { flex-shrink: 0; }
  .logo-text { font-weight: 700; font-size: 13px; letter-spacing: .3px; }
  .logo-sub { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 1px; }
  button.primary {
    width: 100%; padding: 8px 12px;
    background: #7c3aed; color: #fff;
    border: none; border-radius: 6px;
    font-size: 12px; font-weight: 600;
    cursor: pointer; letter-spacing: .3px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    transition: background .15s;
  }
  button.primary:hover { background: #6d28d9; }
  button.primary:disabled { background: #4b3a6a; color: #9ca3af; cursor: not-allowed; }
  button.secondary {
    width: 100%; padding: 7px 12px;
    background: transparent; color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 6px; font-size: 11px; cursor: pointer;
    transition: border-color .15s;
  }
  button.secondary:hover { border-color: #7c3aed; }
  .card {
    background: var(--vscode-editor-background, #252526);
    border: 1px solid var(--vscode-panel-border, #3e3e42);
    border-radius: 8px; padding: 12px;
    margin-bottom: 10px;
  }
  .label { font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
  .invoice-box {
    background: #0d1117; border: 1px solid #30363d;
    border-radius: 6px; padding: 8px;
    font-size: 9px; font-family: monospace;
    color: #8b949e; word-break: break-all;
    max-height: 60px; overflow: hidden;
    margin: 8px 0;
  }
  .amount-badge {
    display: inline-flex; align-items: center; gap: 4px;
    background: rgba(124,58,237,.15); color: #a855f7;
    border: 1px solid rgba(124,58,237,.3);
    border-radius: 20px; padding: 3px 10px;
    font-size: 12px; font-weight: 700;
    margin-bottom: 10px;
  }
  .status-row { display: flex; align-items: center; gap: 8px; font-size: 11px; margin-bottom: 8px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot.purple { background: #7c3aed; animation: pulse 1.2s infinite; }
  .dot.green { background: #22c55e; }
  .dot.red { background: #ef4444; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .progress { height: 3px; background: #21262d; border-radius: 3px; overflow: hidden; margin: 10px 0; }
  .progress-bar { height: 100%; background: linear-gradient(90deg,#7c3aed,#a855f7); border-radius: 3px; transition: width .4s ease; }
  .tier-group { display: flex; gap: 6px; margin: 6px 0 10px; }
  .tier-btn {
    flex: 1; padding: 6px 4px;
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 5px; background: transparent;
    color: var(--vscode-foreground); font-size: 10px;
    cursor: pointer; text-align: center; transition: all .15s;
  }
  .tier-btn.active { border-color: #7c3aed; background: rgba(124,58,237,.15); color: #a855f7; }
  .tier-name { font-weight: 700; display: block; }
  .tier-price { color: var(--vscode-descriptionForeground); font-size: 9px; }
  .viewer-link {
    display: flex; align-items: center; gap: 6px;
    color: #a855f7; font-size: 11px; cursor: pointer;
    text-decoration: none; margin-top: 8px;
  }
  .summary-text { font-size: 11px; line-height: 1.5; color: var(--vscode-descriptionForeground); margin: 8px 0; }
  .confidence { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .confidence span { color: #22c55e; font-weight: 700; }
  select {
    width: 100%; padding: 5px 8px;
    background: var(--vscode-editor-background); color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 5px; font-size: 11px; margin-bottom: 10px;
  }
  #root { display: flex; flex-direction: column; gap: 4px; }
  .hint { font-size: 10px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
</style>
</head>
<body>
<div class="logo">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="4" width="5" height="4" rx="1"/><rect x="9" y="1" width="5" height="4" rx="1"/>
    <rect x="9" y="10" width="5" height="4" rx="1"/><rect x="17" y="5.5" width="6" height="4" rx="1"/>
    <line x1="6" y1="6" x2="9" y2="3"/><line x1="6" y1="6" x2="9" y2="12"/>
    <line x1="14" y1="3" x2="17" y2="7.5"/><line x1="14" y1="12" x2="17" y2="7.5"/>
  </svg>
  <div>
    <div class="logo-text">Diagram Forge</div>
    <div class="logo-sub">AI Architecture Diagrams ⚡</div>
  </div>
</div>
<div id="root"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
let state = { type: 'idle' };

function render() {
  const root = document.getElementById('root');
  root.innerHTML = '';

  if (state.type === 'idle') {
    const ghStatus = state.githubConnected
      ? \`<div style="display:flex;align-items:center;gap:6px;font-size:10px;color:#22c55e;margin-bottom:10px">
          <div class="dot green"></div>GitHub connected
          <button class="secondary" style="margin-left:auto;width:auto;padding:3px 8px;font-size:10px" onclick="vscode.postMessage({command:'disconnectGitHub'})">Disconnect</button>
        </div>\`
      : \`<button class="secondary" style="margin-bottom:10px;font-size:11px" onclick="vscode.postMessage({command:'connectGitHub'})">
          Connect GitHub (optional)
        </button>\`;
    root.innerHTML = \`
      <div class="hint" style="margin-bottom:12px">Open a GitHub repo in VS Code, then click <strong>Analyze</strong> to generate an interactive architecture diagram.</div>
      \${ghStatus}
      <button class="primary" onclick="vscode.postMessage({command:'analyze'})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="13 2 13 9 20 9"/><path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/></svg>
        Analyze Repo
      </button>
      <div style="margin-top:14px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);line-height:0">
        <img src="https://raw.githubusercontent.com/ThiagoDataEngineer/diagram-forge/main/docs/demo-viewer.gif"
          alt="Diagram Forge — example output"
          style="width:100%;height:auto;display:block;opacity:0.85"
          onerror="this.style.display='none'"/>
      </div>
    \`;
  }

  else if (state.type === 'detecting') {
    root.innerHTML = \`
      <div class="status-row"><div class="dot purple"></div><span>Detecting repository…</span></div>
    \`;
  }

  else if (state.type === 'confirming') {
    const tiers = [
      { id: 'basic', label: 'Basic', price: '2 000 sats', iters: '8 iters' },
      { id: 'full', label: 'Full', price: '10 000 sats', iters: '12 iters' },
      { id: 'live', label: 'Live', price: '25 000 sats', iters: 'deep' },
    ];
    const tierBtns = tiers.map(t => \`
      <button class="tier-btn \${state.tier === t.id ? 'active' : ''}" onclick="setTier('\${t.id}')">
        <span class="tier-name">\${t.label}</span>
        <span class="tier-price">\${t.price}</span>
      </button>
    \`).join('');
    root.innerHTML = \`
      <div class="card">
        <div class="label">Repository</div>
        <div style="font-size:11px;word-break:break-all;margin-bottom:10px">\${escapeHtml(state.repoUrl)}</div>
        <div class="label">Analysis tier</div>
        <div class="tier-group">\${tierBtns}</div>
        <div class="label" style="margin-top:8px">Promo code (optional)</div>
        <input
          type="text" id="promo-input"
          placeholder="e.g. PRIMAL"
          value="\${escapeHtml(state.promoCode ?? '')}"
          oninput="vscode.postMessage({command:'promoChange',payload:this.value.trim().toUpperCase()})"
          style="width:100%;padding:5px 8px;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border,#444);border-radius:5px;font-size:11px;font-family:monospace;letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px;box-sizing:border-box;"
        />
        <button class="primary" onclick="vscode.postMessage({command:'confirm'})">
          ⚡ Analyze
        </button>
      </div>
    \`;
  }

  else if (state.type === 'paying') {
    const c = state.challenge;
    const preimage = state.preimage ?? '';
    const canSubmit = preimage.length === 64;
    const confirmed = state.paidConfirmed ?? false;

    // When payment is confirmed but preimage not returned by server, show input prominently
    const preimageSection = confirmed
      ? \`<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:6px;padding:10px;margin-bottom:8px">
          <div class="status-row" style="margin-bottom:8px"><div class="dot green"></div><span style="font-weight:700;color:#22c55e">Payment confirmed!</span></div>
          <div class="hint" style="margin-bottom:8px">Your wallet received a <strong>payment proof (preimage)</strong> — paste the 64-character hex below to start the analysis.</div>
          <input
            type="text" id="preimage-input"
            placeholder="64-char hex preimage from your wallet"
            value="\${escapeHtml(preimage)}"
            oninput="onPreimageInput(this.value)"
            autofocus
            style="width:100%;padding:6px 8px;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid rgba(34,197,94,.4);border-radius:5px;font-size:10px;font-family:monospace;margin-bottom:8px;box-sizing:border-box;"
          />
          <button class="primary" \${canSubmit ? '' : 'disabled'} onclick="vscode.postMessage({command:'submitPreimage'})">
            Submit &amp; Generate Diagram
          </button>
        </div>\`
      : \`<div class="hint" style="margin-bottom:10px">Pay with any Lightning wallet — the diagram will start automatically once payment confirms.</div>
        <details style="margin-top:4px">
          <summary style="font-size:10px;color:var(--vscode-descriptionForeground);cursor:pointer;user-select:none">Paid but nothing happened? Enter preimage manually</summary>
          <div style="margin-top:8px">
            <input
              type="text" id="preimage-input"
              placeholder="64-char hex preimage"
              value="\${escapeHtml(preimage)}"
              oninput="onPreimageInput(this.value)"
              style="width:100%;padding:5px 8px;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border,#444);border-radius:5px;font-size:10px;font-family:monospace;margin-bottom:8px;box-sizing:border-box;"
            />
            <button class="primary" \${canSubmit ? '' : 'disabled'} onclick="vscode.postMessage({command:'submitPreimage'})">
              Submit &amp; Generate Diagram
            </button>
          </div>
        </details>\`;

    root.innerHTML = \`
      <div class="card">
        <div class="status-row"><div class="dot \${confirmed ? 'green' : 'purple'}"></div><span>\${confirmed ? 'Payment received' : 'Waiting for payment…'}</span></div>
        <div class="amount-badge">⚡ \${escapeHtml(String(c.amountSats))} sats — \${escapeHtml(c.tier)}</div>
        \${confirmed ? '' : \`
        <div class="label">Lightning invoice</div>
        <div class="invoice-box">\${escapeHtml(c.invoice)}</div>
        <button class="primary" onclick="vscode.postMessage({command:'copyInvoice'})" style="margin-bottom:10px">
          Copy Invoice
        </button>\`}
        \${preimageSection}
      </div>
    \`;
  }

  else if (state.type === 'analyzing') {
    const pct = Math.min(95, (state.step / 12) * 100);
    root.innerHTML = \`
      <div class="card">
        <div class="status-row"><div class="dot purple"></div><span>Analyzing with Claude…</span></div>
        <div class="progress"><div class="progress-bar" style="width:\${pct}%"></div></div>
        <div class="hint">Step \${state.step} — detecting services, connections, protocols…</div>
      </div>
    \`;
  }

  else if (state.type === 'done') {
    root.innerHTML = \`
      <div class="card" style="border-color:rgba(34,197,94,.3)">
        <div class="status-row"><div class="dot green"></div><span style="font-weight:700">Diagram ready</span></div>
        <div class="summary-text">\${escapeHtml(state.summary)}</div>
        <div class="confidence">Confidence: <span>\${Math.round(state.confidence * 100)}%</span></div>
        <button class="primary" style="margin-top:10px" onclick="vscode.postMessage({command:'openViewer'})">
          Open Interactive Diagram ↗
        </button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <button class="secondary" onclick="vscode.postMessage({command:'openBenchmark'})" title="6-dimension quality score">
          📊 Benchmark
        </button>
        <button class="secondary" onclick="vscode.postMessage({command:'openDiff'})" title="Compare with another snapshot">
          🔀 Diff
        </button>
      </div>
      <button class="secondary" style="margin-top:0" onclick="vscode.postMessage({command:'analyze'})">Analyze another repo</button>
    \`;
  }

  else if (state.type === 'error') {
    root.innerHTML = \`
      <div class="card" style="border-color:rgba(239,68,68,.3)">
        <div class="status-row"><div class="dot red"></div><span style="font-weight:700">Error</span></div>
        <div class="hint" style="margin:8px 0;color:#ef4444">\${escapeHtml(state.message)}</div>
        <button class="primary" onclick="vscode.postMessage({command:'analyze'})">Retry</button>
      </div>
    \`;
  }
}

function setTier(tier) {
  state = { ...state, tier };
  vscode.postMessage({ command: 'tierChange', payload: tier });
  render();
}

function onPreimageInput(val) {
  const clean = val.trim().toLowerCase();
  vscode.postMessage({ command: 'preimageChange', payload: clean });
  // Update button state without full re-render
  const btn = document.querySelector('#root button.primary:last-child');
  if (btn) btn.disabled = clean.length !== 64;
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'state') {
    state = msg.state;
    render();
  }
});

render();
</script>
</body>
</html>`;
  }
}
