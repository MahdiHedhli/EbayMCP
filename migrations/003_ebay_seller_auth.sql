CREATE TABLE IF NOT EXISTS ebay_oauth_states (
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  state_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (environment, state_hash)
);

CREATE TABLE IF NOT EXISTS ebay_seller_connections (
  environment TEXT PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  encrypted_tokens TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
