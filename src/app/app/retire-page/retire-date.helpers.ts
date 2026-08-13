import { addYears, differenceInCalendarMonths, format, isValid, parse, startOfMonth } from 'date-fns';

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

export function parseStoredWithdrawalStartMonth(
  value: string,
  referenceDate = new Date()
): Date {
  const parsedDate = parse(value, MONTH_INPUT_FORMAT, getRetirementBaseDate(referenceDate));

  if (!isValid(parsedDate)) {
    return getRetirementBaseDate(referenceDate);
  }

  return startOfMonth(parsedDate);
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

export function getWithdrawalEndFromProjectionYears(
  withdrawalStartDate: Date,
  projectionYears: number
): Date {
  return addYears(
    startOfMonth(withdrawalStartDate),
    Math.max(Math.round(Math.max(projectionYears, 0)), 1)
  );
}

export function formatWithdrawalEndMonth(
  withdrawalStartDate: Date,
  projectionYears: number
): string {
  return format(getWithdrawalEndFromProjectionYears(withdrawalStartDate, projectionYears), MONTH_INPUT_FORMAT);
}

export function isWithdrawalMonthReached(withdrawalDate: string, referenceDate = new Date()): boolean {
  return startOfMonth(new Date(withdrawalDate)) <= getRetirementBaseDate(referenceDate);
}

function coerceWithdrawalStartDate(withdrawalStartDate: Date, referenceDate: Date): Date {
  const normalizedDate = startOfMonth(withdrawalStartDate);
  const minimumDate = getRetirementBaseDate(referenceDate);

  return normalizedDate < minimumDate ? minimumDate : normalizedDate;
}
