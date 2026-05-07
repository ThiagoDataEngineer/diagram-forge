export function makeRateLimiter(maxPerDay: number) {
  const usage = new Map<string, { count: number; resetAt: number }>();
  return function allowed(ip: string, now = Date.now()): { ok: boolean; remaining: number } {
    let entry = usage.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 86_400_000 };
      usage.set(ip, entry);
    }
    if (entry.count >= maxPerDay) return { ok: false, remaining: 0 };
    entry.count++;
    return { ok: true, remaining: maxPerDay - entry.count };
  };
}
