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
    expect(plan.remainingUnplannedSell).toBe(0);
    expect(plan.rows[0].sharesToSell).toBe(5);
  });
});
