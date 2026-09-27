import type { SaleFormatRecommendation } from "../domain/types.js";

export interface SaleFormatSignals {
  knownValueConfidence: "LOW" | "MEDIUM" | "HIGH";
  demand: "LOW" | "MEDIUM" | "HIGH";
  priceDispersion: "LOW" | "MEDIUM" | "HIGH";
  rarity: "COMMON" | "UNCOMMON" | "RARE";
  evidenceRefs?: string[];
}

export function recommendSaleFormat(signals: SaleFormatSignals): SaleFormatRecommendation {
  const rationale: string[] = [];
  let auctionScore = 0;

  if (signals.rarity === "RARE") {
    auctionScore += 2;
    rationale.push("Rare items can benefit from price discovery when buyer competition exists.");
  }
  if (signals.priceDispersion === "HIGH") {
    auctionScore += 1;
    rationale.push("High observed price dispersion increases uncertainty around a fixed asking price.");
  }
  if (signals.knownValueConfidence === "LOW") {
    auctionScore += 1;
    rationale.push("Low valuation confidence favors price discovery over a rigid asking price.");
  }
  if (signals.demand === "HIGH") {
    auctionScore += 1;
    rationale.push("High demand can support competitive bidding.");
  }
  if (signals.demand === "LOW") {
    auctionScore -= 2;
    rationale.push("Low demand favors a fixed-price listing with patience rather than a time-bounded auction.");
  }
  if (signals.knownValueConfidence === "HIGH" && signals.priceDispersion === "LOW") {
    auctionScore -= 2;
    rationale.push("High valuation confidence and low price dispersion support a fixed-price listing.");
  }

  const format = auctionScore >= 2 ? "AUCTION" : "FIXED_PRICE";
  return {
    format,
    rationale: rationale.length ? rationale : ["Insufficient differentiation, defaulting to fixed price."],
    confidence: Math.abs(auctionScore) >= 3 ? "HIGH" : Math.abs(auctionScore) >= 1 ? "MEDIUM" : "LOW",
    evidenceRefs: signals.evidenceRefs ?? [],
  };
}
