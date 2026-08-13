import {
  formatWithdrawalStartMonth,
  getAccumulationMonths,
  getRetirementBaseDate,
  formatWithdrawalEndMonth,
  getWithdrawalEndFromProjectionYears,
  parseStoredWithdrawalStartMonth,
  parseWithdrawalStartMonth
} from './retire-date.helpers';

describe('retire date helpers', () => {
  const referenceDate = new Date('2026-08-12T00:00:00.000Z');

  it('normalizes the projection base date to the first day of the month', () => {
    const baseDate = getRetirementBaseDate(referenceDate);

    expect(baseDate.getFullYear()).toBe(2026);
    expect(baseDate.getMonth()).toBe(7);
    expect(baseDate.getDate()).toBe(1);
  });

  it('converts projection years into a withdrawal end month', () => {
    const withdrawalStartDate = new Date('2030-01-01T00:00:00.000Z');

    const withdrawalEndDate = getWithdrawalEndFromProjectionYears(withdrawalStartDate, 25);

    expect(withdrawalEndDate.getFullYear()).toBe(2055);
    expect(withdrawalEndDate.getMonth()).toBe(0);
    expect(withdrawalEndDate.getDate()).toBe(1);
    expect(formatWithdrawalEndMonth(withdrawalStartDate, 25)).toBe('2055-01');
  });

  it('clamps parsed withdrawal months to the current month or later', () => {
    expect(formatWithdrawalStartMonth(parseWithdrawalStartMonth('2026-05', referenceDate))).toBe(
      '2026-08'
    );
  });

  it('keeps the stored withdrawal month without clamping', () => {
    expect(
      formatWithdrawalStartMonth(parseStoredWithdrawalStartMonth('2026-05', referenceDate))
    ).toBe('2026-05');
  });

});
