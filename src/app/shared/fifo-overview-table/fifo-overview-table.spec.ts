import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FifoOverviewTable } from './fifo-overview-table';
import type { FifoOverviewRow } from './fifo-overview-table.models';

describe('FifoOverviewTable', () => {
  let component: FifoOverviewTable;
  let fixture: ComponentFixture<FifoOverviewTable>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FifoOverviewTable]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FifoOverviewTable);
    component = fixture.componentInstance;
  });

  it('renders the empty state when no rows are provided', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('No overview available.');
  });

  it('renders expandable detail rows when activities are present', () => {
    fixture.componentRef.setInput('rows', [
      {
        activities: [
          {
            date: new Date('2024-01-01T00:00:00.000Z'),
            gainAmount: 10,
            gainPercentage: 10,
            potentialTaxes: 2,
            quantity: 5,
            sellDetails: [
              {
                date: new Date('2024-02-01T00:00:00.000Z'),
                realizedAmount: 4,
                realizedPercentage: 20,
                soldQuantity: 1,
                taxForSelling: 1,
                totalValue: 24,
                unitPrice: 24,
                usedSparerPauschbetragForSelling: 0,
                usedTaxableVapForSelling: 0.7,
                usedVapForSelling: 1
              }
            ],
            soldQuantity: 1,
            totalTaxableVap: 0.7,
            totalVap: 1,
            totalValue: 100,
            type: 'BUY',
            unitPrice: 20
          }
        ],
        currency: 'EUR',
        entryPriceAmount: 100,
        entryPricePerUnit: 20,
        gainAmount: 10,
        gainPercentage: 10,
        name: 'ETF A',
        positionPriceAmount: 110,
        positionPricePerUnit: 22,
        positionQuantity: 5,
        potentialTaxes: 2,
        realizedAmount: 4,
        realizedPercentage: 20,
        symbol: 'AAA',
        taxForSelling: 1,
        totalTaxableVap: 0.7,
        totalVap: 1,
        trackKey: 'AAA',
        usedSparerPauschbetragForSelling: 0,
        usedTaxableVapForSelling: 0.7,
        usedVapForSelling: 1
      }
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.activity-details').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('ETF A');
  });

  it('expands sell details when clicking a BUY activity row', () => {
    fixture.componentRef.setInput('rows', [
      {
        activities: [
          {
            date: new Date('2024-01-01T00:00:00.000Z'),
            gainAmount: 10,
            gainPercentage: 10,
            potentialTaxes: 2,
            quantity: 5,
            sellDetails: [
              {
                date: new Date('2024-02-01T00:00:00.000Z'),
                realizedAmount: 4,
                realizedPercentage: 20,
                soldQuantity: 1,
                taxForSelling: 1,
                totalValue: 24,
                unitPrice: 24,
                usedSparerPauschbetragForSelling: 0,
                usedTaxableVapForSelling: 0.7,
                usedVapForSelling: 1
              }
            ],
            soldQuantity: 1,
            totalTaxableVap: 0.7,
            totalVap: 1,
            totalValue: 100,
            type: 'BUY',
            unitPrice: 20
          }
        ],
        currency: 'EUR',
        entryPriceAmount: 100,
        entryPricePerUnit: 20,
        gainAmount: 10,
        gainPercentage: 10,
        name: 'ETF A',
        positionPriceAmount: 110,
        positionPricePerUnit: 22,
        positionQuantity: 5,
        potentialTaxes: 2,
        realizedAmount: 4,
        realizedPercentage: 20,
        symbol: 'AAA',
        taxForSelling: 1,
        totalTaxableVap: 0.7,
        totalVap: 1,
        trackKey: 'AAA',
        usedSparerPauschbetragForSelling: 0,
        usedTaxableVapForSelling: 0.7,
        usedVapForSelling: 1
      }
    ]);
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    const buyRow = fixture.nativeElement.querySelector('tbody tr.buy-row-expandable') as HTMLTableRowElement;
    buyRow.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sell-details-row')).not.toBeNull();
  });

  it('sorts rows by name ascending by default', () => {
    fixture.componentRef.setInput('rows', [
      createRow({ name: 'Zulu ETF', symbol: 'ZZZ', trackKey: 'ZZZ' }),
      createRow({ name: 'Alpha ETF', symbol: 'AAA', trackKey: 'AAA' })
    ]);
    fixture.detectChanges();

    expect(extractRenderedNames(fixture.nativeElement)).toEqual([
      'Alpha ETF',
      'Zulu ETF'
    ]);
  });

  it('toggles sort direction when clicking the same header', () => {
    fixture.componentRef.setInput('rows', [
      createRow({ name: 'Zulu ETF', symbol: 'ZZZ', trackKey: 'ZZZ' }),
      createRow({ name: 'Alpha ETF', symbol: 'AAA', trackKey: 'AAA' })
    ]);
    fixture.detectChanges();

    const nameButton = findSortButton(fixture.nativeElement, 'Name');
    nameButton.click();
    fixture.detectChanges();

    expect(extractRenderedNames(fixture.nativeElement)).toEqual([
      'Zulu ETF',
      'Alpha ETF'
    ]);
  });

  it('sorts by gain when the gain header is clicked', () => {
    fixture.componentRef.setInput('rows', [
      createRow({ name: 'Positive ETF', symbol: 'POS', trackKey: 'POS', gainPercentage: 8 }),
      createRow({ name: 'Negative ETF', symbol: 'NEG', trackKey: 'NEG', gainPercentage: -3 })
    ]);
    fixture.detectChanges();

    const gainButton = findSortButton(fixture.nativeElement, 'Gain');
    gainButton.click();
    fixture.detectChanges();

    expect(extractRenderedNames(fixture.nativeElement)).toEqual([
      'Negative ETF',
      'Positive ETF'
    ]);
  });
});

function extractRenderedNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.metrics-name-cell > span')).map((nameCell) => {
    return nameCell.textContent?.trim() ?? '';
  });
}

function findSortButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button.sort-button')).find((candidate) => {
    return candidate.textContent?.includes(label);
  });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Sort button not found: ${label}`);
  }

  return button;
}

function createRow(overrides: Partial<FifoOverviewRow> = {}): FifoOverviewRow {
  return buildBaseRow({
    ...overrides
  });
}

function buildBaseRow(overrides: Partial<FifoOverviewRow> = {}): FifoOverviewRow {
  return {
    activities: overrides.activities ?? [],
    currency: overrides.currency ?? 'EUR',
    entryPriceAmount: overrides.entryPriceAmount ?? 100,
    entryPricePerUnit: overrides.entryPricePerUnit ?? 20,
    gainAmount: overrides.gainAmount ?? 10,
    gainPercentage: overrides.gainPercentage ?? 10,
    name: overrides.name ?? 'ETF A',
    positionPriceAmount: overrides.positionPriceAmount ?? 110,
    positionPricePerUnit: overrides.positionPricePerUnit ?? 22,
    positionQuantity: overrides.positionQuantity ?? 5,
    potentialTaxes: overrides.potentialTaxes ?? 2,
    realizedAmount: overrides.realizedAmount ?? 4,
    realizedPercentage: overrides.realizedPercentage ?? 20,
    symbol: overrides.symbol ?? 'AAA',
    taxForSelling: overrides.taxForSelling ?? 1,
    totalTaxableVap: overrides.totalTaxableVap ?? 0.7,
    totalVap: overrides.totalVap ?? 1,
    trackKey: overrides.trackKey ?? 'AAA',
    usedSparerPauschbetragForSelling: overrides.usedSparerPauschbetragForSelling ?? 0,
    usedTaxableVapForSelling: overrides.usedTaxableVapForSelling ?? 0.7,
    usedVapForSelling: overrides.usedVapForSelling ?? 1
  };
}
