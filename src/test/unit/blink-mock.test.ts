/**
 * Unit tests for BlinkBackend using mocked fetch.
 * Always runs — no real credentials needed.
 * Complements integration/blink.test.ts (which skips without BLINK_API_KEY).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { BlinkBackend } from "../../payment/lightning.js";

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function blinkGqlResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data }),
  } as Response);
}

function blinkGqlError(message: string) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ errors: [{ message }] }),
  } as Response);
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeBackend() {
  return new BlinkBackend("test-api-key", "test-wallet-id");
}

function makePreimage() {
  const preimage = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256")
    .update(Buffer.from(preimage, "hex"))
    .digest("hex");
  return { preimage, hash };
}

// ── createInvoice ─────────────────────────────────────────────────────────────

describe("BlinkBackend.createInvoice — mock", () => {
  it("returns Invoice with correct shape on success", async () => {
    const { hash } = makePreimage();
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          lnInvoiceCreate: {
            invoice: {
              paymentHash: hash,
              paymentRequest: `lnbc100n1p_${hash.slice(0, 20)}`,
              expiresAt,
            },
            errors: [],
          },
        },
      }),
    } as unknown as Response);

    const backend = makeBackend();
    const inv = await backend.createInvoice(100, "Test memo");

    expect(inv.payment_hash).toBe(hash);
    expect(inv.payment_request).toMatch(/^lnbc/);
    expect(inv.amount_sats).toBe(100);
    expect(inv.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("throws when Blink returns GraphQL errors", async () => {
    mockFetch.mockImplementationOnce(() => blinkGqlError("wallet not found"));

    const backend = makeBackend();
    await expect(backend.createInvoice(100, "test")).rejects.toThrow("wallet not found");
  });

  it("throws when HTTP error (non-200)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    const backend = makeBackend();
    await expect(backend.createInvoice(100, "test")).rejects.toThrow("503");
  });
});

// ── checkPaid ─────────────────────────────────────────────────────────────────

describe("BlinkBackend.checkPaid — mock", () => {
  it("returns false for unknown payment_hash (not in invoiceStore)", async () => {
    const backend = makeBackend();
    // No createInvoice call → hash not in store
    const result = await backend.checkPaid("0".repeat(64));
    expect(result).toBe(false);
    // fetch should NOT be called (early return on missing paymentRequest)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns true when Blink reports PAID status", async () => {
    const { hash } = makePreimage();
    const expiresAt = new Date(Date.now() + 600_000).toISOString();

    // First call: createInvoice
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          lnInvoiceCreate: {
            invoice: { paymentHash: hash, paymentRequest: `lnbc_${hash.slice(0, 20)}`, expiresAt },
            errors: [],
          },
        },
      }),
    } as unknown as Response);

    // Second call: checkPaid → PAID
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          lnInvoicePaymentStatus: { status: "PAID", errors: [] },
        },
      }),
    } as unknown as Response);

    const backend = makeBackend();
    await backend.createInvoice(100, "test");
    const paid = await backend.checkPaid(hash);
    expect(paid).toBe(true);
  });

  it("returns false when Blink reports PENDING status", async () => {
    const { hash } = makePreimage();
    const expiresAt = new Date(Date.now() + 600_000).toISOString();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          lnInvoiceCreate: {
            invoice: { paymentHash: hash, paymentRequest: `lnbc_${hash.slice(0, 20)}`, expiresAt },
            errors: [],
          },
        },
      }),
    } as unknown as Response);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: { lnInvoicePaymentStatus: { status: "PENDING", errors: [] } },
      }),
    } as unknown as Response);

    const backend = makeBackend();
    await backend.createInvoice(100, "test");
    const paid = await backend.checkPaid(hash);
    expect(paid).toBe(false);
  });
});

// ── verifyPreimage ────────────────────────────────────────────────────────────

describe("BlinkBackend.verifyPreimage — mock", () => {
  it("returns true for valid preimage/hash pair", () => {
    const { preimage, hash } = makePreimage();
    const backend = makeBackend();
    expect(backend.verifyPreimage(hash, preimage)).toBe(true);
  });

  it("returns false for mismatched preimage", () => {
    const { hash } = makePreimage();
    const { preimage: wrongPreimage } = makePreimage();
    const backend = makeBackend();
    expect(backend.verifyPreimage(hash, wrongPreimage)).toBe(false);
  });

  it("returns false for all-zero preimage", () => {
    const { hash } = makePreimage();
    const backend = makeBackend();
    expect(backend.verifyPreimage(hash, "0".repeat(64))).toBe(false);
  });

  it("returns false for invalid hex string", () => {
    const backend = makeBackend();
    expect(backend.verifyPreimage("0".repeat(64), "not-hex")).toBe(false);
  });
});
