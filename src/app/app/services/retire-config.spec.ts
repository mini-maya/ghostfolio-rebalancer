import { normalizeRetireConfig } from './retire-config';

describe('normalizeRetireConfig', () => {
  it('merges partial retire settings with defaults', () => {
    expect(
      normalizeRetireConfig({
        monthlySavingsRate: 2500,
        withdrawalStartMonth: '2035-07'
      })
    ).toEqual({
      accumulationAnnualReturnPercentage: 6,
      annualInflationPercentage: 2,
      capitalAtWithdrawalStart: 0,
      capitalPreservationPercentage: 10,
      frequency: 'monthly',
      monthlySavingsRate: 2500,
      projectionYears: 25,
      withdrawalAnnualReturnPercentage: 6,
      withdrawalStarted: false,
      withdrawalStartMonth: '2035-07'
    });
  });
});
