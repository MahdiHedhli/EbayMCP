import { randomUUID } from "node:crypto";
import { DEFAULT_SHIPPING_SAFETY_MARGIN_BPS, protectShippingEstimate, type Money } from "../domain/shipping.js";
import type { SaleItem, SellerPolicy } from "../domain/types.js";

export interface SaleItemStore {
  create(item: SaleItem): Promise<SaleItem>;
  get(id: string): Promise<SaleItem | undefined>;
}

export class InMemorySaleItemStore implements SaleItemStore {
  readonly #items = new Map<string, SaleItem>();
  async create(item: SaleItem): Promise<SaleItem> {
    this.#items.set(item.id, structuredClone(item));
    return structuredClone(item);
  }
  async get(id: string): Promise<SaleItem | undefined> {
    const item = this.#items.get(id);
    return item ? structuredClone(item) : undefined;
  }
}

export class SaleService {
  constructor(
    private readonly store: SaleItemStore,
    readonly policy: SellerPolicy = { shippingSafetyMarginBps: DEFAULT_SHIPPING_SAFETY_MARGIN_BPS },
  ) {}

  async createSaleItem(facts: Record<string, string>): Promise<SaleItem> {
    const now = new Date().toISOString();
    const id = randomUUID();
    return this.store.create({
      id,
      sku: `OD-${id.slice(0, 8).toUpperCase()}`,
      stage: "CAPTURED",
      facts,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  async getSaleItem(id: string): Promise<SaleItem | undefined> {
    return this.store.get(id);
  }

  estimateProtectedShipping(base: Money) {
    return protectShippingEstimate(base, this.policy.shippingSafetyMarginBps);
  }
}
