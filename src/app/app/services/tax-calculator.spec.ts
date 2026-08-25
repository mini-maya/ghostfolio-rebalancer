import { TaxEvent } from './tax-events';
import {
  calculatePaidVap,
  calculatePotentialTax,
  calculateTaxForSale,
  calculateTotalTaxImpact,
  calculateTotalVap,
  calculateTotalVapAfterTeilfreistellung,
  calculateUsedVap,
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

  it('calculates used VAP for a sale from the relevant FIFO tax history without double counting', () => {
    const taxEvents: TaxEvent[] = [
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 100,
        symbolId: 'VWCE',
        taxYear: 2024,
        vorabpauschalePerShare: 2,
        vorabpauschalePerShareAfterTeilfreistellung: 1.4
      }),
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 100,
        symbolId: 'VWCE',
        taxYear: 2025,
        vorabpauschalePerShare: 3,
        vorabpauschalePerShareAfterTeilfreistellung: 2.1
      })
    ];

    expect(
      calculateUsedVap({
        accountId: 'acc-1',
        soldQuantity: 120,
        symbolId: 'VWCE',
        taxEvents
      })
    ).toBe(260);

    expect(
      calculateUsedVap({
        accountId: 'acc-1',
        soldQuantity: 50,
        symbolId: 'VWCE',
        taxEvents
      })
    ).toBe(100);
  });

  it('uses VAP from the same year or a later year for a matching buy lot, but not from an earlier year', () => {
    const taxEvents: TaxEvent[] = [
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 100,
        symbolId: 'VWCE',
        taxYear: 2025,
        vorabpauschalePerShare: 3,
        vorabpauschalePerShareAfterTeilfreistellung: 2.1
      }),
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 100,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 4,
        vorabpauschalePerShareAfterTeilfreistellung: 2.8
      })
    ];

    expect(
      calculateUsedVap({
        accountId: 'acc-1',
        soldQuantity: 60,
        symbolId: 'VWCE',
        taxEvents,
        taxYear: 2024
      })
    ).toBe(180);

    expect(
      calculateUsedVap({
        accountId: 'acc-1',
        soldQuantity: 60,
        symbolId: 'VWCE',
        taxEvents,
        taxYear: 2026
      })
    ).toBe(240);
  });

  it('caps used VAP at the total available VAP pool for the symbol', () => {
    const taxEvents: TaxEvent[] = [
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 100,
        symbolId: 'VWCE',
        taxYear: 2024,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      }),
      makeTaxEvent({
        accountId: 'acc-1',
        quantity: 100,
        symbolId: 'VWCE',
        taxYear: 2025,
        vorabpauschalePerShare: 2,
        vorabpauschalePerShareAfterTeilfreistellung: 1.4
      })
    ];

    expect(
      calculateUsedVap({
        accountId: 'acc-1',
        soldQuantity: 600,
        symbolId: 'VWCE',
        taxEvents
      })
    ).toBe(300);
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

  it('calculates total tax impact as used VAP plus tax for selling', () => {
    expect(
      calculateTotalTaxImpact({
        taxForSelling: 406.18,
        usedVapForSelling: 300
      })
    ).toBe(706.18);
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
    expect(
      calculateUsedVap({
        accountId: 'acc-1',
        soldQuantity: 20,
        symbolId: 'VWCE',
        taxEvents
      })
    ).toBe(40);
  });
});
