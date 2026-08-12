import {
  formatWithdrawalStartMonth,
  getAccumulationMonths,
  getLeadTimeYears,
  getRetirementBaseDate,
  getWithdrawalStartFromLeadTimeYears,
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

  it('converts lead time years into a withdrawal start month and back', () => {
    const withdrawalStartDate = getWithdrawalStartFromLeadTimeYears(1.5, referenceDate);

    expect(formatWithdrawalStartMonth(withdrawalStartDate)).toBe('2028-02');
    expect(getAccumulationMonths(withdrawalStartDate, referenceDate)).toBe(18);
    expect(getLeadTimeYears(18)).toBe(1.5);
  });

  it('clamps parsed withdrawal months to the current month or later', () => {
    expect(formatWithdrawalStartMonth(parseWithdrawalStartMonth('2026-05', referenceDate))).toBe(
      '2026-08'
    );
  });
});
