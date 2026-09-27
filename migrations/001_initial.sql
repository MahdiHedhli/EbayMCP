PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  name TEXT,
  facts_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_policy (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  shipping_safety_margin_bps INTEGER NOT NULL CHECK (shipping_safety_margin_bps BETWEEN 0 AND 10000),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO seller_policy(singleton_id, shipping_safety_margin_bps, updated_at)
VALUES (1, 2500, CURRENT_TIMESTAMP);
