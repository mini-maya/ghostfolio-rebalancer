import { addMonths, addYears, format, startOfMonth } from 'date-fns';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthService } from '../auth/auth.service';
import { RuntimeConfigService } from '../runtime-config';
import { PortfolioDataStore } from '../services/portfolio-data.store';
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
    updateAccountRetireConfig: jasmine.createSpy('updateAccountRetireConfig').and.resolveTo()
  };

  const portfolioDataStoreMock = {
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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RetirePage],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: PortfolioDataStore, useValue: portfolioDataStoreMock },
        { provide: RuntimeConfigService, useValue: runtimeConfigServiceMock }
      ]
    }).compileComponents();

    runtimeConfigServiceMock.config.set({
      allocationsText: '',
      developerMode: false
    });
    expect(authServiceMock.sessionMode()).toBe('account');
  });

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

  it('sets the withdrawal start month to the current month when withdrawals start immediately', () => {
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

    expect(component.withdrawalStarted()).toBeTrue();
    expect(component.withdrawalStartMonth()).toBe(format(currentMonth, 'yyyy-MM'));
    expect(component.capitalAtWithdrawalStart()).toBe(10000);
    expect(component.withdrawalStartLabel()).toBe(format(currentMonth, 'MMMM yyyy'));
    expect(component.projectionEndLabel()).toBe(format(addYears(currentMonth, 25), 'yyyy-MM'));
  });

  it('shows the developer current date input when developer mode is enabled', () => {
    runtimeConfigServiceMock.config.set({
      allocationsText: '',
      developerMode: true
    });

    const fixture = TestBed.createComponent(RetirePage);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="developer-date-field"]')).not.toBeNull();
  });

  it('uses the developer current date as the retire base date', () => {
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

    expect(component.withdrawalStartLabel()).toBe('April 2027');
    expect(component.projectionEndLabel()).toBe('2052-04');
    expect(component.withdrawalScheduleRows()[0].dateLabel).toBe('April 2027');
  });

  it('collapses past years into yearly summary rows and prefixes completed rows with a checkmark', () => {
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

    const rows = component.withdrawalScheduleRows();

    expect(rows[0].isYearSummary).toBeTrue();
    expect(rows[0].periodLabel).toBe('Jahr 2048');
    expect(rows[0].dateLabel).toBe('January 2048 – December 2048');
    expect(rows[0].isCompleted).toBeTrue();
    expect(rows[1].isYearSummary).toBeTrue();
    expect(rows.some((row: any) => !row.isYearSummary && row.dateLabel === 'January 2050')).toBeTrue();
    expect(
      fixture.nativeElement
        .querySelector('.withdrawal-schedule-table tbody tr .row-status')
        .textContent.includes('✅')
    ).toBeTrue();
  });

  it('keeps past withdrawal periods visible and marks them as completed', () => {
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
    const currentRow = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.withdrawal-schedule-table tbody tr')
    ).find((row: Element) => row.textContent?.includes('October 2050'));

    expect(currentRow?.textContent?.includes('➡️')).toBeTrue();
  });

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

  it('numbers immediate withdrawal rows from 1 to the projection length', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());

    component.withdrawalStartMonth.set(format(addMonths(currentMonth, -1), 'yyyy-MM'));
    component.withdrawalStarted.set(false);
    component.updateWithdrawalStarted({
      target: { checked: true }
    } as unknown as Event);

    const rows = component.withdrawalScheduleRows();

    expect(rows).toHaveSize(300);
    expect(rows[0].periodIndex).toBe(1);
    expect(rows.at(-1)?.periodIndex).toBe(300);
    expect(rows[0].dateLabel).toBe(format(currentMonth, 'MMMM yyyy'));
    expect(rows.at(-1)?.dateLabel).toBe(format(addMonths(currentMonth, 299), 'MMMM yyyy'));
  });

  it('hides savings-phase fields when withdrawals start immediately', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    component.withdrawalStarted.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="withdrawal-start-field"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="monthly-savings-field"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="accumulation-return-field"]')).toBeNull();
  });

  it('shows the next withdrawal month in the sell plan section', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    expect(component.nextWithdrawalLabel()).not.toBe('n/a');
  });

  it('starts the withdrawal schedule at the current month when the start month is invalid', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;

    const currentMonth = startOfMonth(new Date());
    component.withdrawalStartMonth.set(format(addMonths(currentMonth, -3), 'yyyy-MM'));

    const firstVisibleRow = component.withdrawalScheduleRows()[0];

    expect(firstVisibleRow.dateLabel).toBe(format(currentMonth, 'MMMM yyyy'));
    expect(firstVisibleRow.periodIndex).toBe(1);
  });

  it('starts the visible withdrawal list at the stored month when it is in the future', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());
    const futureMonth = addMonths(currentMonth, 3);

    component.withdrawalStartMonth.set(format(futureMonth, 'yyyy-MM'));

    expect(component.withdrawalScheduleRows()[0].dateLabel).toBe(format(futureMonth, 'MMMM yyyy'));
  });

  it('derives the expected end from a future withdrawal start month', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());
    const futureMonth = addMonths(currentMonth, 3);

    component.withdrawalStartMonth.set(format(futureMonth, 'yyyy-MM'));

    expect(component.withdrawalEndLabel()).toBe(format(addYears(futureMonth, 25), 'yyyy-MM'));
    expect(component.projectionEndLabel()).toBe(format(addYears(futureMonth, 25), 'yyyy-MM'));
  });

  it('anchors the projected end label to the current month when withdrawals start immediately', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());

    component.withdrawalStartMonth.set('2026-05');
    component.withdrawalStarted.set(false);
    component.updateWithdrawalStarted({
      target: { checked: true }
    } as unknown as Event);

    expect(component.projectionEndLabel()).toBe(format(addYears(currentMonth, 25), 'yyyy-MM'));
    expect(component.withdrawalStartLabel()).toBe(format(currentMonth, 'MMMM yyyy'));
  });

  it('caps the visible withdrawal list at the expected end month', () => {
    const fixture = TestBed.createComponent(RetirePage);
    const component = fixture.componentInstance as any;
    const currentMonth = startOfMonth(new Date());
    const futureMonth = addMonths(currentMonth, 3);

    component.withdrawalStartMonth.set(format(futureMonth, 'yyyy-MM'));
    component.projectionYears.set(1);

    const rows = component.withdrawalScheduleRows();

    expect(rows[0].dateLabel).toBe(format(futureMonth, 'MMMM yyyy'));
    expect(rows.at(-1)?.dateLabel).toBe(format(addMonths(futureMonth, 11), 'MMMM yyyy'));
  });
});
