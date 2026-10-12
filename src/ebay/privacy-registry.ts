// Every application D1 table and column must appear here. The migration
// coverage test fails when a future schema change lacks a data classification.
export const EBAY_D1_PRIVACY_REGISTRY = {
  sale_items: {
    handling: "local_item_no_ebay_subject_reference",
    columns: ["id", "sku", "stage", "name", "facts_json", "version", "created_at", "updated_at"],
  },
  seller_policy: {
    handling: "non_personal_configuration",
    columns: ["singleton_id", "shipping_safety_margin_bps", "updated_at"],
  },
  listing_drafts: {
    handling: "local_draft_no_ebay_subject_reference",
    columns: ["id", "item_id", "version", "title", "description", "condition", "sale_format", "price_currency",
      "price_minor_units", "category_id", "item_specifics_json", "created_at", "updated_at"],
  },
  ebay_oauth_states: {
    handling: "opaque_short_lived_oauth_state",
    columns: ["environment", "state_hash", "expires_at"],
  },
  ebay_seller_connections: {
    handling: "ebay_seller_credential_erase_by_user_id",
    columns: ["environment", "encrypted_tokens", "access_expires_at", "refresh_expires_at", "version", "connected_at",
      "updated_at", "ebay_user_id"],
  },
  ebay_account_deletion_receipts: {
    handling: "minimal_90_day_audit_no_raw_subject",
    columns: ["notification_id", "subject_digest", "processed_at", "erased_connections"],
  },
} as const;
