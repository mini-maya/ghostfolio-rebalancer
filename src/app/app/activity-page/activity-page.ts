import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { startOfYear, sub } from 'date-fns';

import { GfInvestmentChartComponent } from '../../shared/investment-chart/public-api';
import type { InvestmentItem, LineChartItem } from '../../shared/investment-chart/src/investment-chart.interfaces';
import type { ColorScheme, TimeRange } from '../../shared/investment-chart/src/investment-chart.types';
import { LocaleNumberPipe } from '../pipes/locale-number.pipe';
import type { Activity, Holding, PortfolioPerformanceChartItem } from '../services/ghostfolio-api';
import { PortfolioDataStore } from '../services/portfolio-data.store';

interface SellDetailRow {
  date: Date | null;
  realizedAmount: number;
  realizedPercentage: number;
  soldQuantity: number;
  totalValue: number;
  unitPrice: number;
}

interface ActivityDetailRow {
  date: Date | null;
  fee: number;
  gainAmount: number | null;
  gainPercentage: number | null;
  quantity: number;
  sellDetails: SellDetailRow[];
  soldQuantity: number | null;
  totalValue: number;
  totalWithFee: number;
  type: string;
  unitPrice: number;
}

interface ActivitySymbolMetrics {
  allocationPercentage: number;
  currency: string;
  entryPriceAmount: number;
  entryPricePerUnit: number;
  gainAmount: number;
  gainPercentage: number;
  positionPriceAmount: number;
  positionPricePerUnit: number;
  positionQuantity: number;
  realizedAmount: number;
  realizedPercentage: number;
}

interface ActivitySymbolGroup {
  entries: ActivityDetailRow[];
  metrics: ActivitySymbolMetrics;
  name: string;
  symbol: string;
}

interface ActivitySubClassGroup {
  subClass: string;
  symbols: ActivitySymbolGroup[];
}

interface ActivityClassGroup {
  assetClass: string;
  subClasses: ActivitySubClassGroup[];
}

interface PortfolioSummaryMetrics {
  currentValue: number;
  gainAmount: number;
  gainPercentage: number;
  hasData: boolean;
}

type SortDirection = 'asc' | 'desc';
type MetricsSortColumn =
  | 'name'
  | 'entryPrice'
  | 'positionPrice'
  | 'gain'
  | 'realized'
  | 'allocation';

@Component({
  selector: 'app-activity-page',
  imports: [CommonModule, GfInvestmentChartComponent, LocaleNumberPipe],
  templateUrl: './activity-page.html',
  styleUrl: './activity-page.scss'
})
export class ActivityPage {
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly portfolioDataStore = inject(PortfolioDataStore);
  protected readonly activities = this.portfolioDataStore.activities;
  protected readonly holdings = this.portfolioDataStore.holdings;
  protected readonly isLoading = this.portfolioDataStore.isLoading;
  protected readonly portfolioPerformanceData = this.portfolioDataStore.portfolioPerformanceData;
  protected readonly portfolioChartColorScheme = signal<ColorScheme>(readChartColorScheme(this.document));
  protected readonly selectedChartTimeRange = signal<TimeRange>('MAX');
  protected readonly metricsSortColumn = signal<MetricsSortColumn>('name');
  protected readonly metricsSortDirection = signal<SortDirection>('asc');
  private readonly expandedEntrySet = signal(new Set<ActivityDetailRow>());
  protected readonly portfolioTotal = computed(() => {
    return roundToTwo(
      this.holdings().reduce((sum, holding) => {
        return sum + holding.valueInBaseCurrency;
      }, 0)
    );
  });
  protected readonly investmentChartBenchmarkDataItems = computed<InvestmentItem[]>(() => {
    return this.portfolioPerformanceData().map(({ date, investment }) => ({
      date,
      investment
    }));
  });
  protected readonly investmentChartHistoricalDataItems = computed<LineChartItem[]>(() => {
    return this.portfolioPerformanceData().map(({ date, value }) => ({
      date,
      value
    }));
  });
  protected readonly portfolioChartCurrency = computed(() => {
    return this.holdings()[0]?.currency ?? '???';
  });
  protected readonly maxRangePortfolioSummary = computed<PortfolioSummaryMetrics>(() => {
    return calculatePortfolioSummaryMetrics({
      performanceData: this.portfolioPerformanceData()
    });
  });
  protected readonly selectedRangePortfolioSummary = computed<PortfolioSummaryMetrics>(() => {
    return calculatePortfolioSummaryMetrics({
      performanceData: this.getPerformanceDataByRange(this.selectedChartTimeRange())
    });
  });
  protected readonly activityClassGroups = computed<ActivityClassGroup[]>(() => {
    const holdingsBySymbol = new Map(
      this.holdings().map((holding) => [holding.symbol.trim().toUpperCase(), holding] as const)
    );
    const portfolioTotal = this.portfolioTotal();
    const metricsSortColumn = this.metricsSortColumn();
    const metricsDirectionFactor = this.metricsSortDirection() === 'asc' ? 1 : -1;
    const activityGroupsByClass = new Map<string, Map<string, Map<string, Activity[]>>>();

    for (const activity of this.activities()) {
      const assetClass = activity.assetClass.trim().toUpperCase() || 'UNKNOWN';
      const assetSubClass = activity.assetSubClass.trim().toUpperCase() || 'UNKNOWN';
      const symbol = activity.symbol.trim().toUpperCase() || 'UNKNOWN';
      const subClassesByClass = activityGroupsByClass.get(assetClass) ?? new Map<
        string,
        Map<string, Activity[]>
      >();
      const symbolsBySubClass = subClassesByClass.get(assetSubClass) ?? new Map<string, Activity[]>();
      const activitiesBySymbol = symbolsBySubClass.get(symbol) ?? [];

      activitiesBySymbol.push(activity);
      symbolsBySubClass.set(symbol, activitiesBySymbol);
      subClassesByClass.set(assetSubClass, symbolsBySubClass);
      activityGroupsByClass.set(assetClass, subClassesByClass);
    }

    return [...activityGroupsByClass.entries()]
      .sort(([leftClass], [rightClass]) => {
        return leftClass.localeCompare(rightClass, undefined, {
          numeric: true,
          sensitivity: 'base'
        });
      })
      .map(([assetClass, subClassesByClass]) => {
        const subClasses = [...subClassesByClass.entries()]
          .sort(([leftSubClass], [rightSubClass]) => {
            return leftSubClass.localeCompare(rightSubClass, undefined, {
              numeric: true,
              sensitivity: 'base'
            });
          })
          .map(([subClass, symbolsBySubClass]) => {
            const symbols = [...symbolsBySubClass.entries()]
              .map(([symbol, activities]) => {
                const name =
                  activities.find((activity) => activity.name.trim())?.name.trim() || symbol;
                const { metrics, gainAmountByBuyIndex, gainPercentageByBuyIndex, sellDetailsByBuyIndex, soldQuantityByBuyIndex } = calculateActivitySymbolMetrics({
                  activities,
                  holding: holdingsBySymbol.get(symbol),
                  portfolioTotal
                });
                let buyIndex = 0;
                const entries = [...activities]
                  .sort((leftActivity, rightActivity) => {
                    return (
                      getActivityTimestamp(leftActivity.date) - getActivityTimestamp(rightActivity.date)
                    );
                  })
                  .map((activity) => {
                    const type = activity.type.trim().toUpperCase() || 'UNKNOWN';
                    const totalValue = activity.quantity * activity.unitPrice;
                    const isBuy = type === 'BUY';
                    const currentBuyIndex = isBuy ? buyIndex++ : -1;

                    return {
                      date: activity.date,
                      fee: activity.fee,
                      gainAmount: isBuy ? (gainAmountByBuyIndex.get(currentBuyIndex) ?? null) : null,
                      gainPercentage: isBuy ? (gainPercentageByBuyIndex.get(currentBuyIndex) ?? null) : null,
                      quantity: activity.quantity,
                      sellDetails: isBuy ? (sellDetailsByBuyIndex.get(currentBuyIndex) ?? []) : [],
                      soldQuantity: isBuy ? (soldQuantityByBuyIndex.get(currentBuyIndex) ?? 0) : null,
                      totalValue,
                      totalWithFee: isBuy ? totalValue + activity.fee : totalValue - activity.fee,
                      type,
                      unitPrice: activity.unitPrice
                    };
                  });

                return {
                  _index: symbol,
                  entries,
                  metrics,
                  name,
                  symbol
                };
              })
              .sort((left, right) => {
                const comparison = compareMetricsSortValue({
                  column: metricsSortColumn,
                  left,
                  right
                });

                if (comparison !== 0) {
                  return comparison * metricsDirectionFactor;
                }

                return left._index.localeCompare(right._index, undefined, {
                  numeric: true,
                  sensitivity: 'base'
                });
              })
              .map(({ _index, ...symbolRow }) => symbolRow);

            return {
              subClass,
              symbols
            };
          });

        return {
          assetClass,
          subClasses
        };
      });
  });

  constructor() {
    const themeObserver = new MutationObserver(() => {
      this.portfolioChartColorScheme.set(readChartColorScheme(this.document));
    });

    themeObserver.observe(this.document.documentElement, {
      attributeFilter: ['data-theme'],
      attributes: true
    });

    this.destroyRef.onDestroy(() => {
      themeObserver.disconnect();
    });
  }

  protected isMetricsSortColumn(column: MetricsSortColumn): boolean {
    return this.metricsSortColumn() === column;
  }

  protected sortMetricsBy(column: MetricsSortColumn) {
    if (this.metricsSortColumn() === column) {
      this.metricsSortDirection.set(this.metricsSortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.metricsSortColumn.set(column);
    this.metricsSortDirection.set('asc');
  }

  protected metricsSortIndicator(column: MetricsSortColumn): string {
    if (!this.isMetricsSortColumn(column)) {
      return '';
    }

    return this.metricsSortDirection() === 'asc' ? '▲' : '▼';
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

  protected onChartTimeRangeChange(range: TimeRange): void {
    this.selectedChartTimeRange.set(range);
  }

  protected toggleEntry(entry: ActivityDetailRow) {
    this.expandedEntrySet.update((set) => {
      const next = new Set(set);

      if (next.has(entry)) {
        next.delete(entry);
      } else {
        next.add(entry);
      }

      return next;
    });
  }

  protected isEntryExpanded(entry: ActivityDetailRow): boolean {
    return this.expandedEntrySet().has(entry);
  }

  protected absolute(value: number): number {
    return Math.abs(value);
  }

  private getPerformanceDataByRange(range: TimeRange): PortfolioPerformanceChartItem[] {
    const cutoffDate = getCutoffDate(range);

    if (!cutoffDate) {
      return this.portfolioPerformanceData();
    }

    return this.portfolioPerformanceData().filter((item) => {
      const itemDate = parseChartDate(item.date);

      return itemDate ? itemDate >= cutoffDate : false;
    });
  }
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function readChartColorScheme(document: Document): ColorScheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'DARK' : 'LIGHT';
}

function getCutoffDate(range: TimeRange): Date | null {
  const now = new Date();

  switch (range) {
    case '1M':
      return sub(now, { months: 1 });
    case '3M':
      return sub(now, { months: 3 });
    case '6M':
      return sub(now, { months: 6 });
    case '1J':
      return sub(now, { years: 1 });
    case '3J':
      return sub(now, { years: 3 });
    case '5J':
      return sub(now, { years: 5 });
    case 'YTD':
      return startOfYear(now);
    case 'MAX':
    default:
      return null;
  }
}

function parseChartDate(date: string): Date | null {
  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function calculatePortfolioSummaryMetrics({
  performanceData
}: {
  performanceData: PortfolioPerformanceChartItem[];
}): PortfolioSummaryMetrics {
  if (!performanceData.length) {
    return {
      currentValue: 0,
      gainAmount: 0,
      gainPercentage: 0,
      hasData: false
    };
  }

  const firstPoint = performanceData[0];
  const lastPoint = performanceData[performanceData.length - 1];
  const currentValue = lastPoint.value;
  const valueDelta = lastPoint.value - firstPoint.value;
  const investmentDelta = lastPoint.investment - firstPoint.investment;
  const gainAmount = valueDelta - investmentDelta;
  const gainPercentage = investmentDelta !== 0 ? ((valueDelta - investmentDelta) / investmentDelta) * 100 : 0;

  return {
    currentValue: roundToTwo(currentValue),
    gainAmount: roundToTwo(gainAmount),
    gainPercentage: roundToTwo(gainPercentage),
    hasData: true
  };
}

interface FifoLot {
  lotIndex: number;
  quantity: number;
  unitCost: number;
}

function calculateActivitySymbolMetrics({
  activities,
  holding,
  portfolioTotal
}: {
  activities: Activity[];
  holding: Holding | undefined;
  portfolioTotal: number;
}): {
  metrics: ActivitySymbolMetrics;
  gainAmountByBuyIndex: Map<number, number | null>;
  gainPercentageByBuyIndex: Map<number, number | null>;
  sellDetailsByBuyIndex: Map<number, SellDetailRow[]>;
  soldQuantityByBuyIndex: Map<number, number>;
} {
  const lots: FifoLot[] = [];
  const soldQuantityByBuyIndex = new Map<number, number>();
  const sellDetailsByBuyIndex = new Map<number, SellDetailRow[]>();
  let realizedAmount = 0;
  let realizedCostBasis = 0;
  let buyIndex = 0;

  const sortedActivities = [...activities].sort((left, right) => {
    return getActivityTimestamp(left.date) - getActivityTimestamp(right.date);
  });

  for (const activity of sortedActivities) {
    const type = activity.type.trim().toUpperCase();
    const quantity = Math.max(activity.quantity, 0);

    if (quantity <= 0) {
      continue;
    }

    if (type === 'BUY') {
      const totalCost = quantity * activity.unitPrice + activity.fee;
      lots.push({
        lotIndex: buyIndex++,
        quantity,
        unitCost: totalCost / quantity
      });
      continue;
    }

    if (type !== 'SELL') {
      continue;
    }

    let remainingToMatch = quantity;
    let matchedQuantity = 0;
    let matchedCostBasis = 0;

    while (remainingToMatch > 0 && lots.length > 0) {
      const firstLot = lots[0];
      const matchedFromLot = Math.min(firstLot.quantity, remainingToMatch);
      const feePerUnit = activity.fee / quantity;
      const sellUnitNetPrice = activity.unitPrice - feePerUnit;
      const lotProceeds = matchedFromLot * sellUnitNetPrice;
      const lotCostBasis = matchedFromLot * firstLot.unitCost;
      const lotRealizedAmt = lotProceeds - lotCostBasis;
      const lotRealizedPct =
        lotCostBasis > 0 ? (lotRealizedAmt / lotCostBasis) * 100 : 0;
      const existingDetails = sellDetailsByBuyIndex.get(firstLot.lotIndex) ?? [];

      existingDetails.push({
        date: activity.date,
        realizedAmount: lotRealizedAmt,
        realizedPercentage: lotRealizedPct,
        soldQuantity: matchedFromLot,
        totalValue: matchedFromLot * activity.unitPrice,
        unitPrice: activity.unitPrice
      });
      sellDetailsByBuyIndex.set(firstLot.lotIndex, existingDetails);

      matchedQuantity += matchedFromLot;
      matchedCostBasis += lotCostBasis;
      soldQuantityByBuyIndex.set(
        firstLot.lotIndex,
        (soldQuantityByBuyIndex.get(firstLot.lotIndex) ?? 0) + matchedFromLot
      );
      firstLot.quantity -= matchedFromLot;
      remainingToMatch -= matchedFromLot;

      if (firstLot.quantity <= 0) {
        lots.shift();
      }
    }

    if (matchedQuantity <= 0) {
      continue;
    }

    const matchedRatio = matchedQuantity / quantity;
    const matchedProceeds = (quantity * activity.unitPrice - activity.fee) * matchedRatio;

    realizedAmount += matchedProceeds - matchedCostBasis;
    realizedCostBasis += matchedCostBasis;
  }

  const openQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const entryPriceAmount = lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0);
  const entryPricePerUnit = openQuantity > 0 ? entryPriceAmount / openQuantity : 0;
  const positionQuantity = openQuantity;
  const positionPricePerUnit = holding?.marketPrice ?? entryPricePerUnit;
  const positionPriceAmount = holding?.valueInBaseCurrency ?? openQuantity * positionPricePerUnit;
  const gainAmount = positionPriceAmount - entryPriceAmount;
  const gainPercentage = entryPriceAmount > 0 ? (gainAmount / entryPriceAmount) * 100 : 0;
  const realizedPercentage = realizedCostBasis > 0 ? (realizedAmount / realizedCostBasis) * 100 : 0;
  const allocationPercentage = holding
    ? portfolioTotal > 0
      ? (holding.valueInBaseCurrency / portfolioTotal) * 100
      : normalizeAllocationPercentage(holding.allocationInPercentage)
    : 0;
  const currency = sortedActivities.find((activity) => activity.currency.trim())?.currency.trim() || 'EUR';

  const gainPercentageByBuyIndex = new Map<number, number | null>();
  const gainAmountByBuyIndex = new Map<number, number | null>();

  for (const lot of lots) {
    const lotEntryAmount = lot.quantity * lot.unitCost;
    const lotCurrentAmount = lot.quantity * positionPricePerUnit;
    const lotGainAmt = lotCurrentAmount - lotEntryAmount;
    const lotGainPct = lotEntryAmount > 0 ? (lotGainAmt / lotEntryAmount) * 100 : null;

    gainAmountByBuyIndex.set(lot.lotIndex, lotGainAmt);
    gainPercentageByBuyIndex.set(lot.lotIndex, lotGainPct);
  }

  return {
    gainAmountByBuyIndex,
    gainPercentageByBuyIndex,
    metrics: {
      allocationPercentage,
      currency,
      entryPriceAmount,
      entryPricePerUnit,
      gainAmount,
      gainPercentage,
      positionPriceAmount,
      positionPricePerUnit,
      positionQuantity,
      realizedAmount,
      realizedPercentage
    },
    sellDetailsByBuyIndex,
    soldQuantityByBuyIndex
  };
}

function normalizeAllocationPercentage(value: number): number {
  const nonNegativeValue = Math.max(value, 0);

  if (nonNegativeValue <= 1) {
    return nonNegativeValue * 100;
  }

  return nonNegativeValue;
}

function compareMetricsSortValue({
  column,
  left,
  right
}: {
  column: MetricsSortColumn;
  left: ActivitySymbolGroup;
  right: ActivitySymbolGroup;
}): number {
  if (column === 'name') {
    const leftValue = `${left.symbol} ${left.name}`;
    const rightValue = `${right.symbol} ${right.name}`;

    return leftValue.localeCompare(rightValue, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  if (column === 'entryPrice') {
    return left.metrics.entryPriceAmount - right.metrics.entryPriceAmount;
  }

  if (column === 'positionPrice') {
    return left.metrics.positionPriceAmount - right.metrics.positionPriceAmount;
  }

  if (column === 'gain') {
    return left.metrics.gainPercentage - right.metrics.gainPercentage;
  }

  if (column === 'realized') {
    return left.metrics.realizedPercentage - right.metrics.realizedPercentage;
  }

  return left.metrics.allocationPercentage - right.metrics.allocationPercentage;
}

function getActivityTimestamp(date: Date | null): number {
  if (!date) {
    return Number.POSITIVE_INFINITY;
  }

  return date.getTime();
}
