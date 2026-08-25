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

export interface UsedVapInput {
  accountId: string;
  soldQuantity: number;
  symbolId: string;
  taxEvents: TaxEvent[];
  taxYear?: number;
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
  taxableVap
}: {
  taxProfile?: TaxProfile;
  taxableVap: number;
}): number {
  if (taxableVap <= 0) {
    return 0;
  }

  const taxOnVap = taxableVap * taxProfile.capitalGainsTaxRate;
  const solidaritySurcharge = taxOnVap * taxProfile.solidaritySurchargeRate;
  const churchTax = taxableVap * taxProfile.churchTaxRate;

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
  useAfterTeilfreistellung = false
}: {
  accountId: string;
  quantity: number;
  symbolId: string;
  taxEvents: TaxEvent[];
  taxYear?: number;
  useAfterTeilfreistellung?: boolean;
}): number {
  if (quantity <= 0) {
    return 0;
  }

  let remainingQuantity = quantity;
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
    if (remainingQuantity <= 0) {
      break;
    }

    const allocatedQuantity = Math.min(remainingQuantity, taxEvent.quantity);
    const perShareValue = useAfterTeilfreistellung
      ? taxEvent.vorabpauschalePerShareAfterTeilfreistellung
      : taxEvent.vorabpauschalePerShare;

    vap += allocatedQuantity * perShareValue;
    remainingQuantity -= allocatedQuantity;
  }

  return roundMoney(Math.min(vap, Number.MAX_SAFE_INTEGER));
}

export function calculateVapForBuyLot({
  accountId,
  quantity,
  symbolId,
  taxEvents,
  taxYear,
  useAfterTeilfreistellung = false
}: {
  accountId: string;
  quantity: number;
  symbolId: string;
  taxEvents: TaxEvent[];
  taxYear?: number;
  useAfterTeilfreistellung?: boolean;
}): number {
  if (quantity <= 0) {
    return 0;
  }

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

  return roundMoney(quantity * totalPerShareVap);
}

export function calculateUsedVap({
  accountId,
  soldQuantity,
  symbolId,
  taxEvents,
  taxYear
}: UsedVapInput): number {
  const matchingTaxEvents = taxEvents.filter((taxEvent) => {
    return (
      taxEvent.accountId === accountId &&
      taxEvent.symbolId === symbolId &&
      (taxYear === undefined || taxEvent.taxYear >= taxYear)
    );
  });
  const totalAvailableVap = calculateTotalVap(matchingTaxEvents);
  const usedVap = calculateVapForQuantity({
    accountId,
    quantity: soldQuantity,
    symbolId,
    taxEvents,
    taxYear
  });

  return roundMoney(Math.min(usedVap, totalAvailableVap));
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

export function calculateTotalTaxImpact({
  taxForSelling,
  usedVapForSelling
}: {
  taxForSelling: number;
  usedVapForSelling: number;
}): number {
  return roundMoney(taxForSelling + usedVapForSelling);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
