import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Invoice {
  payment_hash: string;   // hex, 32 bytes — the SHA256 of the preimage
  payment_request: string; // BOLT-11 string (lnbc...)
  amount_sats: number;
  expires_at: number;      // unix timestamp
}

export interface LightningBackend {
  createInvoice(sats: number, memo: string): Promise<Invoice>;
  checkPaid(payment_hash: string): Promise<boolean>;
  verifyPreimage(payment_hash: string, preimage: string): boolean;
}

// ─── LNbits Backend ───────────────────────────────────────────────────────────
// Docs: https://demo.lnbits.com/docs

export class LNbitsBackend implements LightningBackend {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  async createInvoice(sats: number, memo: string): Promise<Invoice> {
    const res = await fetch(`${this.baseUrl}/api/v1/payments`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        out: false,
        amount: sats,
        memo,
        expiry: 600, // 10 min
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LNbits createInvoice failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      payment_hash: string;
      payment_request: string;
    };

    return {
      payment_hash: data.payment_hash,
      payment_request: data.payment_request,
      amount_sats: sats,
      expires_at: Math.floor(Date.now() / 1000) + 600,
    };
  }

  async checkPaid(payment_hash: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/api/v1/payments/${payment_hash}`, {
      headers: { "X-Api-Key": this.apiKey },
    });

    if (!res.ok) return false;

    const data = (await res.json()) as { paid: boolean };
    return data.paid === true;
  }

  verifyPreimage(payment_hash: string, preimage: string): boolean {
    try {
      const preimageBytes = Buffer.from(preimage, "hex");
      const hash = crypto.createHash("sha256").update(preimageBytes).digest("hex");
      return hash === payment_hash;
    } catch {
      return false;
    }
  }
}

// ─── Mock Backend (development / testing) ────────────────────────────────────

export class MockLightningBackend implements LightningBackend {
  // In-memory store: payment_hash -> { preimage, paid }
  private store = new Map<string, { preimage: string; paid: boolean }>();

  async createInvoice(sats: number, memo: string): Promise<Invoice> {
    // Generate a random 32-byte preimage
    const preimage = crypto.randomBytes(32).toString("hex");
    const payment_hash = crypto
      .createHash("sha256")
      .update(Buffer.from(preimage, "hex"))
      .digest("hex");

    this.store.set(payment_hash, { preimage, paid: false });

    if (process.env.NODE_ENV !== "production") {
      console.log("\n" + "─".repeat(60));
      console.log("⚡ MOCK LIGHTNING INVOICE CREATED");
      console.log(`   Amount:       ${sats} sats`);
      console.log(`   Memo:         ${memo}`);
      console.log(`   Payment hash: ${payment_hash}`);
      console.log(`   Preimage:     ${preimage}   ← use this to simulate payment`);
      console.log("─".repeat(60) + "\n");
    }

    return {
      payment_hash,
      payment_request: `lnbc_mock_${payment_hash.slice(0, 20)}`,
      amount_sats: sats,
      expires_at: Math.floor(Date.now() / 1000) + 600,
    };
  }

  async checkPaid(payment_hash: string): Promise<boolean> {
    return this.store.get(payment_hash)?.paid ?? false;
  }

  // Simulate payment — returns the preimage so caller can pass it back
  markPaid(payment_hash: string): string | null {
    const entry = this.store.get(payment_hash);
    if (entry) { entry.paid = true; return entry.preimage; }
    return null;
  }

  verifyPreimage(payment_hash: string, preimage: string): boolean {
    try {
      const preimageBytes = Buffer.from(preimage, "hex");
      const hash = crypto.createHash("sha256").update(preimageBytes).digest("hex");
      return hash === payment_hash;
    } catch {
      return false;
    }
  }
}

// ─── Blink Backend ────────────────────────────────────────────────────────────
// Docs: https://dev.blink.sv

export class BlinkBackend implements LightningBackend {
  private readonly apiUrl = "https://api.blink.sv/graphql";
  // Maps payment_hash → paymentRequest (needed to poll status)
  private invoiceStore = new Map<string, string>();

  constructor(private apiKey: string, private walletId: string) {}

  private async gql<T>(query: string, variables: unknown): Promise<T> {
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Blink API HTTP ${res.status}`);
    const json = (await res.json()) as { data: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`Blink GQL: ${json.errors[0].message}`);
    return json.data;
  }

  async createInvoice(sats: number, memo: string): Promise<Invoice> {
    const data = await this.gql<{
      lnInvoiceCreate: {
        invoice: { paymentHash: string; paymentRequest: string; expiresAt: string } | null;
        errors: { message: string }[];
      };
    }>(
      `mutation LnInvoiceCreate($input: LnInvoiceCreateInput!) {
        lnInvoiceCreate(input: $input) {
          invoice { paymentHash paymentRequest expiresAt }
          errors { message }
        }
      }`,
      { input: { walletId: this.walletId, amount: sats, memo } }
    );

    const { invoice, errors } = data.lnInvoiceCreate;
    if (errors?.length || !invoice) {
      throw new Error(`Blink createInvoice: ${errors?.[0]?.message ?? "no invoice returned"}`);
    }

    this.invoiceStore.set(invoice.paymentHash, invoice.paymentRequest);

    return {
      payment_hash: invoice.paymentHash,
      payment_request: invoice.paymentRequest,
      amount_sats: sats,
      expires_at: Math.floor(new Date(invoice.expiresAt).getTime() / 1000),
    };
  }

  async checkPaid(payment_hash: string): Promise<boolean> {
    const paymentRequest = this.invoiceStore.get(payment_hash);
    if (!paymentRequest) return false;

    try {
      const data = await this.gql<{
        lnInvoicePaymentStatus: { status: string; errors: { message: string }[] };
      }>(
        `query LnInvoicePaymentStatus($input: LnInvoicePaymentStatusInput!) {
          lnInvoicePaymentStatus(input: $input) {
            status
            errors { message }
          }
        }`,
        { input: { paymentRequest } }
      );
      return data.lnInvoicePaymentStatus?.status === "PAID";
    } catch {
      return false;
    }
  }

  verifyPreimage(payment_hash: string, preimage: string): boolean {
    try {
      const hash = crypto.createHash("sha256")
        .update(Buffer.from(preimage, "hex"))
        .digest("hex");
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(payment_hash));
    } catch {
      return false;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function isProductionLightning(): boolean {
  if (process.env.TEST_MOCK_LIGHTNING === "true") return false;
  return !!(
    process.env.LIGHTNING_ADDRESS ||
    (process.env.BLINK_API_KEY && process.env.BLINK_WALLET_ID) ||
    (process.env.LNBITS_URL && process.env.LNBITS_API_KEY)
  );
}

export function createLightningBackend(): LightningBackend {
  const blinkKey = process.env.BLINK_API_KEY;
  const blinkWallet = process.env.BLINK_WALLET_ID;
  if (blinkKey && blinkWallet) {
    console.log("[lightning] Using Blink backend (shinydapps@blink.sv)");
    return new BlinkBackend(blinkKey, blinkWallet);
  }

  const lnbitsUrl = process.env.LNBITS_URL;
  const lnbitsKey = process.env.LNBITS_API_KEY;
  if (lnbitsUrl && lnbitsKey) {
    console.log(`[lightning] Using LNbits backend: ${lnbitsUrl}`);
    return new LNbitsBackend(lnbitsUrl, lnbitsKey);
  }

  console.log("[lightning] No lightning backend set — using mock (dev mode)");
  return new MockLightningBackend();
}
