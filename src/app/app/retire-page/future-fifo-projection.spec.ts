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
    //
    // The resulting taxable sale gain (~62,88 EUR after VAP and Teilfreistellung) is fully
    // covered by the default annual Sparer-Pauschbetrag (1.000 EUR), so the actual 2026 tax owed
    // is 0 - not the pre-allowance amount that calculateTaxForSale alone would report.
    expect(
      calculateTaxForSale({
        acquisitionCost: 10,
        saleProceeds: 100,
        taxProfile: DEFAULT_TAX_PROFILE,
        usedVap: 0.175
      })
    ).toBeCloseTo(16.58, 2);
    expect(estimate?.tax).toBe(0);
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

  it('shares a single annual Sparer-Pauschbetrag across multiple withdrawals within the same calendar year', () => {
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
          date: new Date('2026-01-01T00:00:00.000Z'),
          fee: 0,
          name: 'ETF A',
          quantity: 1000,
          symbol: 'AAA',
          type: 'BUY',
          unitPrice: 1,
          unitPriceInAssetProfileCurrency: 1,
          valueInBaseCurrency: 1000
        } as Activity
      ],
      allocations: [{ percentage: 100, symbol: 'AAA' }],
      currentDate: new Date('2026-01-01T00:00:00.000Z'),
      holdings: [
        {
          allocationInPercentage: 100,
          currency: 'EUR',
          marketPrice: 3,
          name: 'ETF A',
          quantity: 1000,
          symbol: 'AAA',
          valueInBaseCurrency: 3000
        } as Holding
      ],
      monthlySavingsRate: 0,
      taxEvents: [],
      taxProfile: DEFAULT_TAX_PROFILE,
      withdrawalAnnualReturnPercentage: 0,
      withdrawalPoints: [
        // Sells 500 of the 1.000 shares at 3 EUR each (1.500 EUR gross), for a taxable gain
        // (after 30% Teilfreistellung) of 500 * (3 - 1) * 0.7 = 700 EUR.
        { date: new Date('2026-02-01T00:00:00.000Z'), periodIndex: 0, withdrawal: 1500 },
        // Sells the remaining 500 shares, an identical 700 EUR taxable gain, within the same
        // calendar year.
        { date: new Date('2026-06-01T00:00:00.000Z'), periodIndex: 1, withdrawal: 1500 }
      ],
      withdrawalStartDate: new Date('2026-01-01T00:00:00.000Z')
    });

    const firstWithdrawal = estimates.get(0);
    const secondWithdrawal = estimates.get(1);

    // Taken alone, 700 EUR taxable gain is fully covered by the default 1.000 EUR annual
    // Sparer-Pauschbetrag, so the first withdrawal of the year is tax free...
    expect(firstWithdrawal?.tax).toBe(0);
    // ...but by the time the second withdrawal is sold, the shared annual allowance (1.000 EUR)
    // has already been used up by the first 700 EUR, leaving only 300 EUR of it for the combined
    // 1.400 EUR of taxable gains realized this year. So 400 EUR remains taxable, taxed at the
    // effective 26,375 % rate (25 % KapSt + 5,5 % Soli) = 105,50 EUR - not 0, as it would be if
    // the allowance were (incorrectly) granted anew for each withdrawal.
    expect(secondWithdrawal?.tax).toBeCloseTo(105.5, 2);
  });
});
