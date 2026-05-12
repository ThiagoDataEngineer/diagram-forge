import fs from "fs";
import path from "path";

export type ToolName =
  | "list_directory"
  | "read_file"
  | "search_pattern"
  | "detect_entry_points"
  | "finish_analysis";

// ─── Tool Definitions (sent to Claude) ────────────────────────────────────────

export const FILESYSTEM_TOOLS = [
  {
    name: "list_directory" as const,
    description:
      "List files and folders in a directory. Use this to explore the project structure. Returns names, types, and sizes. Skips node_modules, .git, dist, build automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path inside the project root. Use '.' for root.",
        },
        depth: {
          type: "number",
          description: "How many levels deep to list (1-3). Default 1.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "read_file" as const,
    description:
      "Read the content of a file. Use for config files, entry points, and key source files to understand architecture. Limit to files under 500 lines.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from project root.",
        },
        lines: {
          type: "number",
          description: "Max lines to read (default 200, max 500).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_pattern" as const,
    description:
      "Search for a text/regex pattern across project files. Use to find imports, env vars, API calls, framework usage, database connections, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Text or regex pattern to search for.",
        },
        glob: {
          type: "string",
          description:
            "File glob pattern to limit search (e.g. '**/*.ts', '**/*.py'). Optional.",
        },
        max_results: {
          type: "number",
          description: "Max results to return (default 20).",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "detect_entry_points" as const,
    description:
      "Auto-detect the main entry points and key config files of the project (package.json, Dockerfile, docker-compose, main.py, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "finish_analysis" as const,
    description:
      "Call this when you have enough information to produce the architecture diagram. Pass the complete structured graph.",
    input_schema: {
      type: "object" as const,
      properties: {
        nodes: {
          type: "array",
          description: "All service/component nodes identified.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "frontend",
                  "backend",
                  "database",
                  "cache",
                  "queue",
                  "storage",
                  "auth",
                  "gateway",
                  "external_api",
                  "ml_model",
                  "worker",
                  "cdn",
                  "monitoring",
                  "other",
                ],
              },
              technology: {
                type: "string",
                description:
                  "Specific tech used, e.g. 'Next.js', 'PostgreSQL', 'Redis'.",
              },
              description: {
                type: "string",
                description: "What this component does in one sentence.",
              },
              metadata: {
                type: "object",
                description: "Any extra info: port, version, env vars used.",
              },
            },
            required: ["id", "label", "type", "technology"],
          },
        },
        edges: {
          type: "array",
          description: "Connections between nodes (data flows).",
          items: {
            type: "object",
            properties: {
              from: { type: "string", description: "Source node id." },
              to: { type: "string", description: "Target node id." },
              label: {
                type: "string",
                description: "What flows through this connection.",
              },
              protocol: {
                type: "string",
                enum: [
                  "HTTP",
                  "HTTPS",
                  "WebSocket",
                  "gRPC",
                  "TCP",
                  "AMQP",
                  "SQL",
                  "Redis",
                  "GraphQL",
                  "tRPC",
                  "Lightning",
                  "Unknown",
                ],
              },
              direction: {
                type: "string",
                enum: ["unidirectional", "bidirectional"],
              },
              async: {
                type: "boolean",
                description: "Is this connection asynchronous?",
              },
            },
            required: ["from", "to", "protocol", "direction"],
          },
        },
        summary: {
          type: "string",
          description: "2-3 sentence summary of the architecture.",
        },
        tech_stack: {
          type: "array",
          items: { type: "string" },
          description: "Full list of technologies detected.",
        },
        confidence: {
          type: "number",
          description: "Analysis confidence 0-1 based on how much code was readable.",
        },
      },
      required: ["nodes", "edges", "summary", "tech_stack", "confidence"],
    },
  },
];

// ─── Tool Execution (runs locally, results sent back to Claude) ───────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  "coverage",
  ".turbo",
  "out",
  "target",
  ".cargo",
]);

export function executeListDirectory(
  projectRoot: string,
  relPath: string,
  depth = 1
): string {
  const absPath = path.resolve(projectRoot, relPath);

  const err = assertWithinRoot(absPath, projectRoot);
  if (err) return err;

  if (!fs.existsSync(absPath)) {
    return `Error: path '${relPath}' does not exist.`;
  }

  const lines: string[] = [];

  function walk(dir: string, currentDepth: number, prefix: string) {
    if (currentDepth > depth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) {
        if (entry.name !== ".env.example" && entry.name !== ".github") continue;
      }
      const fullEntryPath = path.join(dir, entry.name);
      // Fix 3: skip symlinks during directory walk to prevent symlink traversal
      if (entry.isSymbolicLink()) continue;
      const icon = entry.isDirectory() ? "📁" : "📄";
      const size = entry.isFile()
        ? ` (${(fs.statSync(fullEntryPath).size / 1024).toFixed(1)}kb)`
        : "";
      lines.push(`${prefix}${icon} ${entry.name}${size}`);
      if (entry.isDirectory() && currentDepth < depth) {
        walk(fullEntryPath, currentDepth + 1, prefix + "  ");
      }
    }
  }

  walk(absPath, 1, "");
  return lines.length > 0 ? lines.join("\n") : "Empty directory.";
}

// Resolves ALL symlinks in the path (not just the final component) and verifies
// the real path stays within projectRoot. Handles intermediate symlinks too.
function assertWithinRoot(absPath: string, projectRoot: string): string | null {
  let rootReal: string;
  try {
    rootReal = fs.realpathSync.native(projectRoot);
  } catch {
    rootReal = path.resolve(projectRoot);
  }
  // Check nominal path first (fast path for non-symlink cases)
  const nominal = path.resolve(absPath);
  if (!nominal.startsWith(rootReal + path.sep) && nominal !== rootReal) {
    return "Error: path traversal not allowed.";
  }
  // Fully resolve all symlinks in the path (catches intermediate symlinks)
  try {
    const real = fs.realpathSync.native(absPath);
    if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
      return "Error: symlink escapes project root — skipped for security.";
    }
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null; // file doesn't exist yet — nominal check passed above
    return "Error: cannot resolve path.";
  }
  return null; // OK
}

export function executeReadFile(
  projectRoot: string,
  relPath: string,
  maxLines = 200
): string {
  const absPath = path.resolve(projectRoot, relPath);

  const err = assertWithinRoot(absPath, projectRoot);
  if (err) return err;

  if (!fs.existsSync(absPath)) {
    return `Error: file '${relPath}' not found.`;
  }

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    return `'${relPath}' is a directory. Use list_directory to explore it.`;
  }
  if (stat.size > 500_000) {
    return `File too large (${(stat.size / 1024).toFixed(0)}kb). Use search_pattern instead.`;
  }

  const content = fs.readFileSync(absPath, "utf-8");
  const lines = content.split("\n");
  const capped = Math.min(maxLines, 500);

  if (lines.length > capped) {
    return (
      lines.slice(0, capped).join("\n") +
      `\n\n[... ${lines.length - capped} more lines truncated]`
    );
  }

  return content;
}

export function executeSearchPattern(
  projectRoot: string,
  pattern: string,
  glob?: string,
  maxResults = 20
): string {
  const results: string[] = [];
  const regex = new RegExp(pattern, "i");

  function walkSearch(dir: string) {
    if (results.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(projectRoot, fullPath);

      if (entry.isDirectory()) {
        walkSearch(fullPath);
      } else if (entry.isFile()) {
        if (glob) {
          const ext = glob.replace("**/*", "").replace("*", "");
          if (ext && !entry.name.endsWith(ext)) continue;
        }

        let content: string;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 200_000) continue;
          content = fs.readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
            if (results.length >= maxResults) break;
          }
        }
      }
    }
  }

  walkSearch(projectRoot);
  return results.length > 0
    ? results.join("\n")
    : `No matches found for pattern: ${pattern}`;
}

const ENTRY_POINT_PATTERNS = [
  // JS/TS
  "package.json",
  "turbo.json",
  "nx.json",
  "lerna.json",
  // Python
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  // Data / ML / Databricks
  "databricks.yml",
  "databricks.yaml",
  ".databrickscfg",
  "mlflow.yaml",
  "dbt_project.yml",
  "airflow.cfg",
  "metaflow.yaml",
  // JVM
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "build.sbt",
  // Go / Rust / Other
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  // Mobile
  "pubspec.yaml",
  "android/build.gradle",
  "ios/Podfile",
  // Infrastructure
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "serverless.yml",
  "serverless.yaml",
  "terraform.tf",
  "main.tf",
  "Chart.yaml",
  // Docs
  ".env.example",
  "README.md",
];

export function executeDetectEntryPoints(projectRoot: string): string {
  const found: string[] = [];

  for (const pattern of ENTRY_POINT_PATTERNS) {
    const p = path.join(projectRoot, pattern);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      found.push(`${pattern} (${(stat.size / 1024).toFixed(1)}kb)`);
    }
  }

  // look for Jupyter / Databricks notebooks
  const notebookDirs = ["notebooks", "nbs", "analysis", "explore", "."];
  for (const dir of notebookDirs) {
    const dirPath = path.join(projectRoot, dir);
    if (!fs.existsSync(dirPath)) continue;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const notebooks = entries.filter(
        (e) => e.isFile() && (e.name.endsWith(".ipynb") || e.name.endsWith(".dbc"))
      );
      if (notebooks.length > 0) {
        found.push(
          `${dir === "." ? "root" : dir}/ — ${notebooks.length} notebook(s) found (e.g. ${notebooks[0].name})`
        );
      }
    } catch {
      // ignore
    }
  }

  // also look for monorepo packages
  const packages = path.join(projectRoot, "packages");
  const apps = path.join(projectRoot, "apps");
  if (fs.existsSync(packages)) {
    const dirs = fs.readdirSync(packages, { withFileTypes: true });
    dirs.filter((d) => d.isDirectory()).forEach((d) => {
      found.push(`packages/${d.name}/ (monorepo package)`);
    });
  }
  if (fs.existsSync(apps)) {
    const dirs = fs.readdirSync(apps, { withFileTypes: true });
    dirs.filter((d) => d.isDirectory()).forEach((d) => {
      found.push(`apps/${d.name}/ (monorepo app)`);
    });
  }

  return found.length > 0
    ? "Entry points detected:\n" + found.join("\n")
    : "No standard entry points found. Try listing the root directory.";
}
