import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { LocaleNumberPipe } from '../pipes/locale-number.pipe';
import { PortfolioDataStore } from '../services/portfolio-data.store';
import {
  calculatePaidVap,
  calculatePotentialTax,
  calculateTaxForSale,
  calculateTotalTaxImpact,
  calculateTotalVap,
  calculateTotalVapAfterTeilfreistellung,
  calculateUsedVap,
  calculateVapForBuyLot,
  calculateVapForQuantity,
  DEFAULT_TAX_PROFILE,
  type TaxProfile
} from '../services/tax-calculator';
import {
  TaxEventsService,
  type TaxEvent
} from '../services/tax-events';

interface LabelOption {
  id: string;
  label: string;
}

interface TaxEventRow extends TaxEvent {
  accountLabel: string;
  totalAmount: number;
  totalAmountAfterTeilfreistellung: number;
  symbolLabel: string;
}

interface TaxEventYearGroup {
  events: TaxEventRow[];
  taxYear: number;
}

interface TaxSellDetailRow {
  date: Date | null;
  realizedAmount: number;
  realizedCostBasis: number;
  realizedPercentage: number;
  soldQuantity: number;
  taxForSelling: number;
  totalTaxImpact: number;
  totalValue: number;
  unitPrice: number;
  usedPaidVapForSelling: number;
  usedVapForSelling: number;
}

interface TaxActivityRow {
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
  totalPaidVap: number;
  totalVap: number;
  totalVapAfterTeilfreistellung: number;
  totalValue: number;
  type: string;
  unitPrice: number;
}

interface TaxOverviewRow {
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
  totalPaidVap: number;
  totalTaxImpact: number;
  usedPaidVapForSelling: number;
  totalVap: number;
  totalVapAfterTeilfreistellung: number;
  usedVapForSelling: number;
}

type DialogMode = 'create' | 'edit';

@Component({
  selector: 'app-tax-page',
  imports: [CommonModule, LocaleNumberPipe],
  templateUrl: './tax-page.html',
  styleUrl: './tax-page.scss'
})
export class TaxPage implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService, { optional: true });
  private readonly portfolioDataStore = inject(PortfolioDataStore);
  private readonly taxEventsService = inject(TaxEventsService);

  protected readonly activities = this.portfolioDataStore.activities;
  protected readonly holdings = this.portfolioDataStore.holdings;
  protected readonly infoMessage = this.portfolioDataStore.infoMessage;
  protected readonly isLoading = this.portfolioDataStore.isLoading;
  protected readonly taxEvents = signal<TaxEvent[]>([]);
  protected readonly taxErrorMessage = signal('');
  protected readonly taxInfoMessage = signal('');
  protected readonly isSaving = signal(false);
  protected readonly isTaxEventsLoading = signal(false);
  protected readonly selectedAccountId = signal('all');
  protected readonly isDialogOpen = signal(false);
  protected readonly dialogMode = signal<DialogMode>('create');
  private readonly expandedEntrySet = signal(new Set<TaxActivityRow>());
  protected readonly dialogTaxEventId = signal('');
  protected readonly dialogAccountId = signal('');
  protected readonly dialogSymbolId = signal('');
  protected readonly dialogTaxYear = signal(getCurrentYear());
  protected readonly dialogQuantity = signal(0);
  protected readonly dialogVorabpauschalePerShare = signal(0);
  protected readonly dialogVorabpauschalePerShareAfterTeilfreistellung = signal(0);
  protected readonly dialogErrorMessage = signal('');
  protected readonly expandedYears = signal(new Set<number>());
  protected readonly taxProfile = signal<TaxProfile>({ ...DEFAULT_TAX_PROFILE });
  private taxProfileSaveTimeout: number | null = null;
  protected readonly accountLabelById = computed(() => {
    return buildLabelMap([
      ...this.activities().map(({ accountId, accountName }) => ({
        id: accountId,
        label: accountName || accountId
      })),
      ...this.taxEvents().map(({ accountId }) => ({
        id: accountId,
        label: accountId
      }))
    ]);
  });
  protected readonly createAccountOptions = computed(() => {
    return sortLabelOptions(
      buildLabelMap(
        this.activities().map(({ accountId, accountName }) => ({
          id: accountId,
          label: accountName || accountId
        }))
      )
    );
  });
  protected readonly symbolLabelById = computed(() => {
    return buildLabelMap([
      ...this.activities().map(({ name, symbol }) => ({
        id: symbol,
        label: name || symbol
      })),
      ...this.holdings().map(({ name, symbol }) => ({
        id: symbol,
        label: name || symbol
      })),
      ...this.taxEvents().map(({ symbolId }) => ({
        id: symbolId,
        label: symbolId
      }))
    ]);
  });
  protected readonly createSymbolOptions = computed(() => {
    return sortLabelOptions(
      buildLabelMap([
        ...this.activities().map(({ name, symbol }) => ({
          id: symbol,
          label: name || symbol
        })),
        ...this.holdings().map(({ name, symbol }) => ({
          id: symbol,
          label: name || symbol
        }))
      ])
    );
  });
  protected readonly accountFilterOptions = computed(() => {
    return sortLabelOptions(this.accountLabelById());
  });
  protected readonly canEditTaxProfile = computed(() => Boolean(this.authService?.user()));
  protected readonly canCreateTaxEvent = computed(() => {
    return (
      this.createAccountOptions().length > 0 &&
      this.createSymbolOptions().length > 0
    );
  });
  private readonly syncTaxProfileEffect = effect(() => {
    const savedTaxProfile = this.authService?.taxConfig();

    if (!savedTaxProfile) {
      return;
    }

    this.taxProfile.set({
      ...DEFAULT_TAX_PROFILE,
      ...savedTaxProfile
    });
  });
  protected readonly taxEventRows = computed<TaxEventRow[]>(() => {
    const accountLabels = this.accountLabelById();
    const symbolLabels = this.symbolLabelById();

    return this.taxEvents()
      .filter((taxEvent) => {
        return this.selectedAccountId() === 'all' || taxEvent.accountId === this.selectedAccountId();
      })
      .map((taxEvent) => {
        const totalAmount = calculateTotalVap([taxEvent]);
        const totalAmountAfterTeilfreistellung = calculateTotalVapAfterTeilfreistellung([taxEvent]);

        return {
          ...taxEvent,
          accountLabel: accountLabels.get(taxEvent.accountId) || taxEvent.accountId,
          symbolLabel: symbolLabels.get(taxEvent.symbolId) || taxEvent.symbolId,
          totalAmount,
          totalAmountAfterTeilfreistellung
        };
      })
      .sort((left, right) => {
        if (left.taxYear !== right.taxYear) {
          return right.taxYear - left.taxYear;
        }

        const accountComparison = left.accountLabel.localeCompare(right.accountLabel, undefined, {
          numeric: true,
          sensitivity: 'base'
        });

        if (accountComparison !== 0) {
          return accountComparison;
        }

        const symbolComparison = left.symbolLabel.localeCompare(right.symbolLabel, undefined, {
          numeric: true,
          sensitivity: 'base'
        });

        if (symbolComparison !== 0) {
          return symbolComparison;
        }

        return left.id.localeCompare(right.id, undefined, {
          numeric: true,
          sensitivity: 'base'
        });
      });
  });
  protected readonly taxEventYearGroups = computed<TaxEventYearGroup[]>(() => {
    const groups = new Map<number, TaxEventRow[]>();

    for (const taxEvent of this.taxEventRows()) {
      const yearRows = groups.get(taxEvent.taxYear);

      if (yearRows) {
        yearRows.push(taxEvent);
      } else {
        groups.set(taxEvent.taxYear, [taxEvent]);
      }
    }

    return [...groups.entries()]
      .sort(([leftYear], [rightYear]) => rightYear - leftYear)
      .map(([taxYear, events]) => ({
        events,
        taxYear
      }));
  });
  protected readonly taxSummary = computed(() => {
    const taxProfile = this.taxProfile();
    const overviewRows = this.taxOverviewRows().filter((row) => {
      return this.selectedAccountId() === 'all' || row.accountId === this.selectedAccountId();
    });
    const filteredTaxEvents =
      this.selectedAccountId() === 'all'
        ? this.taxEvents()
        : this.taxEvents().filter((taxEvent) => taxEvent.accountId === this.selectedAccountId());
    const totalVap = calculateTotalVap(filteredTaxEvents);
    const totalVapAfterTeilfreistellung = calculateTotalVapAfterTeilfreistellung(filteredTaxEvents);
    const totalPaidVap = calculatePaidVap({
      taxProfile,
      taxableVap: totalVapAfterTeilfreistellung
    });
    const portfolioValue = this.holdings().reduce((sum, holding) => {
      return sum + holding.valueInBaseCurrency;
    }, 0);
    const portfolioCostBasis = this.activities().reduce((sum, activity) => {
      if (this.selectedAccountId() !== 'all' && activity.accountId !== this.selectedAccountId()) {
        return sum;
      }

      if (activity.type.trim().toUpperCase() === 'BUY') {
        return sum + activity.quantity * activity.unitPrice + activity.fee;
      }

      if (activity.type.trim().toUpperCase() === 'SELL') {
        return sum + activity.quantity * activity.unitPrice - activity.fee;
      }

      return sum;
    }, 0);
    const potentialTaxes = calculatePotentialTax({
      acquisitionCost: portfolioCostBasis,
      currentValue: portfolioValue,
      taxProfile,
      usedVap: totalVap
    });
    const realizedSaleProceeds = this.activities().reduce((sum, activity) => {
      if (this.selectedAccountId() !== 'all' && activity.accountId !== this.selectedAccountId()) {
        return sum;
      }

      if (activity.type.trim().toUpperCase() === 'SELL') {
        return sum + activity.quantity * activity.unitPrice - activity.fee;
      }

      return sum;
    }, 0);
    const usedVapForSelling = overviewRows.reduce((sum, row) => sum + row.usedVapForSelling, 0);
    const usedPaidVapForSelling = overviewRows.reduce((sum, row) => sum + row.usedPaidVapForSelling, 0);
    const taxForSelling = calculateTaxForSale({
      acquisitionCost: portfolioCostBasis,
      saleProceeds: realizedSaleProceeds,
      taxProfile,
      usedVap: usedVapForSelling
    });

    return {
      potentialTaxes,
      taxForSelling,
      totalTaxImpact: calculateTotalTaxImpact({
        taxForSelling,
        usedVapForSelling: usedVapForSelling
      }),
      totalPaidVap,
      usedPaidVapForSelling,
      usedVapForSelling,
      totalVap,
      totalVapAfterTeilfreistellung
    };
  });
  protected readonly taxOverviewRows = computed<TaxOverviewRow[]>(() => {
    const rows = new Map<string, TaxOverviewRow>();

    for (const activity of this.activities()) {
      const symbolKey = `${activity.accountId}:${activity.symbol.trim().toUpperCase()}`;
      const taxProfile = this.taxProfile();
      const existing = rows.get(symbolKey) ?? {
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
        totalPaidVap: 0,
        totalTaxImpact: 0,
        usedPaidVapForSelling: 0,
        totalVap: 0,
        totalVapAfterTeilfreistellung: 0,
        usedVapForSelling: 0
      };

      const type = activity.type.trim().toUpperCase();
      const totalValue = activity.quantity * activity.unitPrice;
      const taxEvents = this.taxEvents().filter((taxEvent) => {
        return taxEvent.accountId === activity.accountId && taxEvent.symbolId === activity.symbol.trim().toUpperCase();
      });
      const activityTaxYear = activity.date ? new Date(activity.date).getFullYear() : undefined;
      const activityVap =
        type === 'BUY'
          ? calculateVapForBuyLot({
              accountId: activity.accountId,
              quantity: activity.quantity,
              symbolId: activity.symbol.trim().toUpperCase(),
              taxEvents,
              taxYear: activityTaxYear
            })
          : 0;
      const activityVapAfterTeilfreistellung =
        type === 'BUY'
          ? calculateVapForBuyLot({
              accountId: activity.accountId,
              quantity: activity.quantity,
              symbolId: activity.symbol.trim().toUpperCase(),
              taxEvents,
              taxYear: activityTaxYear,
              useAfterTeilfreistellung: true
            })
          : 0;
      const currentMarketPrice = this.holdings().find((holding) => {
        return holding.symbol.trim().toUpperCase() === activity.symbol.trim().toUpperCase();
      })?.marketPrice ?? activity.unitPrice;
      const remainingQuantity = type === 'BUY' ? activity.quantity : 0;
      const currentMarketValueForActivity = remainingQuantity * currentMarketPrice;
      const acquisitionCostForActivity = type === 'BUY' ? Math.max(totalValue, 0) : 0;
      const potentialTaxes =
        type === 'BUY'
          ? calculatePotentialTax({
              acquisitionCost: acquisitionCostForActivity,
              currentValue: Math.max(currentMarketValueForActivity, 0),
              taxProfile,
              usedVap: activityVap
            })
          : 0;
      const potentialTaxesWithoutVap =
        type === 'BUY'
          ? calculatePotentialTax({
              acquisitionCost: acquisitionCostForActivity,
              currentValue: Math.max(currentMarketValueForActivity, 0),
              taxProfile,
              usedVap: 0
            })
          : 0;

      existing.activities.push({
        accountId: activity.accountId,
        date: activity.date,
        fee: activity.fee,
        gainAmount: null,
        gainPercentage: null,
        potentialTaxes,
        potentialTaxesWithoutVap,
        quantity: activity.quantity,
        sellDetails: [],
        soldQuantity: type === 'SELL' ? activity.quantity : 0,
        symbol: activity.symbol,
        totalPaidVap: calculatePaidVap({
          taxProfile,
          taxableVap: activityVapAfterTeilfreistellung
        }),
        totalVap: activityVap,
        totalVapAfterTeilfreistellung: activityVapAfterTeilfreistellung,
        totalValue,
        type,
        unitPrice: activity.unitPrice
      });

      if (activity.type.trim().toUpperCase() === 'BUY') {
        existing.entryPriceAmount += activity.quantity * activity.unitPrice + activity.fee;
      }

      rows.set(symbolKey, existing);
    }

    for (const row of rows.values()) {
      const taxEvents = this.taxEvents().filter((taxEvent) => {
        return taxEvent.accountId === row.accountId && taxEvent.symbolId === row.symbol.trim().toUpperCase();
      });
      let remainingAvailableVapForSymbol = calculateTotalVap(taxEvents);
      let remainingAvailablePaidVapForSymbol = calculateTotalVapAfterTeilfreistellung(taxEvents);
      const fifoLots: Array<{ activity: TaxActivityRow; quantity: number }> = [];

      for (const activity of [...row.activities].sort((left, right) => {
        const leftTimestamp = left.date ? getActivityTimestamp(left.date) : 0;
        const rightTimestamp = right.date ? getActivityTimestamp(right.date) : 0;

        return leftTimestamp - rightTimestamp;
      })) {
        const type = activity.type.trim().toUpperCase();

        if (type === 'BUY') {
          fifoLots.push({ activity, quantity: activity.quantity });
          continue;
        }

        if (type !== 'SELL') {
          continue;
        }

        let remainingQuantity = activity.quantity;

        while (remainingQuantity > 0 && fifoLots.length > 0) {
          const firstLot = fifoLots[0];
          const matchedQuantity = Math.min(firstLot.quantity, remainingQuantity);
          const buyCostBasis = matchedQuantity * firstLot.activity.unitPrice + firstLot.activity.fee;
          const sellProceeds = matchedQuantity * activity.unitPrice - activity.fee;
          const realizedAmount = sellProceeds - buyCostBasis;
          const realizedPercentage = buyCostBasis > 0 ? (realizedAmount / buyCostBasis) * 100 : 0;
          const lotYear = firstLot.activity.date ? new Date(firstLot.activity.date).getFullYear() : undefined;
          const taxProfile = this.taxProfile();
          const demandVapForSelling = calculateVapForBuyLot({
            accountId: activity.accountId,
            quantity: matchedQuantity,
            symbolId: activity.symbol.trim().toUpperCase(),
            taxEvents: this.taxEvents().filter((taxEvent) => {
              return taxEvent.accountId === activity.accountId && taxEvent.symbolId === activity.symbol.trim().toUpperCase();
            }),
            taxYear: lotYear
          });
          const usedVapForSelling = Math.min(demandVapForSelling, remainingAvailableVapForSymbol);
          remainingAvailableVapForSymbol = Math.max(remainingAvailableVapForSymbol - usedVapForSelling, 0);
          const demandPaidVapForSelling = calculateVapForBuyLot({
            accountId: activity.accountId,
            quantity: matchedQuantity,
            symbolId: activity.symbol.trim().toUpperCase(),
            taxEvents: this.taxEvents().filter((taxEvent) => {
              return taxEvent.accountId === activity.accountId && taxEvent.symbolId === activity.symbol.trim().toUpperCase();
            }),
            taxYear: lotYear,
            useAfterTeilfreistellung: true
          });
          const effectivePaidVapForSelling = Math.min(
            demandPaidVapForSelling,
            remainingAvailablePaidVapForSymbol
          );
          const usedPaidVapForSelling = calculatePaidVap({
            taxProfile,
            taxableVap: effectivePaidVapForSelling
          });
          remainingAvailablePaidVapForSymbol = Math.max(
            remainingAvailablePaidVapForSymbol - effectivePaidVapForSelling,
            0
          );
          const taxForSelling = calculateTaxForSale({
            acquisitionCost: buyCostBasis,
            saleProceeds: sellProceeds,
            taxProfile,
            usedVap: usedVapForSelling
          });

          firstLot.activity.soldQuantity = (firstLot.activity.soldQuantity ?? 0) + matchedQuantity;
          firstLot.activity.sellDetails.push({
            date: activity.date,
            realizedAmount,
            realizedCostBasis: buyCostBasis,
            realizedPercentage,
            soldQuantity: matchedQuantity,
            taxForSelling,
            totalTaxImpact: calculateTotalTaxImpact({
              taxForSelling,
              usedVapForSelling
            }),
            totalValue: sellProceeds,
            unitPrice: activity.unitPrice,
            usedPaidVapForSelling,
            usedVapForSelling
          });
          firstLot.quantity -= matchedQuantity;
          remainingQuantity -= matchedQuantity;

          if (firstLot.quantity <= 0) {
            fifoLots.shift();
          }
        }
      }

      for (const activity of row.activities) {
        if (activity.type.trim().toUpperCase() === 'BUY' && activity.soldQuantity === 0) {
          activity.soldQuantity = 0;
        }
      }
    }

    return [...rows.values()].map((row) => {
      const taxProfile = this.taxProfile();
      const holding = this.holdings().find((holding) => {
        return holding.symbol.trim().toUpperCase() === row.symbol.trim().toUpperCase();
      });
      const taxEvents = this.taxEvents().filter((taxEvent) => {
        return taxEvent.accountId === row.accountId && taxEvent.symbolId === row.symbol.trim().toUpperCase();
      });
      const fifoLots: Array<{ quantity: number; unitCost: number }> = [];
      for (const activity of [...row.activities].sort((left, right) => {
        const leftTimestamp = left.date ? getActivityTimestamp(left.date) : 0;
        const rightTimestamp = right.date ? getActivityTimestamp(right.date) : 0;

        return leftTimestamp - rightTimestamp;
      })) {
        const type = activity.type.trim().toUpperCase();

        if (type === 'BUY') {
          const totalCost = activity.quantity * activity.unitPrice + activity.fee;
          fifoLots.push({
            quantity: activity.quantity,
            unitCost: activity.quantity > 0 ? totalCost / activity.quantity : 0
          });
          continue;
        }

        if (type !== 'SELL') {
          continue;
        }

        let remainingToMatch = activity.quantity;

        while (remainingToMatch > 0 && fifoLots.length > 0) {
          const firstLot = fifoLots[0];
          const matchedQuantity = Math.min(firstLot.quantity, remainingToMatch);
          firstLot.quantity -= matchedQuantity;
          remainingToMatch -= matchedQuantity;

          if (firstLot.quantity <= 0) {
            fifoLots.shift();
          }
        }
      }

      const openQuantity = fifoLots.reduce((sum, lot) => sum + lot.quantity, 0);
      const entryPriceAmount = fifoLots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0);
      const entryPricePerUnit = openQuantity > 0 ? entryPriceAmount / openQuantity : 0;
      const fallbackPricePerUnit = holding?.marketPrice ?? entryPricePerUnit;
      const currentPositionValue = holding?.valueInBaseCurrency ?? openQuantity * fallbackPricePerUnit;
      const positionPricePerUnit = holding?.marketPrice ?? entryPricePerUnit;
      const totalVap = calculateTotalVap(taxEvents);
      const totalVapAfterTeilfreistellung = calculateTotalVapAfterTeilfreistellung(taxEvents);
      const totalPaidVap = calculatePaidVap({
        taxProfile,
        taxableVap: totalVapAfterTeilfreistellung
      });
      const potentialTaxes = calculatePotentialTax({
        acquisitionCost: entryPriceAmount,
        currentValue: currentPositionValue,
        taxProfile,
        usedVap: totalVap
      });
      const potentialTaxesWithoutVap = calculatePotentialTax({
        acquisitionCost: entryPriceAmount,
        currentValue: currentPositionValue,
        taxProfile,
        usedVap: 0
      });
      const usedVapForSelling = row.activities.reduce((sum, activity) => {
        return (
          sum +
          activity.sellDetails.reduce((activitySum, sellDetail) => {
            return activitySum + sellDetail.usedVapForSelling;
          }, 0)
        );
      }, 0);
      const usedPaidVapForSelling = row.activities.reduce((sum, activity) => {
        return (
          sum +
          activity.sellDetails.reduce((activitySum, sellDetail) => {
            return activitySum + sellDetail.usedPaidVapForSelling;
          }, 0)
        );
      }, 0);
      const taxForSelling = row.activities.reduce((sum, activity) => {
        return (
          sum +
          activity.sellDetails.reduce((activitySum, sellDetail) => {
            return activitySum + sellDetail.taxForSelling;
          }, 0)
        );
      }, 0);
      const totalTaxImpact = row.activities.reduce((sum, activity) => {
        return (
          sum +
          activity.sellDetails.reduce((activitySum, sellDetail) => {
            return activitySum + sellDetail.totalTaxImpact;
          }, 0)
        );
      }, 0);

      const gainAmount = currentPositionValue - entryPriceAmount;
      const gainPercentage = entryPriceAmount > 0 ? (gainAmount / entryPriceAmount) * 100 : 0;
      const realizedAmount = row.activities.reduce((sum, activity) => {
        return sum + activity.sellDetails.reduce((activitySum, sellDetail) => activitySum + sellDetail.realizedAmount, 0);
      }, 0);
      const realizedCostBasis = row.activities.reduce((sum, activity) => {
        return sum + activity.sellDetails.reduce((activitySum, sellDetail) => activitySum + sellDetail.realizedCostBasis, 0);
      }, 0);
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
      row.totalPaidVap = totalPaidVap;
      row.totalTaxImpact = totalTaxImpact;
      row.usedPaidVapForSelling = usedPaidVapForSelling;
      row.totalVap = totalVap;
      row.totalVapAfterTeilfreistellung = totalVapAfterTeilfreistellung;
      row.usedVapForSelling = usedVapForSelling;

      for (const activityRow of row.activities) {
        if (activityRow.type !== 'BUY') {
          continue;
        }

        const baseCost = activityRow.quantity * activityRow.unitPrice + activityRow.fee;
        const remainingBuyQuantity = Math.max(activityRow.quantity - (activityRow.soldQuantity ?? 0), 0);
        const remainingCostBasis =
          activityRow.quantity > 0 ? (remainingBuyQuantity / activityRow.quantity) * baseCost : 0;
        const currentValueForRow = remainingBuyQuantity * row.positionPricePerUnit;
        const buyGainAmount = remainingCostBasis > 0 ? currentValueForRow - remainingCostBasis : 0;
        const buyGainPercentage = remainingCostBasis > 0 ? (buyGainAmount / remainingCostBasis) * 100 : 0;
        const activityTaxYear = activityRow.date ? new Date(activityRow.date).getFullYear() : undefined;
        const remainingActivityVap = calculateVapForBuyLot({
          accountId: activityRow.accountId,
          quantity: remainingBuyQuantity,
          symbolId: row.symbol.trim().toUpperCase(),
          taxEvents: taxEvents,
          taxYear: activityTaxYear
        });
        const remainingActivityVapAfterTeilfreistellung = calculateVapForBuyLot({
          accountId: activityRow.accountId,
          quantity: remainingBuyQuantity,
          symbolId: row.symbol.trim().toUpperCase(),
          taxEvents: taxEvents,
          taxYear: activityTaxYear,
          useAfterTeilfreistellung: true
        });

        activityRow.gainAmount = buyGainAmount;
        activityRow.gainPercentage = buyGainPercentage;
        activityRow.totalPaidVap = calculatePaidVap({
          taxProfile,
          taxableVap: remainingActivityVapAfterTeilfreistellung
        });
        activityRow.totalVap = remainingActivityVap;
        activityRow.totalVapAfterTeilfreistellung = remainingActivityVapAfterTeilfreistellung;
        activityRow.potentialTaxes =
          remainingBuyQuantity > 0
            ? calculatePotentialTax({
                acquisitionCost: remainingCostBasis,
                currentValue: currentValueForRow,
                taxProfile,
                usedVap: remainingActivityVap
              })
            : 0;
        activityRow.potentialTaxesWithoutVap =
          remainingBuyQuantity > 0
            ? calculatePotentialTax({
                acquisitionCost: remainingCostBasis,
                currentValue: currentValueForRow,
                taxProfile,
                usedVap: 0
              })
            : 0;
      }

      return row;
    });
  });
  protected readonly taxYearOptions = computed(() => {
    const currentYear = getCurrentYear();
    const years = new Set<number>(this.taxEventRows().map(({ taxYear }) => taxYear));

    for (let year = currentYear - 5; year <= currentYear + 5; year += 1) {
      years.add(year);
    }

    return [...years].sort((left, right) => left - right);
  });
  protected readonly selectedAccountLabel = computed(() => {
    if (this.selectedAccountId() === 'all') {
      return 'All accounts';
    }

    return this.accountLabelById().get(this.selectedAccountId()) || this.selectedAccountId();
  });

  protected toggleEntry(entry: TaxActivityRow): void {
    this.expandedEntrySet.update((set) => {
      const next = new Set(set);

      if (next.has(entry)) {
        next.delete(entry);
      } else {
        next.add(entry);
      }

      return next;
    });
  }

  protected isEntryExpanded(entry: TaxActivityRow): boolean {
    return this.expandedEntrySet().has(entry);
  }

  public ngOnInit(): void {
    void this.loadTaxEvents();

    if (!this.holdings().length && !this.activities().length && !this.isLoading()) {
      void this.portfolioDataStore.loadPortfolioData();
    }
  }

  protected async loadTaxEvents(): Promise<void> {
    this.isTaxEventsLoading.set(true);
    this.taxErrorMessage.set('');

    try {
      const taxEvents = await this.taxEventsService.loadTaxEvents();
      this.taxEvents.set(taxEvents);

      if (this.expandedYears().size === 0) {
        this.expandedYears.set(new Set());
      }
    } catch (error) {
      this.taxEvents.set([]);
      this.taxErrorMessage.set(this.getErrorMessage(error, 'Loading tax events failed.'));
    } finally {
      this.isTaxEventsLoading.set(false);
    }
  }

  protected updateSelectedAccountId(event: Event): void {
    this.selectedAccountId.set(readSelectValue(event));
  }

  protected openCreateDialog(): void {
    if (!this.canCreateTaxEvent()) {
      return;
    }

    this.dialogMode.set('create');
    this.dialogTaxEventId.set('');
    this.dialogAccountId.set(this.createAccountOptions()[0]?.id ?? '');
    this.dialogSymbolId.set(this.createSymbolOptions()[0]?.id ?? '');
    this.dialogTaxYear.set(this.taxYearOptions().find((year) => year === getCurrentYear()) ?? getCurrentYear());
    this.dialogQuantity.set(0);
    this.dialogVorabpauschalePerShare.set(0);
    this.dialogVorabpauschalePerShareAfterTeilfreistellung.set(0);
    this.dialogErrorMessage.set('');
    this.isDialogOpen.set(true);
  }

  protected openEditDialog(taxEvent: TaxEventRow): void {
    this.dialogMode.set('edit');
    this.dialogTaxEventId.set(taxEvent.id);
    this.dialogAccountId.set(taxEvent.accountId);
    this.dialogSymbolId.set(taxEvent.symbolId);
    this.dialogTaxYear.set(taxEvent.taxYear);
    this.dialogQuantity.set(taxEvent.quantity);
    this.dialogVorabpauschalePerShare.set(taxEvent.vorabpauschalePerShare);
    this.dialogVorabpauschalePerShareAfterTeilfreistellung.set(
      taxEvent.vorabpauschalePerShareAfterTeilfreistellung
    );
    this.dialogErrorMessage.set('');
    this.isDialogOpen.set(true);
  }

  protected closeDialog(): void {
    this.isDialogOpen.set(false);
    this.dialogErrorMessage.set('');
  }

  protected updateDialogAccountId(event: Event): void {
    this.dialogAccountId.set(readSelectValue(event));
  }

  protected updateDialogSymbolId(event: Event): void {
    this.dialogSymbolId.set(readSelectValue(event));
  }

  protected updateDialogTaxYear(event: Event): void {
    this.dialogTaxYear.set(readPositiveIntegerInput(event));
  }

  protected updateDialogQuantity(event: Event): void {
    this.dialogQuantity.set(readPositiveNumberInput(event));
  }

  protected updateDialogVorabpauschalePerShare(event: Event): void {
    this.dialogVorabpauschalePerShare.set(readNonNegativeNumberInput(event));
  }

  protected updateDialogVorabpauschalePerShareAfterTeilfreistellung(event: Event): void {
    this.dialogVorabpauschalePerShareAfterTeilfreistellung.set(readNonNegativeNumberInput(event));
  }

  protected async submitDialog(): Promise<void> {
    const taxEvent = this.readDialogTaxEvent();

    if (!taxEvent) {
      return;
    }

    this.dialogErrorMessage.set('');
    this.taxErrorMessage.set('');
    this.isSaving.set(true);

    try {
      const savedTaxEvent =
        this.dialogMode() === 'create'
          ? await this.taxEventsService.createTaxEvent(taxEvent)
          : await this.taxEventsService.updateTaxEvent(this.dialogTaxEventId(), taxEvent);

      this.taxEvents.update((taxEvents) => {
        const nextTaxEvents =
          this.dialogMode() === 'create'
            ? [...taxEvents, savedTaxEvent]
            : taxEvents.map((currentTaxEvent) =>
                currentTaxEvent.id === savedTaxEvent.id ? savedTaxEvent : currentTaxEvent
              );

        return nextTaxEvents.sort((left, right) => {
          if (left.taxYear !== right.taxYear) {
            return right.taxYear - left.taxYear;
          }

          const accountComparison = left.accountId.localeCompare(right.accountId, undefined, {
            numeric: true,
            sensitivity: 'base'
          });

          if (accountComparison !== 0) {
            return accountComparison;
          }

          return left.symbolId.localeCompare(right.symbolId, undefined, {
            numeric: true,
            sensitivity: 'base'
          });
        });
      });

      this.expandedYears.update((years) => {
        const nextYears = new Set(years);
        nextYears.add(savedTaxEvent.taxYear);
        return nextYears;
      });
      this.taxInfoMessage.set(
        this.dialogMode() === 'create'
          ? 'VAP entry was saved.'
          : 'VAP entry was updated.'
      );
      this.closeDialog();
    } catch (error) {
      this.taxErrorMessage.set(this.getErrorMessage(error, 'Saving the tax event failed.'));
    } finally {
      this.isSaving.set(false);
    }
  }

  protected async deleteTaxEvent(taxEvent: TaxEventRow): Promise<void> {
    const confirmed = window.confirm(
      `Delete tax event for ${taxEvent.symbolLabel} in ${taxEvent.taxYear}?`
    );

    if (!confirmed) {
      return;
    }

    this.taxErrorMessage.set('');
    this.taxInfoMessage.set('');

    try {
      await this.taxEventsService.deleteTaxEvent(taxEvent.id);
      this.taxEvents.update((taxEvents) => {
        return taxEvents.filter((currentTaxEvent) => currentTaxEvent.id !== taxEvent.id);
      });
      this.taxInfoMessage.set('VAP entry was deleted.');
    } catch (error) {
      this.taxErrorMessage.set(this.getErrorMessage(error, 'Deleting the tax event failed.'));
    }
  }

  protected setYearExpanded(taxYear: number, isOpen: boolean): void {
    this.expandedYears.update((years) => {
      const nextYears = new Set(years);

      if (isOpen) {
        nextYears.add(taxYear);
      } else {
        nextYears.delete(taxYear);
      }

      return nextYears;
    });
  }

  protected isYearExpanded(taxYear: number): boolean {
    return this.expandedYears().has(taxYear);
  }

  public ngOnDestroy(): void {
    if (this.taxProfileSaveTimeout !== null) {
      window.clearTimeout(this.taxProfileSaveTimeout);
      this.taxProfileSaveTimeout = null;
    }
  }

  protected updateTaxProfileCapitalGainsTaxRate(event: Event): void {
    this.updateTaxProfile({
      ...this.taxProfile(),
      capitalGainsTaxRate: readPercentInput(event)
    });
  }

  protected updateTaxProfileChurchTaxRate(event: Event): void {
    this.updateTaxProfile({
      ...this.taxProfile(),
      churchTaxRate: readPercentInput(event)
    });
  }

  protected updateTaxProfilePartialExemptionRate(event: Event): void {
    this.updateTaxProfile({
      ...this.taxProfile(),
      partialExemptionRate: readPercentInput(event)
    });
  }

  protected updateTaxProfileSolidaritySurchargeRate(event: Event): void {
    this.updateTaxProfile({
      ...this.taxProfile(),
      solidaritySurchargeRate: readPercentInput(event)
    });
  }

  protected accountLabel(accountId: string): string {
    return this.accountLabelById().get(accountId) || accountId;
  }

  protected symbolLabel(symbolId: string): string {
    return this.symbolLabelById().get(symbolId) || symbolId;
  }

  private updateTaxProfile(taxProfile: TaxProfile): void {
    this.taxProfile.set(taxProfile);

    if (!this.canEditTaxProfile()) {
      return;
    }

    this.scheduleTaxProfileSave();
  }

  private scheduleTaxProfileSave(): void {
    if (!this.authService) {
      return;
    }

    if (this.taxProfileSaveTimeout !== null) {
      window.clearTimeout(this.taxProfileSaveTimeout);
    }

    this.taxProfileSaveTimeout = window.setTimeout(() => {
      this.taxProfileSaveTimeout = null;
      void this.saveTaxProfile();
    }, 300);
  }

  private async saveTaxProfile(): Promise<void> {
    if (!this.authService || !this.canEditTaxProfile()) {
      return;
    }

    try {
      await this.authService.updateAccountTaxConfig(this.taxProfile());
      this.taxInfoMessage.set('Tax profile was saved.');
    } catch (error) {
      this.taxErrorMessage.set(this.getErrorMessage(error, 'Saving the tax profile failed.'));
    }
  }

  protected dialogTotalAmount(): number {
    return roundToTwo(this.dialogQuantity() * this.dialogVorabpauschalePerShare());
  }

  protected dialogTotalAmountAfterTeilfreistellung(): number {
    return roundToTwo(
      this.dialogQuantity() * this.dialogVorabpauschalePerShareAfterTeilfreistellung()
    );
  }

  protected currencySymbol(): string {
    return '€';
  }

  protected abs(value: number | null): number {
    return Math.abs(value ?? 0);
  }

  protected formatYearOption(year: number): string {
    return String(year);
  }

  protected isCreateDialogMode(): boolean {
    return this.dialogMode() === 'create';
  }

  private readDialogTaxEvent(): Omit<TaxEvent, 'id'> | null {
    if (this.dialogMode() === 'create') {
      if (!this.dialogAccountId() || !this.dialogSymbolId() || !this.dialogTaxYear()) {
        this.dialogErrorMessage.set('Please fill in the required tax event fields.');
        return null;
      }
    }

    if (this.dialogQuantity() <= 0) {
      this.dialogErrorMessage.set('The quantity must be greater than zero.');
      return null;
    }

    if (this.dialogVorabpauschalePerShare() < 0) {
      this.dialogErrorMessage.set('The tax amount per share must be zero or greater.');
      return null;
    }

    if (this.dialogVorabpauschalePerShareAfterTeilfreistellung() < 0) {
      this.dialogErrorMessage.set(
        'The tax amount per share after partial exemption must be zero or greater.'
      );
      return null;
    }

    return {
      accountId: this.dialogAccountId(),
      quantity: this.dialogQuantity(),
      symbolId: this.dialogSymbolId(),
      taxYear: this.dialogTaxYear(),
      vorabpauschalePerShare: this.dialogVorabpauschalePerShare(),
      vorabpauschalePerShareAfterTeilfreistellung:
        this.dialogVorabpauschalePerShareAfterTeilfreistellung()
    };
  }

  private getErrorMessage(error: unknown, fallbackMessage: string): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error?.message === 'string' && error.error.message.trim()) {
        return error.error.message;
      }

      if (error.status === 0) {
        return 'The application backend is not reachable.';
      }

      if (error.status === 401 || error.status === 403) {
        return 'Tax events could not be loaded because Ghostfolio is not available.';
      }

      return `${fallbackMessage} (status ${error.status}).`;
    }

    return fallbackMessage;
  }
}

function buildLabelMap(items: LabelOption[]): Map<string, string> {
  const labels = new Map<string, string>();

  for (const item of items) {
    const id = item.id.trim();

    if (!id) {
      continue;
    }

    const label = item.label.trim() || id;
    const currentLabel = labels.get(id);

    if (!currentLabel || currentLabel === id) {
      labels.set(id, label);
    }
  }

  return labels;
}

function sortLabelOptions(labelMap: Map<string, string>): LabelOption[] {
  return [...labelMap.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => {
      return left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    });
}

function getActivityTimestamp(date: Date | null): number {
  return date ? new Date(date).getTime() : 0;
}

function getCurrentYear(): number {
  return new Date().getFullYear();
}

function readSelectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function readPositiveIntegerInput(event: Event): number {
  const value = Math.round(readLocaleNumberValue(event));

  return Number.isFinite(value) && value > 0 ? value : getCurrentYear();
}

function readPositiveNumberInput(event: Event): number {
  const value = readLocaleNumberValue(event);

  return Number.isFinite(value) && value > 0 ? value : 0;
}

function readNonNegativeNumberInput(event: Event): number {
  const value = readLocaleNumberValue(event);

  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function readPercentInput(event: Event): number {
  return readNonNegativeNumberInput(event) / 100;
}

function readLocaleNumberValue(event: Event): number {
  const rawValue = (event.target as HTMLInputElement).value.trim();

  if (!rawValue) {
    return Number.NaN;
  }

  const normalizedValue = rawValue.includes(',')
    ? rawValue.replace(/\./g, '').replace(',', '.')
    : rawValue;

  return Number(normalizedValue);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
