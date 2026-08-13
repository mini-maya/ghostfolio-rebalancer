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
});
