import { supabase } from "./supabase.js";

export type PromoResult =
  | { valid: true; tier: "basic" | "full" | "live" | null }
  | { valid: false; reason: string };

export async function redeemPromo(code: string): Promise<PromoResult> {
  if (!supabase) return { valid: false, reason: "promo_unavailable" };

  const upper = code.trim().toUpperCase();

  const { data, error } = await supabase
    .from("promo_codes")
    .select("tier, max_uses, uses, expires_at")
    .eq("code", upper)
    .single();

  if (error || !data) return { valid: false, reason: "invalid_code" };

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return { valid: false, reason: "code_expired" };

  if (data.max_uses !== null && data.uses >= data.max_uses)
    return { valid: false, reason: "code_exhausted" };

  // Atomic increment
  const { error: upErr } = await supabase
    .from("promo_codes")
    .update({ uses: data.uses + 1 })
    .eq("code", upper)
    .eq("uses", data.uses); // optimistic lock

  if (upErr) return { valid: false, reason: "redeem_failed" };

  return { valid: true, tier: (data.tier as "basic" | "full" | "live") ?? null };
}
