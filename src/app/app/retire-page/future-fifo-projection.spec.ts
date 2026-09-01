import type { Activity, Holding } from '../services/ghostfolio-api';
import { calculateTaxForSale, DEFAULT_TAX_PROFILE } from '../services/tax-calculator';

import { calculateFutureFifoWithdrawalPlan } from './future-fifo-projection';

describe('calculateFutureFifoWithdrawalPlan', () => {
  it('matches the oldest lots first when estimating withdrawal gain', () => {
    const estimates = calculateFutureFifoWithdrawalPlan({
      accumulationAnnualReturnPercentage: 0,
      accumulationMonths: 0,
      activities: [
        {
          accountId: 'acc-1',
          accountName: 'Main',
          assetClass: 'ETF',
          assetSubClass: 'WORLD',
          currency: 'EUR',
          date: new Date('2024-01-01T00:00:00.000Z'),
          fee: 0,
          name: 'ETF A',
          quantity: 1,
          symbol: 'AAA',
          type: 'BUY',
          unitPrice: 10,
          unitPriceInAssetProfileCurrency: 10,
          valueInBaseCurrency: 10
        },
        {
          accountId: 'acc-1',
          accountName: 'Main',
          assetClass: 'ETF',
          assetSubClass: 'WORLD',
          currency: 'EUR',
          date: new Date('2024-02-01T00:00:00.000Z'),
          fee: 0,
          name: 'ETF A',
          quantity: 1,
          symbol: 'AAA',
          type: 'BUY',
          unitPrice: 100,
          unitPriceInAssetProfileCurrency: 100,
          valueInBaseCurrency: 100
        } as Activity
      ],
      allocations: [{ percentage: 100, symbol: 'AAA' }],
      currentDate: new Date('2026-01-01T00:00:00.000Z'),
      holdings: [
        {
          allocationInPercentage: 100,
          currency: 'EUR',
          marketPrice: 100,
          name: 'ETF A',
          quantity: 2,
          symbol: 'AAA',
          valueInBaseCurrency: 200
        } as Holding
      ],
      monthlySavingsRate: 0,
      taxEvents: [],
      taxProfile: DEFAULT_TAX_PROFILE,
      withdrawalPoints: [
        {
          date: new Date('2026-01-01T00:00:00.000Z'),
          periodIndex: 0,
          withdrawal: 100
        }
      ],
      withdrawalStartDate: new Date('2026-01-01T00:00:00.000Z')
    });

    const estimate = estimates.get(0);

    expect(estimate?.gain).toBe(90);
    // The sold lot was acquired in 2024, and 2024 is already a fully completed past year by the
    // 2026 sale date. Even though no real TaxEvent exists for 2024, the shared engine now fills
    // in a synthetic Vorabpauschale for it (based on the real 2024 -> 2026 price development),
    // which correctly reduces the taxable gain - unlike the previous behaviour where prior-year
    // VAP was silently ignored whenever no real TaxEvent had been entered yet.
    expect(estimate?.tax).toBeCloseTo(
      calculateTaxForSale({
        acquisitionCost: 10,
        saleProceeds: 100,
        taxProfile: DEFAULT_TAX_PROFILE,
        usedVap: 0.175
      }),
      2
    );
    expect(estimate?.netWithdrawal).toBeCloseTo(100 - (estimate?.tax ?? 0), 2);
  });

  it('uses the withdrawal return assumption when valuing the symbol during the withdrawal phase', () => {
    const zeroReturnEstimate = calculateFutureFifoWithdrawalPlan({
      accumulationAnnualReturnPercentage: 0,
      accumulationMonths: 0,
      activities: [
        {
          accountId: 'acc-1',
          accountName: 'Main',
          assetClass: 'ETF',
          assetSubClass: 'WORLD',
          currency: 'EUR',
          date: new Date('2024-01-01T00:00:00.000Z'),
          fee: 0,
          name: 'ETF A',
          quantity: 100,
          symbol: 'AAA',
          type: 'BUY',
          unitPrice: 10,
          unitPriceInAssetProfileCurrency: 10,
          valueInBaseCurrency: 1000
        } as Activity
      ],
      allocations: [{ percentage: 100, symbol: 'AAA' }],
      currentDate: new Date('2025-01-01T00:00:00.000Z'),
      holdings: [
        {
          allocationInPercentage: 100,
          currency: 'EUR',
          marketPrice: 10,
          name: 'ETF A',
          quantity: 100,
          symbol: 'AAA',
          valueInBaseCurrency: 1000
        } as Holding
      ],
      monthlySavingsRate: 0,
      taxEvents: [],
      taxProfile: DEFAULT_TAX_PROFILE,
      withdrawalPoints: [
        {
          date: new Date('2026-01-01T00:00:00.000Z'),
          periodIndex: 0,
          withdrawal: 1000
        }
      ],
      withdrawalStartDate: new Date('2025-01-01T00:00:00.000Z')
    });
    const sixPercentReturnEstimate = calculateFutureFifoWithdrawalPlan({
      accumulationAnnualReturnPercentage: 0,
      accumulationMonths: 0,
      activities: [
        {
          accountId: 'acc-1',
          accountName: 'Main',
          assetClass: 'ETF',
          assetSubClass: 'WORLD',
          currency: 'EUR',
          date: new Date('2024-01-01T00:00:00.000Z'),
          fee: 0,
          name: 'ETF A',
          quantity: 100,
          symbol: 'AAA',
          type: 'BUY',
          unitPrice: 10,
          unitPriceInAssetProfileCurrency: 10,
          valueInBaseCurrency: 1000
        } as Activity
      ],
      allocations: [{ percentage: 100, symbol: 'AAA' }],
      currentDate: new Date('2025-01-01T00:00:00.000Z'),
      holdings: [
        {
          allocationInPercentage: 100,
          currency: 'EUR',
          marketPrice: 10,
          name: 'ETF A',
          quantity: 100,
          symbol: 'AAA',
          valueInBaseCurrency: 1000
        } as Holding
      ],
      monthlySavingsRate: 0,
      taxEvents: [],
      taxProfile: DEFAULT_TAX_PROFILE,
      withdrawalAnnualReturnPercentage: 6,
      withdrawalPoints: [
        {
          date: new Date('2026-01-01T00:00:00.000Z'),
          periodIndex: 0,
          withdrawal: 1000
        }
      ],
      withdrawalStartDate: new Date('2025-01-01T00:00:00.000Z')
    });

    expect(sixPercentReturnEstimate.get(0)?.gain).toBeGreaterThan(zeroReturnEstimate.get(0)?.gain ?? 0);
  });
});
