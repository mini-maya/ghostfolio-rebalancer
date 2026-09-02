import type {
  FifoOverviewActivityRow,
  FifoOverviewRow,
  FifoOverviewSellDetailRow
} from '../../shared/fifo-overview-table/fifo-overview-table.models';
import type { Activity, Holding } from './ghostfolio-api';
import {
  allocateSparerPauschbetragChronologically,
  allocateSparerPauschbetragForYear,
  calculatePotentialTax,
  calculateTaxableGainAfterVap,
  calculateTaxForSale,
  calculateTaxOnTaxableAmount,
  calculateVapMonthFactor,
  DEFAULT_TAX_PROFILE,
  type TaxProfile
} from './tax-calculator';
import type { TaxEvent } from './tax-events';

/**
 * Single, shared FIFO + Vorabpauschale (VAP) + tax calculation engine.
 *
 * This is the ONE place where FIFO lot matching, VAP attribution and potential/realized
 * capital-gains-tax figures are calculated. It is used by both the Tax-Page (asOfDate =
 * "now", live Ghostfolio holdings) and the Retire-Page (asOfDate = end of the selected
 * month, real and/or simulated activities). There must never be a second, independent
 * implementation of this logic.
 *
 * VAP handling: this engine only ever consumes plain `TaxEvent[]` records (account/symbol/
 * taxYear/per-share amounts). It has no built-in "estimate a missing VAP" fallback - callers
 * that need an estimate for years/symbols without a real tax-page entry (e.g. the retire
 * simulation for future years) are responsible for generating a synthetic `TaxEvent` and
 * merging it into the `taxEvents` array before calling this engine, so that real and
 * synthetic VAP data flow through the exact same attribution code path.
 *
 * German Vorabpauschale rule implemented here: the VAP declared for tax year Y only becomes
 * tax-relevant on 01.01 of year Y+1, and it only applies to the quantity of a BUY lot that is
 * still held (not yet sold) at the end of year Y. A lot that was completely sold before the
 * end of year Y receives no VAP for year Y (or any later year). A lot bought during year Y
 * only receives a pro-rated (by acquisition month) share of year Y's VAP.
 */

export interface TaxSellDetailRow extends FifoOverviewSellDetailRow {
  date: Date | null;
  realizedAmount: number;
  realizedCostBasis: number;
  realizedPercentage: number;
  soldQuantity: number;
  /**
   * Taxable sale gain (after used VAP and Teilfreistellung), *before* the annual
   * Sparer-Pauschbetrag is applied. Used by calculateAnnualTaxSummaries to aggregate this
   * sale's contribution to its calendar year's combined taxable capital income.
   */
  taxableGainBeforeAllowance: number;
  taxForSelling: number;
  totalValue: number;
  unitPrice: number;
  /**
   * Portion of the shared annual Sparer-Pauschbetrag this specific sale consumed, following
   * the agreed allocation order: the year's taxable VAP is consumed first (in full), then any
   * remaining allowance is distributed to sales chronologically by date, with same-day sales
   * splitting that day's remaining allowance proportionally to their own taxable amount. This
   * is a purely informative, additive breakdown - it never changes taxForSelling or any
   * existing year-level total (see allocateSparerPauschbetragChronologically).
   */
  usedSparerPauschbetragForSelling: number;
  usedTaxableVapForSelling: number;
  usedVapForSelling: number;
}

export interface TaxActivityRow extends FifoOverviewActivityRow {
  accountId: string;
  date: Date | null;
  fee: number;
  gainAmount: number | null;
  gainPercentage: number | null;
  potentialTaxes: number;
  potentialTaxesWithoutVap: number;
  quantity: number;
  sellDetails: TaxSellDetailRow[];
  soldQuantity: number | null;
  symbol: string;
  totalTaxableVap: number;
  totalVap: number;
  totalVapAfterTeilfreistellung: number;
  totalValue: number;
  type: string;
  unitPrice: number;
}

export interface TaxOverviewRow extends FifoOverviewRow {
  accountId: string;
  accountName: string;
  activities: TaxActivityRow[];
  currency: string;
  entryPriceAmount: number;
  entryPricePerUnit: number;
  gainAmount: number;
  gainPercentage: number;
  name: string;
  positionPriceAmount: number;
  positionPricePerUnit: number;
  positionQuantity: number;
  potentialTaxes: number;
  potentialTaxesWithoutVap: number;
  realizedAmount: number;
  realizedPercentage: number;
  symbol: string;
  taxForSelling: number;
  totalTaxableVap: number;
  /** Sum of usedSparerPauschbetragForSelling across all of this row's sellDetails. */
  usedSparerPauschbetragForSelling: number;
  usedTaxableVapForSelling: number;
  totalVap: number;
  totalVapAfterTeilfreistellung: number;
  usedVapForSelling: number;
}

export interface CalculateTaxOverviewInput {
  /** All known activities. Activities dated after asOfDate are ignored. */
  activities: Activity[];
  /** Holdings/market prices, representing the position as of asOfDate. */
  holdings: Holding[];
  /** Real and/or synthetic Vorabpauschale records. */
  taxEvents: TaxEvent[];
  taxProfile?: TaxProfile;
  /** The Stichtag (cut-off date) for the whole calculation. Defaults to "now". */
  asOfDate?: Date;
}

interface FifoLot {
  activity: TaxActivityRow;
  originalQuantity: number;
  remainingQuantity: number;
}

// Tolerance for floating-point residuals left over when summed sell quantities
// should exactly match a lot's bought quantity (e.g. 17.4405 + 31 + 7.17225 !==
// exactly 55.61275 in IEEE 754 arithmetic). Without this, a near-zero leftover
// quantity stays "open" with a near-zero cost basis, producing absurd gain
// percentages (e.g. 1925%) while the gain amount itself rounds to 0,00 €.
const QUANTITY_EPSILON = 1e-6;

/**
 * Returns the quantity of a BUY activity that is still open (not yet sold),
 * clamping floating-point residuals below QUANTITY_EPSILON to exactly 0.
 */
function remainingLotQuantity(quantity: number, soldQuantity: number | null | undefined): number {
  const remaining = quantity - (soldQuantity ?? 0);

  return remaining > QUANTITY_EPSILON ? remaining : 0;
}

export function calculateTaxOverview({
  activities,
  holdings,
  taxEvents,
  taxProfile = DEFAULT_TAX_PROFILE,
  asOfDate = new Date()
}: CalculateTaxOverviewInput): TaxOverviewRow[] {
  const cutoffTimestamp = endOfDayTimestamp(asOfDate);
  const asOfYear = asOfDate.getFullYear();
  const relevantActivities = activities.filter((activity) => {
    return activity.date !== null && new Date(activity.date).getTime() <= cutoffTimestamp;
  });

  const rows = new Map<string, TaxOverviewRow>();

  for (const activity of relevantActivities) {
    const symbolKey = `${activity.accountId}:${normalizeSymbol(activity.symbol)}`;
    const existing = rows.get(symbolKey) ?? createEmptyRow(activity, symbolKey);
    const type = normalizeType(activity.type);
    const totalValue = activity.quantity * activity.unitPrice;

    existing.activities.push({
      accountId: activity.accountId,
      date: activity.date,
      fee: activity.fee,
      gainAmount: null,
      gainPercentage: null,
      potentialTaxes: 0,
      potentialTaxesWithoutVap: 0,
      quantity: activity.quantity,
      sellDetails: [],
      soldQuantity: type === 'SELL' ? activity.quantity : 0,
      symbol: activity.symbol,
      totalTaxableVap: 0,
      totalVap: 0,
      totalVapAfterTeilfreistellung: 0,
      totalValue,
      type,
      unitPrice: activity.unitPrice
    });

    if (type === 'BUY') {
      existing.entryPriceAmount += activity.quantity * activity.unitPrice + activity.fee;
    }

    rows.set(symbolKey, existing);
  }

  for (const row of rows.values()) {
    const rowTaxEvents = taxEvents.filter((taxEvent) => {
      return taxEvent.accountId === row.accountId && taxEvent.symbolId === normalizeSymbol(row.symbol);
    });

    // Build FIFO lots in chronological order and match SELL activities against them,
    // recording, for every BUY lot, the exact date+quantity of every partial/complete sale.
    // This per-lot sell timeline is what allows VAP to be attributed correctly: a lot's
    // remaining quantity at the end of any given year can be reconstructed from it.
    const fifoLots: FifoLot[] = [];

    for (const activity of [...row.activities].sort(byActivityDate)) {
      if (activity.type === 'BUY') {
        fifoLots.push({
          activity,
          originalQuantity: activity.quantity,
          remainingQuantity: activity.quantity
        });
        continue;
      }

      if (activity.type !== 'SELL') {
        continue;
      }

      let remainingToMatch = activity.quantity;

      while (remainingToMatch > QUANTITY_EPSILON && fifoLots.length > 0) {
        const lot = fifoLots[0];
        const matchedQuantity = Math.min(lot.remainingQuantity, remainingToMatch);
        const buyCostBasis = matchedQuantity * lot.activity.unitPrice + lot.activity.fee;
        const sellProceeds = matchedQuantity * activity.unitPrice - activity.fee;
        const realizedAmount = sellProceeds - buyCostBasis;
        const realizedPercentage = buyCostBasis > 0 ? (realizedAmount / buyCostBasis) * 100 : 0;
        const saleYear = activity.date ? new Date(activity.date).getFullYear() : asOfYear;
        const accruedPerShareBeforeSale = calculateLotVapPerShare({
          acquisitionDate: lot.activity.date,
          throughYear: saleYear - 1,
          taxEvents: rowTaxEvents
        });
        const usedVapForSelling = roundMoney(
          matchedQuantity * accruedPerShareBeforeSale.grossPerShare
        );
        const usedTaxableVapForSelling = roundMoney(
          matchedQuantity * accruedPerShareBeforeSale.taxablePerShare
        );
        const taxableGainBeforeAllowance = calculateTaxableGainAfterVap({
          acquisitionCost: buyCostBasis,
          saleProceeds: sellProceeds,
          taxProfile,
          usedVap: usedVapForSelling
        });
        const taxForSelling = calculateTaxForSale({
          acquisitionCost: buyCostBasis,
          saleProceeds: sellProceeds,
          taxProfile,
          usedVap: usedVapForSelling
        });

        lot.activity.soldQuantity = (lot.activity.soldQuantity ?? 0) + matchedQuantity;
        lot.activity.sellDetails.push({
          date: activity.date,
          realizedAmount,
          realizedCostBasis: buyCostBasis,
          realizedPercentage,
          soldQuantity: matchedQuantity,
          taxableGainBeforeAllowance,
          taxForSelling,
          totalValue: sellProceeds,
          unitPrice: activity.unitPrice,
          // Filled in by the chronological Sparer-Pauschbetrag allocation pass below, once all
          // sellDetails for the year (across every symbol/account) are known.
          usedSparerPauschbetragForSelling: 0,
          usedTaxableVapForSelling,
          usedVapForSelling
        });

        lot.remainingQuantity -= matchedQuantity;
        remainingToMatch -= matchedQuantity;

        if (lot.remainingQuantity <= QUANTITY_EPSILON) {
          fifoLots.shift();
        }
      }
    }
  }

  // Distribute the shared annual Sparer-Pauschbetrag across every sale of every symbol/account,
  // following the agreed order: each year's taxable VAP (across all symbols) is consumed first,
  // then the remaining allowance goes to sales in chronological order (same-day sales split
  // proportionally). This is a purely additive, informative breakdown attached to sellDetails -
  // it never changes taxForSelling or any existing totals (see
  // allocateSparerPauschbetragChronologically and calculateAnnualTaxSummaries, which apply the
  // same combined allowance at the year-total level).
  const taxableVapByYear = new Map<number, number>();
  const saleEventsByYear = new Map<
    number,
    { id: string; date: Date; sellDetail: TaxSellDetailRow; taxableAmount: number }[]
  >();
  let saleEventCounter = 0;

  for (const row of rows.values()) {
    const rowTaxEvents = taxEvents.filter((taxEvent) => {
      return taxEvent.accountId === row.accountId && taxEvent.symbolId === normalizeSymbol(row.symbol);
    });

    for (const activity of row.activities) {
      if (activity.type === 'BUY') {
        const vapByYear = calculateLotVapByYear({
          acquisitionDate: activity.date,
          asOfYear,
          originalQuantity: activity.quantity,
          sellDetails: activity.sellDetails,
          taxEvents: rowTaxEvents
        });

        for (const [year, { taxableVap }] of vapByYear) {
          taxableVapByYear.set(year, roundMoney((taxableVapByYear.get(year) ?? 0) + taxableVap));
        }
      }

      for (const sellDetail of activity.sellDetails) {
        if (!sellDetail.date) {
          continue;
        }

        const saleYear = new Date(sellDetail.date).getFullYear();
        const events = saleEventsByYear.get(saleYear) ?? [];

        events.push({
          date: new Date(sellDetail.date),
          id: `sale-${saleEventCounter}`,
          sellDetail,
          taxableAmount: sellDetail.taxableGainBeforeAllowance
        });
        saleEventCounter += 1;
        saleEventsByYear.set(saleYear, events);
      }
    }
  }

  const allowanceYears = new Set([...taxableVapByYear.keys(), ...saleEventsByYear.keys()]);

  for (const year of allowanceYears) {
    const events = saleEventsByYear.get(year) ?? [];
    const allocation = allocateSparerPauschbetragChronologically({
      saleEvents: events.map(({ id, date, taxableAmount }) => ({ date, id, taxableAmount })),
      sparerPauschbetragAvailable: taxProfile.sparerPauschbetrag,
      vapTaxableAmount: taxableVapByYear.get(year) ?? 0
    });

    for (const event of events) {
      event.sellDetail.usedSparerPauschbetragForSelling =
        allocation.saleAllocations.get(event.id)?.used ?? 0;
    }
  }

  return [...rows.values()].map((row) => {
    const holding = holdings.find((candidate) => {
      return normalizeSymbol(candidate.symbol) === normalizeSymbol(row.symbol);
    });
    const rowTaxEvents = taxEvents.filter((taxEvent) => {
      return taxEvent.accountId === row.accountId && taxEvent.symbolId === normalizeSymbol(row.symbol);
    });
    const buyLots = row.activities.filter((activity) => activity.type === 'BUY');

    const openQuantity = buyLots.reduce((sum, activity) => {
      return sum + remainingLotQuantity(activity.quantity, activity.soldQuantity);
    }, 0);
    const entryPriceAmount = buyLots.reduce((sum, activity) => {
      const remaining = remainingLotQuantity(activity.quantity, activity.soldQuantity);
      const totalCost = activity.quantity * activity.unitPrice + activity.fee;
      const unitCost = activity.quantity > 0 ? totalCost / activity.quantity : 0;

      return sum + remaining * unitCost;
    }, 0);
    const entryPricePerUnit = openQuantity > 0 ? entryPriceAmount / openQuantity : 0;
    const fallbackPricePerUnit = holding?.marketPrice ?? entryPricePerUnit;
    const currentPositionValue = holding?.valueInBaseCurrency ?? openQuantity * fallbackPricePerUnit;
    const positionPricePerUnit = holding?.marketPrice ?? entryPricePerUnit;

    let totalVap = 0;
    let totalVapAfterTeilfreistellung = 0;

    for (const activity of buyLots) {
      const lotLifetimeVap = calculateLotLifetimeVap({
        acquisitionDate: activity.date,
        asOfYear,
        originalQuantity: activity.quantity,
        sellDetails: activity.sellDetails,
        taxEvents: rowTaxEvents
      });

      totalVap += lotLifetimeVap.grossVap;
      totalVapAfterTeilfreistellung += lotLifetimeVap.taxableVap;

      const remainingBuyQuantity = remainingLotQuantity(activity.quantity, activity.soldQuantity);
      const baseCost = activity.quantity * activity.unitPrice + activity.fee;
      const remainingCostBasis =
        activity.quantity > 0 ? (remainingBuyQuantity / activity.quantity) * baseCost : 0;
      const currentValueForRow = remainingBuyQuantity * positionPricePerUnit;
      const buyGainAmount = remainingCostBasis > 0 ? currentValueForRow - remainingCostBasis : 0;
      const buyGainPercentage = remainingCostBasis > 0 ? (buyGainAmount / remainingCostBasis) * 100 : 0;
      const remainingAccruedPerShare = calculateLotVapPerShare({
        acquisitionDate: activity.date,
        throughYear: asOfYear - 1,
        taxEvents: rowTaxEvents
      });
      const remainingActivityVap = roundMoney(
        remainingBuyQuantity * remainingAccruedPerShare.grossPerShare
      );
      const remainingActivityVapAfterTeilfreistellung = roundMoney(
        remainingBuyQuantity * remainingAccruedPerShare.taxablePerShare
      );

      activity.gainAmount = buyGainAmount;
      activity.gainPercentage = buyGainPercentage;
      activity.totalTaxableVap = remainingActivityVapAfterTeilfreistellung;
      activity.totalVap = remainingActivityVap;
      activity.totalVapAfterTeilfreistellung = remainingActivityVapAfterTeilfreistellung;
      activity.potentialTaxes =
        remainingBuyQuantity > 0
          ? calculatePotentialTax({
              acquisitionCost: remainingCostBasis,
              currentValue: currentValueForRow,
              taxProfile,
              usedVap: remainingActivityVap
            })
          : 0;
      activity.potentialTaxesWithoutVap =
        remainingBuyQuantity > 0
          ? calculatePotentialTax({
              acquisitionCost: remainingCostBasis,
              currentValue: currentValueForRow,
              taxProfile,
              usedVap: 0
            })
          : 0;
    }

    totalVap = roundMoney(totalVap);
    totalVapAfterTeilfreistellung = roundMoney(totalVapAfterTeilfreistellung);

    const potentialTaxes = calculatePotentialTax({
      acquisitionCost: entryPriceAmount,
      currentValue: currentPositionValue,
      taxProfile,
      usedVap: buyLots.reduce((sum, activity) => sum + activity.totalVap, 0)
    });
    const potentialTaxesWithoutVap = calculatePotentialTax({
      acquisitionCost: entryPriceAmount,
      currentValue: currentPositionValue,
      taxProfile,
      usedVap: 0
    });
    const usedVapForSelling = roundMoney(sumSellDetails(row.activities, 'usedVapForSelling'));
    const usedTaxableVapForSelling = roundMoney(
      sumSellDetails(row.activities, 'usedTaxableVapForSelling')
    );
    const taxForSelling = roundMoney(sumSellDetails(row.activities, 'taxForSelling'));
    const usedSparerPauschbetragForSelling = roundMoney(
      sumSellDetails(row.activities, 'usedSparerPauschbetragForSelling')
    );
    const gainAmount = currentPositionValue - entryPriceAmount;
    const gainPercentage = entryPriceAmount > 0 ? (gainAmount / entryPriceAmount) * 100 : 0;
    const realizedAmount = roundMoney(sumSellDetails(row.activities, 'realizedAmount'));
    const realizedCostBasis = roundMoney(sumSellDetails(row.activities, 'realizedCostBasis'));
    const realizedPercentage = realizedCostBasis > 0 ? (realizedAmount / realizedCostBasis) * 100 : 0;

    row.currency = row.currency || 'EUR';
    row.entryPriceAmount = entryPriceAmount;
    row.entryPricePerUnit = entryPricePerUnit;
    row.positionQuantity = openQuantity;
    row.positionPricePerUnit = positionPricePerUnit;
    row.positionPriceAmount = currentPositionValue;
    row.gainAmount = gainAmount;
    row.gainPercentage = gainPercentage;
    row.realizedAmount = realizedAmount;
    row.realizedPercentage = realizedPercentage;
    row.potentialTaxes = potentialTaxes;
    row.potentialTaxesWithoutVap = potentialTaxesWithoutVap;
    row.taxForSelling = taxForSelling;
    row.totalTaxableVap = totalVapAfterTeilfreistellung;
    row.usedSparerPauschbetragForSelling = usedSparerPauschbetragForSelling;
    row.usedTaxableVapForSelling = usedTaxableVapForSelling;
    row.totalVap = totalVap;
    row.totalVapAfterTeilfreistellung = totalVapAfterTeilfreistellung;
    row.usedVapForSelling = usedVapForSelling;

    return row;
  });
}

/**
 * Per-share VAP accrued by a lot for every full tax year it was held, up to and including
 * `throughYear`. Only the acquisition year is prorated by acquisition month; every later year
 * counts fully. Callers multiply this by whatever quantity of the lot is relevant (the
 * quantity still held at the point in time being evaluated).
 */
function calculateLotVapPerShare({
  acquisitionDate,
  taxEvents,
  throughYear
}: {
  acquisitionDate: Date | string | null;
  taxEvents: TaxEvent[];
  throughYear: number;
}): { grossPerShare: number; taxablePerShare: number } {
  if (!acquisitionDate) {
    return { grossPerShare: 0, taxablePerShare: 0 };
  }

  const lotYear = new Date(acquisitionDate).getFullYear();

  if (Number.isNaN(lotYear)) {
    return { grossPerShare: 0, taxablePerShare: 0 };
  }

  let grossPerShare = 0;
  let taxablePerShare = 0;

  for (let year = lotYear; year <= throughYear; year += 1) {
    const monthFactor = year === lotYear ? calculateVapMonthFactor({ acquisitionDate }) : 1;
    const yearEvents = taxEvents.filter((taxEvent) => taxEvent.taxYear === year);

    for (const taxEvent of yearEvents) {
      grossPerShare += monthFactor * taxEvent.vorabpauschalePerShare;
      taxablePerShare += monthFactor * taxEvent.vorabpauschalePerShareAfterTeilfreistellung;
    }
  }

  return { grossPerShare, taxablePerShare };
}

/**
 * Total VAP a BUY lot has ever accrued up to `asOfYear`, correctly excluding any year in which
 * the lot (or the relevant portion of it) had already been fully sold before that year's end.
 */
function calculateLotLifetimeVap({
  acquisitionDate,
  asOfYear,
  originalQuantity,
  sellDetails,
  taxEvents
}: {
  acquisitionDate: Date | string | null;
  asOfYear: number;
  originalQuantity: number;
  sellDetails: TaxSellDetailRow[];
  taxEvents: TaxEvent[];
}): { grossVap: number; taxableVap: number } {
  if (!acquisitionDate) {
    return { grossVap: 0, taxableVap: 0 };
  }

  const lotYear = new Date(acquisitionDate).getFullYear();

  if (Number.isNaN(lotYear)) {
    return { grossVap: 0, taxableVap: 0 };
  }

  let grossVap = 0;
  let taxableVap = 0;

  for (let year = lotYear; year < asOfYear; year += 1) {
    const remainingQuantity = remainingQuantityAtEndOfYear({
      originalQuantity,
      sellDetails,
      year
    });

    if (remainingQuantity <= 0) {
      continue;
    }

    const monthFactor = year === lotYear ? calculateVapMonthFactor({ acquisitionDate }) : 1;
    const yearEvents = taxEvents.filter((taxEvent) => taxEvent.taxYear === year);

    for (const taxEvent of yearEvents) {
      grossVap += remainingQuantity * monthFactor * taxEvent.vorabpauschalePerShare;
      taxableVap +=
        remainingQuantity * monthFactor * taxEvent.vorabpauschalePerShareAfterTeilfreistellung;
    }
  }

  return { grossVap: roundMoney(grossVap), taxableVap: roundMoney(taxableVap) };
}

function remainingQuantityAtEndOfYear({
  originalQuantity,
  sellDetails,
  year
}: {
  originalQuantity: number;
  sellDetails: TaxSellDetailRow[];
  year: number;
}): number {
  const endOfYearTimestamp = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
  const soldByEndOfYear = sellDetails.reduce((sum, sellDetail) => {
    if (!sellDetail.date || sellDetail.date.getTime() > endOfYearTimestamp) {
      return sum;
    }

    return sum + sellDetail.soldQuantity;
  }, 0);

  return Math.max(originalQuantity - soldByEndOfYear, 0);
}

/**
 * Per-year breakdown of a BUY lot's taxable VAP, keyed by the *calendar year the VAP becomes
 * tax-relevant in* (a taxEvent declared for taxYear Y is only taxable from 01.01 of year Y+1
 * onwards - see the module doc comment). Only years in which the lot still had a remaining,
 * unsold quantity at year-end contribute. Used exclusively to feed the annual Sparer-
 * Pauschbetrag aggregation in calculateAnnualTaxSummaries; calculateLotLifetimeVap (the
 * lifetime total used for the regular per-symbol overview rows) is intentionally left
 * unchanged.
 */
function calculateLotVapByYear({
  acquisitionDate,
  asOfYear,
  originalQuantity,
  sellDetails,
  taxEvents
}: {
  acquisitionDate: Date | string | null;
  asOfYear: number;
  originalQuantity: number;
  sellDetails: TaxSellDetailRow[];
  taxEvents: TaxEvent[];
}): Map<number, { grossVap: number; taxableVap: number }> {
  const vapByTaxRelevantYear = new Map<number, { grossVap: number; taxableVap: number }>();

  if (!acquisitionDate) {
    return vapByTaxRelevantYear;
  }

  const lotYear = new Date(acquisitionDate).getFullYear();

  if (Number.isNaN(lotYear)) {
    return vapByTaxRelevantYear;
  }

  for (let year = lotYear; year < asOfYear; year += 1) {
    const remainingQuantity = remainingQuantityAtEndOfYear({ originalQuantity, sellDetails, year });

    if (remainingQuantity <= 0) {
      continue;
    }

    const monthFactor = year === lotYear ? calculateVapMonthFactor({ acquisitionDate }) : 1;
    const yearEvents = taxEvents.filter((taxEvent) => taxEvent.taxYear === year);

    if (!yearEvents.length) {
      continue;
    }

    let grossVap = 0;
    let taxableVap = 0;

    for (const taxEvent of yearEvents) {
      grossVap += remainingQuantity * monthFactor * taxEvent.vorabpauschalePerShare;
      taxableVap +=
        remainingQuantity * monthFactor * taxEvent.vorabpauschalePerShareAfterTeilfreistellung;
    }

    // The VAP declared for tax year `year` only becomes tax-relevant on 01.01 of `year + 1`.
    const taxRelevantYear = year + 1;
    const existing = vapByTaxRelevantYear.get(taxRelevantYear) ?? { grossVap: 0, taxableVap: 0 };

    vapByTaxRelevantYear.set(taxRelevantYear, {
      grossVap: roundMoney(existing.grossVap + grossVap),
      taxableVap: roundMoney(existing.taxableVap + taxableVap)
    });
  }

  return vapByTaxRelevantYear;
}

export interface AnnualTaxSummary {
  /** Calendar year the Sparer-Pauschbetrag was applied for. */
  year: number;
  /** Sum of taxable VAP that becomes tax-relevant in this calendar year. */
  taxableVapBeforeAllowance: number;
  /** Sum of taxable realized sale gains from sales that occurred in this calendar year. */
  taxableSaleGainBeforeAllowance: number;
  /** taxableVapBeforeAllowance + taxableSaleGainBeforeAllowance. */
  totalTaxableCapitalIncome: number;
  /** The configured annual Sparer-Pauschbetrag (does not carry over from other years). */
  sparerPauschbetragAvailable: number;
  /** Portion of the allowance consumed by this year's combined capital income. */
  sparerPauschbetragUsed: number;
  /** Unused portion of this year's allowance. It expires and is never carried forward. */
  sparerPauschbetragRemaining: number;
  /** Taxable capital income remaining after the allowance has been applied. */
  taxableCapitalIncomeAfterAllowance: number;
  capitalGainsTax: number;
  solidaritySurcharge: number;
  churchTax: number;
  totalTax: number;
}

/**
 * Builds one summary per calendar year that combines *all* taxable VAP (attributed to the
 * calendar year it becomes tax-relevant in) and *all* taxable realized sale gains (attributed
 * to the calendar year of the sale) across every symbol/account, applies the annual Sparer-
 * Pauschbetrag exactly once to that combined amount, and calculates the resulting tax.
 *
 * This never modifies the VAP itself (see calculateTaxOverview/TaxOverviewRow.totalVap) - it
 * only reduces the tax base derived from it. It reuses calculateTaxOverview's FIFO/VAP
 * attribution (the single shared engine) rather than re-implementing it.
 */
export function calculateAnnualTaxSummaries({
  activities,
  holdings,
  taxEvents,
  taxProfile = DEFAULT_TAX_PROFILE,
  asOfDate = new Date()
}: CalculateTaxOverviewInput): AnnualTaxSummary[] {
  const asOfYear = asOfDate.getFullYear();
  const rows = calculateTaxOverview({ activities, asOfDate, holdings, taxEvents, taxProfile });
  const taxableVapByYear = new Map<number, number>();
  const taxableSaleGainByYear = new Map<number, number>();

  for (const row of rows) {
    const rowTaxEvents = taxEvents.filter((taxEvent) => {
      return taxEvent.accountId === row.accountId && taxEvent.symbolId === normalizeSymbol(row.symbol);
    });

    for (const activity of row.activities) {
      if (activity.type === 'BUY') {
        const vapByYear = calculateLotVapByYear({
          acquisitionDate: activity.date,
          asOfYear,
          originalQuantity: activity.quantity,
          sellDetails: activity.sellDetails,
          taxEvents: rowTaxEvents
        });

        for (const [year, { taxableVap }] of vapByYear) {
          taxableVapByYear.set(year, roundMoney((taxableVapByYear.get(year) ?? 0) + taxableVap));
        }
      }

      for (const sellDetail of activity.sellDetails) {
        const saleYear = sellDetail.date ? new Date(sellDetail.date).getFullYear() : asOfYear;

        taxableSaleGainByYear.set(
          saleYear,
          roundMoney(
            (taxableSaleGainByYear.get(saleYear) ?? 0) + sellDetail.taxableGainBeforeAllowance
          )
        );
      }
    }
  }

  const years = [...new Set([...taxableVapByYear.keys(), ...taxableSaleGainByYear.keys()])].sort(
    (left, right) => left - right
  );

  return years.map((year) => {
    const taxableVapBeforeAllowance = roundMoney(taxableVapByYear.get(year) ?? 0);
    const taxableSaleGainBeforeAllowance = roundMoney(taxableSaleGainByYear.get(year) ?? 0);
    const allocation = allocateSparerPauschbetragForYear({
      sparerPauschbetragAvailable: taxProfile.sparerPauschbetrag,
      taxableAmounts: [taxableVapBeforeAllowance, taxableSaleGainBeforeAllowance]
    });
    const capitalGainsTax = roundMoney(
      allocation.taxableAfterAllowance * taxProfile.capitalGainsTaxRate
    );
    const solidaritySurcharge = roundMoney(capitalGainsTax * taxProfile.solidaritySurchargeRate);
    const churchTax = roundMoney(allocation.taxableAfterAllowance * taxProfile.churchTaxRate);
    const totalTax = calculateTaxOnTaxableAmount(allocation.taxableAfterAllowance, taxProfile);

    return {
      capitalGainsTax,
      churchTax,
      solidaritySurcharge,
      sparerPauschbetragAvailable: roundMoney(Math.max(taxProfile.sparerPauschbetrag, 0)),
      sparerPauschbetragRemaining: allocation.remaining,
      sparerPauschbetragUsed: allocation.used,
      taxableCapitalIncomeAfterAllowance: allocation.taxableAfterAllowance,
      taxableSaleGainBeforeAllowance,
      taxableVapBeforeAllowance,
      totalTax,
      totalTaxableCapitalIncome: allocation.totalTaxableAmount,
      year
    };
  });
}

function sumSellDetails(
  activities: TaxActivityRow[],
  field:
    | 'realizedAmount'
    | 'realizedCostBasis'
    | 'taxForSelling'
    | 'usedSparerPauschbetragForSelling'
    | 'usedTaxableVapForSelling'
    | 'usedVapForSelling'
): number {
  return activities.reduce((sum, activity) => {
    return sum + activity.sellDetails.reduce((activitySum, sellDetail) => activitySum + sellDetail[field], 0);
  }, 0);
}


function createEmptyRow(activity: Activity, symbolKey: string): TaxOverviewRow {
  return {
    accountId: activity.accountId,
    accountName: activity.accountName,
    activities: [],
    currency: activity.currency || 'EUR',
    entryPriceAmount: 0,
    entryPricePerUnit: 0,
    gainAmount: 0,
    gainPercentage: 0,
    name: activity.name || activity.symbol,
    positionPriceAmount: 0,
    positionPricePerUnit: 0,
    positionQuantity: 0,
    potentialTaxes: 0,
    potentialTaxesWithoutVap: 0,
    realizedAmount: 0,
    realizedPercentage: 0,
    symbol: activity.symbol,
    taxForSelling: 0,
    trackKey: symbolKey,
    totalTaxableVap: 0,
    usedSparerPauschbetragForSelling: 0,
    usedTaxableVapForSelling: 0,
    totalVap: 0,
    totalVapAfterTeilfreistellung: 0,
    usedVapForSelling: 0
  };
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeType(type: string): string {
  return type.trim().toUpperCase();
}

function byActivityDate(left: TaxActivityRow, right: TaxActivityRow): number {
  const leftTimestamp = left.date ? new Date(left.date).getTime() : 0;
  const rightTimestamp = right.date ? new Date(right.date).getTime() : 0;

  return leftTimestamp - rightTimestamp;
}

function endOfDayTimestamp(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
