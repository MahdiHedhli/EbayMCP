export const DEFAULT_SHIPPING_SAFETY_MARGIN_BPS = 2500;

export interface Money {
  currency: string;
  minorUnits: number;
}

export interface ProtectedShippingEstimate {
  base: Money;
  safetyMarginBps: number;
  safetyMargin: Money;
  protectedEstimate: Money;
}

export function protectShippingEstimate(
  base: Money,
  safetyMarginBps = DEFAULT_SHIPPING_SAFETY_MARGIN_BPS,
): ProtectedShippingEstimate {
  if (!Number.isSafeInteger(base.minorUnits) || base.minorUnits < 0) {
    throw new RangeError("base shipping cost must be a non-negative integer in minor units");
  }
  if (!Number.isInteger(safetyMarginBps) || safetyMarginBps < 0 || safetyMarginBps > 10_000) {
    throw new RangeError("shipping safety margin must be between 0 and 10000 basis points");
  }

  // Round the seller-protective component upward. Never erode the configured cushion by rounding down.
  const marginMinor = Math.ceil((base.minorUnits * safetyMarginBps) / 10_000);
  return {
    base,
    safetyMarginBps,
    safetyMargin: { currency: base.currency, minorUnits: marginMinor },
    protectedEstimate: { currency: base.currency, minorUnits: base.minorUnits + marginMinor },
  };
}
