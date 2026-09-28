CREATE TABLE IF NOT EXISTS listing_drafts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES sale_items(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  condition TEXT NOT NULL,
  sale_format TEXT NOT NULL CHECK (sale_format IN ('FIXED_PRICE', 'AUCTION')),
  price_currency TEXT,
  price_minor_units INTEGER,
  category_id TEXT,
  item_specifics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((price_currency IS NULL) = (price_minor_units IS NULL))
);

CREATE INDEX IF NOT EXISTS listing_drafts_item_id_idx ON listing_drafts(item_id);
