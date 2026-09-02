import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { LocaleNumberPipe } from '../pipes/locale-number.pipe';
import { PortfolioDataStore } from '../services/portfolio-data.store';
import { FifoOverviewTable } from '../../shared/fifo-overview-table/fifo-overview-table';
import {
  calculatePotentialTax,
  calculateTaxForSale,
  calculateTotalVap,
  calculateTotalVapAfterTeilfreistellung,
  DEFAULT_TAX_PROFILE,
  resolveTaxProfile,
  type TaxProfile
} from '../services/tax-calculator';
import {
  calculateAnnualTaxSummaries,
  calculateTaxOverview,
  type AnnualTaxSummary,
  type TaxActivityRow,
  type TaxOverviewRow
} from '../services/tax-engine';
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

type DialogMode = 'create' | 'edit';

@Component({
  selector: 'app-tax-page',
  imports: [CommonModule, LocaleNumberPipe, FifoOverviewTable],
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

    this.taxProfile.set(resolveTaxProfile(savedTaxProfile));
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
    const totalVap = overviewRows.reduce((sum, row) => sum + row.totalVap, 0);
    const totalVapAfterTeilfreistellung = overviewRows.reduce(
      (sum, row) => sum + row.totalVapAfterTeilfreistellung,
      0
    );
    const totalTaxableVap = totalVapAfterTeilfreistellung;
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
    const usedTaxableVapForSelling = overviewRows.reduce((sum, row) => sum + row.usedTaxableVapForSelling, 0);
    const taxForSelling = calculateTaxForSale({
      acquisitionCost: portfolioCostBasis,
      saleProceeds: realizedSaleProceeds,
      taxProfile,
      usedVap: usedVapForSelling
    });

    return {
      potentialTaxes,
      taxForSelling,
      totalTaxableVap,
      usedTaxableVapForSelling,
      usedVapForSelling,
      totalVap,
      totalVapAfterTeilfreistellung
    };
  });
  protected readonly taxOverviewRows = computed<TaxOverviewRow[]>(() => {
    return calculateTaxOverview({
      activities: this.activities(),
      holdings: this.holdings(),
      taxEvents: this.taxEvents(),
      taxProfile: this.taxProfile(),
      asOfDate: new Date()
    });
  });
  protected readonly annualTaxSummaries = computed<AnnualTaxSummary[]>(() => {
    const activities = this.activities().filter((activity) => {
      return this.selectedAccountId() === 'all' || activity.accountId === this.selectedAccountId();
    });
    const taxEvents = this.taxEvents().filter((taxEvent) => {
      return this.selectedAccountId() === 'all' || taxEvent.accountId === this.selectedAccountId();
    });

    return [...calculateAnnualTaxSummaries({
      activities,
      holdings: this.holdings(),
      taxEvents,
      taxProfile: this.taxProfile(),
      asOfDate: new Date()
    })].sort((left, right) => right.year - left.year);
  });
  // Maps each year group's raw accrual `taxYear` to its matching AnnualTaxSummary, which is
  // keyed by the tax-relevant "due year" (accrual year + 1) - see AnnualTaxSummary.year.
  protected readonly annualTaxSummaryByTaxYear = computed<Map<number, AnnualTaxSummary>>(() => {
    const map = new Map<number, AnnualTaxSummary>();

    for (const summary of this.annualTaxSummaries()) {
      map.set(summary.year - 1, summary);
    }

    return map;
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

  protected updateTaxProfileSparerPauschbetrag(event: Event): void {
    this.updateTaxProfile({
      ...this.taxProfile(),
      sparerPauschbetrag: readNonNegativeNumberInput(event)
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
