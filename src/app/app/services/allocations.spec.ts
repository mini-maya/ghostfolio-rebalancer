import { parseAllocationsText } from './allocations';

describe('parseAllocationsText', () => {
  it('parses symbol and percentage pairs', () => {
    const result = parseAllocationsText('SPY,60|VXUS,40');

    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      { percentage: 60, symbol: 'SPY' },
      { percentage: 40, symbol: 'VXUS' }
    ]);
    expect(result.total).toBe(100);
  });

  it('returns validation errors for malformed entries', () => {
    const result = parseAllocationsText('SPY|VXUS,foo');

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([
      'Entry 1 must use "SYMBOL,PERCENT|SYMBOL,PERCENT".',
      'Entry 2 has an invalid percentage.'
    ]);
    expect(result.total).toBe(0);
  });
});
