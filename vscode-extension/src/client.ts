const SERVER = "https://forge.l402kit.com";

export interface AnalyzeOpts {
  repoUrl?: string;
  tier?: "basic" | "full" | "live";
  idempotencyKey?: string;
  preimage?: string;
  macaroon?: string;
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
    body: JSON.stringify({ repo_url: opts.repoUrl, tier: opts.tier ?? "basic" }),
  });

  if (res.status === 402) {
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
    const inv = wwwAuth.match(/invoice="([^"]+)"/)?.[1] ?? "";
    const mac = wwwAuth.match(/macaroon="([^"]+)"/)?.[1] ?? "";
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: false,
      l402: {
        invoice: inv,
        macaroon: mac,
        paymentHash: (body.payment_hash as string) ?? "",
        amountSats: (body.amount_sats as number) ?? 0,
        tier: (body.tier as string) ?? "basic",
      },
    };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>;
    return { ok: false, error: (body.error as string) ?? res.statusText };
  }

  const body = await res.json() as { id?: string; graph?: Graph };
  const id = body.id ?? "";
  return {
    ok: true,
    data: { id, graph: body.graph!, viewerUrl: `${SERVER}/g/${id}` },
  };
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
