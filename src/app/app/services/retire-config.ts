import type { WithdrawalFrequency } from '../retire-page/retire-calculator';

export interface RetireConfig {
  accumulationAnnualReturnPercentage: number;
  annualInflationPercentage: number;
  capitalAtWithdrawalStart: number;
  capitalPreservationPercentage: number;
  frequency: WithdrawalFrequency;
  monthlySavingsRate: number;
  projectionYears: number;
  withdrawalAnnualReturnPercentage: number;
  withdrawalStarted: boolean;
  withdrawalStartMonth: string;
}

export const DEFAULT_RETIRE_CONFIG: RetireConfig = {
  accumulationAnnualReturnPercentage: 6,
  annualInflationPercentage: 2,
  capitalAtWithdrawalStart: 0,
  capitalPreservationPercentage: 10,
  frequency: 'monthly',
  monthlySavingsRate: 1750,
  projectionYears: 25,
  withdrawalAnnualReturnPercentage: 6,
  withdrawalStarted: false,
  withdrawalStartMonth: ''
};

export function normalizeRetireConfig(
  retireConfig: Partial<RetireConfig> | null | undefined
): RetireConfig {
  return {
    ...DEFAULT_RETIRE_CONFIG,
    ...retireConfig
  };
}
