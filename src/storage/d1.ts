import type { DraftStore, ListingDraft } from "../domain/drafts.js";
import type { SaleItem, SellerPolicy } from "../domain/types.js";
import type { SaleItemStore, SellerPolicyStore } from "./interfaces.js";

// The small binding shape keeps the storage adapter independent of the Worker runtime.
export interface D1Binding {
  prepare(query: string): {
    bind(...values: (string | number | null)[]): {
      run(): Promise<unknown>;
      first<T>(): Promise<T | null>;
    };
  };
}

interface SaleItemRow {
  id: string;
  sku: string;
  stage: SaleItem["stage"];
  name: string | null;
  facts_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export class D1SaleItemStore implements SaleItemStore {
  constructor(private readonly db: D1Binding) {}

  async create(item: SaleItem): Promise<SaleItem> {
    await this.db.prepare(
      "INSERT INTO sale_items (id, sku, stage, name, facts_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(item.id, item.sku, item.stage, item.name ?? null, JSON.stringify(item.facts), item.version, item.createdAt, item.updatedAt).run();
    return structuredClone(item);
  }

  async get(id: string): Promise<SaleItem | undefined> {
    const row = await this.db.prepare(
      "SELECT id, sku, stage, name, facts_json, version, created_at, updated_at FROM sale_items WHERE id = ?",
    ).bind(id).first<SaleItemRow>();
    if (!row) return undefined;
    return {
      id: row.id,
      sku: row.sku,
      stage: row.stage,
      ...(row.name === null ? {} : { name: row.name }),
      facts: JSON.parse(row.facts_json) as Record<string, string>,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface PolicyRow { shipping_safety_margin_bps: number }

export class D1SellerPolicyStore implements SellerPolicyStore {
  constructor(private readonly db: D1Binding) {}

  async get(): Promise<SellerPolicy> {
    const row = await this.db.prepare(
      "SELECT shipping_safety_margin_bps FROM seller_policy WHERE singleton_id = 1",
    ).bind().first<PolicyRow>();
    if (!row) throw new Error("seller policy migration has not been applied");
    return { shippingSafetyMarginBps: row.shipping_safety_margin_bps };
  }

  async set(policy: SellerPolicy): Promise<SellerPolicy> {
    if (!Number.isInteger(policy.shippingSafetyMarginBps) || policy.shippingSafetyMarginBps < 0 || policy.shippingSafetyMarginBps > 10000) {
      throw new RangeError("shipping safety margin must be between 0 and 10000 basis points");
    }
    await this.db.prepare(
      "UPDATE seller_policy SET shipping_safety_margin_bps = ?, updated_at = ? WHERE singleton_id = 1",
    ).bind(policy.shippingSafetyMarginBps, new Date().toISOString()).run();
    return this.get();
  }
}

interface DraftRow {
  id: string;
  item_id: string;
  version: number;
  title: string;
  description: string;
  condition: string;
  sale_format: ListingDraft["saleFormat"];
  price_currency: string | null;
  price_minor_units: number | null;
  category_id: string | null;
  item_specifics_json: string;
  created_at: string;
  updated_at: string;
}

export class D1DraftStore implements DraftStore {
  constructor(private readonly db: D1Binding) {}

  async create(draft: ListingDraft): Promise<ListingDraft> {
    await this.db.prepare(
      "INSERT INTO listing_drafts (id, item_id, version, title, description, condition, sale_format, price_currency, price_minor_units, category_id, item_specifics_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(draft.id, draft.itemId, draft.version, draft.title, draft.description, draft.condition, draft.saleFormat,
      draft.price?.currency ?? null, draft.price?.minorUnits ?? null, draft.categoryId ?? null,
      JSON.stringify(draft.itemSpecifics), draft.createdAt, draft.updatedAt).run();
    return structuredClone(draft);
  }

  async get(id: string): Promise<ListingDraft | undefined> {
    const row = await this.db.prepare(
      "SELECT id, item_id, version, title, description, condition, sale_format, price_currency, price_minor_units, category_id, item_specifics_json, created_at, updated_at FROM listing_drafts WHERE id = ?",
    ).bind(id).first<DraftRow>();
    if (!row) return undefined;
    return {
      id: row.id,
      itemId: row.item_id,
      version: row.version,
      title: row.title,
      description: row.description,
      condition: row.condition,
      saleFormat: row.sale_format,
      ...(row.price_currency === null || row.price_minor_units === null ? {} : { price: { currency: row.price_currency, minorUnits: row.price_minor_units } }),
      ...(row.category_id === null ? {} : { categoryId: row.category_id }),
      itemSpecifics: JSON.parse(row.item_specifics_json) as Record<string, string>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
