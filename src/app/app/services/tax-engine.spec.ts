import type { Activity, Holding } from './ghostfolio-api';
import { calculateTaxOverview } from './tax-engine';
import { DEFAULT_TAX_PROFILE } from './tax-calculator';
import type { TaxEvent } from './tax-events';

function makeActivity({
  accountId = 'acc-1',
  accountName = 'Depot A',
  date,
  fee = 0,
  quantity,
  symbol = 'VWCE',
  type,
  unitPrice
}: {
  accountId?: string;
  accountName?: string;
  date: string;
  fee?: number;
  quantity: number;
  symbol?: string;
  type: 'BUY' | 'SELL';
  unitPrice: number;
}): Activity {
  return {
    accountId,
    accountName,
    assetClass: 'ETF',
    assetSubClass: 'World',
    currency: 'EUR',
    date: new Date(date),
    fee,
    name: 'Vanguard FTSE All-World',
    quantity,
    symbol,
    type,
    unitPrice,
    unitPriceInAssetProfileCurrency: unitPrice,
    valueInBaseCurrency: quantity * unitPrice
  };
}

function makeHolding({
  marketPrice,
  quantity,
  symbol = 'VWCE'
}: {
  marketPrice: number;
  quantity: number;
  symbol?: string;
}): Holding {
  return {
    allocationInPercentage: 100,
    currency: 'EUR',
    marketPrice,
    name: 'Vanguard FTSE All-World',
    quantity,
    symbol,
    valueInBaseCurrency: quantity * marketPrice
  };
}

function makeTaxEvent({
  accountId = 'acc-1',
  quantity,
  symbolId = 'VWCE',
  taxYear,
  vorabpauschalePerShare,
  vorabpauschalePerShareAfterTeilfreistellung
}: {
  accountId?: string;
  quantity: number;
  symbolId?: string;
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

describe('calculateTaxOverview - FIFO', () => {
  it('matches a single BUY against a single full SELL', () => {
    const activities = [
      makeActivity({ date: '2024-01-10', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2024-06-10', quantity: 10, type: 'SELL', unitPrice: 120 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-12-31')
    });

    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.positionQuantity).toBe(0);
    expect(row.realizedAmount).toBe(200); // 10 * (120 - 100)
    expect(row.realizedPercentage).toBeCloseTo(20, 5);
  });

  it('matches multiple BUYs against a single SELL in FIFO order', () => {
    const activities = [
      makeActivity({ date: '2024-01-10', quantity: 5, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2024-03-10', quantity: 5, type: 'BUY', unitPrice: 110 }),
      makeActivity({ date: '2024-06-10', quantity: 7, type: 'SELL', unitPrice: 130 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-12-31')
    });

    const row = rows[0];
    // 5 shares from the first (cheaper) lot + 2 shares from the second lot are sold first.
    const expectedRealized = 5 * (130 - 100) + 2 * (130 - 110);
    expect(row.realizedAmount).toBe(expectedRealized);
    expect(row.positionQuantity).toBe(3);
    // Remaining 3 shares are the tail of the second (110) lot.
    expect(row.entryPriceAmount).toBe(3 * 110);
  });

  it('matches multiple BUYs against multiple SELLs deterministically', () => {
    const activities = [
      makeActivity({ date: '2024-01-10', quantity: 4, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2024-02-10', quantity: 4, type: 'BUY', unitPrice: 105 }),
      makeActivity({ date: '2024-03-10', quantity: 4, type: 'BUY', unitPrice: 110 }),
      makeActivity({ date: '2024-04-10', quantity: 3, type: 'SELL', unitPrice: 120 }),
      makeActivity({ date: '2024-05-10', quantity: 6, type: 'SELL', unitPrice: 125 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-12-31')
    });

    const row = rows[0];
    // First sell: 3 shares from lot 1 (100).
    // Second sell: 1 remaining share from lot 1 (100) + 4 shares from lot 2 (105) + 1 share from lot 3 (110).
    const expectedRealized =
      3 * (120 - 100) + 1 * (125 - 100) + 4 * (125 - 105) + 1 * (125 - 110);
    expect(row.realizedAmount).toBe(expectedRealized);
    expect(row.positionQuantity).toBe(3); // 3 remaining shares of lot 3 (110)
    expect(row.entryPriceAmount).toBe(3 * 110);
  });

  it('supports a partial sell leaving a remaining, correctly priced lot', () => {
    const activities = [
      makeActivity({ date: '2024-01-10', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2024-06-10', quantity: 4, type: 'SELL', unitPrice: 130 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-12-31')
    });

    const row = rows[0];
    expect(row.positionQuantity).toBe(6);
    expect(row.entryPriceAmount).toBe(600);
    expect(row.realizedAmount).toBe(4 * (130 - 100));
  });

  it('produces the same FIFO result regardless of activity input order', () => {
    const orderedActivities = [
      makeActivity({ date: '2024-01-10', quantity: 5, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2024-03-10', quantity: 5, type: 'BUY', unitPrice: 110 }),
      makeActivity({ date: '2024-06-10', quantity: 7, type: 'SELL', unitPrice: 130 })
    ];
    const shuffledActivities = [orderedActivities[2], orderedActivities[0], orderedActivities[1]];

    const orderedResult = calculateTaxOverview({
      activities: orderedActivities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-12-31')
    });
    const shuffledResult = calculateTaxOverview({
      activities: shuffledActivities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-12-31')
    });

    expect(shuffledResult[0].realizedAmount).toBe(orderedResult[0].realizedAmount);
    expect(shuffledResult[0].positionQuantity).toBe(orderedResult[0].positionQuantity);
    expect(shuffledResult[0].entryPriceAmount).toBe(orderedResult[0].entryPriceAmount);
  });

  it('treats a lot as fully sold when partial sells sum to the bought quantity (floating-point residual)', () => {
    // Regression test: 17.4405 + 31 + 7.17225 mathematically equals 55.61275, but in
    // IEEE 754 arithmetic the subtraction can leave a tiny non-zero residual. That residual
    // must not be treated as an "open" position with a near-zero cost basis, which would
    // otherwise produce an absurd gain percentage (e.g. 1925%) while the amount rounds to 0,00 €.
    const activities = [
      makeActivity({ date: '2025-10-15', quantity: 55.61275, type: 'BUY', unitPrice: 9.71 }),
      makeActivity({ date: '2051-08-01', quantity: 17.4405, type: 'SELL', unitPrice: 49.04 }),
      makeActivity({ date: '2051-09-01', quantity: 31, type: 'SELL', unitPrice: 49.28 }),
      makeActivity({ date: '2051-10-01', quantity: 7.17225, type: 'SELL', unitPrice: 49.52 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 49.52, quantity: 0 })],
      taxEvents: [],
      asOfDate: new Date('2051-12-31')
    });

    const row = rows[0];
    expect(row.positionQuantity).toBe(0);
    expect(row.entryPriceAmount).toBe(0);

    const buyActivity = row.activities.find((activity) => activity.type === 'BUY');
    expect(buyActivity?.gainAmount).toBe(0);
    expect(buyActivity?.gainPercentage).toBe(0);
  });
});

describe('calculateTaxOverview - Vorabpauschale (VAP)', () => {
  it('applies no VAP for a BUY in the current (not-yet-closed) year', () => {
    const activities = [makeActivity({ date: '2024-03-01', quantity: 10, type: 'BUY', unitPrice: 100 })];
    const taxEvents = [
      makeTaxEvent({
        quantity: 10,
        taxYear: 2024,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 100, quantity: 10 })],
      taxEvents,
      asOfDate: new Date('2024-12-31')
    });

    expect(rows[0].totalVap).toBe(0);
  });

  it('applies the prior year VAP starting 01.01 of the following year', () => {
    const activities = [makeActivity({ date: '2023-01-01', quantity: 10, type: 'BUY', unitPrice: 100 })];
    const taxEvents = [
      makeTaxEvent({
        quantity: 10,
        taxYear: 2023,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      })
    ];

    const onDec31 = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 100, quantity: 10 })],
      taxEvents,
      asOfDate: new Date('2023-12-31')
    });
    const onJan1 = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 100, quantity: 10 })],
      taxEvents,
      asOfDate: new Date('2024-01-01')
    });

    expect(onDec31[0].totalVap).toBe(0);
    expect(onJan1[0].totalVap).toBe(10);
  });

  it('pro-rates VAP by acquisition month for a BUY shortly before year end', () => {
    // Bought in November: 2 months held (Nov + Dec) out of 12 -> month factor 2/12.
    const activities = [makeActivity({ date: '2023-11-15', quantity: 12, type: 'BUY', unitPrice: 100 })];
    const taxEvents = [
      makeTaxEvent({
        quantity: 12,
        taxYear: 2023,
        vorabpauschalePerShare: 1.2,
        vorabpauschalePerShareAfterTeilfreistellung: 0.84
      })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 100, quantity: 12 })],
      taxEvents,
      asOfDate: new Date('2024-06-01')
    });

    expect(rows[0].totalVap).toBeCloseTo(12 * (2 / 12) * 1.2, 5);
  });

  it('accrues VAP independently for multiple BUY lots of the same symbol', () => {
    const activities = [
      makeActivity({ date: '2022-01-01', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2023-01-01', quantity: 5, type: 'BUY', unitPrice: 110 })
    ];
    const taxEvents = [
      makeTaxEvent({
        quantity: 10,
        taxYear: 2022,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      }),
      makeTaxEvent({
        quantity: 15,
        taxYear: 2023,
        vorabpauschalePerShare: 2,
        vorabpauschalePerShareAfterTeilfreistellung: 1.4
      })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 150, quantity: 15 })],
      taxEvents,
      asOfDate: new Date('2024-01-01')
    });

    // Lot 1 (10 shares, bought 2022): 2022 VAP (10*1) + 2023 VAP (10*2) = 30
    // Lot 2 (5 shares, bought 2023): 2023 VAP only (5*2) = 10
    expect(rows[0].totalVap).toBe(40);
  });

  it('excludes a lot fully sold before year end from that year onward', () => {
    const activities = [
      makeActivity({ date: '2022-01-01', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2022-06-01', quantity: 10, type: 'SELL', unitPrice: 120 })
    ];
    const taxEvents = [
      makeTaxEvent({
        quantity: 10,
        taxYear: 2022,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      }),
      makeTaxEvent({
        quantity: 10,
        taxYear: 2023,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents,
      asOfDate: new Date('2024-01-01')
    });

    const row = rows[0];
    // The lot was fully gone before 2022 year-end (sold in June 2022), so it must not receive
    // 2022 VAP either, and definitely not the 2023 VAP that only applies to lots still held on
    // 31.12.2023.
    expect(row.totalVap).toBe(0);
    const sellDetail = row.activities.find((activity) => activity.type === 'BUY')!.sellDetails[0];
    expect(sellDetail.usedVapForSelling).toBe(0);
  });

  it('gives a partially sold lot VAP for years held before the sale, and none after', () => {
    const activities = [
      makeActivity({ date: '2020-01-01', quantity: 10, type: 'BUY', unitPrice: 100 }),
      // Sold in 2022, after the 2020 and 2021 year-ends have passed.
      makeActivity({ date: '2022-06-01', quantity: 4, type: 'SELL', unitPrice: 130 })
    ];
    const taxEvents = [
      makeTaxEvent({ quantity: 10, taxYear: 2020, vorabpauschalePerShare: 1, vorabpauschalePerShareAfterTeilfreistellung: 0.7 }),
      makeTaxEvent({ quantity: 10, taxYear: 2021, vorabpauschalePerShare: 1, vorabpauschalePerShareAfterTeilfreistellung: 0.7 }),
      makeTaxEvent({ quantity: 6, taxYear: 2022, vorabpauschalePerShare: 1, vorabpauschalePerShareAfterTeilfreistellung: 0.7 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 140, quantity: 6 })],
      taxEvents,
      asOfDate: new Date('2023-01-01')
    });

    const row = rows[0];
    const buyActivity = row.activities.find((activity) => activity.type === 'BUY')!;

    // Sold 4 shares in 2022: they only ever held through 2020 and 2021 -> 4 * (1 + 1) = 8.
    expect(buyActivity.sellDetails[0].usedVapForSelling).toBe(8);
    // Remaining 6 shares held through 2020, 2021 and 2022 -> 6 * (1 + 1 + 1) = 18.
    expect(buyActivity.totalVap).toBe(18);
    // Lifetime total for the whole lot = used (8) + remaining (18) = 26.
    expect(row.totalVap).toBe(26);
  });

  it('accrues VAP correctly across several consecutive years', () => {
    const activities = [makeActivity({ date: '2019-01-01', quantity: 10, type: 'BUY', unitPrice: 100 })];
    const taxEvents = [2019, 2020, 2021, 2022].map((taxYear) =>
      makeTaxEvent({
        quantity: 10,
        taxYear,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      })
    );

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 100, quantity: 10 })],
      taxEvents,
      asOfDate: new Date('2023-01-01')
    });

    expect(rows[0].totalVap).toBe(40); // 4 years * 10 shares * 1 EUR
    expect(rows[0].totalVapAfterTeilfreistellung).toBe(28); // 4 years * 10 shares * 0.7 EUR
  });

  it('does not double count VAP already used by an earlier sell for a later sell', () => {
    const activities = [
      makeActivity({ date: '2020-01-01', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2022-01-15', quantity: 4, type: 'SELL', unitPrice: 120 }),
      makeActivity({ date: '2023-01-15', quantity: 3, type: 'SELL', unitPrice: 125 })
    ];
    const taxEvents = [2020, 2021, 2022].map((taxYear) =>
      makeTaxEvent({
        quantity: 10,
        taxYear,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      })
    );

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 130, quantity: 3 })],
      taxEvents,
      asOfDate: new Date('2023-06-01')
    });

    const buyActivity = rows[0].activities.find((activity) => activity.type === 'BUY')!;
    // First sell (Jan 2022): held through 2020 + 2021 -> 4 * 2 = 8.
    expect(buyActivity.sellDetails[0].usedVapForSelling).toBe(8);
    // Second sell (Jan 2023): held through 2020 + 2021 + 2022 -> 3 * 3 = 9.
    expect(buyActivity.sellDetails[1].usedVapForSelling).toBe(9);
    // Remaining 3 shares (asOfYear 2023, so only years < 2023 count -> 2020+2021+2022 = 3): 3*3=9
    expect(buyActivity.totalVap).toBe(9);
    // Total lifetime = 8 + 9 + 9 = 26.
    expect(rows[0].totalVap).toBe(26);
  });
});

describe('calculateTaxOverview - Stichtag (asOfDate)', () => {
  it('ignores activities dated after the asOfDate', () => {
    const activities = [
      makeActivity({ date: '2024-01-10', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2024-08-10', quantity: 5, type: 'BUY', unitPrice: 110 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-06-30')
    });

    expect(rows[0].positionQuantity).toBe(10);
  });

  it('treats the asOfDate as inclusive through the end of that day', () => {
    const activities = [makeActivity({ date: '2024-06-30', quantity: 10, type: 'BUY', unitPrice: 100 })];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-06-30')
    });

    expect(rows[0].positionQuantity).toBe(10);
  });

  it('handles a leap-year February month-end correctly', () => {
    const activities = [
      makeActivity({ date: '2024-02-29', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2024-03-01', quantity: 5, type: 'BUY', unitPrice: 105 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2024-02-29')
    });

    expect(rows[0].positionQuantity).toBe(10);
  });

  it('handles a non-leap-year February month-end correctly', () => {
    const activities = [
      makeActivity({ date: '2023-02-28', quantity: 10, type: 'BUY', unitPrice: 100 }),
      makeActivity({ date: '2023-03-01', quantity: 5, type: 'BUY', unitPrice: 105 })
    ];

    const rows = calculateTaxOverview({
      activities,
      holdings: [],
      taxEvents: [],
      asOfDate: new Date('2023-02-28')
    });

    expect(rows[0].positionQuantity).toBe(10);
  });

  it('correctly rolls VAP over the 01.01 year boundary', () => {
    const activities = [makeActivity({ date: '2023-06-01', quantity: 10, type: 'BUY', unitPrice: 100 })];
    const taxEvents = [
      makeTaxEvent({
        quantity: 10,
        taxYear: 2023,
        vorabpauschalePerShare: 1,
        vorabpauschalePerShareAfterTeilfreistellung: 0.7
      })
    ];

    const beforeRollover = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 100, quantity: 10 })],
      taxEvents,
      asOfDate: new Date('2023-12-31')
    });
    const afterRollover = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 100, quantity: 10 })],
      taxEvents,
      asOfDate: new Date('2024-01-01')
    });

    expect(beforeRollover[0].totalVap).toBe(0);
    expect(afterRollover[0].totalVap).toBeGreaterThan(0);
  });

  it('defaults the tax profile when none is provided', () => {
    const activities = [makeActivity({ date: '2024-01-01', quantity: 1, type: 'BUY', unitPrice: 100 })];

    const rows = calculateTaxOverview({
      activities,
      holdings: [makeHolding({ marketPrice: 200, quantity: 1 })],
      taxEvents: [],
      asOfDate: new Date('2024-06-01')
    });

    expect(rows[0].potentialTaxes).toBeGreaterThan(0);
    expect(DEFAULT_TAX_PROFILE.capitalGainsTaxRate).toBe(0.25);
  });
});
