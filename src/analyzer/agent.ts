import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL } from "../config.js";
import {
  FILESYSTEM_TOOLS,
  executeListDirectory,
  executeReadFile,
  executeSearchPattern,
  executeDetectEntryPoints,
} from "../tools/filesystem.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeType =
  | "frontend"
  | "backend"
  | "database"
  | "cache"
  | "queue"
  | "storage"
  | "auth"
  | "gateway"
  | "external_api"
  | "ml_model"
  | "worker"
  | "cdn"
  | "monitoring"
  | "other";

export type Protocol =
  | "HTTP"
  | "HTTPS"
  | "WebSocket"
  | "gRPC"
  | "TCP"
  | "AMQP"
  | "SQL"
  | "Redis"
  | "GraphQL"
  | "tRPC"
  | "Lightning"
  | "Unknown";

export interface DiagramNode {
  id: string;
  label: string;
  type: NodeType;
  technology: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  protocol: Protocol;
  direction: "unidirectional" | "bidirectional";
  async: boolean;
}

export interface ArchitectureGraph {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  summary: string;
  tech_stack: string[];
  confidence: number;
  analysis_steps: number;
}

export interface ProgressEvent {
  type: "progress" | "tool_call" | "complete" | "error";
  iteration?: number;
  max_iterations?: number;
  tool_name?: string;
  file_path?: string;
  message: string;
  elapsed_ms?: number;
  graph?: ArchitectureGraph;
}

export interface AnalyzerOptions {
  apiKey?: string;
  model?: string;
  maxIterations?: number;
  onProgress?: (message: string) => void;
  onProgressEvent?: (event: ProgressEvent) => void;
  tier?: "basic" | "full" | "live";
  onTokenUsage?: (inputTokens: number, outputTokens: number) => void;
}

// ─── 2.1: Token / wall-clock caps ────────────────────────────────────────────
const MAX_INPUT_TOKENS  = 150_000;
const MAX_OUTPUT_TOKENS = 50_000;
const MAX_WALL_CLOCK_MS = 90_000;

const TIER_MAX_ITER: Record<string, number> = {
  basic: 8,
  full:  12,
  live:  12,
};

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert software architect and code analyst. Your task is to analyze a software project and produce an accurate architecture diagram.

You have tools to explore the project filesystem. Use them strategically:

## Analysis Strategy

1. **Start broad**: Call detect_entry_points first to understand the project type
2. **List structure**: Use list_directory on root with depth 2 to see the full layout
3. **Read key configs**: Read package.json, docker-compose, pyproject.toml, Cargo.toml, go.mod, pom.xml, etc.
4. **Find services**: Look for Dockerfile, docker-compose, kubernetes configs, serverless.yml
5. **Trace connections**: Search for database URLs, Redis connections, API calls, message queues
6. **Identify tech**: Search for framework imports, SDK usage, cloud service SDKs
7. **Finish**: Call finish_analysis when you have a clear picture

## Supported Project Types (polyglot)

- **JavaScript/TypeScript**: Next.js, Express, Fastify, NestJS, Remix, tRPC, Prisma, Drizzle
- **Python**: FastAPI, Django, Flask, SQLAlchemy, Celery, Jupyter notebooks (.ipynb), MLflow
- **Java/Kotlin**: Spring Boot, Quarkus, Micronaut, Maven, Gradle
- **Scala**: Akka, Play, Apache Spark, sbt
- **Go**: Gin, Echo, gRPC services
- **Rust**: Actix, Axum, Tokio
- **Mobile**: React Native, Flutter, Swift, Kotlin Android
- **Data/ML**: Jupyter notebooks, Databricks, dbt, Airflow, MLflow, Metaflow
- **Maestro**: Mobile UI testing flows (.yaml test files)
- **Infrastructure**: Terraform, Pulumi, CDK, Helm charts

## Node Detection Rules

- Each distinct service, database, cache, queue = one node
- Monorepo packages/apps = individual nodes
- External APIs (Stripe, Twilio, etc.) = external_api nodes
- Jupyter notebooks = ml_model or worker nodes
- Don't create nodes for libraries — only for services/infrastructure

## Edge Detection Rules

- HTTP/REST calls between services = HTTP or HTTPS edge
- Database queries = SQL edge
- Redis calls = Redis edge
- Message publishing/consuming = AMQP edge
- WebSocket connections = WebSocket edge
- Import/dependency between packages in monorepo = HTTP (internal)
- Lightning Network payments = Lightning edge

## Confidence Score

- 0.9-1.0: docker-compose or k8s fully defines all services
- 0.7-0.9: clear service boundaries, read main configs
- 0.5-0.7: partial information, inferred some connections
- 0.3-0.5: minimal files, best-guess architecture
- <0.3: insufficient information

Be efficient: aim to call finish_analysis within 6-10 tool calls for most projects. Prioritize docker-compose, package.json, pyproject.toml and entry point configs over deep source exploration.`;

// ─── Agent Loop ───────────────────────────────────────────────────────────────

export async function analyzeProject(
  projectRoot: string,
  options: AnalyzerOptions = {}
): Promise<ArchitectureGraph> {
  const {
    apiKey = process.env.ANTHROPIC_API_KEY,
    tier = "full",
    model = DEFAULT_MODEL,
    maxIterations = TIER_MAX_ITER[tier] ?? 12,
    onProgress,
    onProgressEvent,
    onTokenUsage,
  } = options;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const client = new Anthropic({ apiKey });

  const log = (msg: string) => {
    if (onProgress) onProgress(msg);
    else console.log(`[analyzer] ${msg}`);
  };

  const emit = (event: ProgressEvent) => {
    onProgressEvent?.(event);
  };

  log(`Starting analysis of: ${projectRoot}`);
  emit({ type: "progress", message: `Starting analysis`, elapsed_ms: 0, max_iterations: maxIterations });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Analyze the project at the root directory and produce a complete architecture diagram.

Project root: ${projectRoot}

Start with detect_entry_points, then explore as needed. Call finish_analysis when you have a complete picture of the architecture.`,
    },
  ];

  let iterations = 0;
  let finalGraph: ArchitectureGraph | null = null;
  // 2.1: track cumulative token usage across the full loop
  let totalInputTokens  = 0;
  let totalOutputTokens = 0;
  const startTime = Date.now();

  // ─── Agentic Loop ──────────────────────────────────────────────────────────
  while (iterations < maxIterations && !finalGraph) {
    iterations++;

    // 2.1: bail before next API call if we've exceeded budget
    if (
      totalInputTokens  > MAX_INPUT_TOKENS  ||
      totalOutputTokens > MAX_OUTPUT_TOKENS ||
      Date.now() - startTime > MAX_WALL_CLOCK_MS
    ) {
      log(`Cap reached — in: ${totalInputTokens} out: ${totalOutputTokens} elapsed: ${Date.now() - startTime}ms — returning partial graph`);
      break;
    }

    // Inject a deadline at 70% of max iterations so Claude wraps up with what it has.
    const deadlineAt = Math.floor(maxIterations * 0.7);
    if (iterations === deadlineAt && !finalGraph) {
      messages.push({
        role: "user",
        content: `You have used ${iterations} of ${maxIterations} iterations. Call finish_analysis NOW with everything found so far. No more tool calls.`,
      });
    }

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }] as Anthropic.TextBlockParam[],
      tools: FILESYSTEM_TOOLS,
      messages,
    });

    // 2.1: accumulate token usage
    if (response.usage) {
      totalInputTokens  += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
    }

    // Add assistant response to history
    messages.push({ role: "assistant", content: response.content });

    // Check stop reason
    if (response.stop_reason === "end_turn") {
      log("Agent finished without calling finish_analysis — extracting from text.");
      // Fallback: try to extract any partial graph from the text response
      break;
    }

    if (response.stop_reason !== "tool_use") {
      log(`Unexpected stop reason: ${response.stop_reason}`);
      break;
    }

    // ─── Execute Tool Calls ─────────────────────────────────────────────────
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const { name, id, input } = block;
      const inp = input as Record<string, unknown>;
      log(`→ ${name}(${JSON.stringify(inp)})`);
      emit({
        type: "tool_call",
        iteration: iterations,
        max_iterations: maxIterations,
        tool_name: name,
        file_path: typeof inp.path === "string" ? inp.path : undefined,
        message: `${name}(${typeof inp.path === "string" ? inp.path : typeof inp.pattern === "string" ? inp.pattern : ""})`,
        elapsed_ms: Date.now() - startTime,
      });

      let result: string;

      switch (name) {
        case "list_directory":
          result = executeListDirectory(
            projectRoot,
            (inp.path as string) ?? ".",
            (inp.depth as number) ?? 1
          );
          break;

        case "read_file":
          result = executeReadFile(
            projectRoot,
            inp.path as string,
            (inp.lines as number) ?? 100
          );
          break;

        case "search_pattern":
          result = executeSearchPattern(
            projectRoot,
            inp.pattern as string,
            inp.glob as string | undefined,
            (inp.max_results as number) ?? 10
          );
          break;

        case "detect_entry_points":
          result = executeDetectEntryPoints(projectRoot);
          break;

        case "finish_analysis": {
          // Claude is done — extract the graph
          const raw = inp as {
            nodes: DiagramNode[];
            edges: DiagramEdge[];
            summary: string;
            tech_stack: string[];
            confidence: number;
          };

          finalGraph = {
            nodes: raw.nodes,
            edges: raw.edges.map((e) => ({ ...e, async: e.async ?? false })),
            summary: raw.summary,
            tech_stack: raw.tech_stack,
            confidence: raw.confidence,
            analysis_steps: iterations,
          };

          log(
            `✓ Analysis complete — ${finalGraph.nodes.length} nodes, ${finalGraph.edges.length} edges (confidence: ${(finalGraph.confidence * 100).toFixed(0)}%)`
          );
          emit({
            type: "complete",
            iteration: iterations,
            max_iterations: maxIterations,
            message: `Analysis complete — ${finalGraph.nodes.length} nodes, ${finalGraph.edges.length} edges`,
            elapsed_ms: Date.now() - startTime,
            graph: finalGraph,
          });
          result = "Analysis saved successfully.";
          break;
        }

        default:
          result = `Unknown tool: ${name}`;
      }

      // Cap individual tool results to avoid blowing the token budget
      const MAX_RESULT = 1500;
      const cappedResult = result.length > MAX_RESULT
        ? result.slice(0, MAX_RESULT) + `\n[... truncated ${result.length - MAX_RESULT} chars]`
        : result;

      toolResults.push({
        type: "tool_result",
        tool_use_id: id,
        content: cappedResult,
      });
    }

    // Add tool results to message history
    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }

    if (finalGraph) break;
  }

  // 2.1: report token usage to caller (e.g. for metrics)
  onTokenUsage?.(totalInputTokens, totalOutputTokens);

  if (!finalGraph) {
    // 2.2: best-effort fallback — return a minimal valid graph instead of 500
    log(`No finish_analysis call after ${iterations} iterations — returning empty stub graph`);
    return {
      nodes: [],
      edges: [],
      summary: "Analysis could not complete within the token/time budget. Try a smaller repository or a higher tier.",
      tech_stack: [],
      confidence: 0,
      analysis_steps: iterations,
    };
  }

  return finalGraph;
}
