export interface FifoOverviewSellDetailRow {
  date: Date | null;
  realizedAmount: number;
  realizedPercentage: number;
  soldQuantity: number;
  taxForSelling: number;
  totalValue: number;
  unitPrice: number;
  usedTaxableVapForSelling: number;
  usedVapForSelling: number;
}

export interface FifoOverviewActivityRow {
  date: Date | null;
  gainAmount: number | null;
  gainPercentage: number | null;
  potentialTaxes: number;
  quantity: number;
  sellDetails: FifoOverviewSellDetailRow[];
  soldQuantity: number | null;
  totalTaxableVap: number;
  totalVap: number;
  totalValue: number;
  type: string;
  unitPrice: number;
}

export interface FifoOverviewRow {
  activities: FifoOverviewActivityRow[];
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
  realizedAmount: number;
  realizedPercentage: number;
  symbol: string;
  taxForSelling: number;
  totalTaxableVap: number;
  totalVap: number;
  trackKey: string;
  usedTaxableVapForSelling: number;
  usedVapForSelling: number;
}
