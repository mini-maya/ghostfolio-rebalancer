import { addMonths } from 'date-fns';

import type { AllocationItem } from '../services/allocations';
import type { Activity, Holding } from '../services/ghostfolio-api';
import type { TaxProfile } from '../services/tax-calculator';
import type { TaxEvent } from '../services/tax-events';
import { calculateFutureWithdrawalTaxEstimates, type FutureWithdrawalPoint } from './retire-tax-simulation';

export interface FutureWithdrawalPeriodEstimate {
  gain: number;
  netWithdrawal: number;
  tax: number;
  /** Same period tax, ignoring the annual Sparer-Pauschbetrag entirely. Always >= tax. */
  taxBeforeAllowance: number;
  withdrawal: number;
}

export interface FutureLot {
  acquisitionDate?: Date;
  quantity: number;
  unitCost: number;
}

export function createFutureLotsFromCapital(capital: number): FutureLot[] {
  if (capital <= 0) {
    return [];
  }

  return [{ quantity: 1, unitCost: capital }];
}

export function portfolioValueFromLots(lots: FutureLot[], currentPrice: number): number {
  return lots.reduce((sum, lot) => sum + lot.quantity * currentPrice, 0);
}

export function applyLotGrowth(currentPrice: number, growthRate: number): number {
  return currentPrice * (1 + growthRate);
}

export function addContributionToLots(
  lots: FutureLot[],
  amount: number,
  currentPrice: number
): FutureLot[] {
  if (amount <= 0) {
    return lots.map((lot) => ({ ...lot }));
  }

  const purchasePrice = Math.max(currentPrice, 0.000001);

  return [...lots, { quantity: amount / purchasePrice, unitCost: purchasePrice }];
}

export function sellLotsForAmount(lots: FutureLot[], saleAmount: number, currentPrice: number): {
  gain: number;
  lots: FutureLot[];
  proceeds: number;
  soldQuantities: number[];
} {
  const soldQuantities = new Array<number>(lots.length).fill(0);

  if (saleAmount <= 0 || lots.length === 0) {
    return {
      gain: 0,
      lots: lots.map((lot) => ({ ...lot })),
      proceeds: 0,
      soldQuantities
    };
  }

  const workingLots = lots.map((lot) => ({ ...lot }));
  let remainingAmount = saleAmount;
  let totalProceeds = 0;
  let totalCostBasis = 0;
  const normalizedPrice = Math.max(currentPrice, 0.000001);
  let lotIndex = 0;

  while (remainingAmount > 0 && lotIndex < workingLots.length) {
    const currentLot = workingLots[lotIndex];

    if (currentLot.quantity <= 0) {
      lotIndex += 1;
      continue;
    }

    const quantityToSell = Math.min(currentLot.quantity, remainingAmount / normalizedPrice);

    if (quantityToSell <= 0 || !Number.isFinite(quantityToSell)) {
      break;
    }

    const proceeds = quantityToSell * normalizedPrice;
    const costBasis = quantityToSell * currentLot.unitCost;

    totalProceeds += proceeds;
    totalCostBasis += costBasis;
    currentLot.quantity -= quantityToSell;
    soldQuantities[lotIndex] += quantityToSell;
    remainingAmount -= proceeds;

    if (currentLot.quantity <= 0.000001) {
      lotIndex += 1;
    }
  }

  return {
    gain: Math.max(totalProceeds - totalCostBasis, 0),
    lots: workingLots.filter((lot) => lot.quantity > 0.000001),
    proceeds: totalProceeds,
    soldQuantities
  };
}

export function solveWithdrawalAmountForLots({
  annualInflationRate,
  currentPeriodIndex,
  currentPrice,
  currentWithdrawal,
  initialLots,
  periodicReturnRate,
  periodsPerYear,
  remainingPeriods,
  targetCapital
}: {
  annualInflationRate: number;
  currentPeriodIndex: number;
  currentPrice: number;
  currentWithdrawal: number;
  initialLots: FutureLot[];
  periodicReturnRate: number;
  periodsPerYear: number;
  remainingPeriods: number;
  targetCapital: number;
}): number {
  if (targetCapital < 0 || remainingPeriods <= 0) {
    return 0;
  }

  const baseValue = portfolioValueFromLots(initialLots, currentPrice);

  if (
    simulateRemainingBalance({
      annualInflationRate,
      currentPeriodIndex,
      currentPrice,
      initialLots,
      periodicReturnRate,
      periodsPerYear,
      remainingPeriods,
      withdrawal: 0
    }) <= targetCapital
  ) {
    return 0;
  }

  let low = 0;
  let high = Math.max(currentWithdrawal, baseValue);

  while (
    simulateRemainingBalance({
      annualInflationRate,
      currentPeriodIndex,
      currentPrice,
      initialLots,
      periodicReturnRate,
      periodsPerYear,
      remainingPeriods,
      withdrawal: high
    }) > targetCapital &&
    high < baseValue * 10
  ) {
    low = high;
    high *= 2;
  }

  for (let iteration = 0; iteration < 32; iteration += 1) {
    const midpoint = (low + high) / 2;
    const endingBalance = simulateRemainingBalance({
      annualInflationRate,
      currentPeriodIndex,
      currentPrice,
      initialLots,
      periodicReturnRate,
      periodsPerYear,
      remainingPeriods,
      withdrawal: midpoint
    });

    if (endingBalance > targetCapital) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return high;
}

export function projectHoldingsUntilWithdrawalStart({
  accumulationAnnualReturnPercentage,
  accumulationMonths,
  allocations,
  holdings,
  monthlySavingsRate
}: {
  accumulationAnnualReturnPercentage: number;
  accumulationMonths: number;
  allocations: { percentage: number; symbol: string }[];
  holdings: Holding[];
  monthlySavingsRate: number;
}): Holding[] {
  if (accumulationMonths <= 0 || !holdings.length) {
    return holdings.map((holding) => ({ ...holding }));
  }

  const projectedHoldings: Holding[] = holdings.map((holding) => ({ ...holding }));
  const targetAllocationBySymbol = new Map(
    allocations.map(({ percentage, symbol }) => [symbol, percentage] as const)
  );
  const monthlyReturnRate =
    Math.pow(1 + Math.max(accumulationAnnualReturnPercentage, 0) / 100, 1 / 12) - 1;

  for (let monthIndex = 0; monthIndex < accumulationMonths; monthIndex += 1) {
    const targetWeightTotal = allocations.reduce((sum, { percentage }) => sum + percentage, 0);

    for (const holding of projectedHoldings) {
      const currentPrice = Math.max(holding.marketPrice, 0);
      const growthFactor = 1 + monthlyReturnRate;
      const currentTargetWeight =
        targetAllocationBySymbol.get(holding.symbol) ??
        (targetWeightTotal > 0
          ? (holding.valueInBaseCurrency /
              Math.max(holdings.reduce((sum, row) => sum + row.valueInBaseCurrency, 0), 1)) *
            targetWeightTotal
          : 0);
      const monthlyContribution =
        Math.max(monthlySavingsRate, 0) * (Math.max(currentTargetWeight, 0) / 100);

      holding.marketPrice = roundToTwo(currentPrice * growthFactor);

      if (holding.marketPrice > 0 && monthlyContribution > 0) {
        holding.quantity = roundToSix(holding.quantity + monthlyContribution / holding.marketPrice);
      }

      holding.valueInBaseCurrency = roundToTwo(holding.quantity * holding.marketPrice);
    }
  }

  return projectedHoldings;
}

export function calculateFutureFifoWithdrawalPlan({
  accumulationAnnualReturnPercentage,
  accumulationMonths,
  activities,
  allocations,
  currentDate,
  holdings,
  monthlySavingsRate,
  taxEvents = [],
  taxProfile,
  withdrawalAnnualReturnPercentage = 0,
  withdrawalPoints,
  withdrawalStartDate,
  capitalPreservationTarget
}: {
  accumulationAnnualReturnPercentage: number;
  accumulationMonths: number;
  activities: Activity[];
  allocations: AllocationItem[];
  capitalPreservationTarget?: number;
  currentDate: Date;
  holdings: Holding[];
  monthlySavingsRate: number;
  taxEvents?: TaxEvent[];
  taxProfile: TaxProfile;
  withdrawalAnnualReturnPercentage?: number;
  withdrawalPoints: FutureWithdrawalPoint[];
  withdrawalStartDate?: Date;
}): Map<number, FutureWithdrawalPeriodEstimate> {
  return calculateFutureWithdrawalTaxEstimates({
    accumulationAnnualReturnPercentage,
    activities,
    allocations,
    capitalPreservationTarget,
    currentDate,
    holdings,
    monthlySavingsRate,
    taxEvents,
    taxProfile,
    withdrawalAnnualReturnPercentage,
    withdrawalPoints,
    withdrawalStartDate: withdrawalStartDate ?? addMonths(currentDate, Math.max(accumulationMonths, 0))
  });
}

export function getProjectedPrice({
  basePrice,
  monthlyReturnRate,
  monthsOffset
}: {
  basePrice: number;
  monthlyReturnRate: number;
  monthsOffset: number;
}): number {
  return Math.max(basePrice, 0.01) * Math.pow(1 + monthlyReturnRate, Math.max(monthsOffset, 0));
}

function simulateRemainingBalance({
  annualInflationRate,
  currentPeriodIndex,
  currentPrice,
  initialLots,
  periodicReturnRate,
  periodsPerYear,
  remainingPeriods,
  withdrawal
}: {
  annualInflationRate: number;
  currentPeriodIndex: number;
  currentPrice: number;
  initialLots: FutureLot[];
  periodicReturnRate: number;
  periodsPerYear: number;
  remainingPeriods: number;
  withdrawal: number;
}): number {
  let lots = initialLots.map((lot) => ({ ...lot }));
  let price = currentPrice;
  const inflationRatePerPeriod = annualInflationRate / periodsPerYear;

  for (let offset = 0; offset < remainingPeriods; offset += 1) {
    price = applyLotGrowth(price, periodicReturnRate);
    const withdrawalAmount = withdrawal * Math.pow(1 + inflationRatePerPeriod, offset);
    const result = sellLotsForAmount(lots, withdrawalAmount, price);
    lots = result.lots;
  }

  return portfolioValueFromLots(lots, price);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
