import { addMonths, differenceInCalendarMonths, format, isValid, parse, startOfMonth } from 'date-fns';

const MONTH_INPUT_FORMAT = 'yyyy-MM';

export function getRetirementBaseDate(referenceDate = new Date()): Date {
  return startOfMonth(referenceDate);
}

export function formatWithdrawalStartMonth(date: Date): string {
  return format(startOfMonth(date), MONTH_INPUT_FORMAT);
}

export function parseWithdrawalStartMonth(value: string, referenceDate = new Date()): Date {
  const parsedDate = parse(value, MONTH_INPUT_FORMAT, getRetirementBaseDate(referenceDate));

  if (!isValid(parsedDate)) {
    return getRetirementBaseDate(referenceDate);
  }

  return coerceWithdrawalStartDate(parsedDate, referenceDate);
}

export function getAccumulationMonths(withdrawalStartDate: Date, referenceDate = new Date()): number {
  return Math.max(
    differenceInCalendarMonths(
      coerceWithdrawalStartDate(withdrawalStartDate, referenceDate),
      getRetirementBaseDate(referenceDate)
    ),
    0
  );
}

export function getLeadTimeYears(accumulationMonths: number): number {
  return roundToTwo(Math.max(accumulationMonths, 0) / 12);
}

export function getWithdrawalStartFromLeadTimeYears(
  leadTimeYears: number,
  referenceDate = new Date()
): Date {
  return addMonths(
    getRetirementBaseDate(referenceDate),
    Math.max(Math.round(Math.max(leadTimeYears, 0) * 12), 0)
  );
}

function coerceWithdrawalStartDate(withdrawalStartDate: Date, referenceDate: Date): Date {
  const normalizedDate = startOfMonth(withdrawalStartDate);
  const minimumDate = getRetirementBaseDate(referenceDate);

  return normalizedDate < minimumDate ? minimumDate : normalizedDate;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
