# Investment Chart

This component is based on the Investment Chart component
from Ghostfolio.

Original project:
https://github.com/ghostfolio/ghostfolio

Original component:
apps/client/src/app/components/investment-chart/

Copyright © 2021–2026 Ghostfolio contributors

Licensed under the GNU Affero General Public License v3.0.

Modified by mini-maya for ghostfolio-rebalancer.

This folder contains a standalone Angular component for an investment chart that can be copied into another Angular project.

## What is included?

- `src/investment-chart.component.ts` – standalone Angular component
- `src/investment-chart.component.html` – chart canvas and loading skeleton
- `src/investment-chart.component.scss` – layout styling
- `src/investment-chart.helpers.ts` – chart helpers and tooltip setup
- `src/investment-chart.interfaces.ts` – lightweight input models
- `src/investment-chart.types.ts` – `ColorScheme` and `GroupBy` types

## Installation

Install the required peer dependencies:

```bash
npm install chart.js chartjs-adapter-date-fns chartjs-plugin-annotation date-fns ngx-skeleton-loader
```

If you are using Angular 21, the component can be imported directly as a standalone component.

## Usage

```ts
import { Component } from '@angular/core';
import { GfInvestmentChartComponent } from './investment-chart/public-api';

@Component({
  selector: 'app-demo',
  standalone: true,
  imports: [GfInvestmentChartComponent],
  template: `
    <gf-investment-chart
      [benchmarkDataItems]="benchmarkDataItems"
      [benchmarkDataLabel]="'Benchmark'"
      [colorScheme]="'LIGHT'"
      [currency]="'USD'"
      [historicalDataItems]="historicalDataItems"
      [locale]="'en-US'"
    />
  `
})
export class DemoComponent {
  public benchmarkDataItems = [
    { date: '2024-01-01', investment: 1000 },
    { date: '2024-02-01', investment: 1200 }
  ];

  public historicalDataItems = [
    { date: '2024-01-01', value: 1000 },
    { date: '2024-02-01', value: 1250 }
  ];
}
```

## Inputs

- `benchmarkDataItems`: investment benchmark data series
- `benchmarkDataLabel`: label for the benchmark dataset
- `colorScheme`: `'LIGHT' | 'DARK'`
- `currency`: display currency for the tooltip
- `groupBy`: `'month' | 'year'` to switch between grouped chart types
- `historicalDataItems`: historical portfolio values
- `isInPercentage`: render values as percentages
- `isLoading`: show a skeleton instead of the chart
- `locale`: locale for formatting
- `savingsRate`: optional savings rate annotation

## Notes

The chart uses the same visual behavior as the Ghostfolio component, but the helper logic is bundled locally so it can be used outside the Ghostfolio repository without additional internal packages.
