const SERVER = "https://diagram-forge.onrender.com";

export interface AnalyzeOpts {
  repoUrl?: string;
  tier?: "basic" | "full" | "live";
  promoCode?: string;
  idempotencyKey?: string;
  preimage?: string;
  macaroon?: string;
  onProgress?: (event: StreamEvent) => void;
}

export interface Graph {
  nodes: unknown[];
  edges: unknown[];
  summary: string;
  confidence: number;
  analysis_steps: number;
}

export interface L402Challenge {
  invoice: string;
  macaroon: string;
  paymentHash: string;
  amountSats: number;
  tier: string;
}

export interface AnalyzeOk {
  id: string;
  graph: Graph;
  viewerUrl: string;
}

export interface StreamEvent {
  type: "progress" | "tool_call" | "complete" | "error" | "result";
  iteration?: number;
  max_iterations?: number;
  tool_name?: string;
  file_path?: string;
  message?: string;
  elapsed_ms?: number;
  graph?: Graph;
  // result event fields (type === "result")
  ok?: boolean;
  id?: string;
  viewerUrl?: string;
}

type AnalyzeResult =
  | { ok: true; data: AnalyzeOk }
  | { ok: false; l402: L402Challenge }
  | { ok: false; error: string };

export async function analyze(opts: AnalyzeOpts): Promise<AnalyzeResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  if (opts.preimage && opts.macaroon) {
    headers["Authorization"] = `L402 ${opts.macaroon}:${opts.preimage}`;
  }

  const res = await fetch(`${SERVER}/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify({ repo_url: opts.repoUrl, tier: opts.tier ?? "basic", ...(opts.promoCode ? { promo_code: opts.promoCode } : {}) }),
  });

  if (res.status === 402) {
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
    const inv = wwwAuth.match(/invoice="([^"]+)"/)?.[1] ?? "";
    const mac = wwwAuth.match(/macaroon="([^"]+)"/)?.[1] ?? "";
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;

    let paymentHash = (body.payment_hash as string) ?? "";
    if (!paymentHash && mac) {
      try {
        const decoded = JSON.parse(Buffer.from(mac, "base64").toString("utf8")) as Record<string, unknown>;
        paymentHash = (decoded.hash as string) ?? "";
      } catch { /* ignore */ }
    }

    return {
      ok: false,
      l402: {
        invoice: inv,
        macaroon: mac,
        paymentHash,
        amountSats: (body.amount_sats as number) ?? (body.priceSats as number) ?? 0,
        tier: (body.tier as string) ?? opts.tier ?? "basic",
      },
    };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>;
    const msg = (body.error as string) ?? res.statusText;
    return { ok: false, error: `${res.status}: ${msg}` };
  }

  // SSE stream — read events until we get the "result" event
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    return readSseStream(res, opts.onProgress);
  }

  // Fallback: plain JSON (cached response or old server)
  const body = await res.json() as { id?: string; graph?: Graph; viewerUrl?: string };
  const id = body.id ?? "";
  return {
    ok: true,
    data: { id, graph: body.graph!, viewerUrl: body.viewerUrl ?? `${SERVER}/g/${id}` },
  };
}

async function readSseStream(
  res: Response,
  onProgress?: (event: StreamEvent) => void,
): Promise<AnalyzeResult> {
  if (!res.body) return { ok: false, error: "Empty response body" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let event: StreamEvent;
        try {
          event = JSON.parse(line.slice(6)) as StreamEvent;
        } catch {
          continue;
        }

        if (event.type === "result" && event.ok) {
          return {
            ok: true,
            data: { id: event.id ?? "", graph: event.graph!, viewerUrl: event.viewerUrl ?? "" },
          };
        }
        if (event.type === "error") {
          return { ok: false, error: event.message ?? "Analysis failed" };
        }
        onProgress?.(event);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: false, error: "Stream ended without result" };
}

export async function checkPayment(paymentHash: string): Promise<{ paid: boolean; preimage: string | null }> {
  const res = await fetch(`${SERVER}/api/invoice-status/${paymentHash}`);
  if (!res.ok) return { paid: false, preimage: null };
  const body = await res.json() as { paid?: boolean; preimage?: string };
  return { paid: !!body.paid, preimage: body.preimage ?? null };
}

export async function share(graph: Graph): Promise<{ id: string; viewerUrl: string }> {
  const res = await fetch(`${SERVER}/api/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph }),
  });
  const body = await res.json() as { id: string };
  return { id: body.id, viewerUrl: `${SERVER}/g/${body.id}` };
}
