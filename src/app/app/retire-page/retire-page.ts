import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import {
  addMonths,
  addYears,
  differenceInCalendarMonths,
  endOfMonth,
  format,
  isValid,
  parse,
  startOfMonth
} from 'date-fns';

import { GfInvestmentChartComponent } from '../../shared/investment-chart/public-api';
import type { InvestmentItem, LineChartItem } from '../../shared/investment-chart/src/investment-chart.interfaces';
import type { ColorScheme, GroupBy, TimeRange } from '../../shared/investment-chart/src/investment-chart.types';
import { FifoOverviewTable } from '../../shared/fifo-overview-table/fifo-overview-table';
import { AuthService } from '../auth/auth.service';
import { LocaleNumberPipe } from '../pipes/locale-number.pipe';
import { RuntimeConfigService } from '../runtime-config';
import { parseAllocationsText, type AllocationItem } from '../services/allocations';
import type { Activity, Holding } from '../services/ghostfolio-api';
import {
  normalizeRetireConfig,
  type RetireConfig
} from '../services/retire-config';
import { PortfolioDataStore } from '../services/portfolio-data.store';
import {
  resolveTaxProfile,
  type TaxProfile
} from '../services/tax-calculator';
import {
  TaxEventsService,
  type TaxEvent
} from '../services/tax-events';
import {
  calculateTaxOverview,
  type TaxOverviewRow
} from '../services/tax-engine';
import {
  calculateRetirementProjection,
  type RetirementProjectionResult,
  type WithdrawalFrequency
} from './retire-calculator';
import {
  buildRetireTaxOverviewInput,
  buildTaxDataBySymbolFromOverviewInput
} from './retire-tax-simulation';
import { RetireDeveloperDateService } from './retire-developer-date.service';
import {
  calculateNextWithdrawalSellPlan,
  type NextWithdrawalSellRow
} from './retire-withdrawal-plan';
import {
  formatWithdrawalEndMonth,
  formatWithdrawalStartMonth,
  getAccumulationMonths,
  getRetirementBaseDate,
  getWithdrawalEndFromProjectionYears,
  parseStoredWithdrawalStartMonth,
  parseWithdrawalStartMonth
} from './retire-date.helpers';

const MONTH_INPUT_FORMAT = 'yyyy-MM';

type WithdrawalSortColumn =
  | 'symbol'
  | 'currentValue'
  | 'targetAllocationPercentage'
  | 'sellAmount'
  | 'remainingAllocationPercentage';
type SortDirection = 'asc' | 'desc';

interface WithdrawalScheduleRow {
  date: Date;
  dateLabel: string;
  endingBalance: number;
  gain: number;
  isCompleted: boolean;
  isCurrent: boolean;
  isYearSummary: boolean;
  netWithdrawal: number;
  periodIndex: number;
  periodLabel: string;
  tax: number;
  trackKey: string;
  withdrawal: number;
}

interface RetireCalculationSnapshot {
  accumulationAnnualReturnPercentage: number;
  accumulationMonths: number;
  activities: Activity[];
  allocationErrors: string[];
  allocationItems: AllocationItem[];
  allocationTotal: number;
  annualInflationPercentage: number;
  capitalAtWithdrawalStart: number;
  capitalPreservationPercentage: number;
  currentDate: Date;
  effectiveWithdrawalStartDate: Date;
  frequency: WithdrawalFrequency;
  holdings: Holding[];
  monthlySavingsRate: number;
  projectionStartDate: Date;
  projectionYears: number;
  sellWholeSharesOnly: boolean;
  startingCapital: number;
  taxEvents: TaxEvent[];
  taxProfile: TaxProfile;
  withdrawalAnnualReturnPercentage: number;
  withdrawalStarted: boolean;
}

@Component({
  selector: 'app-retire-page',
  imports: [CommonModule, GfInvestmentChartComponent, LocaleNumberPipe, FifoOverviewTable],
  templateUrl: './retire-page.html',
  styleUrl: './retire-page.scss',
})
export class RetirePage implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly portfolioDataStore = inject(PortfolioDataStore);
  private readonly retireDeveloperDateService = inject(RetireDeveloperDateService);
  private readonly runtimeConfigService = inject(RuntimeConfigService);
  private readonly taxEventsService = inject(TaxEventsService);
  private readonly runtimeConfig = this.runtimeConfigService.config;
  private readonly initialRetireConfig = normalizeRetireConfig(this.authService.retireConfig());
  private readonly initialCurrentDate = getRetirementBaseDate();
  protected readonly activities = this.portfolioDataStore.activities;
  protected readonly errorMessage = this.portfolioDataStore.errorMessage;
  protected readonly holdings = this.portfolioDataStore.holdings;
  protected readonly infoMessage = this.portfolioDataStore.infoMessage;
  protected readonly isLoading = this.portfolioDataStore.isLoading;
  protected readonly lastLoadedUrl = this.portfolioDataStore.lastLoadedUrl;
  protected readonly taxEvents = signal<TaxEvent[]>([]);
  protected readonly frequency = signal<WithdrawalFrequency>(this.initialRetireConfig.frequency);
  protected readonly accumulationAnnualReturnPercentage = signal(
    this.initialRetireConfig.accumulationAnnualReturnPercentage
  );
  protected readonly withdrawalAnnualReturnPercentage = signal(
    this.initialRetireConfig.withdrawalAnnualReturnPercentage
  );
  protected readonly annualInflationPercentage = signal(
    this.initialRetireConfig.annualInflationPercentage
  );
  protected readonly capitalPreservationPercentage = signal(
    this.initialRetireConfig.capitalPreservationPercentage
  );
  protected readonly monthlySavingsRate = signal(this.initialRetireConfig.monthlySavingsRate);
  protected readonly projectionYears = signal(this.initialRetireConfig.projectionYears);
  protected readonly sellWholeSharesOnly = signal(this.initialRetireConfig.sellWholeSharesOnly);
  protected readonly withdrawalStarted = signal(this.initialRetireConfig.withdrawalStarted);
  protected readonly currentDate = this.retireDeveloperDateService.currentDate;
  protected readonly taxProfile = computed<TaxProfile>(() => {
    return resolveTaxProfile(this.authService.taxConfig ? this.authService.taxConfig() : undefined);
  });
  protected readonly withdrawalStartMonth = signal(
    this.initialRetireConfig.withdrawalStartMonth || formatWithdrawalStartMonth(this.initialCurrentDate)
  );
  protected readonly capitalAtWithdrawalStart = signal(
    this.initialRetireConfig.capitalAtWithdrawalStart || 0
  );
  protected readonly developerMode = computed(() => Boolean(this.runtimeConfig().developerMode));
  protected readonly developerDateValue = computed(() => format(this.currentDate(), 'yyyy-MM-dd'));
  protected readonly portfolioChartColorScheme = signal<ColorScheme>(readChartColorScheme(this.document));
  protected readonly selectedChartTimeRange = signal<TimeRange>('MAX');
  protected readonly selectedFifoMonthInput = signal('');
  protected readonly isCalculating = signal(false);
  private readonly calculationSnapshot = signal<RetireCalculationSnapshot | null>(null);
  protected readonly hasCalculated = computed(() => this.calculationSnapshot() !== null);
  protected readonly isCalculateDisabled = computed(() => {
    if (this.withdrawalStartMonthHasError()) {
      return true;
    }

    const snapshot = this.calculationSnapshot();

    if (!snapshot) {
      return false;
    }

    return this.snapshotsEqual(snapshot, this.buildCalculationSnapshot());
  });
  private retireConfigSaveTimeout: number | null = null;
  protected readonly startCapital = computed(() => {
    return roundToTwo(
      this.holdings().reduce((sum, holding) => {
        return sum + holding.valueInBaseCurrency;
      }, 0)
    );
  });
  protected readonly effectiveStartingCapital = computed(() => {
    return this.startCapital();
  });
  protected readonly currency = computed(() => {
    return this.holdings()[0]?.currency ?? '???';
  });
  protected readonly displayWithdrawalStartDate = computed(() => {
    return this.effectiveWithdrawalStartDate();
  });
  protected readonly effectiveWithdrawalStartDate = computed(() => {
    if (this.withdrawalStarted()) {
      return parseStoredWithdrawalStartMonth(this.withdrawalStartMonth(), this.currentDate());
    }

    return parseWithdrawalStartMonth(this.withdrawalStartMonth(), this.currentDate());
  });
  protected readonly accumulationMonths = computed(() => {
    if (this.withdrawalStarted()) {
      return 0;
    }

    return getAccumulationMonths(this.effectiveWithdrawalStartDate(), this.currentDate());
  });
  protected readonly projectionStartDate = computed(() => {
    return this.withdrawalStarted()
      ? this.effectiveWithdrawalStartDate()
      : this.currentDate();
  });
  protected readonly targetAllocationsText = computed(() => {
    if (this.authService.sessionMode() === 'account') {
      return this.authService.allocationsText();
    }

    return this.runtimeConfig().allocationsText;
  });
  protected readonly allocationState = computed(() => {
    return parseAllocationsText(this.targetAllocationsText());
  });
  protected readonly frozenAllocationState = computed(() => {
    const snapshot = this.currentCalculationSnapshot();

    return {
      errors: snapshot.allocationErrors,
      items: snapshot.allocationItems,
      total: snapshot.allocationTotal
    };
  });
  protected readonly projection = computed<RetirementProjectionResult>(() => {
    const snapshot = this.currentCalculationSnapshot();

    return calculateRetirementProjection(
      {
        activities: snapshot.activities,
        accumulationAnnualReturnPercentage: snapshot.accumulationAnnualReturnPercentage,
        accumulationMonthlyContribution: snapshot.monthlySavingsRate,
        accumulationMonths: snapshot.accumulationMonths,
        annualInflationPercentage: snapshot.annualInflationPercentage,
        capitalAtWithdrawalStart: snapshot.withdrawalStarted ? snapshot.capitalAtWithdrawalStart : undefined,
        capitalPreservationPercentage: snapshot.capitalPreservationPercentage,
        allocations: snapshot.allocationItems,
        frequency: snapshot.frequency,
        holdings: snapshot.holdings,
        projectionYears: snapshot.projectionYears,
        startingCapital: snapshot.startingCapital,
        taxEvents: snapshot.taxEvents,
        taxProfile: snapshot.taxProfile,
        withdrawalAnnualReturnPercentage: snapshot.withdrawalAnnualReturnPercentage
      },
      snapshot.projectionStartDate
    );
  });
  protected readonly withdrawalChartItems = computed<InvestmentItem[]>(() => {
    return this.projection().points.map(({ date, withdrawal }) => ({
      date,
      investment: withdrawal
    }));
  });
  protected readonly balanceChartItems = computed<LineChartItem[]>(() => {
    return this.projection().points.map(({ date, endingBalance }) => ({
      date,
      value: endingBalance
    }));
  });
  protected readonly chartGroupBy = computed<GroupBy>(() => {
    return this.currentCalculationSnapshot().frequency === 'yearly' ? 'year' : 'month';
  });
  protected readonly withdrawalStartLabel = computed(() => {
    return format(this.displayWithdrawalStartDate(), 'MMMM yyyy');
  });
  protected readonly frozenWithdrawalStartLabel = computed(() => {
    return format(this.currentCalculationSnapshot().effectiveWithdrawalStartDate, 'MMMM yyyy');
  });
  protected readonly withdrawalDisplayYears = computed(() => {
    return roundToTwo(Math.max(Math.round(this.currentCalculationSnapshot().projectionYears), 1));
  });
  protected readonly withdrawalEndLabel = computed(() => {
    return formatWithdrawalEndMonth(
      this.effectiveWithdrawalStartDate(),
      this.projectionYears()
    );
  });
  protected readonly projectionEndLabel = computed(() => {
    return formatWithdrawalEndMonth(
      this.currentCalculationSnapshot().effectiveWithdrawalStartDate,
      this.currentCalculationSnapshot().projectionYears
    );
  });
  protected readonly fifoMonthBounds = computed(() => {
    const snapshot = this.currentCalculationSnapshot();
    const projectionEndMonth = startOfMonth(
      getWithdrawalEndFromProjectionYears(
        snapshot.effectiveWithdrawalStartDate,
        snapshot.projectionYears
      )
    );
    const earliestBuyActivityMonth = snapshot.activities
      .filter(({ type }) => type.trim().toUpperCase() === 'BUY')
      .map(({ date }) => {
        if (!date) {
          return null;
        }

        const normalizedDate = startOfMonth(new Date(date));

        return Number.isNaN(normalizedDate.getTime()) ? null : normalizedDate;
      })
      .filter((date): date is Date => date !== null)
      .reduce<Date | null>((earliest, date) => {
        if (!earliest || date < earliest) {
          return date;
        }

        return earliest;
      }, null);
    const minimumMonth = earliestBuyActivityMonth && earliestBuyActivityMonth <= projectionEndMonth
      ? earliestBuyActivityMonth
      : projectionEndMonth;

    return {
      maximumMonth: projectionEndMonth,
      minimumMonth
    };
  });
  protected readonly selectedFifoMonthDate = computed(() => {
    const { maximumMonth, minimumMonth } = this.fifoMonthBounds();
    const parsedMonth = parseMonthInput(
      this.selectedFifoMonthInput(),
      maximumMonth
    );

    return clampDateToMonthRange(parsedMonth, minimumMonth, maximumMonth);
  });
  protected readonly selectedFifoMonthValue = computed(() => {
    return format(this.selectedFifoMonthDate(), MONTH_INPUT_FORMAT);
  });
  protected readonly selectedFifoMonthMinimum = computed(() => {
    return format(this.fifoMonthBounds().minimumMonth, MONTH_INPUT_FORMAT);
  });
  protected readonly selectedFifoMonthMaximum = computed(() => {
    return format(this.fifoMonthBounds().maximumMonth, MONTH_INPUT_FORMAT);
  });
  protected readonly isSelectedFifoMonthAtMinimum = computed(() => {
    return this.selectedFifoMonthDate().getTime() === this.fifoMonthBounds().minimumMonth.getTime();
  });
  protected readonly isSelectedFifoMonthAtMaximum = computed(() => {
    return this.selectedFifoMonthDate().getTime() === this.fifoMonthBounds().maximumMonth.getTime();
  });
  protected readonly selectedFifoMonthLabel = computed(() => {
    return format(this.selectedFifoMonthDate(), 'MMMM yyyy');
  });
  protected readonly fifoWithdrawalPoints = computed<FifoWithdrawalPoint[]>(() => {
    const snapshot = this.currentCalculationSnapshot();
    const expectedEndDate = startOfMonth(
      getWithdrawalEndFromProjectionYears(snapshot.effectiveWithdrawalStartDate, snapshot.projectionYears)
    );

    return this.projection()
      .points.filter(({ phase }) => phase === 'withdrawal')
      .map(({ date, periodIndex, withdrawal }) => ({
        date: startOfMonth(new Date(date)),
        periodIndex,
        withdrawal: roundToTwo(Math.max(withdrawal, 0))
      }))
      .filter(({ date }) => date <= expectedEndDate)
      .sort((left, right) => left.date.getTime() - right.date.getTime());
  });
  protected readonly selectedFifoDuePoint = computed<FifoWithdrawalPoint | undefined>(() => {
    const selectedMonth = this.selectedFifoMonthDate().getTime();

    return [...this.fifoWithdrawalPoints()]
      .reverse()
      .find(({ date }) => date.getTime() <= selectedMonth);
  });
  protected readonly selectedFifoDuePointLabel = computed(() => {
    const duePoint = this.selectedFifoDuePoint();

    if (!duePoint) {
      return 'No withdrawal due yet';
    }

    return format(duePoint.date, 'MMMM yyyy');
  });
  protected readonly selectedFifoTaxOverviewInput = computed(() => {
    const snapshot = this.currentCalculationSnapshot();

    return buildRetireTaxOverviewInput({
      accumulationAnnualReturnPercentage: snapshot.accumulationAnnualReturnPercentage,
      activities: snapshot.activities,
      allocations: snapshot.allocationItems,
      asOfDate: endOfMonth(this.selectedFifoMonthDate()),
      capitalPreservationTarget: this.projection().targetCapital,
      currentDate: snapshot.currentDate,
      holdings: snapshot.holdings,
      monthlySavingsRate: snapshot.monthlySavingsRate,
      sellWholeSharesOnly: snapshot.sellWholeSharesOnly,
      taxEvents: snapshot.taxEvents,
      taxProfile: snapshot.taxProfile,
      withdrawalAnnualReturnPercentage: snapshot.withdrawalAnnualReturnPercentage,
      withdrawalPoints: this.fifoWithdrawalPoints(),
      withdrawalStartDate: snapshot.effectiveWithdrawalStartDate
    });
  });
  protected readonly currentWithdrawalScheduleRow = computed(() => {
    const rows = this.withdrawalScheduleRows();

    if (!rows.length) {
      return undefined;
    }

    const snapshot = this.currentCalculationSnapshot();
    const currentMonth = startOfMonth(snapshot.currentDate).getTime();

    if (!snapshot.withdrawalStarted) {
      return rows[0];
    }

    if (snapshot.frequency === 'yearly') {
      const currentYear = new Date(currentMonth).getFullYear();

      return (
        rows.find((row) => row.date.getFullYear() === currentYear) ??
        [...rows].reverse().find((row) => row.date.getTime() <= currentMonth) ??
        rows[0]
      );
    }

    return (
      rows.find(({ date }) => startOfMonth(date).getTime() === currentMonth) ??
      [...rows]
        .reverse()
        .find(({ date }) => startOfMonth(date).getTime() <= currentMonth) ??
      rows[0]
    );
  });
  protected readonly currentWithdrawalAmount = computed(() => {
    return this.currentWithdrawalScheduleRow()?.withdrawal ?? this.projection().firstWithdrawal;
  });
  protected readonly currentWithdrawalLabel = computed(() => {
    const currentWithdrawalPoint = this.currentWithdrawalScheduleRow();

    if (!currentWithdrawalPoint) {
      return 'n/a';
    }

    return format(currentWithdrawalPoint.date, 'MMMM yyyy');
  });
  protected readonly nextWithdrawalLabel = this.currentWithdrawalLabel;
  protected readonly nextWithdrawalTaxOverviewInput = computed(() => {
    const snapshot = this.currentCalculationSnapshot();

    return buildRetireTaxOverviewInput({
      accumulationAnnualReturnPercentage: snapshot.accumulationAnnualReturnPercentage,
      activities: snapshot.activities,
      allocations: snapshot.allocationItems,
      asOfDate: endOfMonth(this.currentWithdrawalScheduleRow()?.date ?? snapshot.effectiveWithdrawalStartDate),
      currentDate: snapshot.currentDate,
      holdings: snapshot.holdings,
      monthlySavingsRate: snapshot.monthlySavingsRate,
      sellWholeSharesOnly: snapshot.sellWholeSharesOnly,
      taxEvents: snapshot.taxEvents,
      taxProfile: snapshot.taxProfile,
      withdrawalAnnualReturnPercentage: snapshot.withdrawalAnnualReturnPercentage,
      withdrawalPoints: [],
      withdrawalStartDate: snapshot.effectiveWithdrawalStartDate
    });
  });
  protected readonly projectedHoldingsForNextWithdrawal = computed(() => {
    return this.nextWithdrawalTaxOverviewInput().holdings;
  });
  protected readonly projectedSymbolVapBySymbol = computed(() => {
    const snapshot = this.currentCalculationSnapshot();

    return buildTaxDataBySymbolFromOverviewInput(
      this.nextWithdrawalTaxOverviewInput(),
      snapshot.taxProfile,
      endOfMonth(this.currentWithdrawalScheduleRow()?.date ?? snapshot.effectiveWithdrawalStartDate)
    );
  });
  protected readonly nextWithdrawalSellPlan = computed(() => {
    return calculateNextWithdrawalSellPlan({
      allocations: this.currentCalculationSnapshot().allocationItems,
      holdings: this.projectedHoldingsForNextWithdrawal(),
      sellWholeSharesOnly: this.currentCalculationSnapshot().sellWholeSharesOnly,
      symbolTaxDataBySymbol: this.projectedSymbolVapBySymbol(),
      taxProfile: this.currentCalculationSnapshot().taxProfile,
      withdrawalAmount: this.currentWithdrawalAmount()
    });
  });
  protected readonly withdrawalSortColumn = signal<WithdrawalSortColumn>('symbol');
  protected readonly withdrawalSortDirection = signal<SortDirection>('asc');
  protected readonly sortedNextWithdrawalSellPlanRows = computed(() => {
    const directionFactor = this.withdrawalSortDirection() === 'asc' ? 1 : -1;
    const activeSortColumn = this.withdrawalSortColumn();

    return [...this.nextWithdrawalSellPlan().rows].sort((left, right) => {
      const comparison = this.compareWithdrawalRows(left, right, activeSortColumn);

      if (comparison !== 0) {
        return comparison * directionFactor;
      }

      return (
        left.symbol.localeCompare(right.symbol, undefined, {
          numeric: true,
          sensitivity: 'base'
        }) * directionFactor
      );
    });
  });
  protected readonly simulatedFifoOverviewRows = computed<TaxOverviewRow[]>(() => {
    if (!this.hasValidAllocationTarget()) {
      return [];
    }

    const overviewInput = this.selectedFifoTaxOverviewInput();

    return calculateTaxOverview({
      activities: overviewInput.combinedActivities,
      asOfDate: endOfMonth(this.selectedFifoMonthDate()),
      holdings: overviewInput.holdings,
      taxEvents: overviewInput.combinedTaxEvents,
      taxProfile: this.currentCalculationSnapshot().taxProfile
    });
  });
  protected readonly hasVisibleWithdrawalSchedule = computed(() => {
    return this.withdrawalStarted() || this.effectiveWithdrawalStartDate() <= startOfMonth(this.currentDate());
  });
  protected readonly withdrawalScheduleRows = computed(() => {
    const snapshot = this.currentCalculationSnapshot();
    const currentMonth = startOfMonth(snapshot.currentDate);
    const startDate = snapshot.effectiveWithdrawalStartDate;
    const expectedEndDate = getWithdrawalEndFromProjectionYears(startDate, snapshot.projectionYears);
    const withdrawalPoints = this.projection()
      .points.filter(({ phase }) => phase === 'withdrawal')
      .map(({ date, endingBalance, gain, netWithdrawal, periodIndex, tax, withdrawal }) => ({
        date: new Date(date),
        endingBalance,
        gain,
        netWithdrawal,
        periodIndex,
        tax,
        withdrawal
      }))
      .filter(({ date }) => startOfMonth(date) <= startOfMonth(expectedEndDate));

    if (snapshot.frequency === 'yearly') {
      return buildYearlyWithdrawalScheduleRows(withdrawalPoints, startDate, currentMonth);
    }

    return buildMonthlyWithdrawalScheduleRows(withdrawalPoints, currentMonth);
  });
  protected readonly hasValidAllocationTarget = computed(() => {
    const allocation = this.frozenAllocationState();

    return (
      allocation.items.length > 0 &&
      allocation.errors.length === 0 &&
      Math.abs(allocation.total - 100) <= 0.001
    );
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

  protected isWithdrawalSortColumn(column: WithdrawalSortColumn): boolean {
    return this.withdrawalSortColumn() === column;
  }

  protected sortWithdrawalBy(column: WithdrawalSortColumn): void {
    if (this.withdrawalSortColumn() === column) {
      this.withdrawalSortDirection.set(this.withdrawalSortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.withdrawalSortColumn.set(column);
    this.withdrawalSortDirection.set('asc');
  }

  protected withdrawalSortIndicator(column: WithdrawalSortColumn): string {
    if (!this.isWithdrawalSortColumn(column)) {
      return '';
    }

    return this.withdrawalSortDirection() === 'asc' ? '▲' : '▼';
  }

  private compareWithdrawalRows(
    left: NextWithdrawalSellRow,
    right: NextWithdrawalSellRow,
    column: WithdrawalSortColumn
  ): number {
    switch (column) {
      case 'symbol':
        return left.symbol.localeCompare(right.symbol, undefined, {
          numeric: true,
          sensitivity: 'base'
        });
      case 'currentValue':
        return left.currentValue - right.currentValue;
      case 'targetAllocationPercentage':
        return left.targetAllocationPercentage - right.targetAllocationPercentage;
      case 'sellAmount':
        return left.sellAmount - right.sellAmount;
      case 'remainingAllocationPercentage':
        return left.remainingAllocationPercentage - right.remainingAllocationPercentage;
      default:
        return 0;
    }
  }

  protected calculate(): void {
    if (this.isCalculating() || this.isCalculateDisabled()) {
      return;
    }

    this.isCalculating.set(true);

    // Wait two animation frames before running the (potentially long,
    // main-thread-blocking) calculation. The browser is guaranteed to have
    // painted the spinner in between, so it stays visible even while the
    // synchronous calculation freezes the rest of the page.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.calculationSnapshot.set(this.buildCalculationSnapshot());
        this.isCalculating.set(false);
      });
    });
  }

  private snapshotsEqual(
    a: RetireCalculationSnapshot,
    b: RetireCalculationSnapshot
  ): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private buildCalculationSnapshot(): RetireCalculationSnapshot {
    const allocationState = this.allocationState();

    return {
      accumulationAnnualReturnPercentage: this.accumulationAnnualReturnPercentage(),
      accumulationMonths: this.accumulationMonths(),
      activities: this.activities(),
      allocationErrors: allocationState.errors,
      allocationItems: allocationState.items,
      allocationTotal: allocationState.total,
      annualInflationPercentage: this.annualInflationPercentage(),
      capitalAtWithdrawalStart: this.withdrawalStarted() ? this.capitalAtWithdrawalStart() : 0,
      capitalPreservationPercentage: this.capitalPreservationPercentage(),
      currentDate: this.currentDate(),
      effectiveWithdrawalStartDate: this.effectiveWithdrawalStartDate(),
      frequency: this.frequency(),
      holdings: this.holdings(),
      monthlySavingsRate: this.monthlySavingsRate(),
      projectionStartDate: this.projectionStartDate(),
      projectionYears: this.projectionYears(),
      sellWholeSharesOnly: this.sellWholeSharesOnly(),
      startingCapital: this.effectiveStartingCapital(),
      taxEvents: this.taxEvents(),
      taxProfile: this.taxProfile(),
      withdrawalAnnualReturnPercentage: this.withdrawalAnnualReturnPercentage(),
      withdrawalStarted: this.withdrawalStarted()
    };
  }

  private currentCalculationSnapshot(): RetireCalculationSnapshot {
    return this.calculationSnapshot() ?? {
      accumulationAnnualReturnPercentage: 0,
      accumulationMonths: 0,
      activities: [],
      allocationErrors: [],
      allocationItems: [],
      allocationTotal: 0,
      annualInflationPercentage: 0,
      capitalAtWithdrawalStart: 0,
      capitalPreservationPercentage: 0,
      currentDate: this.currentDate(),
      effectiveWithdrawalStartDate: this.effectiveWithdrawalStartDate(),
      frequency: 'monthly',
      holdings: [],
      monthlySavingsRate: 0,
      projectionStartDate: this.projectionStartDate(),
      projectionYears: 1,
      sellWholeSharesOnly: false,
      startingCapital: 0,
      taxEvents: [],
      taxProfile: this.taxProfile(),
      withdrawalAnnualReturnPercentage: 0,
      withdrawalStarted: false
    };
  }

  public ngOnInit(): void {
    void this.loadTaxEvents();

    if (!this.holdings().length && !this.isLoading()) {
      void this.portfolioDataStore.loadPortfolioData();
    }
  }

  protected async loadTaxEvents(): Promise<void> {
    try {
      const taxEvents = await this.taxEventsService.loadTaxEvents();
      this.taxEvents.set(taxEvents);
    } catch (error) {
      this.taxEvents.set([]);
    }
  }

  protected updateFrequency(event: Event) {
    const value = readInputValue(event);

    this.frequency.set(value === 'yearly' ? 'yearly' : 'monthly');
    this.scheduleRetireConfigSave();
  }

  protected updateCapitalPreservationPercentage(event: Event) {
    this.capitalPreservationPercentage.set(clampPercentage(Number(readInputValue(event))));
    this.scheduleRetireConfigSave();
  }

  protected updateSellWholeSharesOnly(event: Event) {
    this.sellWholeSharesOnly.set(readCheckboxValue(event));
    this.scheduleRetireConfigSave();
  }

  protected updateCurrentDate(event: Event) {
    const parsedDate = new Date(readInputValue(event));

    if (Number.isNaN(parsedDate.getTime())) {
      return;
    }

    this.retireDeveloperDateService.setCurrentDate(parsedDate);
  }

  protected updateWithdrawalStartMonth(event: Event) {
    if (this.withdrawalStarted()) {
      return;
    }

    this.withdrawalStartMonth.set(readInputValue(event));
    this.scheduleRetireConfigSave();
  }

  protected updateWithdrawalStarted(event: Event) {
    const isChecked = readCheckboxValue(event);

    if (isChecked && !this.withdrawalStarted()) {
      this.withdrawalStartMonth.set(formatWithdrawalStartMonth(this.currentDate()));
      this.capitalAtWithdrawalStart.set(this.startCapital());
    }

    if (!isChecked && this.withdrawalStarted()) {
      this.withdrawalStartMonth.set(formatWithdrawalStartMonth(this.currentDate()));
      this.capitalAtWithdrawalStart.set(0);
    }

    this.withdrawalStarted.set(isChecked);

    this.scheduleRetireConfigSave();
  }

  protected updateMonthlySavingsRate(event: Event) {
    this.monthlySavingsRate.set(clampNonNegativeNumber(Number(readInputValue(event))));
    this.scheduleRetireConfigSave();
  }

  protected updateAccumulationAnnualReturnPercentage(event: Event) {
    this.accumulationAnnualReturnPercentage.set(
      clampNonNegativeNumber(Number(readInputValue(event)))
    );
    this.scheduleRetireConfigSave();
  }

  protected updateWithdrawalAnnualReturnPercentage(event: Event) {
    this.withdrawalAnnualReturnPercentage.set(
      clampNonNegativeNumber(Number(readInputValue(event)))
    );
    this.scheduleRetireConfigSave();
  }

  protected updateAnnualInflationPercentage(event: Event) {
    this.annualInflationPercentage.set(clampNonNegativeNumber(Number(readInputValue(event))));
    this.scheduleRetireConfigSave();
  }

  protected updateProjectionYears(event: Event) {
    const value = Math.round(Number(readInputValue(event)));

    this.projectionYears.set(Number.isFinite(value) && value > 0 ? value : 1);
    this.scheduleRetireConfigSave();
  }

  protected onChartTimeRangeChange(range: TimeRange): void {
    this.selectedChartTimeRange.set(range);
  }

  protected updateSelectedFifoMonth(event: Event): void {
    this.selectedFifoMonthInput.set(readInputValue(event));
  }

  protected shiftSelectedFifoMonth(delta: number): void {
    this.stepSelectedFifoMonth(delta);
  }

  protected shiftSelectedFifoYear(delta: number): void {
    this.stepSelectedFifoMonth(delta * 12);
  }

  protected jumpSelectedFifoMonthToToday(): void {
    this.setSelectedFifoMonth(startOfMonth(this.currentDate()));
  }

  protected jumpSelectedFifoMonthByOffset(deltaMonths: number): void {
    this.setSelectedFifoMonth(addMonths(startOfMonth(this.currentDate()), deltaMonths));
  }

  protected jumpSelectedFifoMonthToYtd(): void {
    const currentYear = this.currentDate().getFullYear();

    this.setSelectedFifoMonth(new Date(currentYear, 11, 1));
  }

  protected jumpSelectedFifoMonthToWithdrawalStart(): void {
    this.setSelectedFifoMonth(startOfMonth(this.effectiveWithdrawalStartDate()));
  }

  protected jumpSelectedFifoMonthToEndOfWithdrawal(): void {
    this.setSelectedFifoMonth(this.fifoMonthBounds().maximumMonth);
  }

  private scheduleRetireConfigSave(): void {
    if (this.authService.sessionMode() !== 'account') {
      return;
    }

    if (this.withdrawalStartMonthHasError()) {
      return;
    }

    if (this.retireConfigSaveTimeout !== null) {
      window.clearTimeout(this.retireConfigSaveTimeout);
    }

    this.retireConfigSaveTimeout = window.setTimeout(() => {
      this.retireConfigSaveTimeout = null;
      void this.saveRetireConfig();
    }, 300);
  }

  private async saveRetireConfig(): Promise<void> {
    try {
      await this.authService.updateAccountRetireConfig(this.readRetireConfig());
    } catch {
      this.errorMessage.set('Saving retire settings to the account failed.');
    }
  }

  private readRetireConfig(): RetireConfig {
    return {
      accumulationAnnualReturnPercentage: this.accumulationAnnualReturnPercentage(),
      annualInflationPercentage: this.annualInflationPercentage(),
      capitalAtWithdrawalStart: this.withdrawalStarted() ? this.capitalAtWithdrawalStart() : 0,
      capitalPreservationPercentage: this.capitalPreservationPercentage(),
      frequency: this.frequency(),
      monthlySavingsRate: this.monthlySavingsRate(),
      projectionYears: this.projectionYears(),
      sellWholeSharesOnly: this.sellWholeSharesOnly(),
      withdrawalAnnualReturnPercentage: this.withdrawalAnnualReturnPercentage(),
      withdrawalStarted: this.withdrawalStarted(),
      withdrawalStartMonth: this.withdrawalStartMonth()
    };
  }

  protected readonly withdrawalStartMonthHasError = computed(() => {
    if (this.withdrawalStarted()) {
      return false;
    }

    return this.parseWithdrawalStartMonthForValidation() < this.currentDate();
  });

  protected readonly withdrawalStartMonthErrorMessage = computed(() => {
    return this.withdrawalStartMonthHasError()
      ? 'Withdrawal start must be this month or later.'
      : '';
  });

  private parseWithdrawalStartMonthForValidation(): Date {
    return parseStoredWithdrawalStartMonth(this.withdrawalStartMonth(), this.currentDate());
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

  private stepSelectedFifoMonth(deltaMonths: number): void {
    this.setSelectedFifoMonth(addMonths(this.selectedFifoMonthDate(), deltaMonths));
  }

  private setSelectedFifoMonth(date: Date): void {
    const { maximumMonth, minimumMonth } = this.fifoMonthBounds();
    const clampedDate = clampDateToMonthRange(date, minimumMonth, maximumMonth);

    this.selectedFifoMonthInput.set(format(clampedDate, MONTH_INPUT_FORMAT));
  }
}

interface WithdrawalPoint {
  date: Date;
  endingBalance: number;
  gain: number;
  netWithdrawal: number;
  periodIndex: number;
  tax: number;
  withdrawal: number;
}

interface FifoWithdrawalPoint {
  date: Date;
  periodIndex: number;
  withdrawal: number;
}

function buildYearlyWithdrawalScheduleRows(
  withdrawalPoints: WithdrawalPoint[],
  startDate: Date,
  currentMonth: Date
): WithdrawalScheduleRow[] {
  const groupedByPeriod = new Map<number, WithdrawalPoint[]>();

  for (const point of withdrawalPoints) {
    const periodIndex = Math.max(
      Math.floor(differenceInCalendarMonths(startOfMonth(point.date), startOfMonth(startDate)) / 12),
      0
    );
    const periodPoints = groupedByPeriod.get(periodIndex);

    if (periodPoints) {
      periodPoints.push(point);
    } else {
      groupedByPeriod.set(periodIndex, [point]);
    }
  }

  const rows: WithdrawalScheduleRow[] = [];

  for (const [periodIndex, periodPoints] of groupedByPeriod) {
    const periodStartDate = addYears(startOfMonth(startDate), periodIndex);
    const nextPeriodStart = addYears(periodStartDate, 1);
    const summaryRow = createWithdrawalYearSummaryRow(
      periodIndex,
      periodStartDate,
      nextPeriodStart,
      periodPoints,
      currentMonth
    );

    rows.push(summaryRow);
  }

  return rows;
}

function buildMonthlyWithdrawalScheduleRows(
  withdrawalPoints: WithdrawalPoint[],
  currentMonth: Date
): WithdrawalScheduleRow[] {
  const groupedByYear = new Map<number, WithdrawalPoint[]>();

  for (const point of withdrawalPoints) {
    const year = point.date.getFullYear();
    const yearPoints = groupedByYear.get(year);

    if (yearPoints) {
      yearPoints.push(point);
    } else {
      groupedByYear.set(year, [point]);
    }
  }

  const rows: WithdrawalScheduleRow[] = [];

  for (const [year, yearPoints] of groupedByYear) {
    if (year < currentMonth.getFullYear()) {
      rows.push(createWithdrawalMonthSummaryRow(year, yearPoints, currentMonth));
      continue;
    }

    for (const point of yearPoints) {
      rows.push({
        date: point.date,
        dateLabel: format(point.date, 'MMMM yyyy'),
        endingBalance: roundToTwo(point.endingBalance),
        gain: roundToTwo(point.gain ?? 0),
        isCompleted: startOfMonth(point.date) < currentMonth,
        isCurrent: startOfMonth(point.date).getTime() === currentMonth.getTime(),
        isYearSummary: false,
        netWithdrawal: roundToTwo(point.netWithdrawal ?? Math.max(point.withdrawal, 0)),
        periodIndex: point.periodIndex + 1,
        periodLabel: String(point.periodIndex + 1),
        tax: roundToTwo(point.tax ?? 0),
        trackKey: `month-${point.periodIndex + 1}`,
        withdrawal: roundToTwo(point.withdrawal)
      });
    }
  }

  return rows;
}

function createWithdrawalYearSummaryRow(
  periodIndex: number,
  periodStartDate: Date,
  nextPeriodStart: Date,
  periodPoints: WithdrawalPoint[],
  currentMonth: Date
): WithdrawalScheduleRow {
  const lastPoint = periodPoints.at(-1);
  const periodWithdrawalAmount = periodPoints.reduce((sum, point) => sum + point.withdrawal, 0);
  const periodGain = periodPoints.reduce((sum, point) => sum + (point.gain ?? 0), 0);
  const periodTax = periodPoints.reduce((sum, point) => sum + (point.tax ?? 0), 0);
  const periodNetWithdrawal = periodPoints.reduce((sum, point) => {
    return sum + (point.netWithdrawal ?? Math.max(point.withdrawal - (point.tax ?? 0), 0));
  }, 0);
  const start = startOfMonth(periodStartDate);
  const end = startOfMonth(nextPeriodStart);
  const current = startOfMonth(currentMonth);

  return {
    date: start,
    dateLabel: format(start, 'MMMM yyyy'),
    endingBalance: roundToTwo(lastPoint?.endingBalance ?? 0),
    gain: roundToTwo(periodGain),
    isCompleted: current >= end,
    isCurrent: current >= start && current < end,
    isYearSummary: true,
    netWithdrawal: roundToTwo(periodNetWithdrawal),
    periodIndex: periodIndex + 1,
    periodLabel: `Jahr ${start.getFullYear()}`,
    tax: roundToTwo(periodTax),
    trackKey: `year-${periodIndex + 1}`,
    withdrawal: roundToTwo(periodWithdrawalAmount)
  };
}

function createWithdrawalMonthSummaryRow(
  year: number,
  yearPoints: WithdrawalPoint[],
  currentMonth: Date
): WithdrawalScheduleRow {
  const firstPoint = yearPoints[0];
  const lastPoint = yearPoints.at(-1);
  const periodWithdrawalAmount = yearPoints.reduce((sum, point) => sum + point.withdrawal, 0);
  const yearGain = yearPoints.reduce((sum, point) => sum + (point.gain ?? 0), 0);
  const yearTax = yearPoints.reduce((sum, point) => sum + (point.tax ?? 0), 0);
  const yearNetWithdrawal = yearPoints.reduce((sum, point) => {
    return sum + (point.netWithdrawal ?? Math.max(point.withdrawal - (point.tax ?? 0), 0));
  }, 0);

  return {
    date: firstPoint.date,
    dateLabel: `${format(firstPoint.date, 'MMMM yyyy')} – ${format(lastPoint?.date ?? firstPoint.date, 'MMMM yyyy')}`,
    endingBalance: roundToTwo(lastPoint?.endingBalance ?? 0),
    gain: roundToTwo(yearGain),
    isCompleted: year < currentMonth.getFullYear(),
    isCurrent: year === currentMonth.getFullYear(),
    isYearSummary: true,
    netWithdrawal: roundToTwo(yearNetWithdrawal),
    periodIndex: firstPoint.periodIndex + 1,
    periodLabel: `Jahr ${year}`,
    tax: roundToTwo(yearTax),
    trackKey: `year-${year}`,
    withdrawal: roundToTwo(periodWithdrawalAmount)
  };
}

function readChartColorScheme(document: Document): ColorScheme {
  return document.documentElement.dataset["theme"] === 'dark' ? 'DARK' : 'LIGHT';
}

function readInputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function readCheckboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 100);
}

function clampNonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseMonthInput(value: string, fallbackDate: Date): Date {
  const parsedDate = parse(value, MONTH_INPUT_FORMAT, fallbackDate);

  if (!isValid(parsedDate)) {
    return startOfMonth(fallbackDate);
  }

  return startOfMonth(parsedDate);
}

function clampDateToMonthRange(date: Date, minimumMonth: Date, maximumMonth: Date): Date {
  if (date < minimumMonth) {
    return minimumMonth;
  }

  if (date > maximumMonth) {
    return maximumMonth;
  }

  return date;
}
