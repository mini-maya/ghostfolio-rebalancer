import { addMonths, addYears, endOfMonth, format } from 'date-fns';

import type { AllocationItem } from '../services/allocations';
import type { Activity, Holding } from '../services/ghostfolio-api';
import type { TaxProfile } from '../services/tax-calculator';
import type { TaxEvent } from '../services/tax-events';
import { calculateAnnualTaxSummaries, calculateTaxOverview } from '../services/tax-engine';
import {
  addContributionToLots,
  applyLotGrowth,
  calculateFutureFifoWithdrawalPlan,
  createFutureLotsFromCapital,
  portfolioValueFromLots,
  sellLotsForAmount,
  solveWithdrawalAmountForLots
} from './future-fifo-projection';
import {
  buildRetireTaxOverviewInput,
  calculateAnnualVapCashNeedSchedule,
  type AnnualVapCashNeedEntry
} from './retire-tax-simulation';

export type WithdrawalFrequency = 'monthly' | 'yearly';

export interface RetirementProjectionInput {
  activities?: Activity[];
  accumulationAnnualReturnPercentage: number;
  accumulationMonthlyContribution: number;
  accumulationMonths: number;
  annualInflationPercentage: number;
  capitalAtWithdrawalStart?: number;
  capitalPreservationPercentage: number;
  holdings?: Holding[];
  allocations?: AllocationItem[];
  frequency: WithdrawalFrequency;
  projectionYears: number;
  startingCapital: number;
  taxEvents?: TaxEvent[];
  taxProfile?: TaxProfile;
  withdrawalAnnualReturnPercentage: number;
}

export interface RetirementProjectionPoint {
  contribution: number;
  date: string;
  endingBalance: number;
  growth: number;
  gain: number;
  netWithdrawal: number;
  phase: 'accumulation' | 'withdrawal';
  periodIndex: number;
  tax: number;
  withdrawal: number;
}

export interface RetirementProjectionResult {
  capitalAtWithdrawalStart: number;
  endingCapital: number;
  firstWithdrawal: number;
  lastWithdrawal: number;
  openTaxAtWithdrawalStart: number;
  /**
   * Same as openTaxAtWithdrawalStart, but with the annual Sparer-Pauschbetrag applied once per
   * calendar year to the combined taxable VAP + taxable realized sale gains up to
   * withdrawalStartDate (see calculateAnnualTaxSummaries). This never changes the underlying VAP
   * itself - only the resulting tax estimate.
   */
  openTaxAtWithdrawalStartAfterAllowance: number;
  projectedVapTotal: number;
  taxableVapTotal: number;
  /** Sum of the annual Sparer-Pauschbetrag actually consumed across all years up to withdrawalStartDate. */
  sparerPauschbetragUsedTotal: number;
  /** Sum of the annual Sparer-Pauschbetrag that expired unused (never carried over) across all years up to withdrawalStartDate. */
  sparerPauschbetragUnusedTotal: number;
  /**
   * Sum of the tax actually incurred on sales across all withdrawal periods, already net of the
   * annual Sparer-Pauschbetrag (each period's tax comes from
   * calculateFutureWithdrawalTaxEstimates, which applies the allowance chronologically per
   * calendar year - see retire-tax-simulation.ts).
   */
  soldTaxTotal: number;
  /** Same as soldTaxTotal, but ignoring the Sparer-Pauschbetrag entirely. Always >= soldTaxTotal. */
  soldTaxTotalBeforeAllowance: number;
  points: RetirementProjectionPoint[];
  targetCapital: number;
  totalGrowth: number;
  totalWithdrawals: number;
  /**
   * Year-by-year schedule of the external cash needed to pay VAP tax (after the annual
   * Sparer-Pauschbetrag), spanning the whole projection (accumulation + withdrawal phase). VAP
   * tax is always paid externally (never reduces the simulated depot), so this shows how much
   * must be contributed each year once that year's allowance is exhausted.
   */
  annualVapCashNeedSchedule: AnnualVapCashNeedEntry[];
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
  const points: RetirementProjectionPoint[] = [];
  let lots = createFutureLotsFromCapital(startingCapital);
  let currentPrice = startingCapital > 0 ? startingCapital : 1;

  for (let periodIndex = 0; periodIndex < accumulationMonths; periodIndex += 1) {
    const startingValue = portfolioValueFromLots(lots, currentPrice);
    currentPrice = applyLotGrowth(currentPrice, accumulationPeriodicReturnRate);
    const grownValue = portfolioValueFromLots(lots, currentPrice);
    const growth = roundToTwo(grownValue - startingValue);
    lots = addContributionToLots(lots, accumulationMonthlyContribution, currentPrice);
    const endingBalance = roundToTwo(portfolioValueFromLots(lots, currentPrice));

    points.push({
      contribution: roundToTwo(accumulationMonthlyContribution),
      date: formatProjectionDate({
        frequency: 'monthly',
        periodIndex,
        startDate
      }),
      endingBalance,
      growth,
      gain: 0,
      netWithdrawal: 0,
      phase: 'accumulation',
      periodIndex,
      tax: 0,
      withdrawal: 0
    });
  }

  const capitalAtWithdrawalStart = roundToTwo(
    Math.max(input.capitalAtWithdrawalStart ?? portfolioValueFromLots(lots, currentPrice), 0)
  );
  const targetCapital = roundToTwo(capitalAtWithdrawalStart * capitalPreservationRatio);
  const withdrawalStartDate = addMonths(startDate, accumulationMonths);
  const withdrawalPoints: RetirementProjectionPoint[] = [];
  let capital = portfolioValueFromLots(lots, currentPrice);

  for (let periodIndex = 0; periodIndex < totalPeriods; periodIndex += 1) {
    const remainingPeriods = totalPeriods - periodIndex;
    const withdrawal = roundToTwo(
      Math.max(
        solveWithdrawalAmountForLots({
          annualInflationRate,
          currentPeriodIndex: periodIndex,
          currentPrice,
          currentWithdrawal: capital,
          initialLots: lots,
          periodicReturnRate,
          periodsPerYear,
          remainingPeriods,
          targetCapital
        }),
        0
      )
    );
    const preGrowthValue = portfolioValueFromLots(lots, currentPrice);
    currentPrice = applyLotGrowth(currentPrice, periodicReturnRate);
    const postGrowthValue = portfolioValueFromLots(lots, currentPrice);
    const growth = roundToTwo(postGrowthValue - preGrowthValue);
    const saleResult = sellLotsForAmount(lots, withdrawal, currentPrice);
    lots = saleResult.lots;
    const endingBalance = roundToTwo(portfolioValueFromLots(lots, currentPrice));

    const point: RetirementProjectionPoint = {
      contribution: 0,
      date: formatProjectionDate({
        frequency,
        periodIndex,
        startDate: withdrawalStartDate
      }),
      endingBalance,
      growth,
      gain: 0,
      netWithdrawal: 0,
      phase: 'withdrawal',
      periodIndex,
      tax: 0,
      withdrawal
    };

    points.push(point);
    withdrawalPoints.push(point);
    capital = endingBalance;
  }

  const withdrawalEstimates =
    input.allocations?.length &&
    input.activities?.length &&
    input.holdings?.length &&
    input.taxProfile
      ? calculateFutureFifoWithdrawalPlan({
          accumulationAnnualReturnPercentage: input.accumulationAnnualReturnPercentage,
          accumulationMonths,
          activities: input.activities,
          allocations: input.allocations,
          capitalPreservationTarget: targetCapital,
          currentDate: startDate,
          holdings: input.holdings,
          monthlySavingsRate: accumulationMonthlyContribution,
          taxEvents: input.taxEvents,
          taxProfile: input.taxProfile,
          withdrawalAnnualReturnPercentage: input.withdrawalAnnualReturnPercentage,
          withdrawalPoints: withdrawalPoints.map((point) => ({
            date: new Date(point.date),
            periodIndex: point.periodIndex,
            withdrawal: point.withdrawal
          })),
          withdrawalStartDate
        })
      : new Map<
          number,
          { gain: number; netWithdrawal: number; tax: number; taxBeforeAllowance: number; withdrawal: number }
        >();

  let soldTaxTotalBeforeAllowance = 0;

  for (const point of withdrawalPoints) {
    const estimate = withdrawalEstimates.get(point.periodIndex);

    if (!estimate) {
      continue;
    }

    point.gain = estimate.gain;
    point.netWithdrawal = estimate.netWithdrawal;
    point.tax = estimate.tax;
    soldTaxTotalBeforeAllowance += estimate.taxBeforeAllowance;
  }

  const soldTaxTotal = roundToTwo(
    withdrawalPoints.reduce((sum, point) => sum + point.tax, 0)
  );
  const soldTaxTotalBeforeAllowanceRounded = roundToTwo(soldTaxTotalBeforeAllowance);

  const annualVapCashNeedSchedule =
    input.allocations?.length &&
    input.activities?.length &&
    input.holdings?.length &&
    input.taxProfile
      ? calculateAnnualVapCashNeedSchedule({
          accumulationAnnualReturnPercentage: input.accumulationAnnualReturnPercentage,
          activities: input.activities,
          allocations: input.allocations,
          capitalPreservationTarget: targetCapital,
          currentDate: startDate,
          holdings: input.holdings,
          monthlySavingsRate: accumulationMonthlyContribution,
          taxEvents: input.taxEvents ?? [],
          taxProfile: input.taxProfile,
          withdrawalAnnualReturnPercentage: input.withdrawalAnnualReturnPercentage,
          withdrawalPoints: withdrawalPoints.map((point) => ({
            date: new Date(point.date),
            periodIndex: point.periodIndex,
            withdrawal: point.withdrawal
          })),
          withdrawalStartDate
        })
      : [];

  const taxSummary =
    input.capitalAtWithdrawalStart === undefined &&
    input.allocations?.length &&
    input.activities?.length &&
    input.holdings?.length &&
    input.taxProfile
      ? calculateProjectedTaxSummary({
          accumulationAnnualReturnPercentage: input.accumulationAnnualReturnPercentage,
          activities: input.activities,
          allocations: input.allocations,
          asOfDate: endOfMonth(withdrawalStartDate),
          currentDate: startDate,
          holdings: input.holdings,
          monthlySavingsRate: accumulationMonthlyContribution,
          taxEvents: input.taxEvents ?? [],
          taxProfile: input.taxProfile,
          withdrawalAnnualReturnPercentage: input.withdrawalAnnualReturnPercentage,
          withdrawalStartDate
        })
      : {
          openTaxAtWithdrawalStart: 0,
          openTaxAtWithdrawalStartAfterAllowance: 0,
          projectedVapTotal: 0,
          sparerPauschbetragUnusedTotal: 0,
          sparerPauschbetragUsedTotal: 0,
          taxableVapTotal: 0
        };

  return {
    annualVapCashNeedSchedule,
    capitalAtWithdrawalStart,
    endingCapital: withdrawalPoints.at(-1)?.endingBalance ?? capitalAtWithdrawalStart,
    firstWithdrawal: withdrawalPoints[0]?.withdrawal ?? 0,
    lastWithdrawal: withdrawalPoints.at(-1)?.withdrawal ?? 0,
    openTaxAtWithdrawalStart: taxSummary.openTaxAtWithdrawalStart,
    openTaxAtWithdrawalStartAfterAllowance: taxSummary.openTaxAtWithdrawalStartAfterAllowance,
    points,
    projectedVapTotal: taxSummary.projectedVapTotal,
    soldTaxTotal,
    soldTaxTotalBeforeAllowance: soldTaxTotalBeforeAllowanceRounded,
    sparerPauschbetragUnusedTotal: taxSummary.sparerPauschbetragUnusedTotal,
    sparerPauschbetragUsedTotal: taxSummary.sparerPauschbetragUsedTotal,
    targetCapital,
    taxableVapTotal: taxSummary.taxableVapTotal,
    totalGrowth: roundToTwo(points.reduce((sum, point) => sum + point.growth, 0)),
    totalWithdrawals: roundToTwo(points.reduce((sum, point) => sum + point.withdrawal, 0))
  };
}

function calculateProjectedTaxSummary({
  accumulationAnnualReturnPercentage,
  activities,
  allocations,
  asOfDate,
  currentDate,
  holdings,
  monthlySavingsRate,
  taxEvents,
  taxProfile,
  withdrawalAnnualReturnPercentage,
  withdrawalStartDate
}: {
  accumulationAnnualReturnPercentage: number;
  activities: Activity[];
  allocations: AllocationItem[];
  asOfDate: Date;
  currentDate: Date;
  holdings: Holding[];
  monthlySavingsRate: number;
  taxEvents: TaxEvent[];
  taxProfile: TaxProfile;
  withdrawalAnnualReturnPercentage: number;
  withdrawalStartDate: Date;
}): {
  openTaxAtWithdrawalStart: number;
  openTaxAtWithdrawalStartAfterAllowance: number;
  projectedVapTotal: number;
  sparerPauschbetragUnusedTotal: number;
  sparerPauschbetragUsedTotal: number;
  taxableVapTotal: number;
} {
  const overviewInput = buildRetireTaxOverviewInput({
    accumulationAnnualReturnPercentage,
    activities,
    allocations,
    asOfDate,
    currentDate,
    holdings,
    monthlySavingsRate,
    taxEvents,
    taxProfile,
    withdrawalAnnualReturnPercentage,
    withdrawalPoints: [],
    withdrawalStartDate
  });
  const rows = calculateTaxOverview({
    activities: overviewInput.combinedActivities,
    asOfDate,
    holdings: overviewInput.holdings,
    taxEvents: overviewInput.combinedTaxEvents,
    taxProfile
  });
  const annualSummaries = calculateAnnualTaxSummaries({
    activities: overviewInput.combinedActivities,
    asOfDate,
    holdings: overviewInput.holdings,
    taxEvents: overviewInput.combinedTaxEvents,
    taxProfile
  });

  return {
    openTaxAtWithdrawalStart: roundToTwo(rows.reduce((sum, row) => sum + row.potentialTaxes, 0)),
    openTaxAtWithdrawalStartAfterAllowance: roundToTwo(
      annualSummaries.reduce((sum, summary) => sum + summary.totalTax, 0)
    ),
    projectedVapTotal: roundToTwo(rows.reduce((sum, row) => sum + row.totalVap, 0)),
    sparerPauschbetragUnusedTotal: roundToTwo(
      annualSummaries.reduce((sum, summary) => sum + summary.sparerPauschbetragRemaining, 0)
    ),
    sparerPauschbetragUsedTotal: roundToTwo(
      annualSummaries.reduce((sum, summary) => sum + summary.sparerPauschbetragUsed, 0)
    ),
    taxableVapTotal: roundToTwo(rows.reduce((sum, row) => sum + row.totalTaxableVap, 0))
  };
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
