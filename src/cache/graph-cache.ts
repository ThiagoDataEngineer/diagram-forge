import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import type { ArchitectureGraph } from "../analyzer/agent.js";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Key derivation ───────────────────────────────────────────────────────────

function cacheKey(identifier: string, sha: string): string {
  return crypto
    .createHash("sha256")
    .update(`${identifier}:${sha}`)
    .digest("hex")
    .slice(0, 16);
}

function cacheFile(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

// ─── Git SHA helpers ──────────────────────────────────────────────────────────

/** Get HEAD SHA from a local git repo. Returns null if not a git repo. */
export function getLocalSha(repoPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/** Get HEAD SHA from a remote URL without cloning (uses git ls-remote). */
export function getRemoteSha(repoUrl: string): string | null {
  try {
    const out = execSync(`git ls-remote --quiet --exit-code "${repoUrl}" HEAD`, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sha = out.split("\t")[0].trim();
    return sha.length === 40 || sha.length === 64 ? sha : null;
  } catch {
    return null;
  }
}

// ─── Cache read / write ───────────────────────────────────────────────────────

export interface CachedGraph extends ArchitectureGraph {
  _cached_at: string;
  _sha: string;
  _identifier: string;
}

export function getCachedGraph(identifier: string, sha: string): CachedGraph | null {
  if (!sha) return null;

  const file = cacheFile(cacheKey(identifier, sha));
  if (!fs.existsSync(file)) return null;

  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(file);
      return null;
    }
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CachedGraph;
  } catch {
    return null;
  }
}

export function setCachedGraph(
  identifier: string,
  sha: string,
  graph: ArchitectureGraph
): void {
  if (!sha) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const payload: CachedGraph = {
    ...graph,
    _cached_at: new Date().toISOString(),
    _sha: sha,
    _identifier: identifier,
  };

  fs.writeFileSync(cacheFile(cacheKey(identifier, sha)), JSON.stringify(payload, null, 2), "utf-8");
}

/** Remove cache entries older than TTL. */
export function pruneCache(): number {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (!f.endsWith(".json")) continue;
    const file = path.join(CACHE_DIR, f);
    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
        fs.unlinkSync(file);
        removed++;
      }
    } catch { /* ignore */ }
  }
  return removed;
}
