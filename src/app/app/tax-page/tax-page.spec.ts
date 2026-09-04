import { signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';

import { AuthService } from '../auth/auth.service';
import { PortfolioDataStore } from '../services/portfolio-data.store';
import { DEFAULT_TAX_PROFILE } from '../services/tax-calculator';
import { TaxEventsService } from '../services/tax-events';
import { TaxPage } from './tax-page';

describe('TaxPage', () => {
  const portfolioDataStoreMock = {
    activities: signal([
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2026-01-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 1,
        symbol: 'VWCE',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 100
      }
    ]),
    holdings: signal([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'Vanguard FTSE All-World',
        quantity: 1,
        symbol: 'VWCE',
        valueInBaseCurrency: 100
      }
    ]),
    infoMessage: signal(''),
    isLoading: signal(false),
    lastLoadedUrl: signal('https://ghostfolio.example'),
    loadPortfolioData: jasmine.createSpy('loadPortfolioData').and.resolveTo()
  };

  const taxEventsServiceMock = jasmine.createSpyObj<TaxEventsService>('TaxEventsService', [
    'createTaxEvent',
    'deleteTaxEvent',
    'loadTaxEvents',
    'updateTaxEvent'
  ]);
  const authServiceMock = {
    taxConfig: signal({ ...DEFAULT_TAX_PROFILE }),
    updateAccountTaxConfig: jasmine.createSpy('updateAccountTaxConfig').and.resolveTo(),
    user: signal('local-user')
  };

  beforeEach(async () => {
    portfolioDataStoreMock.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2026-01-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 1,
        symbol: 'VWCE',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 100
      }
    ]);
    portfolioDataStoreMock.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'Vanguard FTSE All-World',
        quantity: 1,
        symbol: 'VWCE',
        valueInBaseCurrency: 100
      }
    ]);

    taxEventsServiceMock.createTaxEvent.calls.reset();
    taxEventsServiceMock.deleteTaxEvent.calls.reset();
    taxEventsServiceMock.loadTaxEvents.calls.reset();
    taxEventsServiceMock.updateTaxEvent.calls.reset();
    authServiceMock.updateAccountTaxConfig.calls.reset();

    taxEventsServiceMock.loadTaxEvents.and.resolveTo([]);
    taxEventsServiceMock.createTaxEvent.and.resolveTo({
      accountId: 'acc-1',
      id: 'tax-1',
      quantity: 143.27,
      symbolId: 'VWCE',
      taxYear: 2026,
      vorabpauschalePerShare: 2.3,
      vorabpauschalePerShareAfterTeilfreistellung: 1.61
    });
    taxEventsServiceMock.updateTaxEvent.and.resolveTo({
      accountId: 'acc-1',
      id: 'tax-1',
      quantity: 150,
      symbolId: 'VWCE',
      taxYear: 2026,
      vorabpauschalePerShare: 2.5,
      vorabpauschalePerShareAfterTeilfreistellung: 1.75
    });
    taxEventsServiceMock.deleteTaxEvent.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [TaxPage],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: PortfolioDataStore, useValue: portfolioDataStoreMock },
        { provide: TaxEventsService, useValue: taxEventsServiceMock }
      ]
    }).compileComponents();
  });

  it('groups tax events by year and calculates totals', () => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    component.taxEvents.set([
      {
        accountId: 'acc-1',
        id: 'tax-1',
        quantity: 143.27,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 2.3,
        vorabpauschalePerShareAfterTeilfreistellung: 1.61
      },
      {
        accountId: 'acc-1',
        id: 'tax-2',
        quantity: 52,
        symbolId: 'IUSN',
        taxYear: 2025,
        vorabpauschalePerShare: 1.2,
        vorabpauschalePerShareAfterTeilfreistellung: 0.84
      }
    ]);
    component.expandedYears.set(new Set([2025, 2026]));
    fixture.detectChanges();

    expect(component.taxEventYearGroups().map((group: any) => group.taxYear)).toEqual([2026, 2025]);
    expect(component.taxEventRows()[0].totalAmount).toBe(329.52);
    expect(component.taxEventRows()[0].totalAmountAfterTeilfreistellung).toBe(230.66);
    expect(fixture.nativeElement.querySelectorAll('.activity-details').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('creates tax events only after portfolio data is available', async () => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    component.openCreateDialog();
    expect(component.isDialogOpen()).toBeTrue();

    component.updateDialogQuantity({
      target: { value: '143.27' }
    } as unknown as Event);
    component.updateDialogVorabpauschalePerShare({
      target: { value: '2.30' }
    } as unknown as Event);
    component.updateDialogVorabpauschalePerShareAfterTeilfreistellung({
      target: { value: '1.61' }
    } as unknown as Event);

    await component.submitDialog();

    expect(taxEventsServiceMock.createTaxEvent).toHaveBeenCalledWith({
      accountId: 'acc-1',
      quantity: 143.27,
      symbolId: 'VWCE',
      taxYear: new Date().getFullYear(),
      vorabpauschalePerShare: 2.3,
      vorabpauschalePerShareAfterTeilfreistellung: 1.61
    });
    expect(component.taxEvents().length).toBe(1);
  });

  it('loads and saves the tax profile for local users', fakeAsync(() => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    fixture.detectChanges();

    expect(component.canEditTaxProfile()).toBeTrue();
    expect(component.taxProfile()).toEqual(DEFAULT_TAX_PROFILE);

    component.updateTaxProfileCapitalGainsTaxRate({
      target: { value: '30' }
    } as unknown as Event);
    tick(300);

    expect(authServiceMock.updateAccountTaxConfig).toHaveBeenCalledWith({
      assumedBasiszinsRate: 0.025,
      capitalGainsTaxRate: 0.3,
      churchTaxRate: 0,
      partialExemptionRate: 0.3,
      solidaritySurchargeRate: 0.055,
      sparerPauschbetrag: 1000
    });
  }));

  it('accepts comma decimals in tax profile inputs', fakeAsync(() => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    fixture.detectChanges();

    component.updateTaxProfileCapitalGainsTaxRate({
      target: { value: '30,5' }
    } as unknown as Event);
    tick(300);

    expect(authServiceMock.updateAccountTaxConfig).toHaveBeenCalledWith({
      assumedBasiszinsRate: 0.025,
      capitalGainsTaxRate: 0.305,
      churchTaxRate: 0,
      partialExemptionRate: 0.3,
      solidaritySurchargeRate: 0.055,
      sparerPauschbetrag: 1000
    });
  }));

  it('updates and saves the Sparer-Pauschbetrag as a Euro amount, not a percentage', fakeAsync(() => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    fixture.detectChanges();

    component.updateTaxProfileSparerPauschbetrag({
      target: { value: '2000' }
    } as unknown as Event);
    tick(300);

    expect(component.taxProfile().sparerPauschbetrag).toBe(2000);
    expect(authServiceMock.updateAccountTaxConfig).toHaveBeenCalledWith({
      assumedBasiszinsRate: 0.025,
      capitalGainsTaxRate: 0.25,
      churchTaxRate: 0,
      partialExemptionRate: 0.3,
      solidaritySurchargeRate: 0.055,
      sparerPauschbetrag: 2000
    });
  }));

  it('sums used VAP values across all overview rows in the metrics header', () => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    // BUY dates and tax-year are chosen so the Vorabpauschale has already rolled over
    // (VAP for tax year Y only becomes tax-relevant on 01.01 of year Y+1) by the time the
    // SELL happens, so a non-zero "used VAP" is actually expected here.
    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2024-01-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 10,
        symbol: 'VWCE',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      },
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2026-02-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 4,
        symbol: 'VWCE',
        type: 'SELL',
        unitPrice: 120,
        unitPriceInAssetProfileCurrency: 120,
        valueInBaseCurrency: 480
      },
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2024-01-01'),
        fee: 0,
        name: 'iShares MSCI World',
        quantity: 8,
        symbol: 'IUSN',
        type: 'BUY',
        unitPrice: 50,
        unitPriceInAssetProfileCurrency: 50,
        valueInBaseCurrency: 400
      },
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2026-02-01'),
        fee: 0,
        name: 'iShares MSCI World',
        quantity: 3,
        symbol: 'IUSN',
        type: 'SELL',
        unitPrice: 60,
        unitPriceInAssetProfileCurrency: 60,
        valueInBaseCurrency: 180
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 60,
        currency: 'EUR',
        marketPrice: 110,
        name: 'Vanguard FTSE All-World',
        quantity: 6,
        symbol: 'VWCE',
        valueInBaseCurrency: 660
      },
      {
        allocationInPercentage: 40,
        currency: 'EUR',
        marketPrice: 55,
        name: 'iShares MSCI World',
        quantity: 5,
        symbol: 'IUSN',
        valueInBaseCurrency: 275
      }
    ]);
    component.taxEvents.set([
      {
        accountId: 'acc-1',
        id: 'tax-1',
        quantity: 10,
        symbolId: 'VWCE',
        taxYear: 2024,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      },
      {
        accountId: 'acc-1',
        id: 'tax-2',
        quantity: 8,
        symbolId: 'IUSN',
        taxYear: 2024,
        vorabpauschalePerShare: 2,
        vorabpauschalePerShareAfterTeilfreistellung: 1.4
      }
    ]);

    fixture.detectChanges();

    const summary = component.taxSummary();
    const overviewRows = component.taxOverviewRows();
    const expectedUsedVap = overviewRows.reduce((sum: number, row: any) => sum + row.usedVapForSelling, 0);
    const expectedUsedTaxableVap = overviewRows.reduce(
      (sum: number, row: any) => sum + row.usedTaxableVapForSelling,
      0
    );

    expect(summary.usedVapForSelling).toBe(expectedUsedVap);
    expect(summary.usedTaxableVapForSelling).toBe(expectedUsedTaxableVap);
    expect(summary.usedVapForSelling).toBeGreaterThan(0);
    expect(summary.usedTaxableVapForSelling).toBeGreaterThan(0);
  });

  it('exposes annual Sparer-Pauschbetrag summaries grouped by calendar year', () => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2024-01-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 10,
        symbol: 'VWCE',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      },
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2026-02-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 4,
        symbol: 'VWCE',
        type: 'SELL',
        unitPrice: 120,
        unitPriceInAssetProfileCurrency: 120,
        valueInBaseCurrency: 480
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 110,
        name: 'Vanguard FTSE All-World',
        quantity: 6,
        symbol: 'VWCE',
        valueInBaseCurrency: 660
      }
    ]);
    component.taxEvents.set([
      {
        accountId: 'acc-1',
        id: 'tax-1',
        quantity: 10,
        symbolId: 'VWCE',
        taxYear: 2024,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      }
    ]);

    fixture.detectChanges();

    const summaries = component.annualTaxSummaries();
    // The VAP for tax year 2024 only becomes tax-relevant on 01.01.2025, and the sale happens
    // in 2026, so both the VAP and the sale gain must be attributed to 2025/2026 respectively
    // and never end up unattributed or duplicated.
    expect(summaries.length).toBeGreaterThan(0);
    // Years are sorted descending (most recent first) for display.
    expect(summaries[0].year).toBeGreaterThanOrEqual(summaries.at(-1)?.year ?? 0);

    const summary2026 = summaries.find((entry: any) => entry.year === 2026);

    expect(summary2026?.taxableSaleGainBeforeAllowance).toBeGreaterThan(0);
    // The gain fits well within the default 1.000 EUR allowance, so it is fully sheltered.
    expect(summary2026?.taxableCapitalIncomeAfterAllowance).toBe(0);
    expect(summary2026?.totalTax).toBe(0);
    expect(summary2026?.sparerPauschbetragAvailable).toBe(1000);
  });

  it('expands BUY rows in the tax overview when sell details exist', () => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    component.activities.set([
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2026-01-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 10,
        symbol: 'VWCE',
        type: 'BUY',
        unitPrice: 100,
        unitPriceInAssetProfileCurrency: 100,
        valueInBaseCurrency: 1000
      },
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'World',
        currency: 'EUR',
        date: new Date('2026-02-01'),
        fee: 0,
        name: 'Vanguard FTSE All-World',
        quantity: 4,
        symbol: 'VWCE',
        type: 'SELL',
        unitPrice: 120,
        unitPriceInAssetProfileCurrency: 120,
        valueInBaseCurrency: 480
      }
    ]);
    component.holdings.set([
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 110,
        name: 'Vanguard FTSE All-World',
        quantity: 6,
        symbol: 'VWCE',
        valueInBaseCurrency: 660
      }
    ]);
    component.taxEvents.set([
      {
        accountId: 'acc-1',
        id: 'tax-1',
        quantity: 10,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      }
    ]);
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector('.activity-details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    const yearGroupHeaderRows = fixture.nativeElement.querySelectorAll('tr.year-group-header-row') as NodeListOf<HTMLTableRowElement>;
    yearGroupHeaderRows.forEach((row) => row.click());
    fixture.detectChanges();

    const monthGroupHeaderRows = fixture.nativeElement.querySelectorAll('tr.month-group-header-row') as NodeListOf<HTMLTableRowElement>;
    monthGroupHeaderRows.forEach((row) => row.click());
    fixture.detectChanges();

    const buyRow = fixture.nativeElement.querySelector('tbody tr.buy-row-expandable') as HTMLTableRowElement;
    buyRow.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sell-details-row')).not.toBeNull();
  });

  it('updates and deletes tax events', async () => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;
    const taxEvent = {
      accountId: 'acc-1',
      id: 'tax-1',
      quantity: 143.27,
      symbolId: 'VWCE',
      taxYear: 2026,
      vorabpauschalePerShare: 2.3,
      vorabpauschalePerShareAfterTeilfreistellung: 1.61
    };

    component.taxEvents.set([taxEvent]);
    component.expandedYears.set(new Set([2026]));

    component.openEditDialog(taxEvent);
    component.updateDialogQuantity({
      target: { value: '150' }
    } as unknown as Event);
    component.updateDialogVorabpauschalePerShare({
      target: { value: '2.50' }
    } as unknown as Event);
    component.updateDialogVorabpauschalePerShareAfterTeilfreistellung({
      target: { value: '1.75' }
    } as unknown as Event);
    await component.submitDialog();

    expect(taxEventsServiceMock.updateTaxEvent).toHaveBeenCalledWith('tax-1', {
      accountId: 'acc-1',
      quantity: 150,
      symbolId: 'VWCE',
      taxYear: 2026,
      vorabpauschalePerShare: 2.5,
      vorabpauschalePerShareAfterTeilfreistellung: 1.75
    });
    expect(component.taxEvents()[0].quantity).toBe(150);

    spyOn(window, 'confirm').and.returnValue(true);
    await component.deleteTaxEvent(component.taxEvents()[0]);

    expect(taxEventsServiceMock.deleteTaxEvent).toHaveBeenCalledWith('tax-1');
    expect(component.taxEvents()).toEqual([]);
  });

  it('validates tax event input before saving', async () => {
    const fixture = TestBed.createComponent(TaxPage);
    const component = fixture.componentInstance as any;

    component.openCreateDialog();
    component.updateDialogQuantity({
      target: { value: '0' }
    } as unknown as Event);

    await component.submitDialog();

    expect(taxEventsServiceMock.createTaxEvent).not.toHaveBeenCalled();
    expect(component.dialogErrorMessage()).toBe('The quantity must be greater than zero.');
  });
});
