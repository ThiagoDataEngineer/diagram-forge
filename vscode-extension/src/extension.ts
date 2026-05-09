import * as vscode from "vscode";
import * as crypto from "crypto";
import { SidebarProvider } from "./panel";
import { detectRepoInfo } from "./git";
import { analyze, checkPayment, L402Challenge, StreamEvent } from "./client";

const SERVER = "https://diagram-forge.onrender.com";
const GITHUB_TOKEN_KEY = "githubToken";

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
    vscode.commands.registerCommand("diagramForge.openLast", cmdOpenLast),
    vscode.commands.registerCommand("diagramForge.connectGitHub", () => cmdConnectGitHub(context)),
    vscode.commands.registerCommand("diagramForge.disconnectGitHub", () => cmdDisconnectGitHub(context)),
  );

  // URI handler — receives vscode://ShinyDapps.diagram-forge/auth/github?token=xxx
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        // fire-and-forget: never block the URI handler with await
        void handleOAuthCallback(uri, context);
      },
    })
  );

  // Restore GitHub connection status in panel on activation
  void context.secrets.get(GITHUB_TOKEN_KEY).then((token) => {
    if (token) sidebar.setGitHubConnected(true);
  });
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

  let sseStep = 1;
  const onSseProgress = (event: StreamEvent) => {
    if (event.type === "tool_call" || event.type === "progress") {
      sseStep = Math.min((event.iteration ?? sseStep) + 1, 11);
      const current = sidebar.getState();
      if (current.type === "analyzing") {
        sidebar.setState({ type: "analyzing", step: sseStep, repoUrl: repoUrl ?? "" });
      }
    }
  };

  // Start fake progress only as fallback for servers that don't stream
  startFakeProgress(repoUrl);

  try {
    const result = await withTimeout(
      analyze({ repoUrl, tier, idempotencyKey: idemKey, preimage, macaroon, promoCode, onProgress: onSseProgress }),
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
        // Dev/mock mode: server returned preimage — auto-continue
        stopPoll();
        await doAnalyze(
          pendingOpts.repoUrl!,
          pendingOpts.tier,
          pendingOpts.idemKey,
          preimage,
          challenge.macaroon,
          pendingOpts.promoCode,
        );
      } else if (paid && !preimage) {
        // Production Lightning: server confirmed paid but won't return preimage.
        // Surface the preimage input prominently so the user can paste it from their wallet.
        stopPoll();
        const cur = sidebar.getState();
        if (cur.type === "paying") {
          sidebar.setState({ ...cur, paidConfirmed: true });
        }
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

async function cmdConnectGitHub(context: vscode.ExtensionContext): Promise<void> {
  const existing = await context.secrets.get(GITHUB_TOKEN_KEY);
  if (existing) {
    vscode.window.showInformationMessage("GitHub already connected. Use 'Diagram Forge: Disconnect GitHub' to unlink.");
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(`${SERVER}/auth/github/vscode`));
}

async function cmdDisconnectGitHub(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(GITHUB_TOKEN_KEY);
  sidebar.setGitHubConnected(false);
  vscode.window.showInformationMessage("GitHub account disconnected.");
}

async function handleOAuthCallback(uri: vscode.Uri, context: vscode.ExtensionContext): Promise<void> {
  if (uri.path !== "/auth/github") return;
  const params = new URLSearchParams(uri.query);
  const token = params.get("token");
  if (!token) {
    vscode.window.showErrorMessage("GitHub auth failed — no token in callback.");
    return;
  }
  await context.secrets.store(GITHUB_TOKEN_KEY, token);
  sidebar.setGitHubConnected(true);
  vscode.window.showInformationMessage("✓ GitHub connected — public repos unlocked.");
}

export function deactivate() {
  stopPoll();
  stopFakeProgress();
}