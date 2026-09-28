import type { SaleItem, SellerPolicy } from "../domain/types.js";

export interface SaleItemStore {
  create(item: SaleItem): Promise<SaleItem>;
  get(id: string): Promise<SaleItem | undefined>;
}

export interface SellerPolicyStore {
  get(): Promise<SellerPolicy>;
  set(policy: SellerPolicy): Promise<SellerPolicy>;
}
