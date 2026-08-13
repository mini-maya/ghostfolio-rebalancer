import type { AllocationItem } from '../services/allocations';
import type { Holding } from '../services/ghostfolio-api';

export interface NextWithdrawalSellRow {
  currency: string;
  currentAllocationPercentage: number;
  currentValue: number;
  marketPrice: number;
  name: string;
  remainingAllocationPercentage: number;
  remainingValue: number;
  sellAmount: number;
  sharesToSell: number;
  symbol: string;
  targetAllocationPercentage: number;
  targetPostWithdrawalValue: number;
}

export interface NextWithdrawalSellPlan {
  portfolioAfterSell: number;
  portfolioTotal: number;
  requestedSellAmount: number;
  rows: NextWithdrawalSellRow[];
  totalPlannedSell: number;
}

export function calculateNextWithdrawalSellPlan({
  allocations,
  holdings,
  withdrawalAmount
}: {
  allocations: AllocationItem[];
  holdings: Holding[];
  withdrawalAmount: number;
}): NextWithdrawalSellPlan {
  const portfolioTotal = holdings.reduce((sum, holding) => {
    return sum + Math.max(holding.valueInBaseCurrency, 0);
  }, 0);
  const requestedSellAmount = clampToRange(withdrawalAmount, 0, portfolioTotal);
  const portfolioAfterSell = Math.max(portfolioTotal - requestedSellAmount, 0);

  if (allocations.length === 0) {
    return {
      portfolioAfterSell: roundToTwo(portfolioAfterSell),
      portfolioTotal: roundToTwo(portfolioTotal),
      requestedSellAmount: roundToTwo(requestedSellAmount),
      rows: [],
      totalPlannedSell: 0
    };
  }

  const holdingsBySymbol = new Map(holdings.map((holding) => [holding.symbol, holding] as const));
  const rows = allocations.map(({ percentage, symbol }) => {
    const holding = holdingsBySymbol.get(symbol);
    const currentValue = Math.max(holding?.valueInBaseCurrency ?? 0, 0);
    const targetPostWithdrawalValue = (percentage / 100) * portfolioAfterSell;

    return {
      availableCapacity: currentValue,
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
    return Math.max(row.currentValue - row.targetPostWithdrawalValue, 0);
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

  const resultRows = rows.map((row) => {
    const sellAmount = clampToRange(row.sellAmount, 0, row.currentValue);
    const remainingValue = Math.max(row.currentValue - sellAmount, 0);
    const rawSharesToSell = row.marketPrice > 0 ? sellAmount / row.marketPrice : 0;
    const sharesToSell =
      row.quantity > 0 ? clampToRange(rawSharesToSell, 0, row.quantity) : Math.max(rawSharesToSell, 0);

    return {
      currency: row.currency,
      currentAllocationPercentage:
        portfolioTotal > 0 ? roundToTwo((row.currentValue / portfolioTotal) * 100) : 0,
      currentValue: roundToTwo(row.currentValue),
      marketPrice: roundToTwo(row.marketPrice),
      name: row.name,
      remainingAllocationPercentage:
        portfolioAfterSell > 0 ? roundToTwo((remainingValue / portfolioAfterSell) * 100) : 0,
      remainingValue: roundToTwo(remainingValue),
      sellAmount: roundToTwo(sellAmount),
      sharesToSell: roundToSix(sharesToSell),
      symbol: row.symbol,
      targetAllocationPercentage: roundToTwo(row.targetAllocationPercentage),
      targetPostWithdrawalValue: roundToTwo(row.targetPostWithdrawalValue)
    };
  });
  const totalPlannedSell = resultRows.reduce((sum, row) => sum + row.sellAmount, 0);

  return {
    portfolioAfterSell: roundToTwo(portfolioAfterSell),
    portfolioTotal: roundToTwo(portfolioTotal),
    requestedSellAmount: roundToTwo(requestedSellAmount),
    rows: resultRows,
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

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
