import type { TaxEvent } from './tax-events';

export interface TaxProfile {
  capitalGainsTaxRate: number;
  churchTaxRate: number;
  partialExemptionRate: number;
  solidaritySurchargeRate: number;
}

export const DEFAULT_TAX_PROFILE: TaxProfile = {
  capitalGainsTaxRate: 0.25,
  churchTaxRate: 0,
  partialExemptionRate: 0.3,
  solidaritySurchargeRate: 0.055
};

// Tolerance for floating-point residuals when a running "remaining quantity"
// total is depleted across multiple tax events (mirrors the QUANTITY_EPSILON
// convention used for FIFO lot matching in tax-engine.ts/activity-page.ts).
const EPSILON = 1e-6;

export function resolveTaxProfile(taxProfile: Partial<TaxProfile> | undefined): TaxProfile {
  return {
    ...DEFAULT_TAX_PROFILE,
    ...taxProfile
  };
}

export interface TaxEventFilter {
  accountId?: string;
  symbolId?: string;
}

export interface PotentialTaxInput {
  acquisitionCost: number;
  currentValue: number;
  taxProfile?: TaxProfile;
  usedVap?: number;
}

export function calculateVapMonthFactor({
  acquisitionDate
}: {
  acquisitionDate?: Date | string | null;
}): number {
  if (!acquisitionDate) {
    return 1;
  }

  const date = acquisitionDate instanceof Date ? acquisitionDate : new Date(acquisitionDate);

  if (Number.isNaN(date.getTime())) {
    return 1;
  }

  const month = date.getMonth() + 1;
  const monthsBeforeAcquisition = Math.max(month - 1, 0);

  return (12 - monthsBeforeAcquisition) / 12;
}

export interface TaxForSaleInput {
  acquisitionCost: number;
  saleProceeds: number;
  taxProfile?: TaxProfile;
  usedVap: number;
}

export function calculateTotalVap(
  taxEvents: TaxEvent[],
  filter: TaxEventFilter = {}
): number {
  return roundMoney(
    taxEvents
      .filter((taxEvent) => {
        return (
          (!filter.accountId || taxEvent.accountId === filter.accountId) &&
          (!filter.symbolId || taxEvent.symbolId === filter.symbolId)
        );
      })
      .reduce((sum, taxEvent) => {
        return sum + roundMoney(taxEvent.quantity * taxEvent.vorabpauschalePerShare);
      }, 0)
  );
}

export function calculateTotalVapAfterTeilfreistellung(
  taxEvents: TaxEvent[],
  filter: TaxEventFilter = {}
): number {
  return roundMoney(
    taxEvents
      .filter((taxEvent) => {
        return (
          (!filter.accountId || taxEvent.accountId === filter.accountId) &&
          (!filter.symbolId || taxEvent.symbolId === filter.symbolId)
        );
      })
      .reduce((sum, taxEvent) => {
        return (
          sum +
          roundMoney(
            taxEvent.quantity * taxEvent.vorabpauschalePerShareAfterTeilfreistellung
          )
        );
      }, 0)
  );
}

export function calculatePaidVap({
  taxProfile = DEFAULT_TAX_PROFILE,
  grossVap,
  taxableVap
}: {
  taxProfile?: TaxProfile;
  grossVap?: number;
  taxableVap?: number;
}): number {
  const calculatedTaxableVap =
    taxableVap ??
    (grossVap !== undefined ? grossVap * (1 - taxProfile.partialExemptionRate) : 0);

  if (calculatedTaxableVap <= 0) {
    return 0;
  }

  const taxOnVap = calculatedTaxableVap * taxProfile.capitalGainsTaxRate;
  const solidaritySurcharge = taxOnVap * taxProfile.solidaritySurchargeRate;
  const churchTax = calculatedTaxableVap * taxProfile.churchTaxRate;

  return roundMoney(taxOnVap + solidaritySurcharge + churchTax);
}

export function calculatePotentialTax({
  acquisitionCost,
  currentValue,
  taxProfile = DEFAULT_TAX_PROFILE,
  usedVap = 0
}: PotentialTaxInput): number {
  const gainAfterVap = Math.max(currentValue - acquisitionCost - usedVap, 0);
  const taxableGain = gainAfterVap * (1 - taxProfile.partialExemptionRate);

  if (taxableGain <= 0) {
    return 0;
  }

  const taxOnGain = taxableGain * taxProfile.capitalGainsTaxRate;
  const solidaritySurcharge = taxOnGain * taxProfile.solidaritySurchargeRate;
  const churchTax = taxableGain * taxProfile.churchTaxRate;

  return roundMoney(taxOnGain + solidaritySurcharge + churchTax);
}

export function calculateVapForQuantity({
  accountId,
  quantity,
  symbolId,
  taxEvents,
  taxYear,
  useAfterTeilfreistellung = false,
  acquisitionDate
}: {
  accountId: string;
  quantity: number;
  symbolId: string;
  taxEvents: TaxEvent[];
  taxYear?: number;
  useAfterTeilfreistellung?: boolean;
  acquisitionDate?: Date | string | null;
}): number {
  if (quantity <= 0) {
    return 0;
  }

  const weightedQuantity = quantity * calculateVapMonthFactor({ acquisitionDate });
  let remainingQuantity = weightedQuantity;
  let vap = 0;

  for (const taxEvent of taxEvents
    .filter((event) => {
      return (
        event.accountId === accountId &&
        event.symbolId === symbolId &&
        (taxYear === undefined || event.taxYear >= taxYear)
      );
    })
    .sort((left, right) => left.taxYear - right.taxYear)) {
    if (remainingQuantity <= EPSILON) {
      break;
    }

    const allocatedQuantity = Math.min(remainingQuantity, taxEvent.quantity);
    const perShareValue = useAfterTeilfreistellung
      ? taxEvent.vorabpauschalePerShareAfterTeilfreistellung
      : taxEvent.vorabpauschalePerShare;

    vap += allocatedQuantity * perShareValue;
    remainingQuantity -= allocatedQuantity;
  }

  return Math.min(vap, Number.MAX_SAFE_INTEGER);
}

export function calculateVapForBuyLot({
  accountId,
  quantity,
  symbolId,
  taxEvents,
  taxYear,
  useAfterTeilfreistellung = false,
  acquisitionDate
}: {
  accountId: string;
  quantity: number;
  symbolId: string;
  taxEvents: TaxEvent[];
  taxYear?: number;
  useAfterTeilfreistellung?: boolean;
  acquisitionDate?: Date | string | null;
}): number {
  if (quantity <= 0) {
    return 0;
  }

  const weightedQuantity = quantity * calculateVapMonthFactor({ acquisitionDate });
  const matchingTaxEvents = taxEvents.filter((event) => {
    return (
      event.accountId === accountId &&
      event.symbolId === symbolId &&
      (taxYear === undefined || event.taxYear >= taxYear)
    );
  });

  if (!matchingTaxEvents.length) {
    return 0;
  }

  const totalPerShareVap = matchingTaxEvents.reduce((sum, taxEvent) => {
    return (
      sum +
      (useAfterTeilfreistellung
        ? taxEvent.vorabpauschalePerShareAfterTeilfreistellung
        : taxEvent.vorabpauschalePerShare)
    );
  }, 0);

  return weightedQuantity * totalPerShareVap;
}

// Fallback base interest rate (Basiszins) used to internally estimate a Vorabpauschale (VAP)
// for years without an explicit tax-page entry, following the same formula the Finanzamt uses:
// Basisertrag = Kurswert Jahresanfang * Basiszins * 0.7, capped at the year's actual price gain.
export const ASSUMED_BASISZINS_PERCENTAGE = 2.5;

/**
 * Estimates a Vorabpauschale (VAP) for a BUY lot whose acquisition year has no explicit
 * tax-page entry, using the statutory formula: Basisertrag = start-of-year price * Basiszins
 * * 0.7, capped at the year's actual price gain (0 if the price fell), prorated by the month
 * the lot was acquired in. Callers are responsible for deriving startOfYearPrice/endOfYearPrice
 * from their own price-projection model.
 */
export function estimateVapForLotWithoutTaxEvent({
  acquisitionDate,
  endOfYearPrice,
  quantity,
  startOfYearPrice,
  taxProfile
}: {
  acquisitionDate?: Date | string | null;
  endOfYearPrice: number;
  quantity: number;
  startOfYearPrice: number;
  taxProfile: TaxProfile;
}): { grossVap: number; taxableVap: number } {
  if (quantity <= 0) {
    return { grossVap: 0, taxableVap: 0 };
  }

  const basisertragPerShare = startOfYearPrice * (ASSUMED_BASISZINS_PERCENTAGE / 100) * 0.7;
  const priceGainPerShare = Math.max(endOfYearPrice - startOfYearPrice, 0);
  const vapPerShare = Math.min(basisertragPerShare, priceGainPerShare);
  const monthFactor = calculateVapMonthFactor({ acquisitionDate });

  const grossVap = roundMoney(quantity * monthFactor * vapPerShare);
  const taxableVap = roundMoney(grossVap * (1 - taxProfile.partialExemptionRate));

  return { grossVap, taxableVap };
}

export function calculateTaxForSale({
  acquisitionCost,
  saleProceeds,
  taxProfile = DEFAULT_TAX_PROFILE,
  usedVap
}: TaxForSaleInput): number {
  const gainAfterVap = Math.max(saleProceeds - acquisitionCost - usedVap, 0);
  const taxableGain = gainAfterVap * (1 - taxProfile.partialExemptionRate);

  if (taxableGain <= 0) {
    return 0;
  }

  const taxOnGain = taxableGain * taxProfile.capitalGainsTaxRate;
  const solidaritySurcharge = taxOnGain * taxProfile.solidaritySurchargeRate;
  const churchTax = taxableGain * taxProfile.churchTaxRate;

  return roundMoney(taxOnGain + solidaritySurcharge + churchTax);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
