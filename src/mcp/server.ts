import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import fs from "fs";
import { analyzeProject } from "../analyzer/agent.js";
import { diffGraphs, diffToMarkdown } from "../analyzer/diff.js";
import { benchmarkGraph, benchmarkToMarkdown, loadReferenceGraphs } from "../analyzer/benchmark.js";
import type { ArchitectureGraph } from "../analyzer/agent.js";

// ─── Server definition ────────────────────────────────────────────────────────

const server = new Server(
  { name: "diagram-forge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool: list ───────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "analyze_architecture",
      description:
        "Analyze a software project and return a complete architecture diagram as JSON. " +
        "Detects services, databases, caches, queues, external APIs and the connections between them. " +
        "Works with any language or framework (Node, Python, Java, Go, Rust, mobile, data/ML, infra).",
      inputSchema: {
        type: "object",
        properties: {
          project_path: {
            type: "string",
            description: "Absolute path to the project root directory to analyze.",
          },
          tier: {
            type: "string",
            enum: ["basic", "full"],
            description: "Analysis depth. 'basic' = faster (8 steps), 'full' = deeper (12 steps). Default: full.",
          },
        },
        required: ["project_path"],
      },
    },
    {
      name: "diff_architectures",
      description:
        "Compare two architecture snapshots and return a structured diff: added/removed/changed services, " +
        "new/removed connections, architecture pattern changes, and confidence delta. " +
        "Accepts saved graph JSON files (from analyze_architecture) or inline graph objects. " +
        "Perfect for CI/CD pipelines — run on every PR to detect architectural drift.",
      inputSchema: {
        type: "object",
        properties: {
          graph_a: {
            type: "object",
            description: "The baseline (older) architecture graph JSON. Use the graph object returned by analyze_architecture.",
          },
          graph_b: {
            type: "object",
            description: "The current (newer) architecture graph JSON to compare against the baseline.",
          },
          file_a: {
            type: "string",
            description: "Alternative to graph_a: filename of a saved graph in data/graphs/ (e.g. 'my-project-graph.json').",
          },
          file_b: {
            type: "string",
            description: "Alternative to graph_b: filename of a saved graph in data/graphs/.",
          },
          format: {
            type: "string",
            enum: ["json", "markdown", "both"],
            description: "Output format. 'json' = structured diff, 'markdown' = ARCHITECTURE-DIFF.md report, 'both' = both. Default: both.",
          },
        },
      },
    },
    {
      name: "analyze_from_image",
      description:
        "Extract an architecture graph from a diagram image — whiteboard photo, screenshot, Visio/Lucidchart export, " +
        "PDF, or any visual representation. Claude reads the image and returns the same structured ArchitectureGraph " +
        "JSON as analyze_architecture. Supports JPEG, PNG, WebP, GIF, PDF.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Absolute path to the image file on disk (JPEG, PNG, WebP, GIF, or PDF).",
          },
          hint: {
            type: "string",
            description: "Optional context to help Claude interpret the diagram (e.g. 'This is a microservices diagram for a fintech app').",
          },
        },
        required: ["image_path"],
      },
    },
    {
      name: "get_diagram_url",
      description:
        "After running analyze_architecture, get a localhost URL to view the interactive diagram in a browser.",
      inputSchema: {
        type: "object",
        properties: {
          graph_file: {
            type: "string",
            description: "Name of the saved graph JSON file (returned by analyze_architecture).",
          },
        },
        required: ["graph_file"],
      },
    },
    {
      name: "benchmark_architecture",
      description:
        "Score an architecture on 6 dimensions (resilience, observability, security, scalability, simplicity, async coverage) " +
        "and compare against industry reference patterns (microservices, monolith, event-driven, serverless, data pipeline). " +
        "Returns overall grade, dimension scores, SPOFs, pattern similarity, and actionable insights.",
      inputSchema: {
        type: "object",
        properties: {
          graph: {
            type: "object",
            description: "Inline architecture graph JSON object (from analyze_architecture or POST /analyze).",
          },
          graph_file: {
            type: "string",
            description: "Alternative to graph: filename of a saved graph in data/graphs/ (e.g. 'my-project-graph.json').",
          },
          cost_context: {
            type: "object",
            description:
              "Optional monthly cost per service in USD. Keys = service labels (case-insensitive), values = USD/month. " +
              "Example: { \"Database\": 300, \"Redis\": 50, \"Auth Service\": 400 }. " +
              "Adds Cost Analysis section: concentration risk, SPOF spend, efficiency score, and cost insights.",
            additionalProperties: { type: "number" },
          },
          format: {
            type: "string",
            enum: ["json", "markdown", "both"],
            description: "Output format. 'json' = structured result, 'markdown' = full report, 'both' = both. Default: both.",
          },
        },
      },
    },
  ],
}));

// ─── Tool: call ───────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  // ── analyze_architecture ─────────────────────────────────────────────────
  if (name === "analyze_architecture") {
    const projectPath = args?.project_path as string;
    const tier = (args?.tier as "basic" | "full") ?? "full";

    if (!projectPath) {
      return { content: [{ type: "text", text: "Error: project_path is required." }], isError: true };
    }

    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved)) {
      return { content: [{ type: "text", text: `Error: path not found: ${resolved}` }], isError: true };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { content: [{ type: "text", text: "Error: ANTHROPIC_API_KEY environment variable not set." }], isError: true };
    }

    const steps: string[] = [];
    try {
      const graph = await analyzeProject(resolved, {
        apiKey,
        tier,
        onProgress: (msg) => steps.push(msg),
      });

      // Save graph to data/graphs/
      const dataDir = path.join(path.dirname(path.dirname(__dirname)), "data", "graphs");
      fs.mkdirSync(dataDir, { recursive: true });
      const slug = path.basename(resolved).toLowerCase().replace(/[^a-z0-9]/g, "-");
      const filename = `${slug}-graph.json`;
      fs.writeFileSync(path.join(dataDir, filename), JSON.stringify(graph, null, 2));

      const summary = [
        `✓ Architecture analysis complete`,
        `  Project: ${resolved}`,
        `  Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length} | Confidence: ${Math.round(graph.confidence * 100)}%`,
        `  Tech stack: ${graph.tech_stack.slice(0, 6).join(", ")}`,
        `  Summary: ${graph.summary}`,
        ``,
        `  Saved: ${filename}`,
        `  View: http://localhost:3000/view?file=${filename}`,
        ``,
        `  Use get_diagram_url tool to open the interactive viewer.`,
      ].join("\n");

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(graph, null, 2) },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Analysis failed: ${msg}\n\nSteps:\n${steps.join("\n")}` }],
        isError: true,
      };
    }
  }

  // ── diff_architectures ───────────────────────────────────────────────────
  if (name === "diff_architectures") {
    const format = (args?.format as string) ?? "both";
    const dataDir = path.join(path.dirname(path.dirname(__dirname)), "data", "graphs");

    const loadFile = (filename: string): ArchitectureGraph | null => {
      const candidates = [
        path.resolve(filename),
        path.join(dataDir, filename),
        path.join(dataDir, filename + ".json"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { /* try next */ }
        }
      }
      return null;
    };

    let graphA = args?.graph_a as ArchitectureGraph | undefined;
    let graphB = args?.graph_b as ArchitectureGraph | undefined;

    if (!graphA && args?.file_a) {
      const loaded = loadFile(args.file_a as string);
      if (!loaded) return { content: [{ type: "text", text: `Error: file not found: ${args.file_a}` }], isError: true };
      graphA = loaded;
    }
    if (!graphB && args?.file_b) {
      const loaded = loadFile(args.file_b as string);
      if (!loaded) return { content: [{ type: "text", text: `Error: file not found: ${args.file_b}` }], isError: true };
      graphB = loaded;
    }

    if (!graphA || !Array.isArray(graphA.nodes)) {
      return { content: [{ type: "text", text: "Error: provide graph_a (object) or file_a (filename) for the baseline graph." }], isError: true };
    }
    if (!graphB || !Array.isArray(graphB.nodes)) {
      return { content: [{ type: "text", text: "Error: provide graph_b (object) or file_b (filename) for the current graph." }], isError: true };
    }

    const diff = diffGraphs(graphA, graphB);
    const s = diff.summary;

    const shortSummary = [
      `✓ Architecture diff complete`,
      `  Services: ${s.old_nodes} → ${s.new_nodes}  (${s.nodes_added > 0 ? "+" + s.nodes_added : ""}${s.nodes_removed > 0 ? " -" + s.nodes_removed : ""} ${s.nodes_changed > 0 ? "~" + s.nodes_changed : ""})`.replace(/\s+/g, " ").trim(),
      `  Connections: ${s.old_edges} → ${s.new_edges}`,
      `  Confidence: ${s.confidence_old}% → ${s.confidence_new}% (${s.confidence_delta >= 0 ? "+" : ""}${s.confidence_delta}%)`,
      `  Severity: ${s.severity.toUpperCase()}`,
      s.nodes_added    ? `  Added: ${diff.added_nodes.map(n => n.label).join(", ")}` : "",
      s.nodes_removed  ? `  Removed: ${diff.removed_nodes.map(n => n.label).join(", ")}` : "",
      s.nodes_changed  ? `  Changed: ${diff.changed_nodes.map(n => `${n.label} (${n.change})`).join("; ")}` : "",
      diff.added_patterns.length   ? `  New patterns: ${diff.added_patterns.join(", ")}` : "",
      diff.removed_patterns.length ? `  Removed patterns: ${diff.removed_patterns.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const content: Array<{ type: "text"; text: string }> = [
      { type: "text", text: shortSummary },
    ];

    if (format === "json" || format === "both") {
      content.push({ type: "text", text: JSON.stringify(diff, null, 2) });
    }
    if (format === "markdown" || format === "both") {
      const labelA = (args?.file_a as string | undefined) ? path.basename((args!.file_a) as string, ".json") : "baseline";
      const labelB = (args?.file_b as string | undefined) ? path.basename((args!.file_b) as string, ".json") : "current";
      content.push({ type: "text", text: diffToMarkdown(diff, labelA, labelB) });
    }

    return { content };
  }

  // ── analyze_from_image ───────────────────────────────────────────────────
  if (name === "analyze_from_image") {
    const imagePath = args?.image_path as string | undefined;
    const hint      = args?.hint as string | undefined;

    if (!imagePath) {
      return { content: [{ type: "text", text: "Error: image_path is required." }], isError: true };
    }

    const resolved = path.resolve(imagePath);
    if (!fs.existsSync(resolved)) {
      return { content: [{ type: "text", text: `Error: file not found: ${resolved}` }], isError: true };
    }

    const ext = path.extname(resolved).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
      ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
    };
    const mediaType = mimeMap[ext];
    if (!mediaType) {
      return { content: [{ type: "text", text: `Error: unsupported file type ${ext}. Supported: jpg, png, webp, gif, pdf.` }], isError: true };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { content: [{ type: "text", text: "Error: ANTHROPIC_API_KEY not set." }], isError: true };
    }

    const IMAGE_PROMPT = `You are an expert software architect analyzing an architecture diagram image.
Extract every visible component, service, database, queue, and connection.
Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "nodes": [{ "id": "snake_case", "label": "Name", "type": "frontend|backend|database|cache|queue|storage|auth|gateway|external_api|ml_model|worker|cdn|monitoring|other", "technology": "Tech", "description": "what it does" }],
  "edges": [{ "from": "id", "to": "id", "protocol": "HTTP|HTTPS|SQL|Redis|gRPC|AMQP|WebSocket|GraphQL|unknown", "direction": "unidirectional|bidirectional", "label": "optional", "async": false }],
  "summary": "2-3 sentence architecture description.",
  "tech_stack": ["Tech1"],
  "confidence": 0.0
}
confidence: 0.9 clear diagram, 0.7 legible whiteboard, 0.5 rough sketch.${hint ? `\nUser context: ${hint}` : ""}`;

    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client    = new Anthropic({ apiKey });
      const imageData = fs.readFileSync(resolved).toString("base64");

      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: imageData } },
            { type: "text", text: IMAGE_PROMPT },
          ],
        }],
      });

      const raw      = (msg.content[0] as { type: string; text: string }).text.trim();
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      const graph    = JSON.parse(jsonText) as ArchitectureGraph;

      if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
        return { content: [{ type: "text", text: "Error: extracted graph missing nodes or edges. Try a clearer image." }], isError: true };
      }

      // Save graph
      const dataDir  = path.join(path.dirname(path.dirname(__dirname)), "data", "graphs");
      fs.mkdirSync(dataDir, { recursive: true });
      const filename = `image-${Date.now()}.json`;
      fs.writeFileSync(path.join(dataDir, filename), JSON.stringify(graph, null, 2));

      const summary = [
        `✓ Architecture extracted from image`,
        `  Source: ${path.basename(resolved)}`,
        `  Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length} | Confidence: ${Math.round((graph.confidence ?? 0) * 100)}%`,
        `  Summary: ${graph.summary}`,
        ``,
        `  Saved: ${filename}`,
        `  View: http://localhost:3000/view?file=${filename}`,
      ].join("\n");

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(graph, null, 2) },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Image analysis failed: ${msg}` }], isError: true };
    }
  }

  // ── get_diagram_url ──────────────────────────────────────────────────────
  if (name === "get_diagram_url") {
    const graphFile = args?.graph_file as string;
    const url = `http://localhost:3000/view?file=${encodeURIComponent(graphFile)}`;
    return {
      content: [
        { type: "text", text: `Interactive diagram: ${url}\n\nMake sure the Diagram Forge server is running:\n  npx tsx src/server.ts` },
      ],
    };
  }

  // ── benchmark_architecture ───────────────────────────────────────────────
  if (name === "benchmark_architecture") {
    const format  = (args?.format as string) ?? "both";
    const dataDir = path.join(path.dirname(path.dirname(__dirname)), "data", "graphs");

    let graph = args?.graph as ArchitectureGraph | undefined;

    if (!graph && args?.graph_file) {
      const filename = args.graph_file as string;
      const candidates = [
        path.resolve(filename),
        path.join(dataDir, filename),
        path.join(dataDir, filename + ".json"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          try { graph = JSON.parse(fs.readFileSync(p, "utf-8")); break; } catch { /* try next */ }
        }
      }
      if (!graph) {
        return { content: [{ type: "text", text: `Error: file not found: ${filename}` }], isError: true };
      }
    }

    if (!graph || !Array.isArray(graph.nodes)) {
      return {
        content: [{ type: "text", text: "Error: provide graph (object) or graph_file (filename) for the architecture to benchmark." }],
        isError: true,
      };
    }

    const costContext = args?.cost_context as Record<string, number> | undefined;
    const result = benchmarkGraph(graph, costContext);
    const refs   = loadReferenceGraphs();

    const costLine = result.cost
      ? `  Cost: $${result.cost.total_monthly_usd.toLocaleString()}/mo | Efficiency ${result.cost.efficiency_score}/100 | SPOF spend ${result.cost.spof_cost_pct}% of budget`
      : "";

    const summary = [
      `✓ Benchmark complete`,
      `  Overall: ${result.overall}/100 — Grade ${result.grade}`,
      `  Resilience:    ${result.dimensions.resilience.score}/100 (${result.dimensions.resilience.grade})`,
      `  Observability: ${result.dimensions.observability.score}/100 (${result.dimensions.observability.grade})`,
      `  Security:      ${result.dimensions.security.score}/100 (${result.dimensions.security.grade})`,
      `  Scalability:   ${result.dimensions.scalability.score}/100 (${result.dimensions.scalability.grade})`,
      `  Simplicity:    ${result.dimensions.simplicity.score}/100 (${result.dimensions.simplicity.grade})`,
      `  Async Coverage:${result.dimensions.async_coverage.score}/100 (${result.dimensions.async_coverage.grade})`,
      costLine,
      result.spofs.length > 0
        ? `  SPOFs: ${result.spofs.join(", ")}`
        : `  SPOFs: none detected`,
      result.pattern_match.length > 0
        ? `  Best match: ${result.pattern_match[0].name} (${result.pattern_match[0].similarity}% similarity)`
        : "",
      ``,
      `  Insights:`,
      ...result.insights.map((i) => `    • ${i}`),
      ...(result.cost?.insights ?? []).map((i) => `    💰 ${i}`),
      ``,
      `  Reference patterns loaded: ${refs.length}`,
    ].filter(Boolean).join("\n");

    const content: Array<{ type: "text"; text: string }> = [
      { type: "text", text: summary },
    ];

    if (format === "json" || format === "both") {
      content.push({ type: "text", text: JSON.stringify(result, null, 2) });
    }
    if (format === "markdown" || format === "both") {
      content.push({ type: "text", text: benchmarkToMarkdown(result) });
    }

    return { content };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate via stdio — no console.log here
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err.message}\n`);
  process.exit(1);
});
