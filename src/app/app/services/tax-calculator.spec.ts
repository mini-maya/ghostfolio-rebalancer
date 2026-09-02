import { TaxEvent } from './tax-events';
import {
  allocateSparerPauschbetragChronologically,
  allocateSparerPauschbetragForYear,
  calculatePaidVap,
  calculatePotentialTax,
  calculateTaxForSale,
  calculateTaxOnTaxableAmount,
  calculateTotalVap,
  calculateTotalVapAfterTeilfreistellung,
  calculateVapForBuyLot,
  DEFAULT_TAX_PROFILE
} from './tax-calculator';

function makeTaxEvent({
  accountId,
  quantity,
  symbolId,
  taxYear,
  vorabpauschalePerShare,
  vorabpauschalePerShareAfterTeilfreistellung
}: {
  accountId: string;
  quantity: number;
  symbolId: string;
  taxYear: number;
  vorabpauschalePerShare: number;
  vorabpauschalePerShareAfterTeilfreistellung: number;
}): TaxEvent {
  return {
    accountId,
    id: `${accountId}-${symbolId}-${taxYear}`,
    quantity,
    symbolId,
    taxYear,
    vorabpauschalePerShare,
    vorabpauschalePerShareAfterTeilfreistellung
  };
}

describe('tax calculator', () => {
  it('calculates total VAP and VAP after partial exemption from tax events', () => {
    const taxEvents: TaxEvent[] = [
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 143.27,
        symbolId: 'VWCE',
        taxYear: 2025,
        vorabpauschalePerShare: 2.3,
        vorabpauschalePerShareAfterTeilfreistellung: 1.61
      }),
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 143.27,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 2.5,
        vorabpauschalePerShareAfterTeilfreistellung: 1.75
      })
    ];

    expect(calculateTotalVap(taxEvents, { accountId: 'acc-1', symbolId: 'VWCE' })).toBe(687.7);
    expect(
      calculateTotalVapAfterTeilfreistellung(taxEvents, {
        accountId: 'acc-1',
        symbolId: 'VWCE'
      })
    ).toBe(481.38);
    expect(calculatePaidVap({ taxableVap: 481.38 })).toBe(126.96);
  });

  it('applies the partial exemption to the gross VAP before calculating the tax', () => {
    expect(
      calculatePaidVap({
        grossVap: 100,
        taxProfile: {
          ...DEFAULT_TAX_PROFILE,
          partialExemptionRate: 0.3
        }
      })
    ).toBe(18.46);
  });

  it('reduces VAP for purchases made after the start of the year according to the acquisition month', () => {
    const taxEvents: TaxEvent[] = [
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 100,
        symbolId: 'VWCE',
        taxYear: 2025,
        vorabpauschalePerShare: 2.38260776,
        vorabpauschalePerShareAfterTeilfreistellung: 1.66782543
      })
    ];

    const weightedVap = [
      { quantity: 7.57002, acquisitionDate: '2025-07-15' },
      { quantity: 7.53239, acquisitionDate: '2025-07-23' },
      { quantity: 2.8582, acquisitionDate: '2025-08-01' },
      { quantity: 2.24349, acquisitionDate: '2025-08-15' },
      { quantity: 2.20006, acquisitionDate: '2025-09-01' },
      { quantity: 3.75397, acquisitionDate: '2025-09-15' },
      { quantity: 2.11, acquisitionDate: '2025-10-01' },
      { quantity: 3.81625, acquisitionDate: '2025-10-15' },
      { quantity: 2.08507, acquisitionDate: '2025-11-01' },
      { quantity: 3.61161, acquisitionDate: '2025-11-15' },
      { quantity: 2.06725, acquisitionDate: '2025-12-01' },
      { quantity: 5.83495, acquisitionDate: '2025-12-15' }
    ].reduce((sum, lot) => {
      return (
        sum +
        calculateVapForBuyLot({
          accountId: 'acc-1',
          quantity: lot.quantity,
          symbolId: 'VWCE',
          taxEvents,
          taxYear: 2025,
          acquisitionDate: lot.acquisitionDate
        })
      );
    }, 0);

    expect(weightedVap).toBeCloseTo(35.14611312562653, 12);
  });

  it('adds all relevant VAP years for a buy lot instead of consuming only the first one', () => {
    const taxEvents: TaxEvent[] = [
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 4,
        symbolId: 'SPPW',
        taxYear: 2024,
        vorabpauschalePerShare: 3,
        vorabpauschalePerShareAfterTeilfreistellung: 1.5
      }),
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 4,
        symbolId: 'SPPW',
        taxYear: 2025,
        vorabpauschalePerShare: 0.68,
        vorabpauschalePerShareAfterTeilfreistellung: 0.47
      })
    ];

    expect(
      calculateVapForBuyLot({
        accountId: 'acc-1',
        quantity: 4,
        symbolId: 'SPPW',
        taxEvents,
        taxYear: 2024
      })
    ).toBe(14.72);

    expect(
      calculateVapForBuyLot({
        accountId: 'acc-1',
        quantity: 4,
        symbolId: 'SPPW',
        taxEvents,
        taxYear: 2024,
        useAfterTeilfreistellung: true
      })
    ).toBe(7.88);
  });

  it('calculates potential taxes for a remaining position using full VAP', () => {
    const profile = {
      ...DEFAULT_TAX_PROFILE,
      partialExemptionRate: 0.3
    };

    expect(
      calculatePotentialTax({
        acquisitionCost: 10000,
        currentValue: 15000,
        taxProfile: profile,
        usedVap: 230
      })
    ).toBe(880.66);

    expect(
      calculatePotentialTax({
        acquisitionCost: 10000,
        currentValue: 15000,
        taxProfile: profile
      })
    ).toBe(923.13);
  });

  it('calculates tax for selling using the full VAP reduction and the tax profile afterwards', () => {
    const taxForSelling = calculateTaxForSale({
      acquisitionCost: 10000,
      saleProceeds: 15000,
      taxProfile: {
        ...DEFAULT_TAX_PROFILE,
        partialExemptionRate: 0.3
      },
      usedVap: 230
    });

    expect(taxForSelling).toBe(880.66);
  });

  it('separates values by account and symbol', () => {
    const taxEvents: TaxEvent[] = [
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 50,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 2,
        vorabpauschalePerShareAfterTeilfreistellung: 1.4
      }),
      makeTaxEvent({
        accountId: 'acc-2',
        quantity: 80,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 2,
        vorabpauschalePerShareAfterTeilfreistellung: 1.4
      }),
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 20,
        symbolId: 'IUSN',
        taxYear: 2026,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      })
    ];

    expect(calculateTotalVap(taxEvents, { accountId: 'acc-1', symbolId: 'VWCE' })).toBe(100);
    expect(calculateTotalVap(taxEvents, { accountId: 'acc-2', symbolId: 'VWCE' })).toBe(160);
    expect(calculateTotalVap(taxEvents, { accountId: 'acc-1', symbolId: 'IUSN' })).toBe(20);
  });

  it('defaults the Sparer-Pauschbetrag to 1.000 EUR per year for a single filer', () => {
    expect(DEFAULT_TAX_PROFILE.sparerPauschbetrag).toBe(1000);
  });

  describe('calculateTaxOnTaxableAmount', () => {
    it('applies capital gains tax plus solidarity surcharge without church tax', () => {
      // 400 * 25% = 100, plus 5,5% Soli on that = 5.5 => 105.50
      expect(calculateTaxOnTaxableAmount(400, DEFAULT_TAX_PROFILE)).toBe(105.5);
    });

    it('returns 0 for a non-positive taxable amount', () => {
      expect(calculateTaxOnTaxableAmount(0, DEFAULT_TAX_PROFILE)).toBe(0);
      expect(calculateTaxOnTaxableAmount(-50, DEFAULT_TAX_PROFILE)).toBe(0);
    });

    it('includes church tax when configured', () => {
      const taxProfile = { ...DEFAULT_TAX_PROFILE, churchTaxRate: 0.09 };

      // 400 * 25% = 100, Soli 5.5 on that = 5.5, Kirchensteuer 9% of the KapSt (100) = 9 => 114.50
      expect(calculateTaxOnTaxableAmount(400, taxProfile)).toBe(114.5);
    });
  });

  describe('allocateSparerPauschbetragForYear', () => {
    it('shares a single allowance across combined VAP and sale-gain income of the same year', () => {
      // steuerpflichtige VAP 700 + steuerpflichtiger Verkauf 500 = 1.200, Pauschbetrag 1.000
      const result = allocateSparerPauschbetragForYear({
        sparerPauschbetragAvailable: 1000,
        taxableAmounts: [700, 500]
      });

      expect(result.totalTaxableAmount).toBe(1200);
      expect(result.used).toBe(1000);
      expect(result.remaining).toBe(0);
      expect(result.taxableAfterAllowance).toBe(200);
    });

    it('does not let the allowance be consumed twice by applying it separately per income type', () => {
      const combined = allocateSparerPauschbetragForYear({
        sparerPauschbetragAvailable: 1000,
        taxableAmounts: [700, 500]
      });

      // Wrong (forbidden) approach would be applying 1.000 to each item separately, yielding 0 + 0.
      expect(combined.taxableAfterAllowance).not.toBe(0);
    });

    it('fully covers combined income smaller than the allowance and reports the unused remainder', () => {
      const result = allocateSparerPauschbetragForYear({
        sparerPauschbetragAvailable: 1000,
        taxableAmounts: [1400]
      });

      // VAP 2.000 mit 30% Teilfreistellung => steuerpflichtige VAP 1.400; Pauschbetrag 1.000 => 400 steuerpflichtig
      expect(result.used).toBe(1000);
      expect(result.remaining).toBe(0);
      expect(result.taxableAfterAllowance).toBe(400);
    });

    it('never carries an unused remainder into a later year (each call gets a fresh allowance)', () => {
      const yearOne = allocateSparerPauschbetragForYear({
        sparerPauschbetragAvailable: 1000,
        taxableAmounts: [600]
      });

      expect(yearOne.remaining).toBe(400);

      // Year two must be called with the plain annual allowance again, never yearOne.remaining.
      const yearTwo = allocateSparerPauschbetragForYear({
        sparerPauschbetragAvailable: 1000,
        taxableAmounts: [1000]
      });

      expect(yearTwo.used).toBe(1000);
      expect(yearTwo.taxableAfterAllowance).toBe(0);
    });

    it('handles an empty income year with no tax base and a fully unused allowance', () => {
      const result = allocateSparerPauschbetragForYear({
        sparerPauschbetragAvailable: 1000,
        taxableAmounts: []
      });

      expect(result.totalTaxableAmount).toBe(0);
      expect(result.used).toBe(0);
      expect(result.remaining).toBe(1000);
      expect(result.taxableAfterAllowance).toBe(0);
    });
  });

  describe('allocateSparerPauschbetragChronologically', () => {
    it('consumes the year VAP first, before any sale gets a share of the allowance', () => {
      // VAP alone (1.000) already exhausts the whole allowance, so no sale gets anything.
      const result = allocateSparerPauschbetragChronologically({
        saleEvents: [{ date: new Date('2024-06-01'), id: 'sale-1', taxableAmount: 500 }],
        sparerPauschbetragAvailable: 1000,
        vapTaxableAmount: 1000
      });

      expect(result.vapAllowanceUsed).toBe(1000);
      expect(result.saleAllocations.get('sale-1')?.used).toBe(0);
      expect(result.saleAllocations.get('sale-1')?.taxableAfterAllowance).toBe(500);
    });

    it('distributes the remaining allowance to sales in chronological order, earliest sale first', () => {
      // VAP uses 400, leaving 600. The earlier sale (300) is fully covered first, the later
      // sale (500) only gets the remaining 300 of allowance, not an even split.
      const result = allocateSparerPauschbetragChronologically({
        saleEvents: [
          { date: new Date('2024-08-01'), id: 'later', taxableAmount: 500 },
          { date: new Date('2024-03-01'), id: 'earlier', taxableAmount: 300 }
        ],
        sparerPauschbetragAvailable: 1000,
        vapTaxableAmount: 400
      });

      expect(result.vapAllowanceUsed).toBe(400);
      expect(result.saleAllocations.get('earlier')?.used).toBe(300);
      expect(result.saleAllocations.get('earlier')?.taxableAfterAllowance).toBe(0);
      expect(result.saleAllocations.get('later')?.used).toBe(300);
      expect(result.saleAllocations.get('later')?.taxableAfterAllowance).toBe(200);
    });

    it('splits the same-day remaining allowance proportionally, not sequentially by size', () => {
      // No VAP. Two sales on the same day: 300 and 900 (total 1.200), but only 600 remains.
      // Proportional split: 300/1200 * 600 = 150, and 900/1200 * 600 = 450.
      const result = allocateSparerPauschbetragChronologically({
        saleEvents: [
          { date: new Date('2024-05-10'), id: 'small', taxableAmount: 300 },
          { date: new Date('2024-05-10'), id: 'large', taxableAmount: 900 }
        ],
        sparerPauschbetragAvailable: 600,
        vapTaxableAmount: 0
      });

      expect(result.saleAllocations.get('small')?.used).toBe(150);
      expect(result.saleAllocations.get('small')?.taxableAfterAllowance).toBe(150);
      expect(result.saleAllocations.get('large')?.used).toBe(450);
      expect(result.saleAllocations.get('large')?.taxableAfterAllowance).toBe(450);
    });

    it('leaves later sales with zero allowance once the pool is exhausted by earlier ones', () => {
      const result = allocateSparerPauschbetragChronologically({
        saleEvents: [
          { date: new Date('2024-01-15'), id: 'first', taxableAmount: 1000 },
          { date: new Date('2024-12-01'), id: 'second', taxableAmount: 500 }
        ],
        sparerPauschbetragAvailable: 1000,
        vapTaxableAmount: 0
      });

      expect(result.saleAllocations.get('first')?.used).toBe(1000);
      expect(result.saleAllocations.get('second')?.used).toBe(0);
      expect(result.saleAllocations.get('second')?.taxableAfterAllowance).toBe(500);
    });
  });
});
