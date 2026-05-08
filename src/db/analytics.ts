import { createHash } from "crypto";
import { supabase } from "./supabase.js";

export type AnalyticsEvent =
  | "trial_granted"
  | "cache_hit"
  | "promo_redeemed"
  | "stripe_checkout"
  | "stripe_paid"
  | "analyze_completed"
  | "analyze_error"
  | "payment_initiated"
  | "share_created"
  | "share_viewed";

interface TrackOpts {
  tier?: string;
  ip?: string;
  repoUrl?: string;
  meta?: Record<string, unknown>;
}

function hash(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function track(event: AnalyticsEvent, opts: TrackOpts = {}) {
  if (!supabase) return;
  const row = {
    event,
    tier: opts.tier ?? null,
    ip_hash: opts.ip ? hash(opts.ip) : null,
    repo_hash: opts.repoUrl ? hash(opts.repoUrl) : null,
    meta: opts.meta ?? null,
  };
  // fire-and-forget — never block the request
  supabase.from("events").insert(row).then(() => {}, () => {});
}
