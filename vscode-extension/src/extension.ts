import * as vscode from "vscode";
import * as crypto from "crypto";
import { SidebarProvider } from "./panel";
import { detectRepoInfo } from "./git";
import { analyze, L402Challenge } from "./client";

let sidebar: SidebarProvider;
let pendingChallenge: L402Challenge | null = null;
let pendingOpts: { repoUrl?: string; tier: "basic" | "full" | "live"; idemKey: string; promoCode?: string } | null = null;
let pollTimer: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
  sidebar = new SidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("diagramForge.sidebar", sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("diagramForge.analyze", cmdAnalyze),
    vscode.commands.registerCommand("diagramForge.analyzeConfirmed", cmdAnalyzeConfirmed),
    vscode.commands.registerCommand("diagramForge.submitPreimage", cmdSubmitPreimage),
    vscode.commands.registerCommand("diagramForge.openLast", cmdOpenLast)
  );
}

async function cmdAnalyze() {
  sidebar.focus();
  sidebar.setState({ type: "detecting" });

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    sidebar.setState({ type: "error", message: "No folder open. Open a project folder first." });
    return;
  }

  const { repoUrl: detected } = detectRepoInfo(root);

  const repoUrl = detected ?? await vscode.window.showInputBox({
    title: "Diagram Forge — Repository URL",
    prompt: "No GitHub remote detected. Paste a public GitHub URL to analyze.",
    placeHolder: "https://github.com/owner/repo",
    validateInput: v => (v && v.includes("github.com")) ? undefined : "Must be a github.com URL",
  });

  if (!repoUrl) {
    sidebar.setState({ type: "idle" });
    return;
  }

  sidebar.setState({ type: "confirming", repoUrl, tier: "basic" });
}

async function cmdAnalyzeConfirmed() {
  const state = sidebar.getState();
  if (state.type !== "confirming") return;

  const { repoUrl, tier, promoCode } = state;
  const idemKey = crypto.randomUUID();
  pendingOpts = { repoUrl, tier, idemKey, promoCode };

  await doAnalyze(repoUrl, tier, idemKey, undefined, undefined, promoCode);
}

async function doAnalyze(
  repoUrl: string,
  tier: "basic" | "full" | "live",
  idemKey: string,
  preimage?: string,
  macaroon?: string,
  promoCode?: string,
) {
  sidebar.setState({ type: "analyzing", step: 1, repoUrl });

  const result = await analyze({ repoUrl, tier, idempotencyKey: idemKey, preimage, macaroon, promoCode });

  if (result.ok) {
    stopPoll();
    sidebar.setState({
      type: "done",
      viewerUrl: result.data.viewerUrl,
      summary: result.data.graph.summary,
      confidence: result.data.graph.confidence,
    });
    // Auto-open
    await vscode.env.openExternal(vscode.Uri.parse(result.data.viewerUrl));
    return;
  }

  if ("l402" in result) {
    pendingChallenge = result.l402;
    sidebar.setState({ type: "paying", challenge: result.l402 });
    startPoll(repoUrl, tier, idemKey, result.l402);
    return;
  }

  sidebar.setState({ type: "error", message: result.error });
}

async function cmdSubmitPreimage() {
  const state = sidebar.getState();
  if (state.type !== "paying" || !state.preimage || !pendingOpts) return;
  stopPoll();
  await doAnalyze(
    pendingOpts.repoUrl!,
    pendingOpts.tier,
    pendingOpts.idemKey,
    state.preimage,
    state.challenge.macaroon,
    pendingOpts.promoCode,
  );
}

function startPoll(repoUrl: string, _tier: string, _idemKey: string, _challenge: L402Challenge) {
  stopPoll();
  let step = 0;
  pollTimer = setInterval(() => {
    step = Math.min(step + 1, 11);
    const current = sidebar.getState();
    if (current.type === "analyzing") {
      sidebar.setState({ type: "analyzing", step, repoUrl });
    }
  }, 5000);
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function cmdOpenLast() {
  const state = sidebar.getState();
  if (state.type === "done") {
    vscode.env.openExternal(vscode.Uri.parse(state.viewerUrl));
  }
}

export function deactivate() {
  stopPoll();
}
