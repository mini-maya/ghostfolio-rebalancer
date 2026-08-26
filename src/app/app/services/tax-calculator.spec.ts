import { TaxEvent } from './tax-events';
import {
  calculatePaidVap,
  calculatePotentialTax,
  calculateTaxForSale,
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
});
