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
  const match = text.match(/url\s*=\s*(.+)/);
  if (!match) return undefined;
  const raw = match[1].trim();
  // normalize SSH → HTTPS
  if (raw.startsWith("git@github.com:")) {
    return "https://github.com/" + raw.slice("git@github.com:".length).replace(/\.git$/, "");
  }
  if (raw.includes("github.com")) {
    return raw.replace(/\.git$/, "");
  }
  return raw;
}

export function detectRepoInfo(root: string): { repoUrl?: string; repoPath: string } {
  const repoUrl = getGitHubRemote(root);
  return { repoUrl, repoPath: root };
}
