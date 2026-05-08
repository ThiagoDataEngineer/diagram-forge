import Stripe from "stripe";
import { createMacaroon } from "./l402.js";
import type { Tier } from "./l402.js";

// ─── Pricing (USD cents) ──────────────────────────────────────────────────────

// Stripe pricing is higher than Lightning to cover:
//   - Stripe fee: 2.9% + $0.30 per transaction
//   - International cards: +1.5%
//   - Enterprise positioning (CFO/CTO audience doesn't haggle over $5)
// Net after max fees (intl card): basic≈$4.50, full≈$13.50, live≈$32.50
export const PRICE_USD = {
  basic: 1200,  // $12.00 → net ~$11.35 after fees
  full:  2900,  // $29.00 → net ~$27.86 after fees
  live:  6900,  // $69.00 → net ~$66.70 after fees
} as const;

const TIER_DESCRIPTIONS: Record<Tier, string> = {
  basic: "Quick scan — up to 10 key files, main services detected",
  full:  "Full repo analysis — all services, connections, monorepos",
  live:  "Full analysis + animated SVG diagram with official logos",
};

// ─── Stripe client ────────────────────────────────────────────────────────────

export function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (Stripe as any)(key) as InstanceType<typeof Stripe>;
}

export function isStripeAvailable(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// ─── Create Checkout Session ──────────────────────────────────────────────────

export async function createStripeCheckout(params: {
  tier: Tier;
  repoUrl?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const { tier, repoUrl, successUrl, cancelUrl } = params;
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Diagram Forge — ${tier.charAt(0).toUpperCase() + tier.slice(1)} Analysis`,
            description: TIER_DESCRIPTIONS[tier],
          },
          unit_amount: PRICE_USD[tier],
        },
        quantity: 1,
      },
    ],
    metadata: {
      tier,
      repo_url: repoUrl ?? "",
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url, sessionId: session.id };
}

// ─── Retrieve session ─────────────────────────────────────────────────────────

export async function getStripeSession(sessionId: string): Promise<Record<string, unknown>> {
  const stripe = getStripeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stripe.checkout.sessions.retrieve(sessionId) as any;
}

// ─── Webhook signature verification ──────────────────────────────────────────

export function constructStripeEvent(rawBody: Buffer, signature: string): { type: string; data: { object: Record<string, unknown> } } {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
  const stripe = getStripeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stripe.webhooks.constructEvent(rawBody, signature, secret) as any;
}

// ─── Issue a macaroon for a paid Stripe session ───────────────────────────────

export function issueStripeMacaroon(sessionId: string, tier: Tier): string {
  return createMacaroon({
    payment_hash: `stripe_${sessionId}`,
    expires_at: Math.floor(Date.now() / 1000) + 7200, // 2 hours
    tier,
    sats: 0,
  });
}
