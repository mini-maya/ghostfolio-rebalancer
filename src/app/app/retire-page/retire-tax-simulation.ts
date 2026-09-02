import { addMonths, differenceInCalendarMonths, endOfMonth, startOfMonth } from 'date-fns';

import type { AllocationItem } from '../services/allocations';
import type { Activity, Holding } from '../services/ghostfolio-api';
import {
  estimateVapForLotWithoutTaxEvent,
  type TaxProfile
} from '../services/tax-calculator';
import type { TaxEvent } from '../services/tax-events';
import { calculateAnnualTaxSummaries, calculateTaxOverview } from '../services/tax-engine';
import { calculateNextWithdrawalSellPlan } from './retire-withdrawal-plan';

const EPSILON = 0.000001;
const SIMULATED_ACCOUNT_ID = 'simulated';
const SIMULATED_ACCOUNT_NAME = 'Simulated Portfolio';

interface SymbolMetadata {
  accountId: string;
  accountName: string;
  assetClass: string;
  assetSubClass: string;
  basePrice: number;
  currency: string;
  name: string;
  symbol: string;
}

interface SymbolState {
  metadata: SymbolMetadata;
  quantity: number;
}

interface RetireTaxTimeline {
  holdingsByMonth: Map<string, Holding[]>;
  syntheticActivities: Activity[];
  syntheticTaxEvents: TaxEvent[];
}

export interface FutureWithdrawalPoint {
  date: Date;
  periodIndex: number;
  withdrawal: number;
}

export interface RetireTaxOverviewInput {
  accumulationAnnualReturnPercentage: number;
  activities: Activity[];
  allocations: AllocationItem[];
  asOfDate: Date;
  capitalPreservationTarget?: number;
  currentDate: Date;
  holdings: Holding[];
  includeCurrentMonthWithdrawals?: boolean;
  monthlySavingsRate: number;
  sellWholeSharesOnly?: boolean;
  taxEvents: TaxEvent[];
  taxProfile: TaxProfile;
  withdrawalAnnualReturnPercentage: number;
  withdrawalPoints?: FutureWithdrawalPoint[];
  withdrawalStartDate: Date;
}

export interface RetireTaxOverviewScenario {
  combinedActivities: Activity[];
  combinedTaxEvents: TaxEvent[];
  holdings: Holding[];
  syntheticActivities: Activity[];
  syntheticTaxEvents: TaxEvent[];
}

export function buildRetireTaxOverviewInput({
  accumulationAnnualReturnPercentage,
  activities,
  allocations,
  asOfDate,
  capitalPreservationTarget,
  currentDate,
  holdings,
  includeCurrentMonthWithdrawals = false,
  monthlySavingsRate,
  sellWholeSharesOnly = false,
  taxEvents,
  taxProfile,
  withdrawalAnnualReturnPercentage,
  withdrawalPoints = [],
  withdrawalStartDate
}: RetireTaxOverviewInput): RetireTaxOverviewScenario {
  const normalizedCurrentMonth = startOfMonth(currentDate);
  const normalizedAsOfMonth = startOfMonth(asOfDate);
  const realActivityCutoffDate = endOfMonth(
    normalizedAsOfMonth <= normalizedCurrentMonth ? normalizedAsOfMonth : normalizedCurrentMonth
  );
  const realActivities = filterActivitiesThroughDate(activities, realActivityCutoffDate);
  // A tax-year's Vorabpauschale only becomes tax-relevant on 01.01 of the following year, but the
  // real TaxEvent for that year is sometimes entered into Ghostfolio with a delay (not just in
  // January - it can still be missing months or years later). Fill any already-completed past
  // year (relative to "now", not to asOfDate) that is still missing a real TaxEvent, using the
  // same estimation formula as the future simulation. Real TaxEvents always take precedence.
  const historicalSyntheticTaxEvents = buildMissingHistoricalTaxEvents({
    activities,
    currentDate,
    holdings,
    taxEvents,
    taxProfile,
    upperBoundYear: Math.min(normalizedCurrentMonth.getFullYear(), asOfDate.getFullYear())
  });

  if (
    normalizedAsOfMonth < normalizedCurrentMonth ||
    (normalizedAsOfMonth.getTime() === normalizedCurrentMonth.getTime() &&
      !includeCurrentMonthWithdrawals)
  ) {
    return {
      combinedActivities: realActivities,
      combinedTaxEvents: [...taxEvents, ...historicalSyntheticTaxEvents],
      holdings: reconstructHistoricalHoldings({
        activities: realActivities,
        asOfDate,
        currentHoldings: holdings
      }),
      syntheticActivities: [],
      syntheticTaxEvents: historicalSyntheticTaxEvents
    };
  }

  const timeline = simulateFutureTimeline({
    accumulationAnnualReturnPercentage,
    activities,
    allocations,
    asOfDate,
    capitalPreservationTarget,
    currentDate,
    holdings,
    includeCurrentMonthWithdrawals,
    monthlySavingsRate,
    sellWholeSharesOnly,
    taxEvents,
    taxProfile,
    withdrawalAnnualReturnPercentage,
    withdrawalPoints,
    withdrawalStartDate
  });
  const holdingsAtAsOfDate =
    timeline.holdingsByMonth.get(monthKey(normalizedAsOfMonth)) ?? cloneHoldings(holdings);
  const allSyntheticTaxEvents = [...historicalSyntheticTaxEvents, ...timeline.syntheticTaxEvents];

  return {
    combinedActivities: [...realActivities, ...timeline.syntheticActivities],
    combinedTaxEvents: [...taxEvents, ...allSyntheticTaxEvents],
    holdings: holdingsAtAsOfDate,
    syntheticActivities: timeline.syntheticActivities,
    syntheticTaxEvents: allSyntheticTaxEvents
  };
}

export function buildTaxDataBySymbolFromOverviewInput(
  input: RetireTaxOverviewScenario,
  taxProfile: TaxProfile,
  asOfDate: Date
): Map<string, { costBasis: number; grossVap: number; taxableVap: number }> {
  const rows = calculateTaxOverview({
    activities: input.combinedActivities,
    asOfDate,
    holdings: input.holdings,
    taxEvents: input.combinedTaxEvents,
    taxProfile
  });

  return new Map(
    rows.map((row) => [
      row.symbol,
      {
        // Cost basis of the currently open (not-yet-sold) quantity for this symbol, needed to
        // compute the actual taxable gain of a future partial sale (see
        // calculateNextWithdrawalSellPlan) instead of approximating it from market value alone.
        costBasis: row.entryPriceAmount,
        grossVap: row.totalVap,
        taxableVap: row.totalTaxableVap
      }
    ])
  );
}

export function calculateFutureWithdrawalTaxEstimates({
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
  withdrawalPoints = [],
  withdrawalStartDate
}: Omit<RetireTaxOverviewInput, 'asOfDate'>): Map<
  number,
  { gain: number; netWithdrawal: number; tax: number; withdrawal: number }
> {
  if (!withdrawalPoints.length) {
    return new Map();
  }

  const sortedPoints = [...withdrawalPoints].sort((left, right) => {
    return left.date.getTime() - right.date.getTime();
  });
  const lastPoint = sortedPoints.at(-1);

  if (!lastPoint) {
    return new Map();
  }

  const scenario = buildRetireTaxOverviewInput({
    accumulationAnnualReturnPercentage,
    activities,
    allocations,
    asOfDate: endOfMonth(lastPoint.date),
    capitalPreservationTarget,
    currentDate,
    holdings,
    includeCurrentMonthWithdrawals: true,
    monthlySavingsRate,
    taxEvents,
    taxProfile,
    withdrawalAnnualReturnPercentage,
    withdrawalPoints: sortedPoints,
    withdrawalStartDate
  });
  const realActivityCutoffDate = endOfMonth(
    startOfMonth(lastPoint.date) <= startOfMonth(currentDate)
      ? startOfMonth(lastPoint.date)
      : startOfMonth(currentDate)
  );
  const realActivities = filterActivitiesThroughDate(activities, realActivityCutoffDate);
  const cumulativeSyntheticActivities: Activity[] = [];
  const sortedSyntheticActivities = [...scenario.syntheticActivities].sort(byActivityDate);
  let syntheticIndex = 0;
  let previousRealizedAmount = 0;
  let previousCumulativeTax = 0;
  const estimates = new Map<number, { gain: number; netWithdrawal: number; tax: number; withdrawal: number }>();

  for (const point of sortedPoints) {
    const pointCutoffDate = endOfMonth(point.date);

    while (
      syntheticIndex < sortedSyntheticActivities.length &&
      activityTimestamp(sortedSyntheticActivities[syntheticIndex]) <= pointCutoffDate.getTime()
    ) {
      cumulativeSyntheticActivities.push(sortedSyntheticActivities[syntheticIndex]);
      syntheticIndex += 1;
    }

    const pointScenario = buildRetireTaxOverviewInput({
      accumulationAnnualReturnPercentage,
      activities,
      allocations,
      asOfDate: pointCutoffDate,
      capitalPreservationTarget,
      currentDate,
      holdings,
      includeCurrentMonthWithdrawals: true,
      monthlySavingsRate,
      taxEvents,
      taxProfile,
      withdrawalAnnualReturnPercentage,
      withdrawalPoints: sortedPoints.filter(({ date }) => startOfMonth(date) <= startOfMonth(point.date)),
      withdrawalStartDate
    });
    const rows = calculateTaxOverview({
      activities: [...realActivities, ...cumulativeSyntheticActivities],
      asOfDate: pointCutoffDate,
      holdings: pointScenario.holdings,
      taxEvents: scenario.combinedTaxEvents,
      taxProfile
    });
    const realizedAmount = rows.reduce((sum, row) => sum + row.realizedAmount, 0);
    // The annual Sparer-Pauschbetrag is reset every calendar year and applies to taxable VAP and
    // taxable sale gains combined, so the tax owed up to this point cannot be derived by simply
    // summing each row's lifetime taxForSelling (which ignores the allowance entirely). Instead,
    // sum the allowance-aware totalTax across all calendar years up to this point.
    const annualSummaries = calculateAnnualTaxSummaries({
      activities: [...realActivities, ...cumulativeSyntheticActivities],
      asOfDate: pointCutoffDate,
      holdings: pointScenario.holdings,
      taxEvents: scenario.combinedTaxEvents,
      taxProfile
    });
    const cumulativeTax = annualSummaries.reduce((sum, summary) => sum + summary.totalTax, 0);
    const periodGain = roundToTwo(realizedAmount - previousRealizedAmount);
    const periodTax = roundToTwo(cumulativeTax - previousCumulativeTax);

    estimates.set(point.periodIndex, {
      gain: periodGain,
      netWithdrawal: roundToTwo(Math.max(point.withdrawal - periodTax, 0)),
      tax: periodTax,
      withdrawal: roundToTwo(point.withdrawal)
    });

    previousRealizedAmount = realizedAmount;
    previousCumulativeTax = cumulativeTax;
  }

  return estimates;
}

export function reconstructHistoricalHoldings({
  activities,
  asOfDate,
  currentHoldings
}: {
  activities: Activity[];
  asOfDate: Date;
  currentHoldings: Holding[];
}): Holding[] {
  const metadataBySymbol = buildSymbolMetadataBySymbol({
    activities,
    allocations: [],
    holdings: currentHoldings
  });
  const basePriceBySymbol = new Map(
    [...metadataBySymbol.entries()].map(([symbol, metadata]) => [symbol, metadata.basePrice] as const)
  );
  const priceBySymbol = getHistoricalPriceBySymbolAtDate({
    activities,
    fallbackPriceBySymbol: basePriceBySymbol,
    referenceDate: asOfDate
  });
  const quantityBySymbol = new Map<string, number>();

  for (const activity of activities) {
    const symbol = normalizeSymbol(activity.symbol);
    const quantity = Math.max(activity.quantity, 0);
    const currentQuantity = quantityBySymbol.get(symbol) ?? 0;
    const type = normalizeType(activity.type);

    if (type === 'BUY') {
      quantityBySymbol.set(symbol, currentQuantity + quantity);
    } else if (type === 'SELL') {
      quantityBySymbol.set(symbol, Math.max(currentQuantity - quantity, 0));
    }
  }

  const holdings = [...quantityBySymbol.entries()]
    .filter(([, quantity]) => quantity > EPSILON)
    .map(([symbol, quantity]) => {
      const metadata = metadataBySymbol.get(symbol) ?? createFallbackMetadata(symbol);
      const marketPrice = Math.max(priceBySymbol.get(symbol) ?? metadata.basePrice, 0.01);

      return {
        allocationInPercentage: 0,
        currency: metadata.currency,
        marketPrice: roundToTwo(marketPrice),
        name: metadata.name,
        quantity: roundToSix(quantity),
        symbol: metadata.symbol,
        valueInBaseCurrency: roundToTwo(quantity * marketPrice)
      };
    });

  if (!holdings.length) {
    return cloneHoldings(currentHoldings);
  }

  return applyAllocationPercentages(holdings);
}

function simulateFutureTimeline({
  accumulationAnnualReturnPercentage,
  activities,
  allocations,
  asOfDate,
  capitalPreservationTarget,
  currentDate,
  holdings,
  includeCurrentMonthWithdrawals = false,
  monthlySavingsRate,
  sellWholeSharesOnly = false,
  taxEvents,
  taxProfile,
  withdrawalAnnualReturnPercentage,
  withdrawalPoints = [],
  withdrawalStartDate
}: RetireTaxOverviewInput): RetireTaxTimeline {
  const normalizedCurrentMonth = startOfMonth(currentDate);
  const normalizedAsOfMonth = startOfMonth(asOfDate);
  const normalizedWithdrawalStartMonth = startOfMonth(withdrawalStartDate);
  const metadataBySymbol = buildSymbolMetadataBySymbol({ activities, allocations, holdings });
  const basePriceBySymbol = new Map(
    [...metadataBySymbol.entries()].map(([symbol, metadata]) => [symbol, metadata.basePrice] as const)
  );
  const historicalPriceCache = new Map<number, Map<string, number>>();
  const accumulationMonthlyReturnRate =
    Math.pow(1 + Math.max(accumulationAnnualReturnPercentage, 0) / 100, 1 / 12) - 1;
  const withdrawalMonthlyReturnRate =
    Math.pow(1 + Math.max(withdrawalAnnualReturnPercentage, 0) / 100, 1 / 12) - 1;
  const statesBySymbol = buildSymbolStates({ holdings, metadataBySymbol });
  const syntheticActivities: Activity[] = [];
  const holdingsByMonth = new Map<string, Holding[]>();
  const withdrawalPointsByMonth = new Map<string, FutureWithdrawalPoint[]>();
  const minimumRemainingValueBySymbol =
    capitalPreservationTarget !== undefined
      ? new Map(
          allocations.map(({ percentage, symbol }) => {
            return [symbol, (Math.max(percentage, 0) / 100) * Math.max(capitalPreservationTarget, 0)] as const;
          })
        )
      : undefined;

  for (const point of withdrawalPoints) {
    const key = monthKey(point.date);
    const rows = withdrawalPointsByMonth.get(key) ?? [];
    rows.push(point);
    rows.sort((left, right) => left.periodIndex - right.periodIndex);
    withdrawalPointsByMonth.set(key, rows);
  }

  const resolvePriceAtMonth = (symbol: string, month: Date) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const normalizedMonth = startOfMonth(month);

    if (normalizedMonth < normalizedCurrentMonth) {
      const cacheKey = normalizedMonth.getTime();
      let prices = historicalPriceCache.get(cacheKey);

      if (!prices) {
        prices = getHistoricalPriceBySymbolAtDate({
          activities,
          fallbackPriceBySymbol: basePriceBySymbol,
          referenceDate: normalizedMonth
        });
        historicalPriceCache.set(cacheKey, prices);
      }

      return Math.max(prices.get(normalizedSymbol) ?? basePriceBySymbol.get(normalizedSymbol) ?? 0.01, 0.01);
    }

    const monthOffset = Math.max(
      differenceInCalendarMonths(normalizedMonth, normalizedCurrentMonth),
      0
    );
    const accumulationMonths = Math.min(
      monthOffset,
      Math.max(differenceInCalendarMonths(normalizedWithdrawalStartMonth, normalizedCurrentMonth), 0)
    );
    const withdrawalMonths = Math.max(monthOffset - accumulationMonths, 0);

    return Math.max(basePriceBySymbol.get(normalizedSymbol) ?? 0.01, 0.01) *
      Math.pow(1 + accumulationMonthlyReturnRate, accumulationMonths) *
      Math.pow(1 + withdrawalMonthlyReturnRate, withdrawalMonths);
  };

  for (
    let monthOffset = includeCurrentMonthWithdrawals ? 0 : 1;
    monthOffset <= differenceInCalendarMonths(normalizedAsOfMonth, normalizedCurrentMonth);
    monthOffset += 1
  ) {
    const simulationMonth = addMonths(normalizedCurrentMonth, monthOffset);

    if (monthOffset > 0 && simulationMonth < normalizedWithdrawalStartMonth) {
      for (const allocation of allocations) {
        const contributionAmount = Math.max(monthlySavingsRate, 0) * (Math.max(allocation.percentage, 0) / 100);
        const price = resolvePriceAtMonth(allocation.symbol, simulationMonth);

        if (contributionAmount <= 0 || price <= 0) {
          continue;
        }

        const metadata = metadataBySymbol.get(normalizeSymbol(allocation.symbol)) ??
          createFallbackMetadata(allocation.symbol);
        const quantity = contributionAmount / price;
        const state = statesBySymbol.get(normalizeSymbol(allocation.symbol)) ?? {
          metadata,
          quantity: 0
        };

        state.quantity += quantity;
        statesBySymbol.set(normalizeSymbol(allocation.symbol), state);
        syntheticActivities.push(
          createSyntheticActivity({
            date: simulationMonth,
            metadata,
            quantity,
            type: 'BUY',
            unitPrice: price
          })
        );
      }
    }

    const pointsInMonth = withdrawalPointsByMonth.get(monthKey(simulationMonth)) ?? [];

    for (const point of pointsInMonth) {
      const sellPlan = calculateNextWithdrawalSellPlan({
        allocations,
        holdings: buildHoldingsSnapshot({ resolvePriceAtMonth, simulationMonth, statesBySymbol }),
        minimumRemainingValueBySymbol,
        sellWholeSharesOnly,
        taxProfile,
        withdrawalAmount: Math.max(point.withdrawal, 0)
      });

      for (const row of sellPlan.rows) {
        if (row.sharesToSell <= EPSILON || row.marketPrice <= 0) {
          continue;
        }

        const metadata = metadataBySymbol.get(normalizeSymbol(row.symbol)) ?? createFallbackMetadata(row.symbol);
        const state = statesBySymbol.get(normalizeSymbol(row.symbol)) ?? {
          metadata,
          quantity: 0
        };
        const soldQuantity = Math.min(Math.max(row.sharesToSell, 0), Math.max(state.quantity, 0));

        if (soldQuantity <= EPSILON) {
          continue;
        }

        state.quantity = Math.max(state.quantity - soldQuantity, 0);
        statesBySymbol.set(normalizeSymbol(row.symbol), state);
        syntheticActivities.push(
          createSyntheticActivity({
            date: simulationMonth,
            metadata,
            quantity: soldQuantity,
            type: 'SELL',
            unitPrice: Math.max(row.marketPrice, 0)
          })
        );
      }
    }

    holdingsByMonth.set(
      monthKey(simulationMonth),
      buildHoldingsSnapshot({ resolvePriceAtMonth, simulationMonth, statesBySymbol })
    );
  }

  return {
    holdingsByMonth,
    syntheticActivities,
    syntheticTaxEvents: buildSyntheticTaxEvents({
      activities,
      asOfDate,
      basePriceBySymbol,
      currentDate,
      holdingsByMonth,
      metadataBySymbol,
      resolvePriceAtMonth,
      taxEvents,
      taxProfile
    })
  };
}

function buildSymbolMetadataBySymbol({
  activities,
  allocations,
  holdings
}: {
  activities: Activity[];
  allocations: AllocationItem[];
  holdings: Holding[];
}): Map<string, SymbolMetadata> {
  const holdingsBySymbol = new Map(
    holdings
      .filter((holding) => typeof holding.symbol === 'string' && holding.symbol.trim())
      .map((holding) => [normalizeSymbol(holding.symbol), holding] as const)
  );
  const latestActivityBySymbol = new Map<string, Activity>();

  for (const activity of activities) {
    if (!activity.symbol.trim()) {
      continue;
    }

    const symbol = normalizeSymbol(activity.symbol);
    const current = latestActivityBySymbol.get(symbol);

    if (!current || activityTimestamp(activity) >= activityTimestamp(current)) {
      latestActivityBySymbol.set(symbol, activity);
    }
  }

  const symbols = new Set<string>([
    ...holdingsBySymbol.keys(),
    ...latestActivityBySymbol.keys(),
    ...allocations.map(({ symbol }) => normalizeSymbol(symbol))
  ]);
  const metadataBySymbol = new Map<string, SymbolMetadata>();

  for (const symbol of symbols) {
    const holding = holdingsBySymbol.get(symbol);
    const activity = latestActivityBySymbol.get(symbol);

    metadataBySymbol.set(symbol, {
      accountId: activity?.accountId || SIMULATED_ACCOUNT_ID,
      accountName: activity?.accountName || SIMULATED_ACCOUNT_NAME,
      assetClass: activity?.assetClass || 'ETF',
      assetSubClass: activity?.assetSubClass || 'SIMULATED',
      basePrice: Math.max(holding?.marketPrice ?? activity?.unitPrice ?? 0.01, 0.01),
      currency: holding?.currency || activity?.currency || 'EUR',
      name: holding?.name || activity?.name || symbol,
      symbol: holding?.symbol || activity?.symbol || symbol
    });
  }

  return metadataBySymbol;
}

function buildSymbolStates({
  holdings,
  metadataBySymbol
}: {
  holdings: Holding[];
  metadataBySymbol: Map<string, SymbolMetadata>;
}): Map<string, SymbolState> {
  const holdingsBySymbol = new Map(
    holdings
      .filter((holding) => typeof holding.symbol === 'string' && holding.symbol.trim())
      .map((holding) => [normalizeSymbol(holding.symbol), holding] as const)
  );
  const statesBySymbol = new Map<string, SymbolState>();

  for (const [symbol, metadata] of metadataBySymbol) {
    statesBySymbol.set(symbol, {
      metadata,
      quantity: Math.max(holdingsBySymbol.get(symbol)?.quantity ?? 0, 0)
    });
  }

  return statesBySymbol;
}

function buildHoldingsSnapshot({
  resolvePriceAtMonth,
  simulationMonth,
  statesBySymbol
}: {
  resolvePriceAtMonth: (symbol: string, month: Date) => number;
  simulationMonth: Date;
  statesBySymbol: Map<string, SymbolState>;
}): Holding[] {
  const holdings = [...statesBySymbol.values()]
    .filter(({ quantity }) => quantity > EPSILON)
    .map(({ metadata, quantity }) => {
      const marketPrice = Math.max(resolvePriceAtMonth(metadata.symbol, simulationMonth), 0.01);

      return {
        allocationInPercentage: 0,
        currency: metadata.currency,
        marketPrice: roundToTwo(marketPrice),
        name: metadata.name,
        quantity: roundToSix(quantity),
        symbol: metadata.symbol,
        valueInBaseCurrency: roundToTwo(quantity * marketPrice)
      };
    });

  return applyAllocationPercentages(holdings);
}

function buildSyntheticTaxEvents({
  activities,
  asOfDate,
  basePriceBySymbol,
  currentDate,
  holdingsByMonth,
  metadataBySymbol,
  resolvePriceAtMonth,
  taxEvents,
  taxProfile
}: {
  activities: Activity[];
  asOfDate: Date;
  basePriceBySymbol: Map<string, number>;
  currentDate: Date;
  holdingsByMonth: Map<string, Holding[]>;
  metadataBySymbol: Map<string, SymbolMetadata>;
  resolvePriceAtMonth: (symbol: string, month: Date) => number;
  taxEvents: TaxEvent[];
  taxProfile: TaxProfile;
}): TaxEvent[] {
  const syntheticTaxEvents: TaxEvent[] = [];
  const normalizedCurrentMonth = startOfMonth(currentDate);
  const asOfYear = asOfDate.getFullYear();
  const realTaxEventKeys = new Set(taxEvents.map(buildTaxEventKey));
  const historicalPriceCache = new Map<number, Map<string, number>>();

  for (let taxYear = normalizedCurrentMonth.getFullYear(); taxYear < asOfYear; taxYear += 1) {
    const yearEndMonth = startOfMonth(new Date(taxYear, 11, 1));
    const yearEndHoldings = holdingsByMonth.get(monthKey(yearEndMonth));

    if (!yearEndHoldings?.length) {
      continue;
    }

    for (const holding of yearEndHoldings) {
      const symbol = normalizeSymbol(holding.symbol);
      const metadata = metadataBySymbol.get(symbol) ?? createFallbackMetadata(symbol);
      const taxEventKey = buildTaxEventKey({
        accountId: metadata.accountId,
        symbolId: symbol,
        taxYear
      });

      if (realTaxEventKeys.has(taxEventKey) || holding.quantity <= EPSILON) {
        continue;
      }

      const startOfYearMonth = startOfMonth(new Date(taxYear, 0, 1));
      const startOfYearPrice =
        startOfYearMonth < normalizedCurrentMonth
          ? getHistoricalPriceBySymbolAtDate({
              activities,
              fallbackPriceBySymbol: basePriceBySymbol,
              referenceDate: startOfYearMonth,
              cache: historicalPriceCache
            }).get(symbol) ?? metadata.basePrice
          : resolvePriceAtMonth(symbol, startOfYearMonth);
      const endOfYearPrice = resolvePriceAtMonth(symbol, yearEndMonth);
      const quantity = roundToSix(holding.quantity);
      const estimate = estimateVapForLotWithoutTaxEvent({
        acquisitionDate: new Date(taxYear, 0, 1),
        endOfYearPrice,
        quantity,
        startOfYearPrice,
        taxProfile
      });
      const grossPerShare = quantity > 0 ? estimate.grossVap / quantity : 0;
      const taxablePerShare = quantity > 0 ? estimate.taxableVap / quantity : 0;

      syntheticTaxEvents.push({
        accountId: metadata.accountId,
        id: `synthetic-${metadata.accountId}-${symbol}-${taxYear}`,
        quantity,
        symbolId: symbol,
        taxYear,
        vorabpauschalePerShare: roundToSix(grossPerShare),
        vorabpauschalePerShareAfterTeilfreistellung: roundToSix(taxablePerShare)
      });
      realTaxEventKeys.add(taxEventKey);
    }
  }

  return syntheticTaxEvents;
}

/**
 * Fills in a synthetic TaxEvent (VAP) for any already-completed past year (strictly before
 * `upperBoundYear`, which the caller sets to the earlier of "now"'s year and the asOf-year) that
 * a symbol was held in but for which no real TaxEvent exists yet. Unlike `buildSyntheticTaxEvents`
 * (which covers future/current years using the simulated timeline), this uses only real
 * activities and real historical prices, since these years are genuinely in the past. Real
 * TaxEvents always take precedence and are never overwritten.
 */
function buildMissingHistoricalTaxEvents({
  activities,
  currentDate,
  holdings,
  taxEvents,
  taxProfile,
  upperBoundYear
}: {
  activities: Activity[];
  currentDate: Date;
  holdings: Holding[];
  taxEvents: TaxEvent[];
  taxProfile: TaxProfile;
  upperBoundYear: number;
}): TaxEvent[] {
  const activityYears = activities
    .filter((activity): activity is Activity & { date: Date | string } => activity.date !== null)
    .map((activity) => new Date(activity.date).getFullYear());

  if (!activityYears.length) {
    return [];
  }

  const earliestYear = Math.min(...activityYears);

  if (earliestYear >= upperBoundYear) {
    return [];
  }

  const metadataBySymbol = buildSymbolMetadataBySymbol({ activities, allocations: [], holdings });
  const basePriceBySymbol = new Map(
    [...metadataBySymbol.entries()].map(([symbol, metadata]) => [symbol, metadata.basePrice] as const)
  );
  const realTaxEventKeys = new Set(taxEvents.map(buildTaxEventKey));
  const historicalPriceCache = new Map<number, Map<string, number>>();
  const syntheticTaxEvents: TaxEvent[] = [];
  // The last known real price for a symbol is usually its most recent BUY/SELL, which can be
  // long before "now". Anchor the current, real market price (from live holdings) at today's
  // date so past-year price interpolation reflects the price development that actually
  // happened, instead of flat-lining at the oldest known activity price.
  const pricingActivities: Activity[] = [
    ...activities,
    ...holdings
      .filter((holding) => holding.marketPrice > 0)
      .map((holding) => createSyntheticActivity({
        date: currentDate,
        metadata: metadataBySymbol.get(normalizeSymbol(holding.symbol)) ?? createFallbackMetadata(holding.symbol),
        quantity: 0,
        type: 'BUY',
        unitPrice: holding.marketPrice
      }))
  ];

  for (let taxYear = earliestYear; taxYear < upperBoundYear; taxYear += 1) {
    const yearEndHoldings = reconstructHistoricalHoldings({
      activities,
      asOfDate: new Date(taxYear, 11, 31, 23, 59, 59, 999),
      currentHoldings: holdings
    });

    for (const holding of yearEndHoldings) {
      const symbol = normalizeSymbol(holding.symbol);
      const metadata = metadataBySymbol.get(symbol) ?? createFallbackMetadata(symbol);
      const taxEventKey = buildTaxEventKey({
        accountId: metadata.accountId,
        symbolId: symbol,
        taxYear
      });

      if (realTaxEventKeys.has(taxEventKey) || holding.quantity <= EPSILON) {
        continue;
      }

      const startOfYearPrice =
        getHistoricalPriceBySymbolAtDate({
          activities: pricingActivities,
          fallbackPriceBySymbol: basePriceBySymbol,
          referenceDate: new Date(taxYear, 0, 1),
          cache: historicalPriceCache
        }).get(symbol) ?? metadata.basePrice;
      const endOfYearPrice =
        getHistoricalPriceBySymbolAtDate({
          activities: pricingActivities,
          fallbackPriceBySymbol: basePriceBySymbol,
          referenceDate: new Date(taxYear, 11, 31),
          cache: historicalPriceCache
        }).get(symbol) ?? metadata.basePrice;
      const quantity = roundToSix(holding.quantity);
      const estimate = estimateVapForLotWithoutTaxEvent({
        acquisitionDate: new Date(taxYear, 0, 1),
        endOfYearPrice,
        quantity,
        startOfYearPrice,
        taxProfile
      });

      if (estimate.grossVap <= 0) {
        continue;
      }

      const grossPerShare = quantity > 0 ? estimate.grossVap / quantity : 0;
      const taxablePerShare = quantity > 0 ? estimate.taxableVap / quantity : 0;

      syntheticTaxEvents.push({
        accountId: metadata.accountId,
        id: `synthetic-historical-${metadata.accountId}-${symbol}-${taxYear}`,
        quantity,
        symbolId: symbol,
        taxYear,
        vorabpauschalePerShare: roundToSix(grossPerShare),
        vorabpauschalePerShareAfterTeilfreistellung: roundToSix(taxablePerShare)
      });
      realTaxEventKeys.add(taxEventKey);
    }
  }

  return syntheticTaxEvents;
}

function getHistoricalPriceBySymbolAtDate({
  activities,
  fallbackPriceBySymbol,
  referenceDate,
  cache
}: {
  activities: Activity[];
  fallbackPriceBySymbol: Map<string, number>;
  referenceDate: Date;
  cache?: Map<number, Map<string, number>>;
}): Map<string, number> {
  const cacheKey = startOfMonth(referenceDate).getTime();
  const cached = cache?.get(cacheKey);

  if (cached) {
    return cached;
  }

  const activitiesBySymbol = new Map<string, Array<{ date: Date; price: number }>>();

  for (const activity of activities) {
    if (!activity.date || !Number.isFinite(activity.unitPrice) || activity.unitPrice <= 0) {
      continue;
    }

    const symbol = normalizeSymbol(activity.symbol);
    const rows = activitiesBySymbol.get(symbol) ?? [];
    rows.push({ date: new Date(activity.date), price: activity.unitPrice });
    activitiesBySymbol.set(symbol, rows);
  }

  const prices = new Map<string, number>();

  for (const [symbol, symbolActivities] of activitiesBySymbol) {
    const sortedActivities = [...symbolActivities].sort((left, right) => left.date.getTime() - right.date.getTime());
    const before = [...sortedActivities]
      .reverse()
      .find(({ date }) => date.getTime() <= referenceDate.getTime());
    const after = sortedActivities.find(({ date }) => date.getTime() >= referenceDate.getTime());

    if (before && after && before.date.getTime() !== after.date.getTime()) {
      const span = after.date.getTime() - before.date.getTime();
      const weight = span > 0 ? (referenceDate.getTime() - before.date.getTime()) / span : 0;
      prices.set(symbol, before.price + weight * (after.price - before.price));
      continue;
    }

    if (before?.price !== undefined) {
      prices.set(symbol, before.price);
      continue;
    }

    if (after?.price !== undefined) {
      prices.set(symbol, after.price);
    }
  }

  for (const [symbol, fallbackPrice] of fallbackPriceBySymbol) {
    if (!prices.has(symbol) && fallbackPrice > 0) {
      prices.set(symbol, fallbackPrice);
    }
  }

  cache?.set(cacheKey, prices);

  return prices;
}

function createSyntheticActivity({
  date,
  metadata,
  quantity,
  type,
  unitPrice
}: {
  date: Date;
  metadata: SymbolMetadata;
  quantity: number;
  type: 'BUY' | 'SELL';
  unitPrice: number;
}): Activity {
  return {
    accountId: metadata.accountId,
    accountName: metadata.accountName,
    assetClass: metadata.assetClass,
    assetSubClass: metadata.assetSubClass,
    currency: metadata.currency,
    date: startOfMonth(date),
    fee: 0,
    name: metadata.name,
    quantity: roundToSix(quantity),
    symbol: metadata.symbol,
    type,
    unitPrice: roundToSix(unitPrice),
    unitPriceInAssetProfileCurrency: roundToSix(unitPrice),
    valueInBaseCurrency: roundToTwo(quantity * unitPrice)
  };
}

function applyAllocationPercentages(holdings: Holding[]): Holding[] {
  const totalValue = holdings.reduce((sum, holding) => sum + holding.valueInBaseCurrency, 0);

  return holdings.map((holding) => ({
    ...holding,
    allocationInPercentage:
      totalValue > 0 ? roundToTwo((holding.valueInBaseCurrency / totalValue) * 100) : 0
  }));
}

function filterActivitiesThroughDate(activities: Activity[], cutoffDate: Date): Activity[] {
  const cutoffTimestamp = cutoffDate.getTime();

  return activities.filter((activity) => {
    return activity.date !== null && new Date(activity.date).getTime() <= cutoffTimestamp;
  });
}

function cloneHoldings(holdings: Holding[]): Holding[] {
  return holdings.map((holding) => ({ ...holding }));
}

function byActivityDate(left: Activity, right: Activity): number {
  return activityTimestamp(left) - activityTimestamp(right);
}

function activityTimestamp(activity: Activity): number {
  return activity.date ? new Date(activity.date).getTime() : 0;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeType(type: string): string {
  return type.trim().toUpperCase();
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildTaxEventKey({
  accountId,
  symbolId,
  taxYear
}: {
  accountId: string;
  symbolId: string;
  taxYear: number;
}): string {
  return `${accountId}:${normalizeSymbol(symbolId)}:${taxYear}`;
}

function createFallbackMetadata(symbol: string): SymbolMetadata {
  return {
    accountId: SIMULATED_ACCOUNT_ID,
    accountName: SIMULATED_ACCOUNT_NAME,
    assetClass: 'ETF',
    assetSubClass: 'SIMULATED',
    basePrice: 0.01,
    currency: 'EUR',
    name: symbol,
    symbol
  };
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
