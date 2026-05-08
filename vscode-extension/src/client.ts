const SERVER = "https://diagram-forge.onrender.com";

export interface AnalyzeOpts {
  repoUrl?: string;
  tier?: "basic" | "full" | "live";
  promoCode?: string;
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
    body: JSON.stringify({ repo_url: opts.repoUrl, tier: opts.tier ?? "basic", ...(opts.promoCode ? { promo_code: opts.promoCode } : {}) }),
  });

  if (res.status === 402) {
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
    const inv = wwwAuth.match(/invoice="([^"]+)"/)?.[1] ?? "";
    const mac = wwwAuth.match(/macaroon="([^"]+)"/)?.[1] ?? "";
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;

    // Extract payment hash from macaroon (base64 JSON: { hash, exp })
    // The 402 body has `priceSats` not `amount_sats`, and no `payment_hash` field.
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

  const body = await res.json() as { id?: string; graph?: Graph };
  const id = body.id ?? "";
  return {
    ok: true,
    data: { id, graph: body.graph!, viewerUrl: `${SERVER}/g/${id}` },
  };
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
