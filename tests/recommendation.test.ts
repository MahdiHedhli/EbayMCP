import { describe, expect, it } from "vitest";
import { recommendSaleFormat } from "../src/service/recommendation-service.js";

describe("sale-format recommendation", () => {
  it("leans fixed-price for a well-known, low-dispersion market", () => {
    expect(recommendSaleFormat({
      knownValueConfidence: "HIGH",
      demand: "MEDIUM",
      priceDispersion: "LOW",
      rarity: "COMMON",
    }).format).toBe("FIXED_PRICE");
  });

  it("leans auction for rare, uncertain, high-demand items", () => {
    expect(recommendSaleFormat({
      knownValueConfidence: "LOW",
      demand: "HIGH",
      priceDispersion: "HIGH",
      rarity: "RARE",
    }).format).toBe("AUCTION");
  });
});
