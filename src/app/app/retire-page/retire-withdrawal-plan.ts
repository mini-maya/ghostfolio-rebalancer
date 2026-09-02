import type { AllocationItem } from '../services/allocations';
import type { Holding } from '../services/ghostfolio-api';
import {
  allocateSparerPauschbetragForYear,
  calculateTaxableGainAfterVap,
  calculateTaxOnTaxableAmount,
  DEFAULT_TAX_PROFILE,
  type TaxProfile
} from '../services/tax-calculator';

export interface NextWithdrawalSellRow {
  currency: string;
  currentAllocationPercentage: number;
  currentValue: number;
  estimatedTax: number;
  grossSellAmount: number;
  marketPrice: number;
  name: string;
  netSellAmount: number;
  projectedVap: number;
  remainingAllocationPercentage: number;
  remainingValue: number;
  sellAmount: number;
  sharesToSell: number;
  symbol: string;
  taxableVap: number;
  targetAllocationPercentage: number;
  targetPostWithdrawalValue: number;
}

export interface NextWithdrawalSellPlan {
  estimatedTaxTotal: number;
  netSellTotal: number;
  portfolioAfterSell: number;
  portfolioTotal: number;
  projectedVapTotal: number;
  requestedSellAmount: number;
  rows: NextWithdrawalSellRow[];
  /** Portion of `sparerPauschbetragRemainingForYear` consumed by this withdrawal's taxable sale gain. */
  sparerPauschbetragRemainingAfter: number;
  sparerPauschbetragUsed: number;
  taxableVapTotal: number;
  totalPlannedSell: number;
}

export function calculateNextWithdrawalSellPlan({
  allocations,
  holdings,
  symbolTaxDataBySymbol,
  taxProfile = DEFAULT_TAX_PROFILE,
  withdrawalAmount,
  minimumRemainingValueBySymbol,
  sellWholeSharesOnly = false,
  sparerPauschbetragRemainingForYear
}: {
  allocations: AllocationItem[];
  holdings: Holding[];
  symbolTaxDataBySymbol?: Map<string, { costBasis?: number; grossVap: number; taxableVap: number }>;
  taxProfile?: TaxProfile;
  withdrawalAmount: number;
  minimumRemainingValueBySymbol?: Map<string, number>;
  sellWholeSharesOnly?: boolean;
  /**
   * Sparer-Pauschbetrag still available for the calendar year this withdrawal falls into,
   * i.e. the annual allowance minus whatever has already been consumed by earlier withdrawals
   * (or taxable VAP) in the same year. Callers tracking a running annual allowance across
   * several withdrawals must pass the previous call's `sparerPauschbetragRemainingAfter` here.
   * Defaults to the full configured annual allowance when the caller does not track state.
   */
  sparerPauschbetragRemainingForYear?: number;
}): NextWithdrawalSellPlan {
  const portfolioTotal = holdings.reduce((sum, holding) => {
    return sum + Math.max(holding.valueInBaseCurrency, 0);
  }, 0);
  const requestedSellAmount = clampToRange(withdrawalAmount, 0, portfolioTotal);
  const portfolioAfterSell = Math.max(portfolioTotal - requestedSellAmount, 0);
  const sparerPauschbetragAvailable = Math.max(
    sparerPauschbetragRemainingForYear ?? taxProfile.sparerPauschbetrag,
    0
  );

  if (allocations.length === 0) {
    return {
      estimatedTaxTotal: 0,
      netSellTotal: 0,
      portfolioAfterSell: roundToTwo(portfolioAfterSell),
      portfolioTotal: roundToTwo(portfolioTotal),
      projectedVapTotal: 0,
      requestedSellAmount: roundToTwo(requestedSellAmount),
      rows: [],
      sparerPauschbetragRemainingAfter: roundToTwo(sparerPauschbetragAvailable),
      sparerPauschbetragUsed: 0,
      taxableVapTotal: 0,
      totalPlannedSell: 0
    };
  }

  const minimumRemainingValues = minimumRemainingValueBySymbol ?? new Map<string, number>();
  const holdingsBySymbol = new Map(holdings.map((holding) => [holding.symbol, holding] as const));
  const rows = allocations.map(({ percentage, symbol }) => {
    const holding = holdingsBySymbol.get(symbol);
    const currentValue = Math.max(holding?.valueInBaseCurrency ?? 0, 0);
    const minimumRemainingValue = Math.max(minimumRemainingValues.get(symbol) ?? 0, 0);
    const availableCapacity = Math.max(currentValue - minimumRemainingValue, 0);
    const targetPostWithdrawalValue = (percentage / 100) * portfolioAfterSell;

    return {
      availableCapacity,
      currentValue,
      currency: holding?.currency ?? '???',
      marketPrice: Math.max(holding?.marketPrice ?? 0, 0),
      name: holding?.name ?? symbol,
      quantity: Math.max(holding?.quantity ?? 0, 0),
      sellAmount: 0,
      symbol,
      targetAllocationPercentage: percentage,
      targetPostWithdrawalValue
    };
  });

  const overweightCapacities = rows.map((row) => {
    return Math.max(Math.min(row.currentValue - row.targetPostWithdrawalValue, row.availableCapacity), 0);
  });
  const overweightCapacityTotal = overweightCapacities.reduce((sum, value) => sum + value, 0);

  if (overweightCapacityTotal > 0) {
    const sellFromOverweight = Math.min(requestedSellAmount, overweightCapacityTotal);
    const plannedOverweightSell = allocateByWeightsWithCaps({
      amount: sellFromOverweight,
      caps: overweightCapacities,
      weights: overweightCapacities
    });

    rows.forEach((row, index) => {
      row.sellAmount = plannedOverweightSell[index];
    });
  }

  const soldAfterOverweight = rows.reduce((sum, row) => sum + row.sellAmount, 0);
  const remainingSellAfterOverweight = Math.max(requestedSellAmount - soldAfterOverweight, 0);

  if (remainingSellAfterOverweight > 0) {
    const fallbackCaps = rows.map((row) => {
      return Math.max(row.availableCapacity - row.sellAmount, 0);
    });
    const fallbackWeights = rows.map((row) => {
      return Math.max(row.targetAllocationPercentage, 0);
    });
    const fallbackSell = allocateByWeightsWithCaps({
      amount: remainingSellAfterOverweight,
      caps: fallbackCaps,
      weights: fallbackWeights
    });

    rows.forEach((row, index) => {
      row.sellAmount += fallbackSell[index];
    });
  }

  if (sellWholeSharesOnly) {
    applyWholeShareConstraint(rows, requestedSellAmount);
  }

  const preliminaryRows = rows.map((row) => {
    const sellAmount = clampToRange(row.sellAmount, 0, row.currentValue);
    const projectedTaxData = symbolTaxDataBySymbol?.get(row.symbol) ?? {
      costBasis: undefined,
      grossVap: 0,
      taxableVap: 0
    };
    const projectedVap = roundToTwo(projectedTaxData.grossVap);
    // Fraction of the currently held position's value that this withdrawal sells. Both the
    // position's cost basis and its accrued (not-yet-taxed) VAP are attributed to the sale
    // proportionally, since this function only receives aggregate per-symbol holding/tax data,
    // not individual FIFO lots (that precise attribution happens in tax-engine.ts).
    const soldFraction = row.currentValue > 0 ? sellAmount / row.currentValue : 0;
    // Falls back to the full current value (i.e. an assumed zero unrealized gain) when no real
    // cost-basis data is supplied, preserving prior behavior for callers that only pass VAP data.
    const costBasisForPosition = projectedTaxData.costBasis ?? row.currentValue;
    const acquisitionCost = costBasisForPosition * soldFraction;
    const usedVap = projectedVap * soldFraction;
    const taxableGainBeforeAllowance = calculateTaxableGainAfterVap({
      acquisitionCost,
      saleProceeds: sellAmount,
      taxProfile,
      usedVap
    });

    return { ...row, acquisitionCost, projectedVap, sellAmount, taxableGainBeforeAllowance, usedVap };
  });
  const totalTaxableGainBeforeAllowance = preliminaryRows.reduce((sum, row) => {
    return sum + row.taxableGainBeforeAllowance;
  }, 0);
  const allowanceAllocation = allocateSparerPauschbetragForYear({
    sparerPauschbetragAvailable: sparerPauschbetragAvailable,
    taxableAmounts: [totalTaxableGainBeforeAllowance]
  });
  // Distribute the combined post-allowance taxable amount back across rows in proportion to
  // each row's pre-allowance share, so the single shared Sparer-Pauschbetrag is never applied
  // more than once across the rows sold in this withdrawal.
  const postAllowanceRatio =
    totalTaxableGainBeforeAllowance > 0
      ? allowanceAllocation.taxableAfterAllowance / totalTaxableGainBeforeAllowance
      : 0;

  const resultRows = preliminaryRows.map((row) => {
    const sellAmount = row.sellAmount;
    const remainingValue = Math.max(row.currentValue - sellAmount, 0);
    const rawSharesToSell = row.marketPrice > 0 ? sellAmount / row.marketPrice : 0;
    const sharesToSell =
      row.quantity > 0 ? clampToRange(rawSharesToSell, 0, row.quantity) : Math.max(rawSharesToSell, 0);
    const projectedVap = row.projectedVap;
    const projectedTaxData = symbolTaxDataBySymbol?.get(row.symbol) ?? {
      grossVap: 0,
      taxableVap: 0
    };
    const taxableVap = roundToTwo(projectedTaxData.taxableVap);
    const rowTaxableAfterAllowance = row.taxableGainBeforeAllowance * postAllowanceRatio;
    const estimatedTax = calculateTaxOnTaxableAmount(rowTaxableAfterAllowance, taxProfile);
    const netSellAmount = Math.max(sellAmount - estimatedTax, 0);

    return {
      currency: row.currency,
      currentAllocationPercentage:
        portfolioTotal > 0 ? roundToTwo((row.currentValue / portfolioTotal) * 100) : 0,
      currentValue: roundToTwo(row.currentValue),
      estimatedTax: roundToTwo(estimatedTax),
      grossSellAmount: roundToTwo(sellAmount),
      marketPrice: roundToTwo(row.marketPrice),
      name: row.name,
      netSellAmount: roundToTwo(netSellAmount),
      projectedVap,
      remainingAllocationPercentage:
        portfolioAfterSell > 0 ? roundToTwo((remainingValue / portfolioAfterSell) * 100) : 0,
      remainingValue: roundToTwo(remainingValue),
      sellAmount: roundToTwo(sellAmount),
      sharesToSell: roundToSix(sharesToSell),
      symbol: row.symbol,
      taxableVap,
      targetAllocationPercentage: roundToTwo(row.targetAllocationPercentage),
      targetPostWithdrawalValue: roundToTwo(row.targetPostWithdrawalValue)
    };
  });
  const totalPlannedSell = resultRows.reduce((sum, row) => sum + row.sellAmount, 0);
  const estimatedTaxTotal = resultRows.reduce((sum, row) => sum + row.estimatedTax, 0);
  const projectedVapTotal = resultRows.reduce((sum, row) => sum + row.projectedVap, 0);
  const taxableVapTotal = resultRows.reduce((sum, row) => sum + row.taxableVap, 0);
  const netSellTotal = resultRows.reduce((sum, row) => sum + row.netSellAmount, 0);

  return {
    estimatedTaxTotal: roundToTwo(estimatedTaxTotal),
    netSellTotal: roundToTwo(netSellTotal),
    portfolioAfterSell: roundToTwo(portfolioAfterSell),
    portfolioTotal: roundToTwo(portfolioTotal),
    projectedVapTotal: roundToTwo(projectedVapTotal),
    requestedSellAmount: roundToTwo(requestedSellAmount),
    rows: resultRows,
    sparerPauschbetragRemainingAfter: allowanceAllocation.remaining,
    sparerPauschbetragUsed: allowanceAllocation.used,
    taxableVapTotal: roundToTwo(taxableVapTotal),
    totalPlannedSell: roundToTwo(totalPlannedSell)
  };
}

function allocateByWeightsWithCaps({
  amount,
  caps,
  weights
}: {
  amount: number;
  caps: number[];
  weights: number[];
}): number[] {
  const allocations = caps.map(() => 0);
  let remainingAmount = Math.max(amount, 0);
  const active = new Set(
    caps
      .map((cap, index) => ({ cap, index }))
      .filter(({ cap }) => cap > 0)
      .map(({ index }) => index)
  );

  while (remainingAmount > 0.0000001 && active.size > 0) {
    const activeIndexes = [...active];
    const activeWeightSum = activeIndexes.reduce((sum, index) => {
      return sum + Math.max(weights[index], 0);
    }, 0);
    const perIndexWeight = activeWeightSum > 0 ? undefined : 1;
    let distributedInRound = 0;

    for (const index of activeIndexes) {
      const remainingCap = Math.max(caps[index] - allocations[index], 0);

      if (remainingCap <= 0) {
        active.delete(index);
        continue;
      }

      const weight = perIndexWeight ?? Math.max(weights[index], 0);
      const normalizedWeight = weight / (perIndexWeight ? activeIndexes.length : activeWeightSum);
      const target = remainingAmount * normalizedWeight;
      const chunk = Math.min(target, remainingCap);

      if (chunk <= 0) {
        continue;
      }

      allocations[index] += chunk;
      distributedInRound += chunk;

      if (caps[index] - allocations[index] <= 0.0000001) {
        active.delete(index);
      }
    }

    if (distributedInRound <= 0.0000001) {
      break;
    }

    remainingAmount -= distributedInRound;
  }

  return allocations;
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const WHOLE_SHARE_EPSILON = 0.000001;

/**
 * Adjusts each row's `sellAmount` (mutating it in place) so that it corresponds to a
 * whole number of shares. Rows are first floored to whole shares based on their
 * continuously-allocated `sellAmount`, then any resulting shortfall against
 * `requestedSellAmount` is greedily filled by adding one whole share at a time —
 * always preferring the highest-priced eligible share — to get as close as possible to
 * the requested amount without exceeding it.
 */
function applyWholeShareConstraint(
  rows: Array<{ availableCapacity: number; marketPrice: number; quantity: number; sellAmount: number }>,
  requestedSellAmount: number
): void {
  const maxShares = rows.map((row) => {
    if (row.marketPrice <= 0) {
      return 0;
    }

    const byQuantity = Math.floor(row.quantity + WHOLE_SHARE_EPSILON);
    const byCapacity = Math.floor(row.availableCapacity / row.marketPrice + WHOLE_SHARE_EPSILON);

    return Math.max(Math.min(byQuantity, byCapacity), 0);
  });

  const shares = rows.map((row, index) => {
    if (row.marketPrice <= 0) {
      return 0;
    }

    const rawShares = Math.floor(row.sellAmount / row.marketPrice + WHOLE_SHARE_EPSILON);

    return clampToRange(rawShares, 0, maxShares[index]);
  });

  const soldSoFar = () => {
    return rows.reduce((sum, row, index) => sum + shares[index] * row.marketPrice, 0);
  };

  let remainingShortfall = Math.max(requestedSellAmount - soldSoFar(), 0);

  while (remainingShortfall > WHOLE_SHARE_EPSILON) {
    let bestIndex = -1;
    let bestPrice = -Infinity;

    rows.forEach((row, index) => {
      if (shares[index] >= maxShares[index] || row.marketPrice <= 0) {
        return;
      }

      if (row.marketPrice <= remainingShortfall + WHOLE_SHARE_EPSILON && row.marketPrice > bestPrice) {
        bestPrice = row.marketPrice;
        bestIndex = index;
      }
    });

    if (bestIndex === -1) {
      break;
    }

    shares[bestIndex] += 1;
    remainingShortfall -= bestPrice;
  }

  rows.forEach((row, index) => {
    row.sellAmount = shares[index] * row.marketPrice;
  });
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
