import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { format, startOfMonth } from 'date-fns';

import { GfInvestmentChartComponent } from '../../shared/investment-chart/public-api';
import type { InvestmentItem, LineChartItem } from '../../shared/investment-chart/src/investment-chart.interfaces';
import type { ColorScheme, GroupBy, TimeRange } from '../../shared/investment-chart/src/investment-chart.types';
import { AuthService } from '../auth/auth.service';
import { LocaleNumberPipe } from '../pipes/locale-number.pipe';
import { RuntimeConfigService } from '../runtime-config';
import { parseAllocationsText } from '../services/allocations';
import {
  normalizeRetireConfig,
  type RetireConfig
} from '../services/retire-config';
import { PortfolioDataStore } from '../services/portfolio-data.store';
import {
  calculateRetirementProjection,
  type RetirementProjectionResult,
  type WithdrawalFrequency
} from './retire-calculator';
import { RetireDeveloperDateService } from './retire-developer-date.service';
import { calculateNextWithdrawalSellPlan } from './retire-withdrawal-plan';
import {
  formatWithdrawalEndMonth,
  formatWithdrawalStartMonth,
  getAccumulationMonths,
  getRetirementBaseDate,
  getWithdrawalEndFromProjectionYears,
  parseStoredWithdrawalStartMonth,
  parseWithdrawalStartMonth
} from './retire-date.helpers';

interface WithdrawalScheduleRow {
  dateLabel: string;
  endingBalance: number;
  isCompleted: boolean;
  isCurrent: boolean;
  isYearSummary: boolean;
  periodIndex: number;
  periodLabel: string;
  trackKey: string;
  withdrawal: number;
}

@Component({
  selector: 'app-retire-page',
  imports: [CommonModule, GfInvestmentChartComponent, LocaleNumberPipe],
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
  private readonly runtimeConfig = this.runtimeConfigService.config;
  private readonly initialRetireConfig = normalizeRetireConfig(this.authService.retireConfig());
  private readonly initialCurrentDate = getRetirementBaseDate();
  protected readonly errorMessage = this.portfolioDataStore.errorMessage;
  protected readonly holdings = this.portfolioDataStore.holdings;
  protected readonly infoMessage = this.portfolioDataStore.infoMessage;
  protected readonly isLoading = this.portfolioDataStore.isLoading;
  protected readonly lastLoadedUrl = this.portfolioDataStore.lastLoadedUrl;
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
  protected readonly withdrawalStarted = signal(this.initialRetireConfig.withdrawalStarted);
  protected readonly currentDate = this.retireDeveloperDateService.currentDate;
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
  protected readonly projection = computed<RetirementProjectionResult>(() => {
    return calculateRetirementProjection(
      {
        accumulationAnnualReturnPercentage: this.accumulationAnnualReturnPercentage(),
        accumulationMonthlyContribution: this.monthlySavingsRate(),
        accumulationMonths: this.accumulationMonths(),
        annualInflationPercentage: this.annualInflationPercentage(),
        capitalAtWithdrawalStart: this.withdrawalStarted() ? this.capitalAtWithdrawalStart() : undefined,
        capitalPreservationPercentage: this.capitalPreservationPercentage(),
        frequency: this.frequency(),
        projectionYears: this.projectionYears(),
        startingCapital: this.effectiveStartingCapital(),
        withdrawalAnnualReturnPercentage: this.withdrawalAnnualReturnPercentage()
      },
      this.projectionStartDate()
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
    return this.frequency() === 'yearly' && this.accumulationMonths() === 0 ? 'year' : 'month';
  });
  protected readonly withdrawalStartLabel = computed(() => {
    return format(this.displayWithdrawalStartDate(), 'MMMM yyyy');
  });
  protected readonly withdrawalDisplayYears = computed(() => {
    return roundToTwo(Math.max(Math.round(this.projectionYears()), 1));
  });
  protected readonly withdrawalEndLabel = computed(() => {
    return formatWithdrawalEndMonth(
      this.effectiveWithdrawalStartDate(),
      this.projectionYears()
    );
  });
  protected readonly projectionEndLabel = computed(() => {
    return this.withdrawalEndLabel();
  });
  protected readonly currentWithdrawalPoint = computed(() => {
    const withdrawalPoints = this.projection().points.filter(({ phase }) => phase === 'withdrawal');

    if (!withdrawalPoints.length) {
      return undefined;
    }

    const currentMonth = startOfMonth(this.currentDate()).getTime();

    if (!this.withdrawalStarted()) {
      return withdrawalPoints[0];
    }

    return (
      withdrawalPoints.find(({ date }) => startOfMonth(new Date(date)).getTime() === currentMonth) ??
      [...withdrawalPoints]
        .reverse()
        .find(({ date }) => startOfMonth(new Date(date)).getTime() <= currentMonth) ??
      withdrawalPoints[0]
    );
  });
  protected readonly currentWithdrawalAmount = computed(() => {
    return this.currentWithdrawalPoint()?.withdrawal ?? this.projection().firstWithdrawal;
  });
  protected readonly currentWithdrawalLabel = computed(() => {
    const currentWithdrawalPoint = this.currentWithdrawalPoint();

    return currentWithdrawalPoint ? format(new Date(currentWithdrawalPoint.date), 'MMMM yyyy') : 'n/a';
  });
  protected readonly nextWithdrawalLabel = this.currentWithdrawalLabel;
  protected readonly nextWithdrawalSellPlan = computed(() => {
    return calculateNextWithdrawalSellPlan({
      allocations: this.allocationState().items,
      holdings: this.holdings(),
      withdrawalAmount: this.currentWithdrawalAmount()
    });
  });
  protected readonly withdrawalScheduleRows = computed(() => {
    const currentMonth = startOfMonth(this.currentDate());
    const currentYear = currentMonth.getFullYear();
    const startDate = this.effectiveWithdrawalStartDate();
    const expectedEndDate = getWithdrawalEndFromProjectionYears(startDate, this.projectionYears());
    const withdrawalPoints = this.projection()
      .points.filter(({ phase }) => phase === 'withdrawal')
      .map(({ date, endingBalance, withdrawal, periodIndex }) => ({
        date: new Date(date),
        endingBalance,
        periodIndex,
        withdrawal
      }))
      .filter(({ date }) => startOfMonth(date) <= startOfMonth(expectedEndDate));

    const groupedByYear = new Map<number, typeof withdrawalPoints>();

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
      if (year < currentYear) {
        const firstPoint = yearPoints[0];
        const lastPoint = yearPoints.at(-1);

        rows.push({
          dateLabel: `${format(firstPoint.date, 'MMMM yyyy')} – ${format(lastPoint?.date ?? firstPoint.date, 'MMMM yyyy')}`,
          endingBalance: roundToTwo(lastPoint?.endingBalance ?? 0),
          isCompleted: true,
          isCurrent: false,
          isYearSummary: true,
          periodIndex: firstPoint.periodIndex + 1,
          periodLabel: `Jahr ${year}`,
          trackKey: `year-${year}`,
          withdrawal: roundToTwo(yearPoints.reduce((sum, point) => sum + point.withdrawal, 0))
        });
        continue;
      }

      for (const point of yearPoints) {
        rows.push({
          dateLabel: format(point.date, 'MMMM yyyy'),
          endingBalance: roundToTwo(point.endingBalance),
          isCompleted: startOfMonth(point.date) < currentMonth,
          isCurrent: startOfMonth(point.date).getTime() === currentMonth.getTime(),
          isYearSummary: false,
          periodIndex: point.periodIndex + 1,
          periodLabel: String(point.periodIndex + 1),
          trackKey: `month-${point.periodIndex + 1}`,
          withdrawal: roundToTwo(point.withdrawal)
        });
      }
    }

    return rows;
  });
  protected readonly hasValidAllocationTarget = computed(() => {
    return (
      this.allocationState().items.length > 0 &&
      this.allocationState().errors.length === 0 &&
      Math.abs(this.allocationState().total - 100) <= 0.001
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

  public ngOnInit(): void {
    if (!this.holdings().length && !this.isLoading()) {
      void this.portfolioDataStore.loadPortfolioData();
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
