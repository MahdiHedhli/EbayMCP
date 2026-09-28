import { describe, expect, it } from "vitest";
import { PolicyService } from "../src/service/policy-service.js";
import { InMemorySellerPolicyStore } from "../src/storage/memory.js";

describe("seller policy", () => {
  it("starts with a 25% shipping safety margin", async () => {
    const service = new PolicyService(new InMemorySellerPolicyStore());
    await expect(service.getSellerPolicy()).resolves.toEqual({ shippingSafetyMarginBps: 2500 });
  });

  it("persists a changed shipping safety margin through the store boundary", async () => {
    const store = new InMemorySellerPolicyStore();
    const first = new PolicyService(store);
    await first.setShippingSafetyMarginBps(3000);
    const second = new PolicyService(store);
    await expect(second.getSellerPolicy()).resolves.toEqual({ shippingSafetyMarginBps: 3000 });
  });

  it("rejects margins above 100%", async () => {
    const service = new PolicyService(new InMemorySellerPolicyStore());
    await expect(service.setShippingSafetyMarginBps(10001)).rejects.toThrow(RangeError);
  });
});
