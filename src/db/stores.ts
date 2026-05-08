import { supabase } from "./supabase.js";

// ─── Preimage Claims — replay-attack protection ───────────────────────────────
// Supabase table: preimage_claims (payment_hash PK, expires_at, claimed_at)
// Fallback: in-memory Map when Supabase is unavailable (dev/offline).

const _localClaims = new Map<string, number>(); // payment_hash → expiry ms

export async function claimPreimage(paymentHash: string, expiresAtSec: number): Promise<boolean> {
  if (supabase) {
    const { error } = await supabase
      .from("preimage_claims")
      .insert({ payment_hash: paymentHash, expires_at: new Date(expiresAtSec * 1000).toISOString() });
    if (!error) return true;
    // 23505 = unique_violation: row already exists → already claimed
    if ((error as { code?: string }).code === "23505") return false;
    // Any other DB error: fall through to in-memory below
  }

  // In-memory fallback (dev or Supabase unavailable)
  const now = Date.now();
  for (const [k, exp] of _localClaims) if (exp < now) _localClaims.delete(k);
  if (_localClaims.has(paymentHash)) return false;
  _localClaims.set(paymentHash, expiresAtSec * 1000);
  return true;
}

// ─── Trial Store — one free basic analysis per IP ─────────────────────────────
// Supabase table: trials (ip_hash PK, created_at)
// IP is already hashed by the caller (SHA256 prefix) before being stored.

const _localTrials = new Set<string>(); // fallback

export async function hasTrial(ipHash: string): Promise<boolean> {
  if (supabase) {
    const { data } = await supabase
      .from("trials")
      .select("ip_hash")
      .eq("ip_hash", ipHash)
      .maybeSingle();
    return !!data;
  }
  return _localTrials.has(ipHash);
}

export async function setTrial(ipHash: string): Promise<void> {
  _localTrials.add(ipHash); // keep local copy in sync
  if (supabase) {
    await supabase
      .from("trials")
      .upsert({ ip_hash: ipHash }, { onConflict: "ip_hash" });
  }
}

// ─── Idempotency Store — dedup /analyze requests ──────────────────────────────
// Supabase table: idem_store (key PK, status, started_at, result jsonb, expires_at)

export type IdemEntry =
  | { status: "running"; startedAt: number }
  | { status: "done";    result: unknown };

type LocalIdemRecord = { entry: IdemEntry; expiresAt: number };
const _localIdem = new Map<string, LocalIdemRecord>(); // fallback
const IDEM_RUNNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

export async function getIdem(key: string): Promise<IdemEntry | null> {
  if (supabase) {
    const { data } = await supabase
      .from("idem_store")
      .select("status, started_at, result, expires_at")
      .eq("key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (!data) return null;
    const row = data as { status: string; started_at: string | null; result: unknown };

    if (row.status === "running") {
      const startedAt = row.started_at ? new Date(row.started_at).getTime() : 0;
      if (Date.now() - startedAt > IDEM_RUNNING_TIMEOUT_MS) {
        await supabase.from("idem_store").delete().eq("key", key);
        return null;
      }
      return { status: "running", startedAt };
    }
    return { status: "done", result: row.result };
  }

  // In-memory fallback
  const rec = _localIdem.get(key);
  if (!rec || rec.expiresAt < Date.now()) return null;
  if (rec.entry.status === "running" && Date.now() - rec.entry.startedAt > IDEM_RUNNING_TIMEOUT_MS) {
    _localIdem.delete(key);
    return null;
  }
  return rec.entry;
}

export async function setIdemRunning(key: string, expiresAt: number): Promise<void> {
  const now = new Date().toISOString();
  _localIdem.set(key, { entry: { status: "running", startedAt: Date.now() }, expiresAt });
  if (supabase) {
    await supabase.from("idem_store").upsert(
      { key, status: "running", started_at: now, result: null, expires_at: new Date(expiresAt).toISOString() },
      { onConflict: "key" }
    );
  }
}

export async function setIdemDone(key: string, result: unknown, expiresAt: number): Promise<void> {
  _localIdem.set(key, { entry: { status: "done", result }, expiresAt });
  if (supabase) {
    await supabase.from("idem_store").upsert(
      { key, status: "done", started_at: null, result, expires_at: new Date(expiresAt).toISOString() },
      { onConflict: "key" }
    );
  }
}

export async function deleteIdem(key: string): Promise<void> {
  _localIdem.delete(key);
  if (supabase) {
    await supabase.from("idem_store").delete().eq("key", key);
  }
}

// ─── Cleanup — prune expired rows periodically ────────────────────────────────

export function startStoreCleanup(): void {
  setInterval(async () => {
    const now = new Date().toISOString();
    const nowMs = Date.now();

    // Local fallback cleanup
    for (const [k, rec] of _localIdem) if (rec.expiresAt < nowMs) _localIdem.delete(k);
    for (const [k, exp] of _localClaims) if (exp < nowMs) _localClaims.delete(k);

    if (!supabase) return;
    await supabase.from("preimage_claims").delete().lt("expires_at", now);
    await supabase.from("idem_store").delete().lt("expires_at", now);
  }, 60_000).unref();
}
