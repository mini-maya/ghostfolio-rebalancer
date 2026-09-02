import type { TaxEvent } from './tax-events';

export interface TaxProfile {
  capitalGainsTaxRate: number;
  churchTaxRate: number;
  partialExemptionRate: number;
  solidaritySurchargeRate: number;
  /**
   * Annual Sparer-Pauschbetrag (German saver's lump-sum allowance) in EUR. Applied once per
   * calendar year against the *combined* taxable capital income of that year (taxable VAP plus
   * taxable realized sale gains) - never against VAP itself, and never carried over into the
   * following year. Defaults to 1.000 EUR (single filer); jointly assessed spouses/partners can
   * configure 2.000 EUR.
   */
  sparerPauschbetrag: number;
}

export const DEFAULT_TAX_PROFILE: TaxProfile = {
  capitalGainsTaxRate: 0.25,
  churchTaxRate: 0,
  partialExemptionRate: 0.3,
  solidaritySurchargeRate: 0.055,
  sparerPauschbetrag: 1000
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

/**
 * Applies the configured capital-gains-tax rate, solidarity surcharge and (optional) church
 * tax to an already-determined taxable amount. This is the single shared tax-rate formula
 * (KapSt + Soli + Kirchensteuer) used for VAP, unrealized potential gains and realized sale
 * gains alike - callers are responsible for first arriving at the correct taxable amount
 * (e.g. after Teilfreistellung and, where relevant, after the Sparer-Pauschbetrag).
 */
export function calculateTaxOnTaxableAmount(
  taxableAmount: number,
  taxProfile: TaxProfile = DEFAULT_TAX_PROFILE
): number {
  if (taxableAmount <= 0) {
    return 0;
  }

  const taxOnAmount = taxableAmount * taxProfile.capitalGainsTaxRate;
  const solidaritySurcharge = taxOnAmount * taxProfile.solidaritySurchargeRate;
  const churchTax = taxableAmount * taxProfile.churchTaxRate;

  return roundMoney(taxOnAmount + solidaritySurcharge + churchTax);
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

  return calculateTaxOnTaxableAmount(calculatedTaxableVap, taxProfile);
}

export function calculatePotentialTax({
  acquisitionCost,
  currentValue,
  taxProfile = DEFAULT_TAX_PROFILE,
  usedVap = 0
}: PotentialTaxInput): number {
  const gainAfterVap = Math.max(currentValue - acquisitionCost - usedVap, 0);
  const taxableGain = gainAfterVap * (1 - taxProfile.partialExemptionRate);

  return calculateTaxOnTaxableAmount(taxableGain, taxProfile);
}

export interface SparerPauschbetragAllocationInput {
  /** Taxable capital income amounts (already after Teilfreistellung) for a single calendar year. */
  taxableAmounts: number[];
  /** Sparer-Pauschbetrag available for that calendar year (does not carry over from prior years). */
  sparerPauschbetragAvailable: number;
}

export interface SparerPauschbetragAllocationResult {
  /** Sum of all taxableAmounts, before applying the allowance. */
  totalTaxableAmount: number;
  /** Portion of the allowance consumed by this year's combined capital income. */
  used: number;
  /** Unused portion of this year's allowance. It expires and must not be carried forward. */
  remaining: number;
  /** Taxable amount remaining after the allowance has been applied. */
  taxableAfterAllowance: number;
}

/**
 * Applies the annual Sparer-Pauschbetrag to the *combined* taxable capital income of a single
 * calendar year (taxable VAP and taxable realized sale gains together - the allowance must
 * never be applied separately per income type, see spec section 17). The allowance itself is
 * never subtracted from the VAP; it only reduces the resulting tax base. Unused amounts expire
 * at year end and must not be passed as `sparerPauschbetragAvailable` for a later year.
 */
export function allocateSparerPauschbetragForYear({
  sparerPauschbetragAvailable,
  taxableAmounts
}: SparerPauschbetragAllocationInput): SparerPauschbetragAllocationResult {
  const totalTaxableAmount = roundMoney(
    taxableAmounts.reduce((sum, amount) => sum + Math.max(amount, 0), 0)
  );
  const allowanceAvailable = Math.max(sparerPauschbetragAvailable, 0);
  const used = roundMoney(Math.min(totalTaxableAmount, allowanceAvailable));
  const remaining = roundMoney(Math.max(allowanceAvailable - used, 0));
  const taxableAfterAllowance = roundMoney(Math.max(totalTaxableAmount - used, 0));

  return {
    remaining,
    taxableAfterAllowance,
    totalTaxableAmount,
    used
  };
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

/**
 * Returns the taxable sale gain (after subtracting already-taxed VAP and applying the fund's
 * Teilfreistellung), *before* any annual Sparer-Pauschbetrag is applied. Exposed separately so
 * callers that need to aggregate several taxable amounts of the same calendar year (VAP and
 * sale gains together) before applying the shared annual allowance can do so without
 * duplicating this formula.
 */
export function calculateTaxableGainAfterVap({
  acquisitionCost,
  saleProceeds,
  taxProfile = DEFAULT_TAX_PROFILE,
  usedVap
}: TaxForSaleInput): number {
  const gainAfterVap = Math.max(saleProceeds - acquisitionCost - usedVap, 0);

  return roundMoney(gainAfterVap * (1 - taxProfile.partialExemptionRate));
}

export function calculateTaxForSale({
  acquisitionCost,
  saleProceeds,
  taxProfile = DEFAULT_TAX_PROFILE,
  usedVap
}: TaxForSaleInput): number {
  const taxableGain = calculateTaxableGainAfterVap({
    acquisitionCost,
    saleProceeds,
    taxProfile,
    usedVap
  });

  return calculateTaxOnTaxableAmount(taxableGain, taxProfile);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
