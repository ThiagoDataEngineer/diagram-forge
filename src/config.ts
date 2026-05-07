// ─── Model config — single source of truth ───────────────────────────────────
// To upgrade: set CLAUDE_MODEL in .env, or update DEFAULT_MODEL here.
// Current Anthropic models (May 2026):
//   claude-sonnet-4-6       ← balanced (default)
//   claude-opus-4-7         ← highest quality, slower, more expensive
//   claude-haiku-4-5-20251001 ← fastest, cheapest

export const DEFAULT_MODEL =
  process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";
