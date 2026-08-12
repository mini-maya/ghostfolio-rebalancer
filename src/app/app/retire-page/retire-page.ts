import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { format } from 'date-fns';

import { GfInvestmentChartComponent } from '../../shared/investment-chart/public-api';
import type { InvestmentItem, LineChartItem } from '../../shared/investment-chart/src/investment-chart.interfaces';
import type { ColorScheme, GroupBy, TimeRange } from '../../shared/investment-chart/src/investment-chart.types';
import { AuthService } from '../auth/auth.service';
import { LocaleNumberPipe } from '../pipes/locale-number.pipe';
import { RuntimeConfigService } from '../runtime-config';
import { parseAllocationsText } from '../services/allocations';
import { PortfolioDataStore } from '../services/portfolio-data.store';
import {
  calculateRetirementProjection,
  type RetirementProjectionResult,
  type WithdrawalFrequency
} from './retire-calculator';
import { calculateNextWithdrawalSellPlan } from './retire-withdrawal-plan';
import {
  formatWithdrawalStartMonth,
  getAccumulationMonths,
  getLeadTimeYears,
  getRetirementBaseDate,
  getWithdrawalStartFromLeadTimeYears,
  parseWithdrawalStartMonth
} from './retire-date.helpers';

@Component({
  selector: 'app-retire-page',
  imports: [CommonModule, GfInvestmentChartComponent, LocaleNumberPipe],
  templateUrl: './retire-page.html',
  styleUrl: './retire-page.scss',
})
export class RetirePage implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly projectionBaseDate = getRetirementBaseDate();
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly portfolioDataStore = inject(PortfolioDataStore);
  private readonly runtimeConfigService = inject(RuntimeConfigService);
  private readonly runtimeConfig = this.runtimeConfigService.config;
  protected readonly errorMessage = this.portfolioDataStore.errorMessage;
  protected readonly holdings = this.portfolioDataStore.holdings;
  protected readonly infoMessage = this.portfolioDataStore.infoMessage;
  protected readonly isLoading = this.portfolioDataStore.isLoading;
  protected readonly lastLoadedUrl = this.portfolioDataStore.lastLoadedUrl;
  protected readonly frequency = signal<WithdrawalFrequency>('monthly');
  protected readonly accumulationAnnualReturnPercentage = signal(6);
  protected readonly withdrawalAnnualReturnPercentage = signal(6);
  protected readonly annualInflationPercentage = signal(2);
  protected readonly capitalPreservationPercentage = signal(10);
  protected readonly monthlySavingsRate = signal(1750);
  protected readonly projectionYears = signal(25);
  protected readonly withdrawalStartMonth = signal(
    formatWithdrawalStartMonth(getWithdrawalStartFromLeadTimeYears(20, this.projectionBaseDate))
  );
  protected readonly portfolioChartColorScheme = signal<ColorScheme>(readChartColorScheme(this.document));
  protected readonly selectedChartTimeRange = signal<TimeRange>('MAX');
  protected readonly startCapital = computed(() => {
    return roundToTwo(
      this.holdings().reduce((sum, holding) => {
        return sum + holding.valueInBaseCurrency;
      }, 0)
    );
  });
  protected readonly currency = computed(() => {
    return this.holdings()[0]?.currency ?? 'EUR';
  });
  protected readonly withdrawalStartDate = computed(() => {
    return parseWithdrawalStartMonth(this.withdrawalStartMonth(), this.projectionBaseDate);
  });
  protected readonly accumulationMonths = computed(() => {
    return getAccumulationMonths(this.withdrawalStartDate(), this.projectionBaseDate);
  });
  protected readonly leadTimeYears = computed(() => {
    return getLeadTimeYears(this.accumulationMonths());
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
    return calculateRetirementProjection({
      accumulationAnnualReturnPercentage: this.accumulationAnnualReturnPercentage(),
      accumulationMonthlyContribution: this.monthlySavingsRate(),
      accumulationMonths: this.accumulationMonths(),
      annualInflationPercentage: this.annualInflationPercentage(),
      capitalPreservationPercentage: this.capitalPreservationPercentage(),
      frequency: this.frequency(),
      projectionYears: this.projectionYears(),
      startingCapital: this.startCapital(),
      withdrawalAnnualReturnPercentage: this.withdrawalAnnualReturnPercentage()
    });
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
  protected readonly targetCapitalGap = computed(() => {
    return roundToTwo(this.projection().endingCapital - this.projection().targetCapital);
  });
  protected readonly withdrawalStartLabel = computed(() => {
    return format(this.withdrawalStartDate(), 'MMM yyyy');
  });
  protected readonly projectionEndLabel = computed(() => {
    const lastPoint = this.projection().points.at(-1);

    return lastPoint ? format(new Date(lastPoint.date), 'MMM yyyy') : 'n/a';
  });
  protected readonly nextWithdrawalSellPlan = computed(() => {
    return calculateNextWithdrawalSellPlan({
      allocations: this.allocationState().items,
      holdings: this.holdings(),
      withdrawalAmount: this.projection().firstWithdrawal
    });
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
  }

  protected updateCapitalPreservationPercentage(event: Event) {
    this.capitalPreservationPercentage.set(clampPercentage(Number(readInputValue(event))));
  }

  protected updateLeadTimeYears(event: Event) {
    const value = clampNonNegativeNumber(Number(readInputValue(event)));

    this.withdrawalStartMonth.set(
      formatWithdrawalStartMonth(
        getWithdrawalStartFromLeadTimeYears(value, this.projectionBaseDate)
      )
    );
  }

  protected updateWithdrawalStartMonth(event: Event) {
    this.withdrawalStartMonth.set(
      formatWithdrawalStartMonth(
        parseWithdrawalStartMonth(readInputValue(event), this.projectionBaseDate)
      )
    );
  }

  protected updateMonthlySavingsRate(event: Event) {
    this.monthlySavingsRate.set(clampNonNegativeNumber(Number(readInputValue(event))));
  }

  protected updateAccumulationAnnualReturnPercentage(event: Event) {
    this.accumulationAnnualReturnPercentage.set(
      clampNonNegativeNumber(Number(readInputValue(event)))
    );
  }

  protected updateWithdrawalAnnualReturnPercentage(event: Event) {
    this.withdrawalAnnualReturnPercentage.set(
      clampNonNegativeNumber(Number(readInputValue(event)))
    );
  }

  protected updateAnnualInflationPercentage(event: Event) {
    this.annualInflationPercentage.set(clampNonNegativeNumber(Number(readInputValue(event))));
  }

  protected updateProjectionYears(event: Event) {
    const value = Math.round(Number(readInputValue(event)));

    this.projectionYears.set(Number.isFinite(value) && value > 0 ? value : 1);
  }

  protected onChartTimeRangeChange(range: TimeRange): void {
    this.selectedChartTimeRange.set(range);
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
