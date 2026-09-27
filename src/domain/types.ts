import type { Money, ProtectedShippingEstimate } from "./shipping.js";

export type SaleStage =
  | "CAPTURED"
  | "IDENTIFIED"
  | "RESEARCHED"
  | "DRAFTED"
  | "LISTED"
  | "SOLD"
  | "FULFILLING"
  | "COMPLETE";

export type SaleFormat = "FIXED_PRICE" | "AUCTION";

export interface SellerPolicy {
  shippingSafetyMarginBps: number;
}

export interface SaleItem {
  id: string;
  sku: string;
  stage: SaleStage;
  name?: string;
  facts: Record<string, string>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaleFormatRecommendation {
  format: SaleFormat;
  rationale: string[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidenceRefs: string[];
}

export interface ShippingDecision {
  estimate: ProtectedShippingEstimate;
  actualCost?: Money;
  provenance: string;
  asOf: string;
}
