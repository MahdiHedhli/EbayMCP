import { randomUUID } from "node:crypto";
import type { DraftStore, ListingDraft } from "../domain/drafts.js";
import type { Money } from "../domain/shipping.js";
import type { SaleFormat } from "../domain/types.js";

export interface CreateDraftInput {
  itemId: string;
  title: string;
  description: string;
  condition: string;
  saleFormat: SaleFormat;
  price?: Money;
  categoryId?: string;
  itemSpecifics?: Record<string, string>;
}

export class DraftService {
  constructor(private readonly store: DraftStore) {}

  async createDraft(input: CreateDraftInput): Promise<ListingDraft> {
    const now = new Date().toISOString();
    return this.store.create({
      id: randomUUID(),
      itemId: input.itemId,
      version: 1,
      title: input.title,
      description: input.description,
      condition: input.condition,
      saleFormat: input.saleFormat,
      price: input.price,
      categoryId: input.categoryId,
      itemSpecifics: input.itemSpecifics ?? {},
      createdAt: now,
      updatedAt: now,
    });
  }

  async getDraft(id: string): Promise<ListingDraft | undefined> {
    return this.store.get(id);
  }
}
