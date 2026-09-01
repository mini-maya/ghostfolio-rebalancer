import { CommonModule } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';

import { LocaleNumberPipe } from '../../app/pipes/locale-number.pipe';
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

@Component({
  selector: 'app-fifo-overview-table',
  imports: [CommonModule, LocaleNumberPipe],
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
  protected readonly sortedRows = computed(() => {
    const directionFactor = this.sortDirection() === 'asc' ? 1 : -1;
    const activeSortColumn = this.sortColumn();

    return [...this.rows()].sort((left, right) => {
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

  protected hasActivities(row: FifoOverviewRow): boolean {
    return row.activities.length > 0;
  }

  protected hasSellDetails(activity: FifoOverviewActivityRow): boolean {
    return activity.type === 'BUY' && activity.sellDetails.length > 0;
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
