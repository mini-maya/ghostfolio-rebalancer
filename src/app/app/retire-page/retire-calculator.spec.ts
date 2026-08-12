import {
  calculateRetirementProjection,
  type RetirementProjectionInput
} from './retire-calculator';

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
    expect(result.firstWithdrawal).toBe(200);
    expect(result.lastWithdrawal).toBe(200);
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
    expect(result.totalContributions).toBe(200);
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
});
