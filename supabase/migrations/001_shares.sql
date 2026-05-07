-- Migration: create shares table for persistent share links (/g/:id)
CREATE TABLE IF NOT EXISTS shares (
  id         TEXT        PRIMARY KEY,
  graph_json JSONB       NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for recency queries (cleanup jobs, analytics)
CREATE INDEX IF NOT EXISTS shares_created_at_idx ON shares (created_at DESC);
