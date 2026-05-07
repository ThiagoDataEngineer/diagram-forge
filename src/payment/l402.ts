import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { LightningBackend } from "./lightning.js";

// ─── L402 Protocol ────────────────────────────────────────────────────────────
// Spec: https://github.com/lightninglabs/L402
//
// Flow:
//   1. Client → POST /analyze
//   2. Server  ← 402 + WWW-Authenticate: L402 macaroon="...", invoice="lnbc..."
//   3. Client pays invoice via Lightning wallet, gets preimage
//   4. Client → POST /analyze + Authorization: L402 <macaroon>:<preimage>
//   5. Server verifies preimage matches invoice payment_hash, proceeds

// ─── Macaroon (simplified) ────────────────────────────────────────────────────
// A real L402 macaroon is a chained HMAC token with caveats.
// Here we use a minimal but correct implementation:
//   macaroon = base64(payment_hash + ":" + expiry + ":" + tier)
//   mac_sig  = HMAC-SHA256(MACAROON_SECRET, macaroon_payload)
//   final    = base64url(payload + "." + sig)

const MACAROON_SECRET = process.env.MACAROON_SECRET ?? crypto.randomBytes(32).toString("hex");

// ─── 3.4: Preimage replay-attack lock ────────────────────────────────────────
// Prevents two parallel requests from using the same preimage simultaneously.
// TTL matches macaroon expiry; expired entries are pruned on each claim.
const usedPreimages = new Map<string, number>(); // payment_hash → expiry ms

function tryClaim(paymentHash: string, expiresAt: number): boolean {
  const now = Date.now();
  for (const [k, exp] of usedPreimages) if (exp < now) usedPreimages.delete(k);
  if (usedPreimages.has(paymentHash)) return false;
  usedPreimages.set(paymentHash, expiresAt * 1000); // expiresAt is Unix seconds
  return true;
}

export interface MacaroonPayload {
  payment_hash: string;
  expires_at: number;
  tier: "basic" | "full" | "live";
  sats: number;
}

export function createMacaroon(payload: MacaroonPayload): string {
  const data = JSON.stringify(payload);
  const encoded = Buffer.from(data).toString("base64url");
  const sig = crypto
    .createHmac("sha256", MACAROON_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyMacaroon(macaroon: string): MacaroonPayload | null {
  try {
    const [encoded, sig] = macaroon.split(".");
    if (!encoded || !sig) return null;

    const expectedSig = crypto
      .createHmac("sha256", MACAROON_SECRET)
      .update(encoded)
      .digest("base64url");

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

    if (Date.now() / 1000 > payload.expires_at) {
      return null; // expired
    }

    return payload as MacaroonPayload;
  } catch {
    return null;
  }
}

// ─── Price Table ──────────────────────────────────────────────────────────────

export const PRICE_SATS = {
  basic: 100,  // up to 10 files, fast scan
  full: 500,   // full repo analysis
  live: 1000,  // full analysis + animated diagram export
} as const;

export type Tier = keyof typeof PRICE_SATS;

// ─── Parse L402 Authorization Header ─────────────────────────────────────────

function parseL402Header(authHeader: string): { macaroon: string; preimage: string } | null {
  // Authorization: L402 <macaroon>:<preimage>
  const match = authHeader.match(/^L402\s+([^:]+):(.+)$/i);
  if (!match) return null;
  return { macaroon: match[1], preimage: match[2] };
}

// ─── Middleware Factory ───────────────────────────────────────────────────────

export interface L402Options {
  lightning: LightningBackend;
  tier?: Tier;
  memo?: string;
}

export function l402(options: L402Options) {
  const { lightning, tier = "full", memo = "Diagram Forge Analysis" } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers["authorization"];

    // ── Step 4: Client sent payment proof ────────────────────────────────────
    if (authHeader?.toLowerCase().startsWith("l402 ")) {
      const parsed = parseL402Header(authHeader);

      if (!parsed) {
        res.status(400).json({
          error: "invalid_l402",
          message: "Malformed Authorization header. Expected: L402 <macaroon>:<preimage>",
        });
        return;
      }

      const payload = verifyMacaroon(parsed.macaroon);
      if (!payload) {
        res.status(401).json({
          error: "invalid_macaroon",
          message: "Macaroon is invalid or expired. Request a new invoice.",
        });
        return;
      }

      // Verify preimage: SHA256(preimage) must equal payment_hash
      const preimageValid = lightning.verifyPreimage(payload.payment_hash, parsed.preimage);
      if (!preimageValid) {
        res.status(401).json({
          error: "invalid_preimage",
          message: "Preimage does not match payment hash.",
        });
        return;
      }

      // (Optional) Double-check with Lightning node that invoice is actually paid
      const isPaid = await lightning.checkPaid(payload.payment_hash);
      if (!isPaid) {
        res.status(402).json({
          error: "payment_not_confirmed",
          message: "Invoice not yet confirmed by Lightning node. Try again in a moment.",
        });
        return;
      }

      // 3.4: Prevent parallel requests from reusing the same preimage
      if (!tryClaim(payload.payment_hash, payload.expires_at)) {
        res.status(401).json({
          error: "preimage_already_used",
          message: "This payment proof has already been used. Request a new invoice.",
        });
        return;
      }

      // Attach tier info for downstream handlers
      (req as Request & { l402: MacaroonPayload }).l402 = payload;
      next();
      return;
    }

    // ── Step 2: No payment — issue invoice and 402 ───────────────────────────
    try {
      const sats = PRICE_SATS[tier];
      const invoice = await lightning.createInvoice(sats, `${memo} (${tier})`);

      const macaroon = createMacaroon({
        payment_hash: invoice.payment_hash,
        expires_at: invoice.expires_at,
        tier,
        sats,
      });

      // WWW-Authenticate: L402 macaroon="...", invoice="lnbc..."
      res.setHeader(
        "WWW-Authenticate",
        `L402 macaroon="${macaroon}", invoice="${invoice.payment_request}"`
      );

      res.status(402).json({
        error: "payment_required",
        message: `Pay ${sats} sats to analyze this repository.`,
        invoice: invoice.payment_request,
        payment_hash: invoice.payment_hash,
        amount_sats: sats,
        expires_at: invoice.expires_at,
        tier,
        instructions: [
          "1. Pay the Lightning invoice with any wallet",
          "2. Get the preimage (payment proof) from your wallet",
          `3. Retry with header: Authorization: L402 ${macaroon}:<preimage>`,
        ],
      });
    } catch (err) {
      res.status(503).json({
        error: "lightning_unavailable",
        message: "Could not create Lightning invoice. Try again later.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
