-- Store keyed hashes only. The Worker never persists the notification payload or subject identifiers.
CREATE TABLE IF NOT EXISTS ebay_deletion_inbox (
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  notification_hash TEXT NOT NULL,
  user_hash TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (environment, notification_hash)
);

-- Future eBay data ingestion must register every subject/record association before persisting data.
-- Current v1 local sale items and drafts contain synthetic data only.
CREATE TABLE IF NOT EXISTS ebay_subject_links (
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  identifier_kind TEXT NOT NULL CHECK (identifier_kind IN ('userId', 'username', 'eiasToken')),
  identifier_hash TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('sale_item', 'seller_connection')),
  target_id TEXT NOT NULL,
  PRIMARY KEY (environment, identifier_kind, identifier_hash, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS ebay_subject_links_target_idx
  ON ebay_subject_links (environment, target_type, target_id);
