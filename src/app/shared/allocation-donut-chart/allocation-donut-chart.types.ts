import type { ColorScheme } from '../investment-chart/src/investment-chart.types';

export type { ColorScheme };

export interface AllocationChartItem {
  currency: string;
  name: string;
  percentage: number;
  symbol: string;
  value: number;
}
