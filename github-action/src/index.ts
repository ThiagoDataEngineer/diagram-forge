import * as core from "@actions/core";
import * as github from "@actions/github";
import { buildComment } from "./comment.js";

interface ArchNode {
  id: string;
  label: string;
  type: string;
  technology: string;
}

interface ArchEdge {
  source: string;
  target: string;
  label?: string;
}

interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  summary: string;
  tech_stack: string[];
  confidence: number;
  analysis_steps: number;
}

interface AnalyzeResponse {
  graph: ArchGraph;
  paid_sats: number;
  cached: boolean;
  saved_file?: string;
  share_id?: string;
}

interface BenchmarkDimension {
  score: number;
  evidence: string[];
}

interface BenchmarkResponse {
  overall: number;
  grade: string;
  dimensions: Record<string, BenchmarkDimension>;
}

interface DiffSummary {
  severity: "none" | "low" | "medium" | "high" | "critical";
  added: number;
  removed: number;
  changed: number;
  description: string;
}

interface DiffResponse {
  summary: DiffSummary;
  added_nodes: ArchNode[];
  removed_nodes: ArchNode[];
  changed_edges: ArchEdge[];
}

interface ShareResponse {
  id: string;
  url: string;
}

async function post(url: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function analyze(baseUrl: string, repoUrl: string, tier: string, authToken?: string): Promise<AnalyzeResponse> {
  const res = await post(`${baseUrl}/analyze`, { repo_url: repoUrl, tier }, authToken);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/analyze failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<AnalyzeResponse>;
}

async function benchmark(baseUrl: string, graph: ArchGraph): Promise<BenchmarkResponse> {
  const res = await post(`${baseUrl}/api/benchmark`, { graph, format: "json" });
  if (!res.ok) throw new Error(`/api/benchmark failed ${res.status}`);
  return res.json() as Promise<BenchmarkResponse>;
}

async function diff(baseUrl: string, fileA: string, fileB: string): Promise<DiffResponse | null> {
  if (!fileA || !fileB) return null;
  const res = await fetch(`${baseUrl}/api/diff?a=${fileA}&b=${fileB}&format=json`);
  if (!res.ok) return null;
  return res.json() as Promise<DiffResponse>;
}

async function share(baseUrl: string, graph: ArchGraph): Promise<ShareResponse | null> {
  try {
    const res = await post(`${baseUrl}/api/share`, { graph });
    if (!res.ok) return null;
    return res.json() as Promise<ShareResponse>;
  } catch {
    return null;
  }
}

// Builds the current repo URL from GITHUB_SERVER_URL + GITHUB_REPOSITORY
function getRepoUrl(): string {
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  return `${server}/${repo}`;
}

// Gets the base repo URL for comparison (PR base branch clone)
function getBaseRepoUrl(): string {
  const base = core.getInput("base_ref") || github.context.payload.pull_request?.base?.ref;
  if (!base) return getRepoUrl();
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  return `${server}/${repo}/tree/${base}`;
}

async function run(): Promise<void> {
  const baseUrl = core.getInput("diagram_forge_url").replace(/\/$/, "");
  const l402Token = core.getInput("l402_token");
  const tier = core.getInput("tier") || "full";
  const ghToken = core.getInput("github_token");
  const shouldComment = core.getInput("post_comment") !== "false";

  const repoUrl = getRepoUrl();
  const baseRepoUrl = getBaseRepoUrl();

  core.info(`[diagram-forge] Analyzing: ${repoUrl} (tier: ${tier})`);

  // ── 1. Analyze current branch ─────────────────────────────────────────────
  let authHeader = l402Token ? `L402 ${l402Token}` : undefined;
  const current = await analyze(baseUrl, repoUrl, tier, authHeader);
  core.info(`[diagram-forge] Graph: ${current.graph.nodes.length} nodes, ${current.graph.edges.length} edges`);

  // ── 2. Analyze base branch (for diff) ────────────────────────────────────
  let baseSavedFile: string | undefined;
  let diffResult: DiffResponse | null = null;

  if (github.context.payload.pull_request) {
    try {
      // Re-acquire token for base analysis (each analysis is a separate payment)
      const baseResult = await analyze(baseUrl, baseRepoUrl, tier, authHeader);
      baseSavedFile = baseResult.saved_file;

      if (current.saved_file && baseSavedFile) {
        diffResult = await diff(baseUrl, baseSavedFile, current.saved_file);
        core.info(`[diagram-forge] Diff severity: ${diffResult?.summary.severity ?? "unknown"}`);
      }
    } catch (err) {
      core.warning(`[diagram-forge] Base branch analysis failed (skipping diff): ${err}`);
    }
  }

  // ── 3. Benchmark ──────────────────────────────────────────────────────────
  const bench = await benchmark(baseUrl, current.graph);
  core.info(`[diagram-forge] Grade: ${bench.grade} (${bench.overall}/100)`);

  // ── 4. Share ──────────────────────────────────────────────────────────────
  const shared = await share(baseUrl, current.graph);
  const shareUrl = shared ? `${baseUrl}/g/${shared.id}` : undefined;

  // ── 5. Set outputs ────────────────────────────────────────────────────────
  core.setOutput("graph_json", JSON.stringify(current.graph));
  core.setOutput("overall_score", String(bench.overall));
  core.setOutput("grade", bench.grade);
  if (shareUrl) core.setOutput("share_url", shareUrl);

  // ── 6. Post PR comment ────────────────────────────────────────────────────
  if (shouldComment && github.context.payload.pull_request && ghToken) {
    const octokit = github.getOctokit(ghToken);
    const { owner, repo } = github.context.repo;
    const prNumber = github.context.payload.pull_request.number;

    const commentBody = buildComment({
      graph: current.graph,
      bench,
      diff: diffResult,
      shareUrl,
      repoUrl,
      tier,
    });

    // Delete previous diagram-forge comments to avoid spam
    const existing = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber });
    for (const c of existing.data) {
      if (c.body?.includes("<!-- diagram-forge -->")) {
        await octokit.rest.issues.deleteComment({ owner, repo, comment_id: c.id });
      }
    }

    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: commentBody });
    core.info("[diagram-forge] PR comment posted.");
  }
}

run().catch(err => {
  core.setFailed(`Diagram Forge action failed: ${err.message}`);
});
