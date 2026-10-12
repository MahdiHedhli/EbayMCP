-- Existing connections cannot be attributed without an account identity lookup.
-- They remain unbound and block acknowledgement until reconnected or reviewed.
ALTER TABLE ebay_seller_connections ADD COLUMN ebay_user_id TEXT;
CREATE INDEX IF NOT EXISTS ebay_seller_connections_user_idx ON ebay_seller_connections(ebay_user_id);
CREATE TRIGGER IF NOT EXISTS ebay_connection_subject_insert
BEFORE INSERT ON ebay_seller_connections WHEN NEW.ebay_user_id IS NULL
BEGIN SELECT RAISE(ABORT, 'seller subject required'); END;
CREATE TRIGGER IF NOT EXISTS ebay_connection_subject_update
BEFORE UPDATE ON ebay_seller_connections WHEN NEW.ebay_user_id IS NULL
BEGIN SELECT RAISE(ABORT, 'seller subject required'); END;

CREATE TABLE IF NOT EXISTS ebay_account_deletion_receipts (
  notification_id TEXT PRIMARY KEY,
  subject_digest TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  erased_connections INTEGER NOT NULL CHECK (erased_connections >= 0)
);
CREATE INDEX IF NOT EXISTS ebay_deletion_subject_idx ON ebay_account_deletion_receipts(subject_digest);
