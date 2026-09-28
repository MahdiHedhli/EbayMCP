import type { Money } from "./shipping.js";
import type { SaleFormat } from "./types.js";

export interface ListingDraft {
  id: string;
  itemId: string;
  version: number;
  title: string;
  description: string;
  condition: string;
  saleFormat: SaleFormat;
  price?: Money;
  categoryId?: string;
  itemSpecifics: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface DraftStore {
  create(draft: ListingDraft): Promise<ListingDraft>;
  get(id: string): Promise<ListingDraft | undefined>;
}
