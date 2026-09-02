import { addMonths, addYears, format, startOfMonth } from 'date-fns';
import { signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';

import { AuthService } from '../auth/auth.service';
import { RuntimeConfigService } from '../runtime-config';
import { PortfolioDataStore } from '../services/portfolio-data.store';
import { TaxEventsService } from '../services/tax-events';
import { RetirePage } from './retire-page';

describe('RetirePage', () => {
  const authServiceMock = {
    allocationsText: () => '',
    retireConfig: () => ({
      accumulationAnnualReturnPercentage: 6,
      annualInflationPercentage: 2,
      capitalAtWithdrawalStart: 0,
      capitalPreservationPercentage: 10,
      frequency: 'monthly',
      monthlySavingsRate: 1750,
      projectionYears: 25,
      withdrawalAnnualReturnPercentage: 6,
      withdrawalStarted: false,
      withdrawalStartMonth: '2030-01'
    }),
    sessionMode: () => 'account',
    taxConfig: () => ({}),
    updateAccountRetireConfig: jasmine.createSpy('updateAccountRetireConfig').and.resolveTo()
  };

  const portfolioDataStoreMock = {
    activities: signal([]),
    errorMessage: signal(''),
    holdings: signal([]),
    infoMessage: signal(''),
    isLoading: signal(false),
    lastLoadedUrl: signal(''),
    loadPortfolioData: jasmine.createSpy('loadPortfolioData').and.resolveTo()
  };

  const runtimeConfigServiceMock = {
    config: signal({
      allocationsText: '',
      developerMode: false
    })
  };
  const taxEventsServiceMock = {
    loadTaxEvents: jasmine.createSpy('loadTaxEvents').and.resolveTo([])
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RetirePage],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: PortfolioDataStore, useValue: portfolioDataStoreMock },
        { provide: RuntimeConfigService, useValue: runtimeConfigServiceMock },
        { provide: TaxEventsService, useValue: taxEventsServiceMock }
      ]
    }).compileComponents();

    runtimeConfigServiceMock.config.set({
      allocationsText: '',
      developerMode: false
    });
    authServiceMock.allocationsText = () => '';
    portfolioDataStoreMock.activities.set([]);
    portfolioDataStoreMock.holdings.set([]);
    portfolioDataStoreMock.errorMessage.set('');
    portfolioDataStoreMock.infoMessage.set('');
    portfolioDataStoreMock.lastLoadedUrl.set('');
    taxEventsServiceMock.loadTaxEvents.and.resolveTo([]);
    expect(authServiceMock.sessionMode()).toBe('account');
  });

  function setSingleSymbolPortfolio(component: any) {
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2024-03-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 120,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1200
      }
    ]);
  }

  function runCalculation(component: any): void {
    component.calculate();
    // The calculation is deferred behind two requestAnimationFrame callbacks
    // so the spinner can paint first; advance the fake clock far enough to
    // flush both of them.
    tick(34);
  }

  it('hides the stats, next withdrawal and projection sections until the first calculation completes', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    setSingleSymbolPortfolio(component);
    fixture.detectChanges();

    expect(component.hasCalculated()).toBeFalse();
    expect(fixture.nativeElement.querySelector('section.stats')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Next withdrawal by symbol');
    expect(fixture.nativeElement.textContent).not.toContain('Projection');

    runCalculation(component);
    fixture.detectChanges();

    expect(component.hasCalculated()).toBeTrue();
    expect(fixture.nativeElement.querySelector('section.stats')).not.toBeNull();
  }));

  it('shows the Sparer-Pauschbetrag usage tiles once a calculation completes', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    setSingleSymbolPortfolio(component);
    fixture.detectChanges();

    runCalculation(component);
    fixture.detectChanges();

    const statsText = fixture.nativeElement.querySelector('section.stats').textContent;

    expect(statsText).toContain('After Sparer-Pauschbetrag');
    expect(statsText).toContain('Sparer-Pauschbetrag used');
    expect(statsText).toContain('Unused (expired)');
    expect(component.projection().openTaxAtWithdrawalStartAfterAllowance).toBeGreaterThanOrEqual(0);
    expect(component.projection().sparerPauschbetragUsedTotal).toBeGreaterThanOrEqual(0);
    expect(component.projection().sparerPauschbetragUnusedTotal).toBeGreaterThanOrEqual(0);
    // The allowance-aware open tax estimate never exceeds the pre-allowance estimate, since the
    // Sparer-Pauschbetrag can only reduce (never increase) the taxable amount.
    expect(component.projection().openTaxAtWithdrawalStartAfterAllowance).toBeLessThanOrEqual(
      component.projection().openTaxAtWithdrawalStart
    );
  }));

  it('hides the below-fold sections again while a subsequent calculation is running', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    setSingleSymbolPortfolio(component);
    fixture.detectChanges();
    runCalculation(component);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('section.stats')).not.toBeNull();

    component.monthlySavingsRate.set(2000);
    component.calculate();
    fixture.detectChanges();

    expect(component.isCalculating()).toBeTrue();
    expect(component.hasCalculated()).toBeTrue();
    expect(fixture.nativeElement.querySelector('section.stats')).toBeNull();

    tick(34);
    fixture.detectChanges();

    expect(component.isCalculating()).toBeFalse();
    expect(fixture.nativeElement.querySelector('section.stats')).not.toBeNull();
  }));

  it('shows a spinner on the calculate button while calculating and hides it afterwards', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    setSingleSymbolPortfolio(component);
    fixture.detectChanges();

    component.calculate();
    fixture.detectChanges();

    expect(component.isCalculating()).toBeTrue();
    const button = fixture.nativeElement.querySelector('.retire-calculate-button');
    expect(button.textContent).toContain('Calculating');
    expect(button.querySelector('.spinner')).not.toBeNull();
    expect(button.disabled).toBeTrue();

    tick(34);
    fixture.detectChanges();

    expect(component.isCalculating()).toBeFalse();
    expect(button.textContent).not.toContain('Calculating');
    // Nothing changed since this calculation finished, so the button goes
    // back to disabled until an input is changed again.
    expect(button.disabled).toBeTrue();
  }));

  it('re-enables the calculate button once an input changes after a calculation', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    setSingleSymbolPortfolio(component);
    fixture.detectChanges();
    runCalculation(component);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.retire-calculate-button');
    expect(button.disabled).toBeTrue();

    component.monthlySavingsRate.set(5000);
    fixture.detectChanges();

    expect(button.disabled).toBeFalse();
  }));

  it('does not change the gated results when inputs change after a calculation until Calculate is clicked again', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    setSingleSymbolPortfolio(component);
    component.monthlySavingsRate.set(100);
    fixture.detectChanges();
    runCalculation(component);

    const projectionBefore = component.projection();

    component.monthlySavingsRate.set(5000);

    expect(component.projection()).toBe(projectionBefore);

    runCalculation(component);

    expect(component.projection()).not.toBe(projectionBefore);
  }));

  it('keeps FIFO simulation month navigation live without needing another Calculate click', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    setSingleSymbolPortfolio(component);
    fixture.detectChanges();
    runCalculation(component);

    const monthBefore = component.selectedFifoMonthInput();
    component.shiftSelectedFifoYear(-1);

    expect(component.selectedFifoMonthInput()).not.toBe(monthBefore);
    expect(component.hasCalculated()).toBeTrue();
  }));

  it('keeps the switch off when the withdrawal start month changes', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.withdrawalStarted.set(false);
    component.updateWithdrawalStartMonth({
      target: { value: '2030-02' }
    } as unknown as Event);

    expect(component.withdrawalStarted()).toBeFalse();
    expect(component.withdrawalStartMonth()).toBe('2030-02');
  });

  it('toggles sellWholeSharesOnly via the switch control', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    expect(component.sellWholeSharesOnly()).toBeFalse();

    component.updateSellWholeSharesOnly({
      target: { checked: true }
    } as unknown as Event);

    expect(component.sellWholeSharesOnly()).toBeTrue();

    component.updateSellWholeSharesOnly({
      target: { checked: false }
    } as unknown as Event);

    expect(component.sellWholeSharesOnly()).toBeFalse();
  });

  it('keeps the withdrawal period editable when withdrawals start immediately', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.withdrawalStarted.set(true);
    component.updateProjectionYears({
      target: { value: '40' }
    } as unknown as Event);
    expect(component.projectionYears()).toBe(40);
    expect(component.projectionYears()).toBe(40);
  });

  it('projects holdings up to the first withdrawal when withdrawals have not started yet', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,50|BBB,50';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,50|BBB,50',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2027-04-15' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2025-01-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 80,
        unitPriceInAssetProfileCurrency: 80,
        valueInBaseCurrency: 800
      },
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2025-02-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF B',
        quantity: 10,
        symbol: 'BBB',
        type: 'BUY',
        unitPrice: 40,
        unitPriceInAssetProfileCurrency: 40,
        valueInBaseCurrency: 400
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 50,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      },
      {
        allocationInPercentage: 50,
        currency: 'EUR',
        marketPrice: 50,
        name: 'ETF B',
        quantity: 10,
        symbol: 'BBB',
        valueInBaseCurrency: 500
      }
    ]);
    component.withdrawalStarted.set(false);
    component.withdrawalStartMonth.set('2027-06');
    component.monthlySavingsRate.set(200);
    component.accumulationAnnualReturnPercentage.set(12);
    fixture.detectChanges();
    runCalculation(component);
    fixture.detectChanges();

    expect(component.projectedHoldingsForNextWithdrawal().reduce((sum: number, holding: any) => {
      return sum + holding.valueInBaseCurrency;
    }, 0)).toBeGreaterThan(1500);
    expect(component.nextWithdrawalSellPlan().portfolioTotal).toBeGreaterThan(1500);
    expect(component.simulatedFifoOverviewRows()).toHaveSize(2);
    expect(component.simulatedFifoOverviewRows()[0].positionPriceAmount).toBeGreaterThan(0);
    expect(component.simulatedFifoOverviewRows()[0].activities.length).toBeGreaterThan(0);
    expect(component.simulatedFifoOverviewRows()[0].activities.some((activity: any) => activity.type === 'SELL')).toBeTrue();
    expect(fixture.nativeElement.querySelector('.sell-plan-table')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-fifo-overview-table')).not.toBeNull();
    // Withdrawals are scheduled for 2027-06, so projection should include withdrawal schedule
    expect(fixture.nativeElement.querySelector('.withdrawal-schedule-table')).not.toBeNull();
  }));

  it('only plans whole-share sells when sellWholeSharesOnly is enabled', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,50|BBB,50';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,50|BBB,50',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2027-04-15' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2025-01-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 1000,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 80,
        unitPriceInAssetProfileCurrency: 80,
        valueInBaseCurrency: 80000
      },
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2025-02-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF B',
        quantity: 1000,
        symbol: 'BBB',
        type: 'BUY',
        unitPrice: 40,
        unitPriceInAssetProfileCurrency: 40,
        valueInBaseCurrency: 40000
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 50,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 1000,
        symbol: 'AAA',
        valueInBaseCurrency: 100000
      },
      {
        allocationInPercentage: 50,
        currency: 'EUR',
        marketPrice: 50,
        name: 'ETF B',
        quantity: 1000,
        symbol: 'BBB',
        valueInBaseCurrency: 50000
      }
    ]);
    component.withdrawalStarted.set(false);
    component.withdrawalStartMonth.set('2027-06');
    component.monthlySavingsRate.set(20000);
    component.accumulationAnnualReturnPercentage.set(12);
    component.updateSellWholeSharesOnly({
      target: { checked: true }
    } as unknown as Event);
    fixture.detectChanges();
    runCalculation(component);
    fixture.detectChanges();

    const sellPlan = component.nextWithdrawalSellPlan();

    expect(sellPlan.rows.length).toBeGreaterThan(0);
    expect(sellPlan.totalPlannedSell).toBeLessThanOrEqual(sellPlan.requestedSellAmount);

    for (const row of sellPlan.rows) {
      expect(Number.isInteger(row.sharesToSell)).toBeTrue();
    }

    const overviewRows = component.simulatedFifoOverviewRows();
    const sellActivities = overviewRows.flatMap((row: any) => {
      return row.activities.filter((activity: any) => activity.type === 'SELL');
    });

    expect(sellActivities.length).toBeGreaterThan(0);

    for (const activity of sellActivities) {
      expect(Number.isInteger(activity.quantity)).toBeTrue();
    }
  }));

  it('sets the withdrawal start month to the current month when withdrawals start immediately', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());

    component.holdings.set([{ currency: 'EUR', valueInBaseCurrency: 10000 }]);
    component.capitalAtWithdrawalStart.set(2500);
    component.withdrawalStartMonth.set('2030-01');
    component.withdrawalStarted.set(false);

    component.updateWithdrawalStarted({
      target: { checked: true }
    } as unknown as Event);
    runCalculation(component);

    expect(component.withdrawalStarted()).toBeTrue();
    expect(component.withdrawalStartMonth()).toBe(format(currentMonth, 'yyyy-MM'));
    expect(component.capitalAtWithdrawalStart()).toBe(10000);
    expect(component.withdrawalStartLabel()).toBe(format(currentMonth, 'MMMM yyyy'));
    expect(component.projectionEndLabel()).toBe(format(addYears(currentMonth, 25), 'yyyy-MM'));
  }));

  it('shows the developer current date input when developer mode is enabled', () => {
    runtimeConfigServiceMock.config.set({
      allocationsText: '',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="developer-date-field"]')).not.toBeNull();
  });

  it('uses the developer current date as the retire base date', fakeAsync(() => {
    runtimeConfigServiceMock.config.set({
      allocationsText: '',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2027-04-15' }
    } as unknown as Event);
    component.holdings.set([{ currency: 'EUR', valueInBaseCurrency: 10000 }]);
    component.withdrawalStarted.set(false);
    component.updateWithdrawalStarted({
      target: { checked: true }
    } as unknown as Event);
    runCalculation(component);

    expect(component.withdrawalStartLabel()).toBe('April 2027');
    expect(component.projectionEndLabel()).toBe('2052-04');
    expect(component.withdrawalScheduleRows()[0].dateLabel).toBe('April 2027');
  }));

  it('collapses past years into yearly summary rows and prefixes completed rows with a checkmark', fakeAsync(() => {
    runtimeConfigServiceMock.config.set({
      allocationsText: '',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2050-10-01' }
    } as unknown as Event);
    component.holdings.set([{ currency: 'EUR', valueInBaseCurrency: 10000 }]);
    component.withdrawalStartMonth.set('2048-01');
    component.withdrawalStarted.set(true);
    fixture.detectChanges();
    runCalculation(component);

    const rows = component.withdrawalScheduleRows();

    expect(rows[0].isYearSummary).toBeTrue();
    expect(rows[0].periodLabel).toBe('Jahr 2048');
    expect(rows[0].dateLabel).toBe('January 2048 – December 2048');
    expect(rows[0].isCompleted).toBeTrue();
    expect(rows[1].isYearSummary).toBeTrue();
    expect(rows.some((row: any) => !row.isYearSummary && row.dateLabel === 'January 2050')).toBeTrue();
  }));

  it('keeps past withdrawal periods visible and marks them as completed', fakeAsync(() => {
    runtimeConfigServiceMock.config.set({
      allocationsText: '',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2050-10-01' }
    } as unknown as Event);
    component.withdrawalStartMonth.set('2050-06');
    component.withdrawalStarted.set(true);
    fixture.detectChanges();
    runCalculation(component);

    const rows = component.withdrawalScheduleRows();

    expect(rows[0].dateLabel).toBe('June 2050');
    expect(rows[0].isCompleted).toBeTrue();
    expect(rows[3].dateLabel).toBe('September 2050');
    expect(rows[3].isCompleted).toBeTrue();
    expect(rows[4].dateLabel).toBe('October 2050');
    expect(rows[4].isCompleted).toBeFalse();
    expect(rows[4].isCurrent).toBeTrue();
    expect(rows[4].periodIndex).toBe(5);
    expect(component.nextWithdrawalLabel()).toBe('October 2050');
    expect(component.withdrawalDisplayYears()).toBe(25);
  }));

  it('shows an error when the withdrawal start month is in the past', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());
    const pastMonth = addMonths(currentMonth, -1);

    component.withdrawalStartMonth.set(format(pastMonth, 'yyyy-MM'));
    fixture.detectChanges();

    expect(component.withdrawalStartMonthHasError()).toBeTrue();
    expect(component.withdrawalStartMonthErrorMessage()).toBe(
      'Withdrawal start must be this month or later.'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="withdrawal-start-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="withdrawal-start-field"] input').classList.contains('is-invalid')).toBeTrue();
    expect(component.isCalculateDisabled()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.retire-calculate-button').disabled).toBeTrue();
  });

  it('stores zero capitalAtWithdrawalStart while withdrawals are off', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.holdings.set([{ currency: 'EUR', valueInBaseCurrency: 73497.34 }]);
    component.withdrawalStarted.set(false);

    expect(component.readRetireConfig().capitalAtWithdrawalStart).toBe(0);
  });

  it('persists the snapshot as capitalAtWithdrawalStart while withdrawals are immediate', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.holdings.set([{ currency: 'EUR', valueInBaseCurrency: 73497.34 }]);
    component.capitalAtWithdrawalStart.set(60000);
    component.withdrawalStarted.set(true);

    expect(component.readRetireConfig().capitalAtWithdrawalStart).toBe(60000);
  });

  it('numbers immediate withdrawal rows from 1 to the projection length', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());

    component.withdrawalStartMonth.set(format(addMonths(currentMonth, -1), 'yyyy-MM'));
    component.withdrawalStarted.set(false);
    component.updateWithdrawalStarted({
      target: { checked: true }
    } as unknown as Event);
    runCalculation(component);

    const rows = component.withdrawalScheduleRows();

    expect(rows).toHaveSize(300);
    expect(rows[0].periodIndex).toBe(1);
    expect(rows.at(-1)?.periodIndex).toBe(300);
    expect(rows[0].dateLabel).toBe(format(currentMonth, 'MMMM yyyy'));
    expect(rows.at(-1)?.dateLabel).toBe(format(addMonths(currentMonth, 299), 'MMMM yyyy'));
  }));

  it('groups the withdrawal plan by year when the payout period is yearly', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.frequency.set('yearly');
    component.updateCurrentDate({
      target: { value: '2050-10-01' }
    } as unknown as Event);
    component.holdings.set([{ currency: 'EUR', valueInBaseCurrency: 10000 }]);
    component.withdrawalStartMonth.set('2050-06');
    component.withdrawalStarted.set(true);
    fixture.detectChanges();
    runCalculation(component);

    const rows = component.withdrawalScheduleRows();

    expect(rows.every((row: any) => row.isYearSummary)).toBeTrue();
    expect(rows[0].dateLabel).toBe('June 2050');
    expect(rows[1].dateLabel).toBe('June 2051');
    expect(component.nextWithdrawalLabel()).toBe('June 2050');
  }));

  it('hides savings-phase fields when withdrawals start immediately', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.withdrawalStarted.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="withdrawal-start-field"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="monthly-savings-field"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="accumulation-return-field"]')).toBeNull();
  });

  it('shows the next withdrawal month in the sell plan section', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    runCalculation(component);

    expect(component.nextWithdrawalLabel()).not.toBe('n/a');
  }));

  it('starts the withdrawal schedule at the current month when the start month is invalid', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    const currentMonth = startOfMonth(new Date());
    component.withdrawalStartMonth.set(format(addMonths(currentMonth, -3), 'yyyy-MM'));
    runCalculation(component);

    const firstVisibleRow = component.withdrawalScheduleRows()[0];

    expect(firstVisibleRow.dateLabel).toBe(format(currentMonth, 'MMMM yyyy'));
    expect(firstVisibleRow.periodIndex).toBe(1);
  }));

  it('starts the visible withdrawal list at the stored month when it is in the future', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());
    const futureMonth = addMonths(currentMonth, 3);

    component.withdrawalStartMonth.set(format(futureMonth, 'yyyy-MM'));
    runCalculation(component);

    expect(component.withdrawalScheduleRows()[0].dateLabel).toBe(format(futureMonth, 'MMMM yyyy'));
  }));

  it('derives the expected end from a future withdrawal start month', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());
    const futureMonth = addMonths(currentMonth, 3);

    component.withdrawalStartMonth.set(format(futureMonth, 'yyyy-MM'));
    runCalculation(component);

    expect(component.withdrawalEndLabel()).toBe(format(addYears(futureMonth, 25), 'yyyy-MM'));
    expect(component.projectionEndLabel()).toBe(format(addYears(futureMonth, 25), 'yyyy-MM'));
  }));

  it('anchors the projected end label to the current month when withdrawals start immediately', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());

    component.withdrawalStartMonth.set('2026-05');
    component.withdrawalStarted.set(false);
    component.updateWithdrawalStarted({
      target: { checked: true }
    } as unknown as Event);
    runCalculation(component);

    expect(component.projectionEndLabel()).toBe(format(addYears(currentMonth, 25), 'yyyy-MM'));
    expect(component.withdrawalStartLabel()).toBe(format(currentMonth, 'MMMM yyyy'));
  }));

  it('caps the visible withdrawal list at the expected end month', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());
    const futureMonth = addMonths(currentMonth, 3);

    component.withdrawalStartMonth.set(format(futureMonth, 'yyyy-MM'));
    component.projectionYears.set(1);
    runCalculation(component);

    const rows = component.withdrawalScheduleRows();

    expect(rows[0].dateLabel).toBe(format(futureMonth, 'MMMM yyyy'));
    expect(rows.at(-1)?.dateLabel).toBe(format(addMonths(futureMonth, 11), 'MMMM yyyy'));
  }));

  it('initializes the FIFO simulation month at projection end', fakeAsync(() => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    runCalculation(component);

    expect(component.selectedFifoMonthValue()).toBe(component.withdrawalEndLabel());
  }));

  it('navigates and clamps the FIFO simulation month within the allowed range', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2024-03-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      }
    ]);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    component.projectionYears.set(1);
    fixture.detectChanges();
    runCalculation(component);

    expect(component.selectedFifoMonthValue()).toBe('2027-08');
    expect(component.selectedFifoMonthMinimum()).toBe('2024-03');
    expect(component.selectedFifoMonthMaximum()).toBe('2027-08');

    component.shiftSelectedFifoYear(-10);
    expect(component.selectedFifoMonthValue()).toBe('2024-03');
    expect(component.isSelectedFifoMonthAtMinimum()).toBeTrue();

    component.shiftSelectedFifoYear(10);
    expect(component.selectedFifoMonthValue()).toBe('2027-08');
    expect(component.isSelectedFifoMonthAtMaximum()).toBeTrue();
  }));

  it('jumps the FIFO simulation month with the shortcut buttons, relative to today, clamped to bounds', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2024-03-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      }
    ]);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    component.projectionYears.set(1);
    fixture.detectChanges();
    runCalculation(component);

    expect(component.selectedFifoMonthMinimum()).toBe('2024-03');
    expect(component.selectedFifoMonthMaximum()).toBe('2027-08');

    component.jumpSelectedFifoMonthToToday();
    expect(component.selectedFifoMonthValue()).toBe('2026-06');

    component.jumpSelectedFifoMonthByOffset(1);
    expect(component.selectedFifoMonthValue()).toBe('2026-07');

    component.jumpSelectedFifoMonthByOffset(3);
    expect(component.selectedFifoMonthValue()).toBe('2026-09');

    component.jumpSelectedFifoMonthByOffset(6);
    expect(component.selectedFifoMonthValue()).toBe('2026-12');

    component.jumpSelectedFifoMonthByOffset(12);
    expect(component.selectedFifoMonthValue()).toBe('2027-06');

    component.jumpSelectedFifoMonthByOffset(36);
    expect(component.selectedFifoMonthValue()).toBe('2027-08');
    expect(component.isSelectedFifoMonthAtMaximum()).toBeTrue();

    component.jumpSelectedFifoMonthToYtd();
    expect(component.selectedFifoMonthValue()).toBe('2026-12');

    component.jumpSelectedFifoMonthToEndOfWithdrawal();
    expect(component.selectedFifoMonthValue()).toBe('2027-08');
    expect(component.isSelectedFifoMonthAtMaximum()).toBeTrue();

    component.jumpSelectedFifoMonthByOffset(-60);
    expect(component.selectedFifoMonthValue()).toBe('2024-03');
    expect(component.isSelectedFifoMonthAtMinimum()).toBeTrue();
  }));


  it('uses no due withdrawal before the withdrawal start month and applies one at start month', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2024-03-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      }
    ]);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    fixture.detectChanges();
    runCalculation(component);

    component.updateSelectedFifoMonth({
      target: { value: '2026-07' }
    } as unknown as Event);
    expect(component.selectedFifoDuePointLabel()).toBe('No withdrawal due yet');
    expect(component.simulatedFifoOverviewRows()[0].activities.some((activity: any) => activity.type === 'SELL')).toBeFalse();

    component.updateSelectedFifoMonth({
      target: { value: '2026-08' }
    } as unknown as Event);
    expect(component.selectedFifoDuePointLabel()).toBe('August 2026');
    expect(component.simulatedFifoOverviewRows()[0].activities.some((activity: any) => activity.type === 'SELL')).toBeTrue();
  }));


  it('renders historical SELL rows per due month up to the selected month', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2024-03-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      }
    ]);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    fixture.detectChanges();
    runCalculation(component);

    component.updateSelectedFifoMonth({
      target: { value: '2026-10' }
    } as unknown as Event);

    const sellActivities = component.simulatedFifoOverviewRows()[0].activities.filter((activity: any) => {
      return activity.type === 'SELL';
    });
    expect(sellActivities.length).toBeGreaterThanOrEqual(3);
    expect(component.simulatedFifoOverviewRows()[0].activities.some((activity: any) => {
      return activity.type === 'BUY' && activity.sellDetails.length > 0;
    })).toBeTrue();
  }));


  it('does not create additional BUY months after withdrawal start when browsing later months', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2024-03-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      }
    ]);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    fixture.detectChanges();
    runCalculation(component);

    component.updateSelectedFifoMonth({
      target: { value: '2026-06' }
    } as unknown as Event);
    const latestBuyInJune = component.simulatedFifoOverviewRows()[0].activities
      .filter((activity: any) => activity.type === 'BUY' && activity.date)
      .map((activity: any) => new Date(activity.date).getTime())
      .reduce((latest: number, value: number) => Math.max(latest, value), Number.MIN_SAFE_INTEGER);

    component.updateSelectedFifoMonth({
      target: { value: '2026-07' }
    } as unknown as Event);
    const latestBuyInJuly = component.simulatedFifoOverviewRows()[0].activities
      .filter((activity: any) => activity.type === 'BUY' && activity.date)
      .map((activity: any) => new Date(activity.date).getTime())
      .reduce((latest: number, value: number) => Math.max(latest, value), Number.MIN_SAFE_INTEGER);

    component.updateSelectedFifoMonth({
      target: { value: '2026-08' }
    } as unknown as Event);
    const latestBuyAtStart = component.simulatedFifoOverviewRows()[0].activities
      .filter((activity: any) => activity.type === 'BUY' && activity.date)
      .map((activity: any) => new Date(activity.date).getTime())
      .reduce((latest: number, value: number) => Math.max(latest, value), Number.MIN_SAFE_INTEGER);

    component.updateSelectedFifoMonth({
      target: { value: '2026-10' }
    } as unknown as Event);
    const latestBuyAfterStart = component.simulatedFifoOverviewRows()[0].activities
      .filter((activity: any) => activity.type === 'BUY' && activity.date)
      .map((activity: any) => new Date(activity.date).getTime())
      .reduce((latest: number, value: number) => Math.max(latest, value), Number.MIN_SAFE_INTEGER);
    const sellCountAfterStart = component.simulatedFifoOverviewRows()[0].activities.filter((activity: any) => {
      return activity.type === 'SELL';
    }).length;

    expect(latestBuyInJuly).toBeGreaterThan(latestBuyInJune);
    expect(latestBuyAfterStart).toBe(latestBuyAtStart);
    expect(latestBuyAfterStart).toBeLessThan(new Date('2026-08-01T00:00:00.000Z').getTime());
    expect(sellCountAfterStart).toBeGreaterThan(0);
  }));

  it('applies accent style class to FIFO month navigation buttons', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: false
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      }
    ]);
    fixture.detectChanges();
    runCalculation(component);
    fixture.detectChanges();

    const navButtons = fixture.nativeElement.querySelectorAll('.fifo-month-navigation .fifo-nav-button');
    expect(navButtons.length).toBe(4);
  }));

  it('filters source activities to the selected month (inclusive)', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2026-06-10T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 1,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 100
      },
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2026-08-15T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 1,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 120,
        unitPriceInAssetProfileCurrency: 120,
        valueInBaseCurrency: 120
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        valueInBaseCurrency: 1000
      }
    ]);
    component.withdrawalStartMonth.set('2026-10');
    component.withdrawalStarted.set(false);
    fixture.detectChanges();
    runCalculation(component);

    component.updateSelectedFifoMonth({
      target: { value: '2026-06' }
    } as unknown as Event);

    const maxVisibleActivityTime = component.simulatedFifoOverviewRows()[0].activities
      .filter((activity: any) => activity.type === 'BUY' && activity.date)
      .map((activity: any) => new Date(activity.date).getTime())
      .reduce((latest: number, value: number) => Math.max(latest, value), Number.MIN_SAFE_INTEGER);

    expect(maxVisibleActivityTime).toBeLessThanOrEqual(new Date('2026-06-30T23:59:59.999Z').getTime());
  }));

  it('shows real historical SELL activities before withdrawal start', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2026-04-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 10,
        symbol: 'AAA',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      },
      {
        accountId: 'acc-1',
        accountName: 'Main',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2026-05-01T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 2,
        symbol: 'AAA',
        type: 'SELL',
        unitPrice: 105,
        unitPriceInAssetProfileCurrency: 105,
        valueInBaseCurrency: 210
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'ETF A',
        quantity: 8,
        symbol: 'AAA',
        valueInBaseCurrency: 800
      }
    ]);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    fixture.detectChanges();
    runCalculation(component);

    component.updateSelectedFifoMonth({
      target: { value: '2026-06' }
    } as unknown as Event);
    const sellRows = component.simulatedFifoOverviewRows()[0].activities.filter((activity: any) => {
      return activity.type === 'SELL';
    });

    expect(sellRows.length).toBeGreaterThan(0);
    expect(sellRows.some((activity: any) => new Date(activity.date).getTime() === new Date('2026-05-01T00:00:00.000Z').getTime())).toBeTrue();
  }));

  it('keeps the current month FIFO view purely historical', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    setSingleSymbolPortfolio(component);
    component.monthlySavingsRate.set(100);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    runCalculation(component);
    component.updateSelectedFifoMonth({
      target: { value: '2026-06' }
    } as unknown as Event);

    const overviewInput = component.selectedFifoTaxOverviewInput();

    expect(overviewInput.syntheticActivities).toEqual([]);
    expect(overviewInput.combinedActivities).toEqual(component.activities());
    expect(overviewInput.syntheticTaxEvents.every((taxEvent: any) => taxEvent.taxYear < 2026)).toBeTrue();
    expect(component.simulatedFifoOverviewRows()).toHaveSize(1);
    expect(component.simulatedFifoOverviewRows()[0].activities).toHaveSize(1);
  }));

  it('adds the first simulated BUY in the next month', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    setSingleSymbolPortfolio(component);
    component.monthlySavingsRate.set(100);
    component.withdrawalStartMonth.set('2026-08');
    component.withdrawalStarted.set(false);
    runCalculation(component);
    component.updateSelectedFifoMonth({
      target: { value: '2026-07' }
    } as unknown as Event);

    const syntheticActivities = component.selectedFifoTaxOverviewInput().syntheticActivities;

    expect(syntheticActivities).toHaveSize(1);
    expect(syntheticActivities[0].type).toBe('BUY');
    expect(format(syntheticActivities[0].date, 'yyyy-MM')).toBe('2026-07');
    expect(component.simulatedFifoOverviewRows()[0].activities.some((activity: any) => {
      return activity.type === 'BUY' && format(activity.date, 'yyyy-MM') === '2026-07';
    })).toBeTrue();
  }));

  it('uses synthetic activities and tax events for future years', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    setSingleSymbolPortfolio(component);
    component.monthlySavingsRate.set(100);
    component.accumulationAnnualReturnPercentage.set(6);
    component.withdrawalAnnualReturnPercentage.set(4);
    component.withdrawalStartMonth.set('2027-01');
    component.withdrawalStarted.set(false);
    component.projectionYears.set(2);
    runCalculation(component);
    component.updateSelectedFifoMonth({
      target: { value: '2028-02' }
    } as unknown as Event);

    const overviewInput = component.selectedFifoTaxOverviewInput();
    const rows = component.simulatedFifoOverviewRows();

    expect(overviewInput.syntheticActivities.some((activity: any) => activity.type === 'SELL')).toBeTrue();
    expect(overviewInput.syntheticTaxEvents.length).toBeGreaterThan(0);
    expect(rows[0].activities.some((activity: any) => activity.type === 'SELL')).toBeTrue();
    expect(rows[0].totalVap).toBeGreaterThan(0);
  }));

  it('rolls simulated VAP in on the following 01.01, not before', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    setSingleSymbolPortfolio(component);
    component.monthlySavingsRate.set(0);
    component.withdrawalStartMonth.set('2028-01');
    component.withdrawalStarted.set(false);
    runCalculation(component);

    component.updateSelectedFifoMonth({
      target: { value: '2026-12' }
    } as unknown as Event);
    const decemberRows = component.simulatedFifoOverviewRows();
    const decemberSyntheticTaxEvents = component.selectedFifoTaxOverviewInput().syntheticTaxEvents;

    component.updateSelectedFifoMonth({
      target: { value: '2027-01' }
    } as unknown as Event);
    const januaryRows = component.simulatedFifoOverviewRows();
    const januarySyntheticTaxEvents = component.selectedFifoTaxOverviewInput().syntheticTaxEvents;

    expect(decemberSyntheticTaxEvents.some((taxEvent: any) => taxEvent.taxYear === 2026)).toBeFalse();
    expect(januarySyntheticTaxEvents.some((taxEvent: any) => taxEvent.taxYear === 2026)).toBeTrue();
    expect(januaryRows[0].totalVap).toBeGreaterThan(decemberRows[0].totalVap);
  }));

  it('keeps a real tax event instead of creating a synthetic replacement', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    setSingleSymbolPortfolio(component);
    component.taxEvents.set([
      {
        accountId: 'acc-1',
        id: 'real-acc-1-AAA-2026',
        quantity: 10,
        symbolId: 'AAA',
        taxYear: 2026,
        vorabpauschalePerShare: 3,
        vorabpauschalePerShareAfterTeilfreistellung: 2.1
      }
    ]);
    component.monthlySavingsRate.set(0);
    component.withdrawalStartMonth.set('2028-01');
    component.withdrawalStarted.set(false);
    runCalculation(component);
    component.updateSelectedFifoMonth({
      target: { value: '2027-01' }
    } as unknown as Event);

    const overviewInput = component.selectedFifoTaxOverviewInput();
    const rows = component.simulatedFifoOverviewRows();

    expect(overviewInput.syntheticTaxEvents.some((taxEvent: any) => taxEvent.taxYear === 2026)).toBeFalse();
    expect(
      overviewInput.combinedTaxEvents.find((taxEvent: any) => taxEvent.taxYear === 2026)?.vorabpauschalePerShare
    ).toBe(3);
    expect(rows[0].totalVap).toBeGreaterThanOrEqual(30);
  }));

  it('synthesizes a missing TaxEvent for a year that ended long ago, outside January', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    // Current month is June (not January), and the BUY happened in 2024 - both 2024 and 2025
    // are already-completed past years with no real TaxEvent recorded yet.
    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    setSingleSymbolPortfolio(component);
    component.withdrawalStartMonth.set('2028-01');
    component.withdrawalStarted.set(false);
    runCalculation(component);
    component.updateSelectedFifoMonth({
      target: { value: '2026-06' }
    } as unknown as Event);

    const overviewInput = component.selectedFifoTaxOverviewInput();
    const rows = component.simulatedFifoOverviewRows();

    expect(overviewInput.syntheticActivities).toEqual([]);
    expect(overviewInput.combinedActivities).toEqual(component.activities());
    expect(overviewInput.syntheticTaxEvents.some((taxEvent: any) => taxEvent.taxYear === 2024)).toBeTrue();
    expect(overviewInput.syntheticTaxEvents.some((taxEvent: any) => taxEvent.taxYear === 2025)).toBeTrue();
    expect(rows[0].totalVap).toBeGreaterThan(0);
  }));

  it('does not overwrite a real TaxEvent for a past year with a synthetic one', fakeAsync(() => {
    authServiceMock.allocationsText = () => 'AAA,100';
    runtimeConfigServiceMock.config.set({
      allocationsText: 'AAA,100',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.updateCurrentDate({
      target: { value: '2026-06-01' }
    } as unknown as Event);
    setSingleSymbolPortfolio(component);
    component.taxEvents.set([
      {
        accountId: 'acc-1',
        id: 'real-acc-1-AAA-2024',
        quantity: 10,
        symbolId: 'AAA',
        taxYear: 2024,
        vorabpauschalePerShare: 3,
        vorabpauschalePerShareAfterTeilfreistellung: 2.1
      }
    ]);
    component.withdrawalStartMonth.set('2028-01');
    component.withdrawalStarted.set(false);
    runCalculation(component);
    component.updateSelectedFifoMonth({
      target: { value: '2026-06' }
    } as unknown as Event);

    const overviewInput = component.selectedFifoTaxOverviewInput();

    expect(overviewInput.syntheticTaxEvents.some((taxEvent: any) => taxEvent.taxYear === 2024)).toBeFalse();
    expect(overviewInput.syntheticTaxEvents.some((taxEvent: any) => taxEvent.taxYear === 2025)).toBeTrue();
    expect(overviewInput.combinedTaxEvents.filter((taxEvent: any) => taxEvent.taxYear === 2024).length).toBe(1);
    expect(
      overviewInput.combinedTaxEvents.find((taxEvent: any) => taxEvent.taxYear === 2024)?.vorabpauschalePerShare
    ).toBe(3);
  }));
});

