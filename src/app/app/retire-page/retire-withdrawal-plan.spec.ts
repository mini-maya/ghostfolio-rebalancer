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
});
