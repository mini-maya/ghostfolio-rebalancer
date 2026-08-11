export interface InvestmentItem {
  date: string;
  investment: number;
}

export interface LineChartItem<T = number> {
  date: string;
  value: T;
}
