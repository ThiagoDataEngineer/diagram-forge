import { execFile } from "child_process";
import { promisify } from "util";
import { promises as dns } from "dns";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

const exec = promisify(execFile);

const CLONE_BASE = path.join(os.tmpdir(), "df-clones");

// ── 1.2: Exact-match allowlist (endsWith would allow github.com.evil.tld) ────

const ALLOWED_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

// ── 1.2: Private/loopback IP detection ───────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  if (
    /^10\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^127\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^0\./.test(ip)
  ) return true;
  // IPv6 loopback + ULA + link-local
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

async function assertNotPrivateHost(hostname: string): Promise<void> {
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("DNS lookup failed for host: " + hostname);
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error("Repository host resolves to a private/loopback address — blocked for security.");
    }
  }
}

export function parseRepoUrl(raw: string): { url: string; org: string; repo: string } {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid URL: " + raw); }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTPS URLs are allowed (got " + url.protocol + ")");
  }
  // 1.2: exact match — endsWith would allow github.com.attacker.com
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("Only GitHub, GitLab, and Bitbucket URLs are supported.");
  }

  const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
  if (parts.length < 2) throw new Error("URL must include org/repo path.");

  const [org, repo] = parts;
  // Sanitize: only allow safe chars
  if (!/^[\w.-]+$/.test(org) || !/^[\w.-]+$/.test(repo)) {
    throw new Error("Repo path contains invalid characters.");
  }

  // Reconstruct clean HTTPS URL
  const cleanUrl = `https://${url.hostname}/${org}/${repo}.git`;
  return { url: cleanUrl, org, repo };
}

// ── Clone ─────────────────────────────────────────────────────────────────────

export interface CloneResult {
  localPath: string;
  cleanup: () => void;
}

export async function cloneRepo(
  repoUrl: string,
  onProgress?: (msg: string) => void
): Promise<CloneResult> {
  const { url, org, repo } = parseRepoUrl(repoUrl);
  const id = crypto.randomBytes(6).toString("hex");
  const cloneDir = path.join(CLONE_BASE, `${org}-${repo}-${id}`);

  // Ensure base dir exists
  fs.mkdirSync(CLONE_BASE, { recursive: true });

  // 1.2: DNS check — reject if host resolves to private/loopback IP
  await assertNotPrivateHost(new URL(url).hostname);

  onProgress?.(`Cloning ${org}/${repo}…`);

  try {
    await exec("git", [
      "clone",
      "--depth=1",          // shallow — only latest commit
      "--single-branch",
      "--no-tags",
      "--quiet",
      url,
      cloneDir,
    ], {
      timeout: 60_000,      // 60s max
      // 1.4: whitelist env — prevents leaking ANTHROPIC_API_KEY, SSH_*, GIT_CREDENTIALS, etc.
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? os.tmpdir(),
        LANG: process.env.LANG ?? "C.UTF-8",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        GCM_INTERACTIVE: "never",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  } catch (err) {
    // Clean up partial clone
    fs.rmSync(cloneDir, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Repository not found") || msg.includes("does not exist")) {
      throw new Error(`Repository not found or is private: ${org}/${repo}`);
    }
    throw new Error(`Clone failed: ${msg.slice(0, 200)}`);
  }

  onProgress?.(`Cloned ${org}/${repo} → ${cloneDir}`);

  const cleanup = () => {
    try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { localPath: cloneDir, cleanup };
}
