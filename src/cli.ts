#!/usr/bin/env node
import path from "path";
import fs from "fs";
import { analyzeProject } from "./analyzer/agent.js";
import type { ArchitectureGraph } from "./analyzer/agent.js";
import { getLocalSha, getCachedGraph, setCachedGraph } from "./cache/graph-cache.js";

// ─── Pretty Print Graph ───────────────────────────────────────────────────────

function printGraph(graph: ArchitectureGraph) {
  const NODE_ICONS: Record<string, string> = {
    frontend: "🌐",
    backend: "⚙️ ",
    database: "🗄️ ",
    cache: "⚡",
    queue: "📨",
    storage: "🪣",
    auth: "🔐",
    gateway: "🚪",
    external_api: "🌍",
    ml_model: "🧠",
    worker: "🔧",
    cdn: "☁️ ",
    monitoring: "📊",
    other: "📦",
  };

  console.log("\n" + "═".repeat(60));
  console.log("  DIAGRAM FORGE — Architecture Analysis");
  console.log("═".repeat(60));

  console.log(`\n📋 Summary\n${graph.summary}`);
  console.log(`\n🛠  Tech Stack: ${graph.tech_stack.join(", ")}`);
  console.log(
    `📊 Confidence: ${(graph.confidence * 100).toFixed(0)}% | Steps: ${graph.analysis_steps}`
  );

  console.log("\n─── NODES " + "─".repeat(51));
  for (const node of graph.nodes) {
    const icon = NODE_ICONS[node.type] ?? "📦";
    console.log(`\n  ${icon} [${node.id}] ${node.label}`);
    console.log(`     Type: ${node.type} | Tech: ${node.technology}`);
    if (node.description) console.log(`     ${node.description}`);
    if (node.metadata && Object.keys(node.metadata).length > 0) {
      console.log(`     Meta: ${JSON.stringify(node.metadata)}`);
    }
  }

  console.log("\n─── EDGES " + "─".repeat(51));
  for (const edge of graph.edges) {
    const arrow = edge.direction === "bidirectional" ? "◄►" : "──►";
    const async_ = edge.async ? " (async)" : "";
    const label = edge.label ? ` [${edge.label}]` : "";
    console.log(
      `  ${edge.from} ${arrow} ${edge.to} | ${edge.protocol}${label}${async_}`
    );
  }

  console.log("\n" + "═".repeat(60) + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`
Diagram Forge — AI-powered architecture diagram generator

Usage:
  tsx src/cli.ts <project-path> [options]

Options:
  --output <file>    Save graph as JSON (e.g. --output graph.json)
  --model <model>    Claude model (default: claude-sonnet-4-6)
  --help             Show this help

Examples:
  tsx src/cli.ts ./my-project
  tsx src/cli.ts /home/user/my-api --output diagram.json
  tsx src/cli.ts . --model claude-opus-4-7
    `);
    process.exit(0);
  }

  const projectPath = path.resolve(args[0]);
  const outputFlag = args.indexOf("--output");
  const outputFile = outputFlag !== -1 ? args[outputFlag + 1] : null;
  const modelFlag = args.indexOf("--model");
  const model = modelFlag !== -1 ? args[modelFlag + 1] : undefined;

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: path not found: ${projectPath}`);
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    console.error("Set it with: set ANTHROPIC_API_KEY=sk-ant-...");
    process.exit(1);
  }

  console.log(`\n🔍 Analyzing: ${projectPath}`);

  try {
    // ── Cache check ──────────────────────────────────────────────────────────
    const sha = getLocalSha(projectPath);
    if (sha) {
      const cached = getCachedGraph(projectPath, sha);
      if (cached) {
        console.log(`  ⚡ Cache hit (sha ${sha.slice(0, 8)}) — skipping API call`);
        printGraph(cached);
        if (outputFile) {
          fs.writeFileSync(outputFile, JSON.stringify(cached, null, 2), "utf-8");
          console.log(`💾 Graph saved to: ${outputFile}`);
        }
        process.exit(0);
      }
    }

    // ── Full analysis ────────────────────────────────────────────────────────
    const graph = await analyzeProject(projectPath, {
      ...(model ? { model } : {}),
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    if (sha) setCachedGraph(projectPath, sha, graph);

    printGraph(graph);

    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(graph, null, 2), "utf-8");
      console.log(`💾 Graph saved to: ${outputFile}`);
    }
  } catch (err) {
    console.error("\n❌ Analysis failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
