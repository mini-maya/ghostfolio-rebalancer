import {
  calculateRetirementProjection,
  type RetirementProjectionInput
} from './retire-calculator';
import { DEFAULT_TAX_PROFILE, calculateTaxForSale } from '../services/tax-calculator';

describe('calculateRetirementProjection', () => {
  const baseInput: RetirementProjectionInput = {
    accumulationAnnualReturnPercentage: 0,
    accumulationMonthlyContribution: 0,
    accumulationMonths: 0,
    annualInflationPercentage: 0,
    capitalPreservationPercentage: 0,
    frequency: 'yearly',
    projectionYears: 5,
    startingCapital: 1000,
    withdrawalAnnualReturnPercentage: 0
  };

  it('spreads withdrawals evenly without return, inflation or preservation target', () => {
    const result = calculateRetirementProjection(baseInput, new Date('2026-01-01T00:00:00.000Z'));

    expect(result.points).toHaveSize(5);
    expect(result.capitalAtWithdrawalStart).toBe(1000);
    expect(result.points[0].date).toBe('2026-01-01');
    expect(result.points.at(-1)?.date).toBe('2030-01-01');
    expect(result.firstWithdrawal).toBeCloseTo(200, 2);
    expect(result.lastWithdrawal).toBeCloseTo(200, 2);
    expect(result.totalWithdrawals).toBe(1000);
    expect(result.endingCapital).toBe(0);
  });

  it('keeps the configured share of capital at the end of the projection', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
        capitalPreservationPercentage: 40
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.targetCapital).toBe(400);
    expect(result.endingCapital).toBe(400);
    expect(result.totalWithdrawals).toBe(600);
  });

  it('uses the saved snapshot only for the minimum portfolio value, not for the live projection base', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
        capitalAtWithdrawalStart: 2000,
        capitalPreservationPercentage: 10,
        startingCapital: 1500
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.capitalAtWithdrawalStart).toBe(2000);
    expect(result.targetCapital).toBe(200);
    expect(result.firstWithdrawal).toBeGreaterThan(0);
  });

  it('bases capital preservation on the withdrawal phase starting capital', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
        accumulationAnnualReturnPercentage: 12,
        accumulationMonthlyContribution: 100,
        accumulationMonths: 2,
        capitalPreservationPercentage: 50,
        projectionYears: 1
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.capitalAtWithdrawalStart).toBeCloseTo(1220.02, 2);
    expect(result.targetCapital).toBeCloseTo(610.01, 2);
  });

  it('stops withdrawals if the real portfolio falls to or below the preservation floor', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
        capitalAtWithdrawalStart: 1000,
        capitalPreservationPercentage: 10,
        startingCapital: 90,
        projectionYears: 2
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.targetCapital).toBe(100);
    expect(result.firstWithdrawal).toBe(0);
    expect(result.totalWithdrawals).toBe(0);
  });

  it('raises later withdrawals when annual inflation is configured', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
        annualInflationPercentage: 5,
        frequency: 'monthly',
        projectionYears: 2
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.points[0].withdrawal).toBeLessThan(result.points[12].withdrawal);
    expect(result.points[23].date).toBe('2027-12-01');
  });

  it('grows the portfolio during the savings phase before withdrawals start', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
        accumulationAnnualReturnPercentage: 12,
        accumulationMonthlyContribution: 100,
        accumulationMonths: 2,
        projectionYears: 1
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.points[0].phase).toBe('accumulation');
    expect(result.points[1].phase).toBe('accumulation');
    expect(result.capitalAtWithdrawalStart).toBeCloseTo(1220.02, 2);
    expect(result.firstWithdrawal).toBeCloseTo(1220.02, 2);
  });

  it('uses a separate withdrawal return assumption after the savings phase', () => {
    const lowerReturnResult = calculateRetirementProjection(
      {
        ...baseInput,
        projectionYears: 2,
        withdrawalAnnualReturnPercentage: 0
      },
      new Date('2026-01-01T00:00:00.000Z')
    );
    const higherReturnResult = calculateRetirementProjection(
      {
        ...baseInput,
        projectionYears: 2,
        withdrawalAnnualReturnPercentage: 8
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(higherReturnResult.firstWithdrawal).toBeGreaterThan(lowerReturnResult.firstWithdrawal);
  });

  it('attaches FIFO gain, tax and net withdrawal values to withdrawal points when lot data is available', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
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
          }
        ],
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [
          {
            allocationInPercentage: 100,
            currency: 'EUR',
            marketPrice: 100,
            name: 'ETF A',
            quantity: 2,
            symbol: 'AAA',
            valueInBaseCurrency: 200
          }
        ],
        taxProfile: DEFAULT_TAX_PROFILE
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    const firstWithdrawalPoint = result.points.find((point) => point.phase === 'withdrawal');

    expect(firstWithdrawalPoint?.gain).toBe(90);
    // Both lots were acquired in 2024, already a fully completed past year by the 2026 sale
    // date. Even without a real TaxEvent, the shared engine now fills in a synthetic
    // Vorabpauschale for 2024 (based on the real 2024 -> 2026 price development), which
    // correctly reduces the taxable gain instead of silently ignoring prior-year VAP.
    //
    // The resulting taxable sale gain (~62,88 EUR after VAP and Teilfreistellung) is fully
    // covered by the default annual Sparer-Pauschbetrag (1.000 EUR), so the actual 2026 tax
    // owed is 0 - not the pre-allowance amount that calculateTaxForSale alone would report.
    expect(
      calculateTaxForSale({
        acquisitionCost: 110,
        saleProceeds: 200,
        taxProfile: DEFAULT_TAX_PROFILE,
        usedVap: 0.175
      })
    ).toBeCloseTo(16.58, 2);
    expect(firstWithdrawalPoint?.tax).toBe(0);
    expect(firstWithdrawalPoint?.netWithdrawal).toBeCloseTo(
      200 - (firstWithdrawalPoint?.tax ?? 0),
      2
    );
  });

  it('exposes projection summary values for the retire stats cards', () => {
    const result = calculateRetirementProjection(
      {
        ...baseInput,
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
            quantity: 10,
            symbol: 'AAA',
            type: 'BUY',
            unitPrice: 100,
            unitPriceInAssetProfileCurrency: 100,
            valueInBaseCurrency: 1000
          }
        ],
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        accumulationAnnualReturnPercentage: 6,
        accumulationMonthlyContribution: 100,
        accumulationMonths: 13,
        holdings: [
          {
            allocationInPercentage: 100,
            currency: 'EUR',
            marketPrice: 120,
            name: 'ETF A',
            quantity: 10,
            symbol: 'AAA',
            valueInBaseCurrency: 1200
          }
        ],
        projectionYears: 1,
        taxProfile: DEFAULT_TAX_PROFILE
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.projectedVapTotal).toBeGreaterThan(0);
    expect(result.taxableVapTotal).toBeGreaterThan(0);
    expect(result.openTaxAtWithdrawalStart).toBeGreaterThanOrEqual(0);
    // The small taxable VAP here fits well within the default 1.000 EUR annual allowance, so
    // the allowance-aware tax estimate should be zero (fully sheltered) and most of the
    // allowance remains unused.
    expect(result.openTaxAtWithdrawalStartAfterAllowance).toBe(0);
    expect(result.sparerPauschbetragUsedTotal).toBeGreaterThan(0);
    expect(result.sparerPauschbetragUsedTotal).toBeLessThanOrEqual(DEFAULT_TAX_PROFILE.sparerPauschbetrag);
    expect(result.sparerPauschbetragUnusedTotal).toBeGreaterThan(0);
    // The realized sale gain is fully sheltered by the allowance, so no sale tax is actually
    // paid during the withdrawal phase.
    expect(result.soldTaxTotal).toBe(0);
    // soldTaxTotalBeforeAllowance can never be lower than the allowance-aware soldTaxTotal.
    expect(result.soldTaxTotalBeforeAllowance).toBeGreaterThanOrEqual(result.soldTaxTotal);
  });

  it('reduces the allowance-aware open tax estimate once the annual Sparer-Pauschbetrag is exceeded', () => {
    // A large, long-held position generates enough taxable VAP across the years to exceed the
    // default 1.000 EUR annual allowance, so the allowance-aware estimate must be strictly lower
    // than (and never higher than) the pre-allowance estimate.
    const result = calculateRetirementProjection(
      {
        ...baseInput,
        activities: [
          {
            accountId: 'acc-1',
            accountName: 'Main',
            assetClass: 'ETF',
            assetSubClass: 'WORLD',
            currency: 'EUR',
            date: new Date('2015-01-01T00:00:00.000Z'),
            fee: 0,
            name: 'ETF A',
            quantity: 1000,
            symbol: 'AAA',
            type: 'BUY',
            unitPrice: 100,
            unitPriceInAssetProfileCurrency: 100,
            valueInBaseCurrency: 100000
          }
        ],
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        accumulationAnnualReturnPercentage: 6,
        accumulationMonthlyContribution: 100,
        accumulationMonths: 13,
        holdings: [
          {
            allocationInPercentage: 100,
            currency: 'EUR',
            marketPrice: 300,
            name: 'ETF A',
            quantity: 1000,
            symbol: 'AAA',
            valueInBaseCurrency: 300000
          }
        ],
        projectionYears: 1,
        taxProfile: DEFAULT_TAX_PROFILE
      },
      new Date('2026-01-01T00:00:00.000Z')
    );

    expect(result.openTaxAtWithdrawalStart).toBeGreaterThan(0);
    expect(result.openTaxAtWithdrawalStartAfterAllowance).toBeGreaterThan(0);
    expect(result.openTaxAtWithdrawalStartAfterAllowance).toBeLessThan(
      result.openTaxAtWithdrawalStart
    );
    // The allowance is fully used up by such a large gain across the multi-year holding period,
    // so nothing remains unused.
    expect(result.sparerPauschbetragUsedTotal).toBeGreaterThan(0);
    expect(result.sparerPauschbetragUnusedTotal).toBe(0);
    // soldTaxTotal aggregates the already allowance-aware per-period tax across the whole
    // withdrawal phase (here just a single withdrawal), so it must match that period's tax and
    // be strictly greater than zero once the allowance is exceeded.
    const withdrawalPointTaxSum = result.points
      .filter((point) => point.phase === 'withdrawal')
      .reduce((sum, point) => sum + point.tax, 0);
    expect(result.soldTaxTotal).toBe(withdrawalPointTaxSum);
    expect(result.soldTaxTotal).toBeGreaterThan(0);
    // soldTaxTotalBeforeAllowance can never be lower than the allowance-aware soldTaxTotal. In
    // this fixture the annual VAP alone (on a 300k+ position) already exceeds the 1.000 EUR
    // annual allowance, so by the time the withdrawal's own sale gain is considered, that year's
    // allowance is already fully consumed - the sale itself receives no further reduction, so
    // before/after can legitimately be equal here (not a bug - see the dedicated allowance-sharing
    // test in future-fifo-projection.spec.ts for a case where the sale itself is still reduced).
    expect(result.soldTaxTotalBeforeAllowance).toBeGreaterThanOrEqual(result.soldTaxTotal);
  });
});
