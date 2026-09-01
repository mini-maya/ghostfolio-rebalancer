import { buildRetireTaxOverviewInput } from '../retire-page/retire-tax-simulation';
import type { Activity, Holding } from './ghostfolio-api';
import { DEFAULT_TAX_PROFILE } from './tax-calculator';
import { calculateTaxOverview } from './tax-engine';
import type { TaxEvent } from './tax-events';

describe('calculateTaxOverview cross-check', () => {
  it('matches the historical retire-page path byte-for-byte', () => {
    const activities: Activity[] = [
      {
        accountId: 'acc-1',
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2023-01-10T00:00:00.000Z'),
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
        accountName: 'Depot A',
        assetClass: 'ETF',
        assetSubClass: 'WORLD',
        currency: 'EUR',
        date: new Date('2024-02-15T00:00:00.000Z'),
        fee: 0,
        name: 'ETF A',
        quantity: 4,
        symbol: 'AAA',
        type: 'SELL',
        unitPrice: 120,
        unitPriceInAssetProfileCurrency: 120,
        valueInBaseCurrency: 480
      }
    ];
    const holdings: Holding[] = [
      {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 120,
        name: 'ETF A',
        quantity: 6,
        symbol: 'AAA',
        valueInBaseCurrency: 720
      }
    ];
    const taxEvents: TaxEvent[] = [
      {
        accountId: 'acc-1',
        id: 'acc-1-AAA-2023',
        quantity: 10,
        symbolId: 'AAA',
        taxYear: 2023,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      }
    ];
    const asOfDate = new Date('2024-06-30T00:00:00.000Z');
    const directRows = calculateTaxOverview({
      activities,
      asOfDate,
      holdings,
      taxEvents,
      taxProfile: DEFAULT_TAX_PROFILE
    });
    const retireInput = buildRetireTaxOverviewInput({
      accumulationAnnualReturnPercentage: 0,
      activities,
      allocations: [{ percentage: 100, symbol: 'AAA' }],
      asOfDate,
      currentDate: new Date('2024-06-30T00:00:00.000Z'),
      holdings,
      monthlySavingsRate: 0,
      taxEvents,
      taxProfile: DEFAULT_TAX_PROFILE,
      withdrawalAnnualReturnPercentage: 0,
      withdrawalPoints: [],
      withdrawalStartDate: new Date('2025-01-01T00:00:00.000Z')
    });
    const retireRows = calculateTaxOverview({
      activities: retireInput.combinedActivities,
      asOfDate,
      holdings: retireInput.holdings,
      taxEvents: retireInput.combinedTaxEvents,
      taxProfile: DEFAULT_TAX_PROFILE
    });

    expect(retireRows).toEqual(directRows);
  });
});
