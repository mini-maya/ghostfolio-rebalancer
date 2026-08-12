import { addMonths, addYears, format } from 'date-fns';

export type WithdrawalFrequency = 'monthly' | 'yearly';

export interface RetirementProjectionInput {
  accumulationAnnualReturnPercentage: number;
  accumulationMonthlyContribution: number;
  accumulationMonths: number;
  annualInflationPercentage: number;
  capitalPreservationPercentage: number;
  frequency: WithdrawalFrequency;
  projectionYears: number;
  startingCapital: number;
  withdrawalAnnualReturnPercentage: number;
}

export interface RetirementProjectionPoint {
  contribution: number;
  date: string;
  endingBalance: number;
  growth: number;
  phase: 'accumulation' | 'withdrawal';
  periodIndex: number;
  withdrawal: number;
}

export interface RetirementProjectionResult {
  capitalAtWithdrawalStart: number;
  endingCapital: number;
  firstWithdrawal: number;
  lastWithdrawal: number;
  points: RetirementProjectionPoint[];
  targetCapital: number;
  totalContributions: number;
  totalGrowth: number;
  totalWithdrawals: number;
}

const DATE_FORMAT = 'yyyy-MM-dd';

export function calculateRetirementProjection(
  input: RetirementProjectionInput,
  startDate = new Date()
): RetirementProjectionResult {
  const frequency = input.frequency === 'yearly' ? 'yearly' : 'monthly';
  const periodsPerYear = frequency === 'yearly' ? 1 : 12;
  const projectionYears = Math.max(Math.round(input.projectionYears), 1);
  const totalPeriods = projectionYears * periodsPerYear;
  const accumulationMonths = Math.max(Math.round(input.accumulationMonths), 0);
  const startingCapital = Math.max(input.startingCapital, 0);
  const accumulationAnnualReturnRate =
    Math.max(input.accumulationAnnualReturnPercentage, 0) / 100;
  const capitalPreservationRatio = clampToPercentage(input.capitalPreservationPercentage) / 100;
  const withdrawalAnnualReturnRate =
    Math.max(input.withdrawalAnnualReturnPercentage, 0) / 100;
  const annualInflationRate = Math.max(input.annualInflationPercentage, 0) / 100;
  const accumulationMonthlyContribution = Math.max(input.accumulationMonthlyContribution, 0);
  const accumulationPeriodicReturnRate = Math.pow(1 + accumulationAnnualReturnRate, 1 / 12) - 1;
  const periodicReturnRate = Math.pow(1 + withdrawalAnnualReturnRate, 1 / periodsPerYear) - 1;
  const targetCapital = roundToTwo(startingCapital * capitalPreservationRatio);
  const points: RetirementProjectionPoint[] = [];
  let capital = startingCapital;

  for (let periodIndex = 0; periodIndex < accumulationMonths; periodIndex += 1) {
    const growth = roundToTwo(capital * accumulationPeriodicReturnRate);
    const contribution = roundToTwo(accumulationMonthlyContribution);
    const endingBalance = roundToTwo(capital + growth + contribution);

    points.push({
      contribution,
      date: formatProjectionDate({
        frequency: 'monthly',
        periodIndex,
        startDate
      }),
      endingBalance,
      growth,
      phase: 'accumulation',
      periodIndex,
      withdrawal: 0
    });

    capital = endingBalance;
  }

  const capitalAtWithdrawalStart = roundToTwo(capital);
  const withdrawalStartDate = addMonths(startDate, accumulationMonths);
  const withdrawalPoints: RetirementProjectionPoint[] = [];

  for (let periodIndex = 0; periodIndex < totalPeriods; periodIndex += 1) {
    const remainingPeriods = totalPeriods - periodIndex;
    const withdrawal = roundToTwo(
      Math.max(
        solveWithdrawalAmount({
          annualInflationRate,
          capital,
          currentPeriodIndex: periodIndex,
          periodicReturnRate,
          periodsPerYear,
          remainingPeriods,
          targetCapital
        }),
        0
      )
    );
    const growth = roundToTwo(capital * periodicReturnRate);
    const endingBalance = roundToTwo(Math.max(capital + growth - withdrawal, 0));

    const point: RetirementProjectionPoint = {
      contribution: 0,
      date: formatProjectionDate({
        frequency,
        periodIndex,
        startDate: withdrawalStartDate
      }),
      endingBalance,
      growth,
      phase: 'withdrawal',
      periodIndex,
      withdrawal
    };

    points.push(point);
    withdrawalPoints.push(point);

    capital = endingBalance;
  }

  return {
    capitalAtWithdrawalStart,
    endingCapital: withdrawalPoints.at(-1)?.endingBalance ?? capitalAtWithdrawalStart,
    firstWithdrawal: withdrawalPoints[0]?.withdrawal ?? 0,
    lastWithdrawal: withdrawalPoints.at(-1)?.withdrawal ?? 0,
    points,
    targetCapital,
    totalContributions: roundToTwo(points.reduce((sum, point) => sum + point.contribution, 0)),
    totalGrowth: roundToTwo(points.reduce((sum, point) => sum + point.growth, 0)),
    totalWithdrawals: roundToTwo(points.reduce((sum, point) => sum + point.withdrawal, 0))
  };
}

function solveWithdrawalAmount({
  annualInflationRate,
  capital,
  currentPeriodIndex,
  periodicReturnRate,
  periodsPerYear,
  remainingPeriods,
  targetCapital
}: {
  annualInflationRate: number;
  capital: number;
  currentPeriodIndex: number;
  periodicReturnRate: number;
  periodsPerYear: number;
  remainingPeriods: number;
  targetCapital: number;
}): number {
  const grossFutureCapital = capital * Math.pow(1 + periodicReturnRate, remainingPeriods);
  const weightedWithdrawalFactor = Array.from({ length: remainingPeriods }, (_, offset) => {
    const inflationSteps =
      Math.floor((currentPeriodIndex + offset) / periodsPerYear) -
      Math.floor(currentPeriodIndex / periodsPerYear);

    return (
      Math.pow(1 + annualInflationRate, inflationSteps) *
      Math.pow(1 + periodicReturnRate, remainingPeriods - 1 - offset)
    );
  }).reduce((sum, value) => sum + value, 0);

  if (weightedWithdrawalFactor <= 0) {
    return 0;
  }

  return (grossFutureCapital - targetCapital) / weightedWithdrawalFactor;
}

function formatProjectionDate({
  frequency,
  periodIndex,
  startDate
}: {
  frequency: WithdrawalFrequency;
  periodIndex: number;
  startDate: Date;
}): string {
  return format(
    frequency === 'yearly'
      ? addYears(startDate, periodIndex)
      : addMonths(startDate, periodIndex),
    DATE_FORMAT
  );
}

function clampToPercentage(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
