import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getGitHubRemote(root: string): string | undefined {
  const configPath = path.join(root, ".git", "config");
  if (!fs.existsSync(configPath)) return undefined;
  const text = fs.readFileSync(configPath, "utf8");

  // Collect all remote URLs, prefer github.com ones
  const allUrls = [...text.matchAll(/url\s*=\s*(.+)/g)].map(m => m[1].trim());
  const raw = allUrls.find(u => u.includes("github.com"));
  if (!raw) return undefined; // non-GitHub remote → trigger manual URL input

  if (raw.startsWith("git@github.com:")) {
    return "https://github.com/" + raw.slice("git@github.com:".length).replace(/\.git$/, "");
  }
  return raw.replace(/\.git$/, "");
}

export function detectRepoInfo(root: string): { repoUrl?: string; repoPath: string } {
  const repoUrl = getGitHubRemote(root);
  return { repoUrl, repoPath: root };
}