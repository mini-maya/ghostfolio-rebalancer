import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { LocaleNumberPipe } from '../pipes/locale-number.pipe';
import { RuntimeConfigService } from '../runtime-config';
import type { Holding } from '../services/ghostfolio-api';
import { PortfolioDataStore } from '../services/portfolio-data.store';

interface AllocationItem {
  percentage: number;
  symbol: string;
}

interface AllocationState {
  errors: string[];
  items: AllocationItem[];
  total: number;
}

interface AllocationDialogRow {
  currentAllocationPercentage: number;
  name: string;
  symbol: string;
  targetAllocationPercentage: number;
}

interface RebalancingRow {
  buyAmount: number;
  buyRoundedAmount: number;
  currency: string;
  currentAllocationPercentage: number;
  currentValue: number;
  marketPrice: number;
  name: string;
  newAllocationPercentage: number;
  newValue: number;
  quantity: number;
  symbol: string;
  targetAllocationPercentage: number;
  targetGap: number;
}

type SortColumn =
  | 'symbol'
  | 'name'
  | 'quantity'
  | 'marketPrice'
  | 'currentValue'
  | 'currentAllocationPercentage'
  | 'targetAllocationPercentage'
  | 'targetGap'
  | 'buyAmount'
  | 'buyRoundedAmount'
  | 'newValue'
  | 'newAllocationPercentage';

type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-rebalancer-page',
  imports: [CommonModule, LocaleNumberPipe],
  templateUrl: './rebalancer-page.html',
  styleUrl: './rebalancer-page.scss'
})
export class RebalancerPage {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly portfolioDataStore = inject(PortfolioDataStore);
  private readonly runtimeConfigService = inject(RuntimeConfigService);
  private readonly runtimeConfig = this.runtimeConfigService.config;
  protected readonly allocationsText = signal(this.getInitialAllocationsText());
  protected readonly errorMessage = this.portfolioDataStore.errorMessage;
  protected readonly holdings = this.portfolioDataStore.holdings;
  protected readonly infoMessage = this.portfolioDataStore.infoMessage;
  protected readonly isLoading = this.portfolioDataStore.isLoading;
  protected readonly lastLoadedUrl = this.portfolioDataStore.lastLoadedUrl;
  protected readonly minimumBuyAmount = signal(10);
  protected readonly allocationDialogRows = signal<AllocationDialogRow[]>([]);
  protected readonly isAllocationDialogOpen = signal(false);
  protected readonly sortColumn = signal<SortColumn>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly roundingStep = signal(10);
  protected readonly savingsRate = signal(1750);
  private allocationsSaveTimeout: number | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.allocationsSaveTimeout !== null) {
        window.clearTimeout(this.allocationsSaveTimeout);
      }
    });

    effect(() => {
      if (
        this.authService.isAuthenticated() &&
        this.allocationTotalIsValid() &&
        !this.isLoading() &&
        !this.lastLoadedUrl()
      ) {
        void this.loadHoldings();
      }
    });
  }

  protected readonly allocationState = computed<AllocationState>(() => {
    const errors: string[] = [];
    const items: AllocationItem[] = [];
    let total = 0;

    for (const [index, rawEntry] of this.allocationsText().split('|').entries()) {
      const entry = rawEntry.trim();

      if (!entry) {
        continue;
      }

      const [symbol, percentageText, ...rest] = entry.split(',').map((value) => value.trim());

      if (!symbol || !percentageText || rest.length > 0) {
        errors.push(`Entry ${index + 1} must use "SYMBOL,PERCENT|SYMBOL,PERCENT".`);
        continue;
      }

      const percentage = Number(percentageText);

      if (!Number.isFinite(percentage) || percentage < 0) {
        errors.push(`Entry ${index + 1} has an invalid percentage.`);
        continue;
      }

      items.push({ percentage, symbol });
      total += percentage;
    }

    return {
      errors,
      items,
      total: roundToTwo(total)
    };
  });
  protected readonly portfolioTotal = computed(() => {
    return roundToTwo(
      this.holdings().reduce((sum, holding) => {
        return sum + holding.valueInBaseCurrency;
      }, 0)
    );
  });
  protected readonly plannedPortfolioTotal = computed(() => {
    return roundToTwo(this.portfolioTotal() + this.savingsRate());
  });
  protected readonly allocationTotalIsValid = computed(() => {
    return Math.abs(this.allocationState().total - 100) <= 0.001;
  });
  protected readonly hasAdvancedDefaults = computed(() => {
    return Boolean(this.getInitialAllocationsText());
  });
  protected readonly allocationDialogTotal = computed(() => {
    return roundToTwo(
      this.allocationDialogRows().reduce((sum, row) => {
        return sum + row.targetAllocationPercentage;
      }, 0)
    );
  });
  protected readonly allocationDialogTotalIsValid = computed(() => {
    return Math.abs(this.allocationDialogTotal() - 100) <= 0.001;
  });

  protected readonly rows = computed<RebalancingRow[]>(() => {
    const holdingsBySymbol = new Map(
      this.holdings().map((holding) => [holding.symbol, holding] as const)
    );
    const currentTotal = this.portfolioTotal();
    const monthlyRate = this.savingsRate();
    const nextTotal = currentTotal + monthlyRate;
    const parsedAllocations = this.allocationState().items;
    const targetGaps = parsedAllocations.map(({ percentage, symbol }) => {
      const holding = holdingsBySymbol.get(symbol);
      const currentValue = holding?.valueInBaseCurrency ?? 0;

      return Math.max((percentage / 100) * nextTotal - currentValue, 0);
    });
    const targetGapTotal = targetGaps.reduce((sum, value) => sum + value, 0);
    const distributionWeights =
      targetGapTotal > 0
        ? targetGaps
        : parsedAllocations.map(({ percentage }) => percentage);
    const distributedBuyAmounts = distributeMonthlyRate({
      minimumBuyAmount: this.minimumBuyAmount(),
      monthlyRate,
      weights: distributionWeights
    });
    const normalizedRoundedBuyAmounts = normalizeRoundedBuyAmounts({
      buyAmounts: distributedBuyAmounts,
      minimumBuyAmount: this.minimumBuyAmount(),
      monthlyRate,
      roundingStep: this.roundingStep()
    });

    const rows = parsedAllocations.map(({ percentage, symbol }, index) => {
      const holding = holdingsBySymbol.get(symbol);
      const currentValue = holding?.valueInBaseCurrency ?? 0;
      const buyAmount = distributedBuyAmounts[index];
      const buyRoundedAmount = normalizedRoundedBuyAmounts[index];
      const newValue = currentValue + buyRoundedAmount;

      return {
        _index: index,
        buyAmount: roundToTwo(buyRoundedAmount === 0 ? 0 : buyAmount),
        buyRoundedAmount: roundToTwo(buyRoundedAmount),
        currency: holding?.currency ?? '???',
        currentAllocationPercentage:
          currentTotal > 0 ? roundToTwo((currentValue / currentTotal) * 100) : 0,
        currentValue: roundToTwo(currentValue),
        marketPrice: holding?.marketPrice ?? 0,
        name: holding?.name ?? symbol,
        newAllocationPercentage:
          nextTotal > 0 ? roundToTwo((newValue / nextTotal) * 100) : 0,
        newValue: roundToTwo(newValue),
        quantity: holding?.quantity ?? 0,
        symbol,
        targetAllocationPercentage: percentage,
        targetGap: roundToTwo(targetGaps[index])
      };
    });

    const directionFactor = this.sortDirection() === 'asc' ? 1 : -1;

    return rows
      .sort((left, right) => {
        const leftValue = left[this.sortColumn()];
        const rightValue = right[this.sortColumn()];

        if (typeof leftValue === 'string' && typeof rightValue === 'string') {
          const comparison = leftValue.localeCompare(rightValue, undefined, {
            numeric: true,
            sensitivity: 'base'
          });

          if (comparison !== 0) {
            return comparison * directionFactor;
          }
        } else if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          if (leftValue !== rightValue) {
            return (leftValue - rightValue) * directionFactor;
          }
        }

        return (left._index - right._index) * directionFactor;
      })
      .map(({ _index, ...row }) => row);
  });

  protected updateAllocationsText(event: Event) {
    this.allocationsText.set(readInputValue(event));
    this.scheduleAllocationsSave();
  }

  protected updateAllocationDialogTarget(symbol: string, event: Event) {
    const value = Number(readInputValue(event));
    const targetAllocationPercentage =
      Number.isFinite(value) && value >= 0 ? roundToTwo(value) : 0;

    this.allocationDialogRows.update((rows) => {
      return rows.map((row) => {
        if (row.symbol !== symbol) {
          return row;
        }

        return {
          ...row,
          targetAllocationPercentage
        };
      });
    });
  }

  protected confirmAllocationDialog() {
    if (!this.allocationDialogTotalIsValid()) {
      return;
    }

    const nextAllocationsText = this.allocationDialogRows()
      .map(({ symbol, targetAllocationPercentage }) => {
        return `${symbol},${formatAllocationPercentage(targetAllocationPercentage)}`;
      })
      .join('|');

    this.allocationsText.set(nextAllocationsText);
    this.isAllocationDialogOpen.set(false);
    this.infoMessage.set('Target allocations were generated from current holdings.');
    this.scheduleAllocationsSave();
  }

  protected updateSavingsRate(event: Event) {
    const value = Number(readInputValue(event));
    this.savingsRate.set(Number.isFinite(value) && value > 0 ? value : 0);
  }

  protected updateMinimumBuyAmount(event: Event) {
    const value = Number(readInputValue(event));
    this.minimumBuyAmount.set(Number.isFinite(value) && value >= 0 ? value : 10);
  }

  protected updateRoundingStep(event: Event) {
    const value = Number(readInputValue(event));
    this.roundingStep.set(Number.isFinite(value) && value >= 0 ? value : 10);
  }

  protected isSortColumn(column: SortColumn): boolean {
    return this.sortColumn() === column;
  }

  protected sortBy(column: SortColumn) {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.sortColumn.set(column);
    this.sortDirection.set('asc');
  }

  protected sortIndicator(column: SortColumn): string {
    if (!this.isSortColumn(column)) {
      return '';
    }

    return this.sortDirection() === 'asc' ? '▲' : '▼';
  }

  protected currencySymbol(currency: string): string {
    const symbols: Record<string, string> = {
      CHF: 'CHF',
      EUR: '€',
      GBP: '£',
      JPY: '¥',
      USD: '$'
    };

    return symbols[currency.toUpperCase()] ?? currency;
  }

  protected async loadHoldings() {
    await this.portfolioDataStore.loadPortfolioData();

    if (!this.allocationsText().trim()) {
      this.openAllocationDialog(this.holdings());
    }
  }

  private openAllocationDialog(holdings: Holding[]) {
    const rows = holdings.map((holding) => {
      const currentAllocationPercentage = roundToTwo(
        normalizeAllocationPercentage(holding.allocationInPercentage)
      );

      return {
        currentAllocationPercentage,
        name: holding.name,
        symbol: holding.symbol,
        targetAllocationPercentage: currentAllocationPercentage
      };
    });

    this.allocationDialogRows.set(rows);
    this.isAllocationDialogOpen.set(rows.length > 0);
  }

  private getInitialAllocationsText(): string {
    if (this.authService.sessionMode() === 'account') {
      return this.authService.allocationsText();
    }

    return this.runtimeConfig().allocationsText;
  }

  private scheduleAllocationsSave() {
    if (this.authService.sessionMode() !== 'account') {
      return;
    }

    if (this.allocationsSaveTimeout !== null) {
      window.clearTimeout(this.allocationsSaveTimeout);
    }

    this.allocationsSaveTimeout = window.setTimeout(() => {
      this.allocationsSaveTimeout = null;
      void this.saveAllocationsText();
    }, 300);
  }

  private async saveAllocationsText() {
    try {
      await this.authService.updateAccountAllocationsText(this.allocationsText());
    } catch {
      this.errorMessage.set('Saving target allocations to the account failed.');
    }
  }
}

function readInputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatAllocationPercentage(value: number): string {
  const roundedValue = roundToTwo(value);

  if (Number.isInteger(roundedValue)) {
    return roundedValue.toString();
  }

  return roundedValue.toFixed(2).replace(/\.?0+$/, '');
}

function normalizeAllocationPercentage(value: number): number {
  const nonNegativeValue = Math.max(value, 0);

  if (nonNegativeValue <= 1) {
    return nonNegativeValue * 100;
  }

  return nonNegativeValue;
}

function distributeMonthlyRate({
  minimumBuyAmount,
  monthlyRate,
  weights
}: {
  minimumBuyAmount: number;
  monthlyRate: number;
  weights: number[];
}): number[] {
  if (monthlyRate <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }

  const positiveWeightSum = weights.reduce((sum, value) => sum + Math.max(value, 0), 0);

  if (positiveWeightSum <= 0) {
    return weights.map(() => 0);
  }

  const proportionalAmounts = weights.map((value) => {
    return (Math.max(value, 0) / positiveWeightSum) * monthlyRate;
  });
  const positiveMinimum = Math.max(minimumBuyAmount, 0);

  if (positiveMinimum <= 0) {
    return proportionalAmounts;
  }

  const fixedIndexes = new Set<number>();

  while (true) {
    const remainingIndexes = proportionalAmounts
      .map((_, index) => index)
      .filter((index) => !fixedIndexes.has(index));
    const remainingBudget = monthlyRate - fixedIndexes.size * positiveMinimum;

    if (remainingBudget < 0) {
      return proportionalAmounts;
    }

    const remainingWeightSum = remainingIndexes.reduce((sum, index) => {
      return sum + proportionalAmounts[index];
    }, 0);
    const redistributedAmounts = proportionalAmounts.map((value, index) => {
      if (fixedIndexes.has(index)) {
        return positiveMinimum;
      }

      if (remainingWeightSum <= 0) {
        return 0;
      }

      return (proportionalAmounts[index] / remainingWeightSum) * remainingBudget;
    });
    const nextFixedIndexes = remainingIndexes.filter((index) => {
      return redistributedAmounts[index] < positiveMinimum;
    });

    if (nextFixedIndexes.length === 0) {
      return redistributedAmounts;
    }

    for (const index of nextFixedIndexes) {
      fixedIndexes.add(index);
    }
  }
}

function normalizeRoundedBuyAmounts({
  buyAmounts,
  minimumBuyAmount,
  monthlyRate,
  roundingStep
}: {
  buyAmounts: number[];
  minimumBuyAmount: number;
  monthlyRate: number;
  roundingStep: number;
}): number[] {
  if (monthlyRate <= 0 || buyAmounts.length === 0) {
    return buyAmounts.map(() => 0);
  }

  const positiveRoundingStep = Math.max(roundingStep, 0);

  if (positiveRoundingStep === 0) {
    return normalizeAmountsToExactTotal(buyAmounts, monthlyRate);
  }

  const totalUnits = Math.floor(monthlyRate / positiveRoundingStep);
  const remainderAmount = roundToTwo(monthlyRate - totalUnits * positiveRoundingStep);
  const positiveIndexes = buyAmounts
    .map((amount, index) => ({ amount, index }))
    .filter(({ amount }) => amount > 0);

  if (positiveIndexes.length === 0) {
    return buyAmounts.map(() => 0);
  }

  if (totalUnits <= 0) {
    return assignRemainderToBestFit({
      amounts: buyAmounts.map(() => 0),
      buyAmounts,
      remainderAmount
    });
  }

  const minimumUnits = Math.max(
    0,
    Math.ceil(Math.max(minimumBuyAmount, 0) / positiveRoundingStep)
  );

  if (minimumUnits === 0) {
    const actionableWeights = buyAmounts.map((amount) => {
      return amount >= positiveRoundingStep ? amount / positiveRoundingStep : 0;
    });

    if (actionableWeights.some((weight) => weight > 0)) {
      const allocated = allocateUnitsByLargestRemainder({
        baseUnits: buyAmounts.map(() => 0),
        totalUnits,
        weights: actionableWeights
      }).map((units) => units * positiveRoundingStep);

      return assignRemainderToBestFit({
        amounts: allocated,
        buyAmounts,
        remainderAmount
      });
    }
  }

  if (positiveIndexes.length * minimumUnits > totalUnits) {
    const allocated = allocateUnitsByLargestRemainder({
      baseUnits: buyAmounts.map(() => 0),
      totalUnits,
      weights: buyAmounts.map((amount) => Math.max(amount, 0) / positiveRoundingStep)
    }).map((units) => units * positiveRoundingStep);

    return assignRemainderToBestFit({
      amounts: allocated,
      buyAmounts,
      remainderAmount
    });
  }

  const baseUnits = buyAmounts.map((amount) => {
    return amount > 0 ? minimumUnits : 0;
  });
  const remainingUnits = totalUnits - positiveIndexes.length * minimumUnits;
  const extraWeights = buyAmounts.map((amount) => {
    return amount > 0
      ? Math.max(amount - minimumUnits * positiveRoundingStep, 0) / positiveRoundingStep
      : 0;
  });
  const normalizedUnits = allocateUnitsByLargestRemainder({
    baseUnits,
    totalUnits: remainingUnits,
    weights: extraWeights
  }).map((units, index) => units + baseUnits[index]);

  return assignRemainderToBestFit({
    amounts: normalizedUnits.map((units) => units * positiveRoundingStep),
    buyAmounts,
    remainderAmount
  });
}

function allocateUnitsByLargestRemainder({
  baseUnits,
  totalUnits,
  weights
}: {
  baseUnits: number[];
  totalUnits: number;
  weights: number[];
}): number[] {
  if (totalUnits <= 0) {
    return baseUnits.map(() => 0);
  }

  const positiveWeightSum = weights.reduce((sum, value) => sum + Math.max(value, 0), 0);

  if (positiveWeightSum <= 0) {
    const allocated = baseUnits.map(() => 0);

    for (let index = 0; index < totalUnits; index++) {
      allocated[index % allocated.length] += 1;
    }

    return allocated;
  }

  const exactUnits = weights.map((value) => {
    return (Math.max(value, 0) / positiveWeightSum) * totalUnits;
  });
  const allocatedUnits = exactUnits.map((value) => Math.floor(value));
  let remainingUnits = totalUnits - allocatedUnits.reduce((sum, value) => sum + value, 0);

  if (remainingUnits > 0) {
    const sortedByRemainder = exactUnits
      .map((value, index) => ({
        fractional: value - Math.floor(value),
        index
      }))
      .sort((a, b) => b.fractional - a.fractional);

    for (let index = 0; index < remainingUnits; index++) {
      allocatedUnits[sortedByRemainder[index % sortedByRemainder.length].index] += 1;
    }
  }

  return allocatedUnits;
}

function assignRemainderToBestFit({
  amounts,
  buyAmounts,
  remainderAmount
}: {
  amounts: number[];
  buyAmounts: number[];
  remainderAmount: number;
}): number[] {
  if (remainderAmount <= 0) {
    return normalizeAmountsToExactTotal(amounts, amounts.reduce((sum, value) => sum + value, 0));
  }

  const nextAmounts = [...amounts];
  const recipientIndex = selectBestFitIndex(buyAmounts, amounts);
  nextAmounts[recipientIndex] += remainderAmount;

  return normalizeAmountsToExactTotal(
    nextAmounts,
    roundToTwo(amounts.reduce((sum, value) => sum + value, 0) + remainderAmount)
  );
}

function selectBestFitIndex(targetAmounts: number[], currentAmounts: number[]): number {
  let bestIndex = 0;
  let bestGap = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < targetAmounts.length; index++) {
    const gap = targetAmounts[index] - currentAmounts[index];

    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function normalizeAmountsToExactTotal(amounts: number[], targetTotal: number): number[] {
  if (amounts.length === 0) {
    return [];
  }

  const targetCents = Math.round(targetTotal * 100);
  const exactCents = amounts.map((amount) => Math.max(amount, 0) * 100);
  const normalizedCents = exactCents.map((value) => Math.floor(value));
  let remainingCents =
    targetCents - normalizedCents.reduce((sum, value) => sum + value, 0);

  if (remainingCents > 0) {
    const sortedByFraction = exactCents
      .map((value, index) => ({
        fraction: value - Math.floor(value),
        index
      }))
      .sort((a, b) => b.fraction - a.fraction);

    for (let index = 0; index < remainingCents; index++) {
      normalizedCents[sortedByFraction[index % sortedByFraction.length].index] += 1;
    }
  } else if (remainingCents < 0) {
    const sortedByRemovable = normalizedCents
      .map((value, index) => ({ index, value }))
      .filter(({ value }) => value > 0)
      .sort((a, b) => b.value - a.value);

    remainingCents = Math.abs(remainingCents);

    for (let index = 0; index < remainingCents && sortedByRemovable.length > 0; index++) {
      normalizedCents[sortedByRemovable[index % sortedByRemovable.length].index] -= 1;
    }
  }

  return normalizedCents.map((value) => value / 100);
}
