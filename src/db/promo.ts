import { supabase } from "./supabase.js";

export type PromoResult =
  | { valid: true; tier: "basic" | "full" | "live" | null }
  | { valid: false; reason: string };

// In-memory cache: code → { result, expiresAt }
// TTL 5 min for valid codes, 1 min for invalid (so new codes propagate quickly)
const cache = new Map<string, { result: PromoResult; expiresAt: number }>();

export async function redeemPromo(code: string): Promise<PromoResult> {
  if (!supabase) return { valid: false, reason: "promo_unavailable" };

  const upper = code.trim().toUpperCase();

  // Check cache — only for invalid/expired/exhausted (safe to cache); valid codes
  // always hit the DB so the atomic increment runs and prevents double-use.
  const cached = cache.get(upper);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.result.valid) return cached.result;
  }

  const { data, error } = await supabase
    .from("promo_codes")
    .select("tier, max_uses, uses, expires_at")
    .eq("code", upper)
    .single();

  if (error || !data) {
    const r: PromoResult = { valid: false, reason: "invalid_code" };
    cache.set(upper, { result: r, expiresAt: Date.now() + 60_000 }); // 1 min
    return r;
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    const r: PromoResult = { valid: false, reason: "code_expired" };
    cache.set(upper, { result: r, expiresAt: Date.now() + 5 * 60_000 });
    return r;
  }

  if (data.max_uses !== null && data.uses >= data.max_uses) {
    const r: PromoResult = { valid: false, reason: "code_exhausted" };
    cache.set(upper, { result: r, expiresAt: Date.now() + 60_000 });
    return r;
  }

  // Atomic increment
  const { error: upErr } = await supabase
    .from("promo_codes")
    .update({ uses: data.uses + 1 })
    .eq("code", upper)
    .eq("uses", data.uses); // optimistic lock

  if (upErr) return { valid: false, reason: "redeem_failed" };

  return { valid: true, tier: (data.tier as "basic" | "full" | "live") ?? null };
}
