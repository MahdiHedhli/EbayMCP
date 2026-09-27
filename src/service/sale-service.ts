import { randomUUID } from "node:crypto";
import { protectShippingEstimate, type Money } from "../domain/shipping.js";
import type { SaleItem } from "../domain/types.js";
import type { SaleItemStore } from "../storage/interfaces.js";
import { PolicyService } from "./policy-service.js";

export class SaleService {
  constructor(
    private readonly store: SaleItemStore,
    private readonly policyService: PolicyService,
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

  async estimateProtectedShipping(base: Money) {
    const policy = await this.policyService.getSellerPolicy();
    return protectShippingEstimate(base, policy.shippingSafetyMarginBps);
  }
}
