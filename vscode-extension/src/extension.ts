import * as vscode from "vscode";
import * as crypto from "crypto";
import { SidebarProvider } from "./panel";
import { detectRepoInfo } from "./git";
import { analyze, checkPayment, L402Challenge } from "./client";

let sidebar: SidebarProvider;
let pendingOpts: { repoUrl?: string; tier: "basic" | "full" | "live"; idemKey: string; promoCode?: string } | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let fakeProgressTimer: NodeJS.Timeout | null = null;

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
    vscode.commands.registerCommand("diagramForge.openBenchmark", cmdOpenBenchmark),
    vscode.commands.registerCommand("diagramForge.openDiff", cmdOpenDiff),
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

  // Restore previous tier so "Retry" / "Analyze another" doesn't reset to basic
  const previousTier = pendingOpts?.tier ?? "basic";
  sidebar.setState({ type: "confirming", repoUrl, tier: previousTier });
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
  startFakeProgress(repoUrl);

  try {
    const result = await withTimeout(
      analyze({ repoUrl, tier, idempotencyKey: idemKey, preimage, macaroon, promoCode }),
      3 * 60 * 1000,
      "Analysis timed out after 3 minutes. The server may be warming up — try again in 30 seconds."
    );

    if (result.ok) {
      stopPoll();
      sidebar.setState({
        type: "done",
        viewerUrl: result.data.viewerUrl,
        summary: result.data.graph.summary,
        confidence: result.data.graph.confidence,
      });
      return;
    }

    if ("l402" in result) {
      sidebar.setState({ type: "paying", challenge: result.l402 });
      startPoll(repoUrl, tier, idemKey, result.l402);
      return;
    }

    sidebar.setState({ type: "error", message: friendlyError(result.error) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    sidebar.setState({ type: "error", message: friendlyError(msg) });
  } finally {
    stopFakeProgress();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function friendlyError(msg: string): string {
  if (msg.includes("invalid_code") || msg.includes("promo")) return "Promo code is invalid or expired. Leave it blank for a free trial.";
  if (msg.includes("daily_limit") || msg.includes("429")) return "Free daily limit reached. Use a Lightning payment to continue.";
  if (msg.includes("timed out") || msg.includes("abort")) return msg;
  if (msg.includes("403") || msg.toLowerCase().includes("forbidden")) return "Access blocked — try on a different network (corporate proxy detected).";
  if (msg.includes("Failed to fetch") || msg.includes("ECONNREFUSED")) return "Could not reach server. Check your internet connection.";
  return msg;
}

function startFakeProgress(repoUrl: string) {
  stopFakeProgress();
  let step = 1;
  // 11 steps × 15 s = ~165 s total fake progress window
  fakeProgressTimer = setInterval(() => {
    step = Math.min(step + 1, 11);
    const current = sidebar.getState();
    if (current.type === "analyzing") {
      sidebar.setState({ type: "analyzing", step, repoUrl });
    }
  }, 15_000);
}

function stopFakeProgress() {
  if (fakeProgressTimer) { clearInterval(fakeProgressTimer); fakeProgressTimer = null; }
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

function startPoll(_repoUrl: string, _tier: string, _idemKey: string, challenge: L402Challenge) {
  stopPoll();
  pollTimer = setInterval(async () => {
    if (challenge.paymentHash && pendingOpts) {
      const { paid, preimage } = await checkPayment(challenge.paymentHash).catch(() => ({ paid: false, preimage: null }));
      if (paid && preimage) {
        stopPoll();
        await doAnalyze(
          pendingOpts.repoUrl!,
          pendingOpts.tier,
          pendingOpts.idemKey,
          preimage,
          challenge.macaroon,
          pendingOpts.promoCode,
        );
      }
    }
  }, 3000);
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function cmdOpenBenchmark() {
  const state = sidebar.getState();
  if (state.type === "done") {
    vscode.env.openExternal(vscode.Uri.parse(state.viewerUrl + "#benchmark"));
  }
}

function cmdOpenDiff() {
  const state = sidebar.getState();
  if (state.type === "done") {
    vscode.env.openExternal(vscode.Uri.parse(state.viewerUrl + "#diff"));
  }
}

function cmdOpenLast() {
  const state = sidebar.getState();
  if (state.type === "done") {
    vscode.env.openExternal(vscode.Uri.parse(state.viewerUrl));
  }
}

export function deactivate() {
  stopPoll();
  stopFakeProgress();
}