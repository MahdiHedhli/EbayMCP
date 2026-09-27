import { describe, expect, it } from "vitest";
import { protectShippingEstimate } from "../src/domain/shipping.js";

describe("protectShippingEstimate", () => {
  it("defaults to a 25% seller-protective margin", () => {
    expect(protectShippingEstimate({ currency: "USD", minorUnits: 1600 })).toEqual({
      base: { currency: "USD", minorUnits: 1600 },
      safetyMarginBps: 2500,
      safetyMargin: { currency: "USD", minorUnits: 400 },
      protectedEstimate: { currency: "USD", minorUnits: 2000 },
    });
  });

  it("rounds the protective component upward", () => {
    expect(protectShippingEstimate({ currency: "USD", minorUnits: 101 }).protectedEstimate.minorUnits).toBe(127);
  });

  it("rejects invalid margins", () => {
    expect(() => protectShippingEstimate({ currency: "USD", minorUnits: 100 }, 10_001)).toThrow(RangeError);
  });
});
