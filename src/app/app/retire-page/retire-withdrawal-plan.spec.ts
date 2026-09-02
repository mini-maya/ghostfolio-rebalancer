import { DEFAULT_TAX_PROFILE } from '../services/tax-calculator';
import { calculateNextWithdrawalSellPlan } from './retire-withdrawal-plan';

describe('calculateNextWithdrawalSellPlan', () => {
  it('sells from overweight symbols first', () => {
    const plan = calculateNextWithdrawalSellPlan({
      allocations: [
        { percentage: 50, symbol: 'AAA' },
        { percentage: 50, symbol: 'BBB' }
      ],
      holdings: [
        {
          allocationInPercentage: 70,
          currency: 'EUR',
          marketPrice: 10,
          name: 'Asset A',
          quantity: 7,
          symbol: 'AAA',
          valueInBaseCurrency: 70
        },
        {
          allocationInPercentage: 30,
          currency: 'EUR',
          marketPrice: 10,
          name: 'Asset B',
          quantity: 3,
          symbol: 'BBB',
          valueInBaseCurrency: 30
        }
      ],
      withdrawalAmount: 20
    });

    const rowA = plan.rows.find((row) => row.symbol === 'AAA');
    const rowB = plan.rows.find((row) => row.symbol === 'BBB');

    expect(plan.totalPlannedSell).toBe(20);
    expect(rowA?.sellAmount).toBe(20);
    expect(rowA?.sharesToSell).toBe(2);
    expect(rowB?.sellAmount).toBe(0);
  });

  it('uses target-weight fallback if overweight positions are insufficient', () => {
    const plan = calculateNextWithdrawalSellPlan({
      allocations: [{ percentage: 100, symbol: 'AAA' }],
      holdings: [
        {
          allocationInPercentage: 20,
          currency: 'EUR',
          marketPrice: 10,
          name: 'Asset A',
          quantity: 2,
          symbol: 'AAA',
          valueInBaseCurrency: 20
        },
        {
          allocationInPercentage: 80,
          currency: 'EUR',
          marketPrice: 10,
          name: 'Asset B',
          quantity: 8,
          symbol: 'BBB',
          valueInBaseCurrency: 80
        }
      ],
      withdrawalAmount: 20
    });

    const rowA = plan.rows.find((row) => row.symbol === 'AAA');

    expect(plan.totalPlannedSell).toBe(20);
    expect(rowA?.sellAmount).toBe(20);
  });

  it('caps planned sell amount to current portfolio value', () => {
    const plan = calculateNextWithdrawalSellPlan({
      allocations: [{ percentage: 100, symbol: 'AAA' }],
      holdings: [
        {
          allocationInPercentage: 100,
          currency: 'EUR',
          marketPrice: 10,
          name: 'Asset A',
          quantity: 5,
          symbol: 'AAA',
          valueInBaseCurrency: 50
        }
      ],
      withdrawalAmount: 500
    });

    expect(plan.requestedSellAmount).toBe(50);
    expect(plan.totalPlannedSell).toBe(50);
    expect(plan.rows[0].sharesToSell).toBe(5);
  });

  it('keeps allocation-based residual ETF value when a preservation floor is configured', () => {
    const plan = calculateNextWithdrawalSellPlan({
      allocations: [
        { percentage: 50, symbol: 'AAA' },
        { percentage: 50, symbol: 'BBB' }
      ],
      holdings: [
        {
          allocationInPercentage: 50,
          currency: 'EUR',
          marketPrice: 1,
          name: 'Asset A',
          quantity: 100,
          symbol: 'AAA',
          valueInBaseCurrency: 100
        },
        {
          allocationInPercentage: 50,
          currency: 'EUR',
          marketPrice: 1,
          name: 'Asset B',
          quantity: 100,
          symbol: 'BBB',
          valueInBaseCurrency: 100
        }
      ],
      minimumRemainingValueBySymbol: new Map([
        ['AAA', 60],
        ['BBB', 60]
      ]),
      withdrawalAmount: 140
    });

    const rowA = plan.rows.find((row) => row.symbol === 'AAA');
    const rowB = plan.rows.find((row) => row.symbol === 'BBB');

    expect(plan.totalPlannedSell).toBe(80);
    expect(rowA?.sellAmount).toBe(40);
    expect(rowB?.sellAmount).toBe(40);
    expect(rowA?.remainingValue).toBe(60);
    expect(rowB?.remainingValue).toBe(60);
  });

  describe('sellWholeSharesOnly', () => {
    it('sells fractional shares by default (flag omitted)', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [
          {
            allocationInPercentage: 100,
            currency: 'EUR',
            marketPrice: 3,
            name: 'Asset A',
            quantity: 10,
            symbol: 'AAA',
            valueInBaseCurrency: 30
          }
        ],
        withdrawalAmount: 10
      });

      expect(plan.totalPlannedSell).toBe(10);
      expect(plan.rows[0].sharesToSell).toBeCloseTo(3.333333, 5);
    });

    it('floors the sell amount to a whole number of shares when enabled', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [
          {
            allocationInPercentage: 100,
            currency: 'EUR',
            marketPrice: 3,
            name: 'Asset A',
            quantity: 10,
            symbol: 'AAA',
            valueInBaseCurrency: 30
          }
        ],
        sellWholeSharesOnly: true,
        withdrawalAmount: 10
      });

      expect(plan.rows[0].sharesToSell).toBe(3);
      expect(plan.rows[0].sellAmount).toBe(9);
      expect(plan.totalPlannedSell).toBe(9);
      expect(plan.totalPlannedSell).toBeLessThan(plan.requestedSellAmount);
    });

    it('greedily fills the shortfall using shares from other symbols to get closer to the requested amount', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [
          { percentage: 50, symbol: 'AAA' },
          { percentage: 50, symbol: 'BBB' }
        ],
        holdings: [
          {
            allocationInPercentage: 50,
            currency: 'EUR',
            marketPrice: 7,
            name: 'Asset A',
            quantity: 100,
            symbol: 'AAA',
            valueInBaseCurrency: 700
          },
          {
            allocationInPercentage: 50,
            currency: 'EUR',
            marketPrice: 4,
            name: 'Asset B',
            quantity: 100,
            symbol: 'BBB',
            valueInBaseCurrency: 700
          }
        ],
        sellWholeSharesOnly: true,
        withdrawalAmount: 11
      });

      const rowA = plan.rows.find((row) => row.symbol === 'AAA');
      const rowB = plan.rows.find((row) => row.symbol === 'BBB');

      expect(plan.totalPlannedSell).toBe(11);
      expect(rowA?.sharesToSell).toBe(1);
      expect(rowA?.sellAmount).toBe(7);
      expect(rowB?.sharesToSell).toBe(1);
      expect(rowB?.sellAmount).toBe(4);
    });

    it('never sells more whole shares than are owned, even if cash capacity would allow it', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [
          {
            allocationInPercentage: 100,
            currency: 'EUR',
            marketPrice: 10,
            name: 'Asset A',
            quantity: 2.5,
            symbol: 'AAA',
            valueInBaseCurrency: 25
          }
        ],
        sellWholeSharesOnly: true,
        withdrawalAmount: 100
      });

      expect(plan.rows[0].sharesToSell).toBe(2);
      expect(plan.rows[0].sellAmount).toBe(20);
      expect(plan.totalPlannedSell).toBe(20);
      expect(plan.totalPlannedSell).toBeLessThan(plan.requestedSellAmount);
    });

    it('never exceeds the requested withdrawal amount, even with a minimum remaining value cap', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [
          { percentage: 50, symbol: 'AAA' },
          { percentage: 50, symbol: 'BBB' }
        ],
        holdings: [
          {
            allocationInPercentage: 50,
            currency: 'EUR',
            marketPrice: 3,
            name: 'Asset A',
            quantity: 100,
            symbol: 'AAA',
            valueInBaseCurrency: 100
          },
          {
            allocationInPercentage: 50,
            currency: 'EUR',
            marketPrice: 3,
            name: 'Asset B',
            quantity: 100,
            symbol: 'BBB',
            valueInBaseCurrency: 100
          }
        ],
        minimumRemainingValueBySymbol: new Map([
          ['AAA', 60],
          ['BBB', 60]
        ]),
        sellWholeSharesOnly: true,
        withdrawalAmount: 140
      });

      const rowA = plan.rows.find((row) => row.symbol === 'AAA');
      const rowB = plan.rows.find((row) => row.symbol === 'BBB');

      expect(plan.totalPlannedSell).toBeLessThanOrEqual(plan.requestedSellAmount);
      expect(Number.isInteger(rowA?.sharesToSell)).toBeTrue();
      expect(Number.isInteger(rowB?.sharesToSell)).toBeTrue();
      expect(rowA?.remainingValue ?? 0).toBeGreaterThanOrEqual(60);
      expect(rowB?.remainingValue ?? 0).toBeGreaterThanOrEqual(60);
    });
  });

  describe('Sparer-Pauschbetrag', () => {
    const holdingAAA = {
      allocationInPercentage: 100,
      currency: 'EUR',
      marketPrice: 100,
      name: 'Asset A',
      quantity: 10,
      symbol: 'AAA',
      valueInBaseCurrency: 1000
    };

    it('taxes the full taxable gain when no allowance remains for the year', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [holdingAAA],
        sparerPauschbetragRemainingForYear: 0,
        symbolTaxDataBySymbol: new Map([['AAA', { costBasis: 200, grossVap: 100, taxableVap: 70 }]]),
        withdrawalAmount: 500
      });

      // soldFraction = 0.5 -> acquisitionCost 100, usedVap 50; gain = 500-100-50 = 350;
      // taxable (70% after Teilfreistellung) = 245; fully taxed since no allowance remains.
      expect(plan.rows[0].estimatedTax).toBe(64.62);
      expect(plan.sparerPauschbetragUsed).toBe(0);
      expect(plan.sparerPauschbetragRemainingAfter).toBe(0);
    });

    it('fully shelters the taxable gain when the whole annual allowance is still available', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [holdingAAA],
        sparerPauschbetragRemainingForYear: 1000,
        symbolTaxDataBySymbol: new Map([['AAA', { costBasis: 200, grossVap: 100, taxableVap: 70 }]]),
        withdrawalAmount: 500
      });

      expect(plan.rows[0].estimatedTax).toBe(0);
      expect(plan.sparerPauschbetragUsed).toBe(245);
      expect(plan.sparerPauschbetragRemainingAfter).toBe(755);
    });

    it('applies only the partially remaining allowance and taxes the rest', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [holdingAAA],
        sparerPauschbetragRemainingForYear: 100,
        symbolTaxDataBySymbol: new Map([['AAA', { costBasis: 200, grossVap: 100, taxableVap: 70 }]]),
        withdrawalAmount: 500
      });

      // 245 taxable minus 100 remaining allowance = 145 taxable; 145 * 25% = 36.25,
      // plus 5,5% Soli on that (1.99375) => 38.24.
      expect(plan.sparerPauschbetragUsed).toBe(100);
      expect(plan.sparerPauschbetragRemainingAfter).toBe(0);
      expect(plan.rows[0].estimatedTax).toBe(38.24);
    });

    it('defaults to the configured annual allowance when the caller does not track remaining state', () => {
      const plan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [holdingAAA],
        symbolTaxDataBySymbol: new Map([['AAA', { costBasis: 200, grossVap: 100, taxableVap: 70 }]]),
        withdrawalAmount: 500
      });

      expect(plan.sparerPauschbetragUsed).toBe(245);
      expect(plan.sparerPauschbetragRemainingAfter).toBe(DEFAULT_TAX_PROFILE.sparerPauschbetrag - 245);
    });

    it('shares a single allowance across multiple symbols sold in the same withdrawal', () => {
      const holdingBBB = {
        allocationInPercentage: 100,
        currency: 'EUR',
        marketPrice: 100,
        name: 'Asset B',
        quantity: 10,
        symbol: 'BBB',
        valueInBaseCurrency: 1000
      };

      const combinedPlan = calculateNextWithdrawalSellPlan({
        allocations: [
          { percentage: 50, symbol: 'AAA' },
          { percentage: 50, symbol: 'BBB' }
        ],
        holdings: [holdingAAA, holdingBBB],
        sparerPauschbetragRemainingForYear: 1000,
        symbolTaxDataBySymbol: new Map([
          ['AAA', { costBasis: 0, grossVap: 0, taxableVap: 0 }],
          ['BBB', { costBasis: 0, grossVap: 0, taxableVap: 0 }]
        ]),
        // Sell both positions in full: 700 EUR taxable gain (after 30% Teilfreistellung) each,
        // 1.400 EUR combined - above the 1.000 EUR annual allowance.
        withdrawalAmount: 2000
      });
      const singleSymbolPlan = calculateNextWithdrawalSellPlan({
        allocations: [{ percentage: 100, symbol: 'AAA' }],
        holdings: [holdingAAA],
        sparerPauschbetragRemainingForYear: 1000,
        symbolTaxDataBySymbol: new Map([['AAA', { costBasis: 0, grossVap: 0, taxableVap: 0 }]]),
        withdrawalAmount: 1000
      });

      // Selling only AAA's 700 EUR taxable gain alone stays fully within the 1.000 EUR
      // allowance and is tax free...
      expect(singleSymbolPlan.rows[0].estimatedTax).toBe(0);
      // ...but selling AAA and BBB together must share the *same* 1.000 EUR allowance instead
      // of each symbol getting its own, so 400 EUR combined remains taxable.
      expect(combinedPlan.sparerPauschbetragUsed).toBe(1000);
      expect(combinedPlan.sparerPauschbetragRemainingAfter).toBe(0);
      expect(combinedPlan.estimatedTaxTotal).toBeGreaterThan(0);
    });
  });
});
