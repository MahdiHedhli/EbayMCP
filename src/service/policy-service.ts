import type { SellerPolicy } from "../domain/types.js";
import type { SellerPolicyStore } from "../storage/interfaces.js";

export class PolicyService {
  constructor(private readonly store: SellerPolicyStore) {}

  async getSellerPolicy(): Promise<SellerPolicy> {
    return this.store.get();
  }

  async setShippingSafetyMarginBps(shippingSafetyMarginBps: number): Promise<SellerPolicy> {
    if (!Number.isInteger(shippingSafetyMarginBps) || shippingSafetyMarginBps < 0 || shippingSafetyMarginBps > 10_000) {
      throw new RangeError("shipping safety margin must be between 0 and 10000 basis points");
    }
    return this.store.set({ shippingSafetyMarginBps });
  }
}
