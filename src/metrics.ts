import client from "prom-client";

client.collectDefaultMetrics({ prefix: "df_" });

export const analyzeRequests = new client.Counter({
  name: "df_analyze_requests_total",
  help: "Total analyze requests by status and tier",
  labelNames: ["status", "tier"] as const,
});

export const analyzeDuration = new client.Histogram({
  name: "df_analyze_duration_seconds",
  help: "Analysis wall-clock duration in seconds",
  buckets: [1, 5, 10, 30, 60, 120],
  labelNames: ["tier", "status"] as const,
});

export const analyzeTokensIn = new client.Counter({
  name: "df_analyze_tokens_input_total",
  help: "Cumulative input tokens sent to Claude",
});

export const analyzeTokensOut = new client.Counter({
  name: "df_analyze_tokens_output_total",
  help: "Cumulative output tokens received from Claude",
});

export const lightningInvoices = new client.Counter({
  name: "df_lightning_invoices_total",
  help: "Lightning invoice outcomes",
  labelNames: ["result"] as const,
});

export const register = client.register;
