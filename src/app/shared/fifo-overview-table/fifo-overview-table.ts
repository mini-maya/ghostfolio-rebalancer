import { CommonModule } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';

import { LocaleNumberPipe } from '../../app/pipes/locale-number.pipe';
import { EtfProviderLogo } from '../etf-provider-logo/etf-provider-logo';
import type {
  FifoOverviewActivityRow,
  FifoOverviewRow
} from './fifo-overview-table.models';

type SortColumn =
  | 'name'
  | 'entryPrice'
  | 'positionPrice'
  | 'gain'
  | 'realized'
  | 'openTax'
  | 'totalVap'
  | 'usedVap';
type SortDirection = 'asc' | 'desc';

const QUANTITY_EPSILON = 1e-6;

interface FifoOverviewActivityEntry {
  activity: FifoOverviewActivityRow;
  index: number;
}

interface FifoOverviewActivityMonthGroup {
  buyCount: number;
  buyTotal: number;
  entries: FifoOverviewActivityEntry[];
  key: string;
  label: string;
  sellCount: number;
  sellTotal: number;
}

interface FifoOverviewActivityYearGroup {
  buyCount: number;
  buyTotal: number;
  key: string;
  label: string;
  monthGroups: FifoOverviewActivityMonthGroup[];
  sellCount: number;
  sellTotal: number;
}

type FifoOverviewRowWithYearGroups = FifoOverviewRow & {
  yearGroups: FifoOverviewActivityYearGroup[];
};

@Component({
  selector: 'app-fifo-overview-table',
  imports: [CommonModule, EtfProviderLogo, LocaleNumberPipe],
  templateUrl: './fifo-overview-table.html',
  styleUrl: './fifo-overview-table.scss',
})
export class FifoOverviewTable {
  readonly rows = input.required<FifoOverviewRow[]>();
  readonly currencySymbol = input('€');
  readonly emptyStateMessage = input('No overview available.');
  readonly maxHeight = input<string | null>(null);
  protected readonly sortColumn = signal<SortColumn>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');
  private readonly rowsWithYearGroups = computed<FifoOverviewRowWithYearGroups[]>(() => {
    return this.rows().map((row) => ({
      ...row,
      yearGroups: buildFifoActivityYearGroups(row.activities),
    }));
  });
  protected readonly sortedRows = computed(() => {
    const directionFactor = this.sortDirection() === 'asc' ? 1 : -1;
    const activeSortColumn = this.sortColumn();

    return [...this.rowsWithYearGroups()].sort((left, right) => {
      const comparison = this.compareRows(left, right, activeSortColumn);

      if (comparison !== 0) {
        return comparison * directionFactor;
      }

      return left.symbol.localeCompare(right.symbol, undefined, {
        numeric: true,
        sensitivity: 'base',
      }) * directionFactor;
    });
  });
  private readonly expandedActivityKeys = signal(new Set<string>());
  private readonly expandedMonthGroupKeys = signal(new Set<string>());
  private readonly expandedYearGroupKeys = signal(new Set<string>());

  protected isSortColumn(column: SortColumn): boolean {
    return this.sortColumn() === column;
  }

  protected sortBy(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.sortColumn.set(column);
    this.sortDirection.set('asc');
  }

  protected sortIndicator(column: SortColumn): string {
    if (!this.isSortColumn(column)) {
      return '';
    }

    return this.sortDirection() === 'asc' ? '▲' : '▼';
  }

  protected toggleActivity(row: FifoOverviewRow, activityIndex: number): void {
    this.expandedActivityKeys.update((set) => {
      const next = new Set(set);
      const key = this.buildActivityKey(row, activityIndex);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  protected isActivityExpanded(row: FifoOverviewRow, activityIndex: number): boolean {
    return this.expandedActivityKeys().has(this.buildActivityKey(row, activityIndex));
  }

  protected toggleMonthGroup(groupId: string): void {
    this.expandedMonthGroupKeys.update((set) => {
      const next = new Set(set);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  }

  protected isMonthGroupExpanded(groupId: string): boolean {
    return this.expandedMonthGroupKeys().has(groupId);
  }

  protected toggleYearGroup(groupId: string): void {
    this.expandedYearGroupKeys.update((set) => {
      const next = new Set(set);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  }

  protected isYearGroupExpanded(groupId: string): boolean {
    return this.expandedYearGroupKeys().has(groupId);
  }

  protected hasActivities(row: FifoOverviewRow): boolean {
    return row.activities.length > 0;
  }

  protected hasSellDetails(activity: FifoOverviewActivityRow): boolean {
    return activity.type === 'BUY' && activity.sellDetails.length > 0;
  }

  protected isFullySoldBuy(activity: FifoOverviewActivityRow): boolean {
    return (
      activity.type === 'BUY' &&
      activity.soldQuantity !== null &&
      activity.soldQuantity >= activity.quantity - QUANTITY_EPSILON
    );
  }

  protected abs(value: number | null): number {
    return Math.abs(value ?? 0);
  }

  private buildActivityKey(row: FifoOverviewRow, activityIndex: number): string {
    return `${row.trackKey}:${activityIndex}`;
  }

  private compareRows(left: FifoOverviewRow, right: FifoOverviewRow, column: SortColumn): number {
    switch (column) {
      case 'name':
        return this.compareText(left.name, right.name);
      case 'entryPrice':
        return this.compareNumber(left.entryPriceAmount, right.entryPriceAmount);
      case 'positionPrice':
        return this.compareNumber(left.positionPriceAmount, right.positionPriceAmount);
      case 'gain':
        return this.compareNumber(left.gainPercentage, right.gainPercentage);
      case 'realized':
        return this.compareNumber(left.realizedPercentage, right.realizedPercentage);
      case 'openTax':
        return this.compareNumber(left.potentialTaxes, right.potentialTaxes) ||
          this.compareNumber(left.taxForSelling, right.taxForSelling);
      case 'totalVap':
        return this.compareNumber(left.totalVap, right.totalVap) ||
          this.compareNumber(left.totalTaxableVap, right.totalTaxableVap);
      case 'usedVap':
        return this.compareNumber(left.usedVapForSelling, right.usedVapForSelling) ||
          this.compareNumber(left.usedTaxableVapForSelling, right.usedTaxableVapForSelling);
      default:
        return 0;
    }
  }

  private compareNumber(left: number, right: number): number {
    return left - right;
  }

  private compareText(left: string, right: string): number {
    return left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
});

function getFifoActivityTimestamp(date: Date | null): number {
  if (!date) {
    return Number.POSITIVE_INFINITY;
  }

  return date.getTime();
}

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function formatMonthLabel(date: Date | null): string {
  if (!date) {
    return 'No date';
  }

  return MONTH_LABEL_FORMATTER.format(date);
}

function buildFifoActivityYearGroups(
  activities: FifoOverviewActivityRow[],
): FifoOverviewActivityYearGroup[] {
  const entriesByYear = new Map<string, FifoOverviewActivityEntry[]>();
  const unknownEntries: FifoOverviewActivityEntry[] = [];

  activities.forEach((activity, index) => {
    if (!activity.date) {
      unknownEntries.push({ activity, index });
      return;
    }

    const year = String(activity.date.getFullYear());
    const yearEntries = entriesByYear.get(year) ?? [];

    yearEntries.push({ activity, index });
    entriesByYear.set(year, yearEntries);
  });

  const groups = [...entriesByYear.entries()]
    .map(([year, yearEntries]) => {
      return buildFifoYearGroup({
        entries: yearEntries,
        key: year,
        label: year,
      });
    })
    .sort((left, right) => right.key.localeCompare(left.key));

  if (unknownEntries.length) {
    groups.push(
      buildFifoYearGroup({
        entries: unknownEntries,
        key: 'unknown',
        label: 'No date',
      }),
    );
  }

  return groups;
}

function buildFifoYearGroup({
  entries,
  key,
  label,
}: {
  entries: FifoOverviewActivityEntry[];
  key: string;
  label: string;
}): FifoOverviewActivityYearGroup {
  let buyCount = 0;
  let buyTotal = 0;
  let sellCount = 0;
  let sellTotal = 0;

  for (const entry of entries) {
    if (entry.activity.type === 'BUY') {
      buyCount++;
      buyTotal += entry.activity.totalValue;
    } else if (entry.activity.type === 'SELL') {
      sellCount++;
      sellTotal += entry.activity.totalValue;
    }
  }

  return {
    buyCount,
    buyTotal,
    key,
    label,
    monthGroups: buildFifoActivityMonthGroups(entries),
    sellCount,
    sellTotal,
  };
}

function buildFifoActivityMonthGroups(
  entries: FifoOverviewActivityEntry[],
): FifoOverviewActivityMonthGroup[] {
  const entriesByKey = new Map<string, FifoOverviewActivityEntry[]>();
  const unknownEntries: FifoOverviewActivityEntry[] = [];

  for (const entry of entries) {
    if (!entry.activity.date) {
      unknownEntries.push(entry);
      continue;
    }

    const key = getMonthKey(entry.activity.date.getFullYear(), entry.activity.date.getMonth());
    const groupEntries = entriesByKey.get(key) ?? [];

    groupEntries.push(entry);
    entriesByKey.set(key, groupEntries);
  }

  const groups = [...entriesByKey.entries()]
    .map(([key, groupEntries]) => {
      const sortedEntries = [...groupEntries].sort((left, right) => {
        return getFifoActivityTimestamp(right.activity.date) - getFifoActivityTimestamp(left.activity.date);
      });

      return buildFifoMonthGroup({
        entries: sortedEntries,
        key,
        label: formatMonthLabel(sortedEntries[0].activity.date),
      });
    })
    .sort((left, right) => right.key.localeCompare(left.key));

  if (unknownEntries.length) {
    groups.push(
      buildFifoMonthGroup({
        entries: unknownEntries,
        key: 'unknown',
        label: 'No date',
      }),
    );
  }

  return groups;
}

function buildFifoMonthGroup({
  entries,
  key,
  label,
}: {
  entries: FifoOverviewActivityEntry[];
  key: string;
  label: string;
}): FifoOverviewActivityMonthGroup {
  let buyCount = 0;
  let buyTotal = 0;
  let sellCount = 0;
  let sellTotal = 0;

  for (const entry of entries) {
    if (entry.activity.type === 'BUY') {
      buyCount++;
      buyTotal += entry.activity.totalValue;
    } else if (entry.activity.type === 'SELL') {
      sellCount++;
      sellTotal += entry.activity.totalValue;
    }
  }

  return {
    buyCount,
    buyTotal,
    entries,
    key,
    label,
    sellCount,
    sellTotal,
  };
}
