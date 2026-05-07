import { describe, it, expect } from "vitest";
import { makeRateLimiter } from "../../utils/rate-limiter.js";

describe("makeRateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = makeRateLimiter(3);
    const now = Date.now();
    expect(limiter("ip1", now).ok).toBe(true);
    expect(limiter("ip1", now).ok).toBe(true);
    expect(limiter("ip1", now).ok).toBe(true);
  });

  it("blocks on the next request after limit", () => {
    const limiter = makeRateLimiter(2);
    const now = Date.now();
    limiter("ip2", now);
    limiter("ip2", now);
    const r = limiter("ip2", now);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("returns correct remaining count", () => {
    const limiter = makeRateLimiter(5);
    const now = Date.now();
    expect(limiter("ip3", now).remaining).toBe(4);
    expect(limiter("ip3", now).remaining).toBe(3);
    expect(limiter("ip3", now).remaining).toBe(2);
  });

  it("tracks IPs independently", () => {
    const limiter = makeRateLimiter(1);
    const now = Date.now();
    expect(limiter("a", now).ok).toBe(true);
    expect(limiter("b", now).ok).toBe(true);
    expect(limiter("a", now).ok).toBe(false);
    expect(limiter("b", now).ok).toBe(false);
  });

  it("resets after 24 hours", () => {
    const limiter = makeRateLimiter(1);
    const t0 = 1_000_000;
    limiter("ip5", t0);
    expect(limiter("ip5", t0).ok).toBe(false);
    // 24h + 1ms later — window resets
    expect(limiter("ip5", t0 + 86_400_001).ok).toBe(true);
  });

  it("does not reset before 24 hours", () => {
    const limiter = makeRateLimiter(1);
    const t0 = 1_000_000;
    limiter("ip6", t0);
    expect(limiter("ip6", t0 + 86_399_999).ok).toBe(false);
  });

  it("allows unlimited use when maxPerDay is large", () => {
    const limiter = makeRateLimiter(1000);
    const now = Date.now();
    for (let i = 0; i < 999; i++) limiter("stress", now);
    expect(limiter("stress", now).ok).toBe(true);
    expect(limiter("stress", now).ok).toBe(false);
  });
});
