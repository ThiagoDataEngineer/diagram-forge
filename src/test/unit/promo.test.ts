/**
 * Unit tests for src/db/promo.ts
 * Mocks the supabase client — no real DB connection needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockSingle = vi.fn();
const mockEqSelect = vi.fn();
const mockEqUpdate = vi.fn();
const mockEqUpdate2 = vi.fn();

function makeChain(selectResult: unknown, updateResult: unknown) {
  mockSingle.mockResolvedValue(selectResult);
  mockEqUpdate2.mockResolvedValue(updateResult);

  mockEqSelect.mockReturnValue({ single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEqSelect });

  mockEqUpdate.mockReturnValue({ eq: mockEqUpdate2 });
  mockUpdate.mockReturnValue({ eq: mockEqUpdate });

  return {
    from: (_table: string) => ({ select: mockSelect, update: mockUpdate }),
  };
}

vi.mock("../../db/supabase.js", () => ({
  supabase: {
    from: (_table: string) => ({ select: mockSelect, update: mockUpdate }),
  },
}));

// Import AFTER mock is registered
const { redeemPromo } = await import("../../db/promo.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset cache between tests by re-importing would be ideal, but since the
  // cache is module-level, we test with unique code names to avoid cross-test hits.
});

describe("redeemPromo — invalid code", () => {
  it("returns valid:false reason:invalid_code when code not found in DB", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    mockEqSelect.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEqSelect });
    mockUpdate.mockReturnValue({ eq: () => ({ eq: () => ({}) }) });

    const result = await redeemPromo("NOTEXIST_UNIQUE1");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("invalid_code");
  });
});

describe("redeemPromo — expired code", () => {
  it("returns valid:false reason:code_expired for past expires_at", async () => {
    mockSingle.mockResolvedValue({
      data: {
        tier: "basic",
        max_uses: 100,
        uses: 0,
        expires_at: "2020-01-01T00:00:00Z", // past
      },
      error: null,
    });
    mockEqSelect.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEqSelect });
    mockUpdate.mockReturnValue({ eq: () => ({ eq: () => ({}) }) });

    const result = await redeemPromo("EXPIRED_UNIQUE1");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("code_expired");
  });
});

describe("redeemPromo — exhausted code", () => {
  it("returns valid:false reason:code_exhausted when uses >= max_uses", async () => {
    mockSingle.mockResolvedValue({
      data: {
        tier: "full",
        max_uses: 5,
        uses: 5, // exactly at limit
        expires_at: null,
      },
      error: null,
    });
    mockEqSelect.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEqSelect });
    mockUpdate.mockReturnValue({ eq: () => ({ eq: () => ({}) }) });

    const result = await redeemPromo("EXHAUSTED_UNIQUE1");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("code_exhausted");
  });
});

describe("redeemPromo — valid code", () => {
  it("returns valid:true with correct tier on successful redemption", async () => {
    mockSingle.mockResolvedValue({
      data: {
        tier: "live",
        max_uses: 10,
        uses: 2,
        expires_at: null,
      },
      error: null,
    });
    mockEqSelect.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEqSelect });
    // Atomic increment succeeds (no error)
    mockEqUpdate2.mockResolvedValue({ error: null });
    mockEqUpdate.mockReturnValue({ eq: mockEqUpdate2 });
    mockUpdate.mockReturnValue({ eq: mockEqUpdate });

    const result = await redeemPromo("VALIDCODE_UNIQUE1");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.tier).toBe("live");
    }
  });

  it("returns valid:true with null tier (uses request tier)", async () => {
    mockSingle.mockResolvedValue({
      data: {
        tier: null, // null means use whatever tier the user requested
        max_uses: null, // unlimited
        uses: 99,
        expires_at: null,
      },
      error: null,
    });
    mockEqSelect.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEqSelect });
    mockEqUpdate2.mockResolvedValue({ error: null });
    mockEqUpdate.mockReturnValue({ eq: mockEqUpdate2 });
    mockUpdate.mockReturnValue({ eq: mockEqUpdate });

    const result = await redeemPromo("NULLTIER_UNIQUE1");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.tier).toBeNull();
    }
  });

  it("returns valid:false reason:redeem_failed when atomic increment fails", async () => {
    mockSingle.mockResolvedValue({
      data: { tier: "basic", max_uses: 1, uses: 0, expires_at: null },
      error: null,
    });
    mockEqSelect.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEqSelect });
    // Simulate concurrent write conflict
    mockEqUpdate2.mockResolvedValue({ error: { code: "23505" } });
    mockEqUpdate.mockReturnValue({ eq: mockEqUpdate2 });
    mockUpdate.mockReturnValue({ eq: mockEqUpdate });

    const result = await redeemPromo("CONFLICT_UNIQUE1");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("redeem_failed");
  });
});
