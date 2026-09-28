import { DEFAULT_SHIPPING_SAFETY_MARGIN_BPS } from "../domain/shipping.js";
import type { SaleItem, SellerPolicy } from "../domain/types.js";
import type { SaleItemStore, SellerPolicyStore } from "./interfaces.js";

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

export class InMemorySellerPolicyStore implements SellerPolicyStore {
  #policy: SellerPolicy = { shippingSafetyMarginBps: DEFAULT_SHIPPING_SAFETY_MARGIN_BPS };

  async get(): Promise<SellerPolicy> {
    return structuredClone(this.#policy);
  }

  async set(policy: SellerPolicy): Promise<SellerPolicy> {
    this.#policy = structuredClone(policy);
    return this.get();
  }
}
