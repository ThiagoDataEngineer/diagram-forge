import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

if (!supabase) {
  console.warn("[supabase] SUPABASE_URL or key not set — promo codes and share links will be unavailable.");
}
