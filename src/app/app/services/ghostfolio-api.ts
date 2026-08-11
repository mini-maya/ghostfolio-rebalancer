import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, from, map } from 'rxjs';

interface HoldingsResponse {
  holdings: RemoteHolding[];
}

interface ActivitiesResponse {
  activities?: RemoteActivity[];
  count?: number;
}

interface DirectLoginUrlResponse {
  url: string;
}

interface PortfolioPerformanceEntry {
  date?: string;
  netPerformanceInPercentageWithCurrencyEffect?: number;
  totalInvestmentValueWithCurrencyEffect?: number;
  value?: number;
  valueInPercentage?: number;
  valueWithCurrencyEffect?: number;
}

interface PortfolioPerformanceSummary {
  currentValueInBaseCurrency?: number;
  netPerformance?: number;
  netPerformanceInPercentage?: number;
  netPerformanceInPercentageWithCurrencyEffect?: number;
  netPerformancePercentage?: number;
  netPerformancePercentageWithCurrencyEffect?: number;
  netPerformanceWithCurrencyEffect?: number;
  totalInvestmentValueWithCurrencyEffect?: number;
}

interface PortfolioPerformanceResponse {
  chart?: PortfolioPerformanceEntry[];
  performance?: PortfolioPerformanceSummary;
}

export interface PortfolioPerformanceChartItem {
  date: string;
  investment: number;
  value: number;
}

interface RemoteHolding {
  allocationInPercentage?: number;
  assetProfile?: {
    currency?: string;
    name?: string;
    symbol?: string;
  };
  marketPrice?: number;
  quantity?: number;
  valueInBaseCurrency?: number;
}

interface RemoteActivity extends Record<string, unknown> {
  assetProfile?: {
    assetClass?: string;
    assetSubClass?: string;
    name?: string;
    symbol?: string;
  };
  currency?: string;
  createdAt?: string;
  date?: string;
  fee?: number;
  id?: string;
  quantity?: number;
  symbol?: string;
  type?: string;
  unitPrice?: number;
  unitPriceInAssetProfileCurrency?: number;
  valueInBaseCurrency?: number;
}

export interface Holding {
  allocationInPercentage: number;
  currency: string;
  marketPrice: number;
  name: string;
  quantity: number;
  symbol: string;
  valueInBaseCurrency: number;
}

export interface Activity {
  assetClass: string;
  assetSubClass: string;
  currency: string;
  date: Date | null;
  fee: number;
  name: string;
  quantity: number;
  symbol: string;
  type: string;
  unitPrice: number;
  unitPriceInAssetProfileCurrency: number;
  valueInBaseCurrency: number;
}

@Injectable({
  providedIn: 'root'
})
export class GhostfolioApi {
  private readonly http = inject(HttpClient);

  public fetchHoldings() {
    return this.http
      .get<HoldingsResponse>('/api/ghostfolio/holdings')
      .pipe(
        map(({ holdings }) => {
          return (holdings ?? [])
            .map((holding) => {
              return {
                allocationInPercentage: holding.allocationInPercentage ?? 0,
                currency: holding.assetProfile?.currency ?? '???',
                marketPrice:
                  holding.marketPrice ??
                  getFallbackMarketPrice({
                    quantity: holding.quantity,
                    valueInBaseCurrency: holding.valueInBaseCurrency
                  }),
                name:
                  holding.assetProfile?.name ??
                  holding.assetProfile?.symbol ??
                  'Unknown',
                quantity: holding.quantity ?? 0,
                symbol: holding.assetProfile?.symbol ?? '',
                valueInBaseCurrency: holding.valueInBaseCurrency ?? 0
              };
            })
            .filter(({ symbol }) => Boolean(symbol))
            .sort((a, b) => a.symbol.localeCompare(b.symbol));
        })
      );
  }

  public fetchActivities() {
    return from(this.fetchAllActivities()).pipe(
      map((activities): Activity[] => {
        return activities.map((activity) => {
          const type = getStringValue(activity.type);
          const symbol =
            getStringValue(activity.symbol) ||
            getStringValue(activity.assetProfile?.symbol);
          const assetClass = getStringValue(activity.assetProfile?.assetClass) || 'UNKNOWN';
          const assetSubClass = getStringValue(activity.assetProfile?.assetSubClass) || 'UNKNOWN';
          const name = getStringValue(activity.assetProfile?.name) || symbol;

          return {
            assetClass,
            assetSubClass,
            currency: getStringValue(activity.currency),
            date: parseDate(activity.date),
            fee: getNumberValue(activity.fee),
            name,
            quantity: getNumberValue(activity.quantity),
            symbol,
            type,
            unitPrice: getNumberValue(activity.unitPrice),
            unitPriceInAssetProfileCurrency: getNumberValue(activity.unitPriceInAssetProfileCurrency),
            valueInBaseCurrency: getNumberValue(activity.valueInBaseCurrency)
          };
        });
      })
    );
  }

  public fetchPortfolioPerformance() {
    return this.http.get<PortfolioPerformanceResponse>('/api/ghostfolio/performance').pipe(
      map(({ chart }) => {
        return (chart ?? [])
          .map((entry): PortfolioPerformanceChartItem => {
            return {
              date: entry.date ?? '',
              investment: getNumberValue(entry.totalInvestmentValueWithCurrencyEffect),
              value: getNumberValue(entry.valueWithCurrencyEffect ?? entry.value)
            };
          })
          .filter(({ date }) => Boolean(date));
      })
    );
  }

  public getDirectLoginUrl(language: string) {
    return this.http
      .get<DirectLoginUrlResponse>('/api/ghostfolio/direct-login-url', {
        params: new HttpParams().set('language', language)
      })
      .pipe(
        map(({ url }) => {
          if (!url) {
            throw new Error('The direct Ghostfolio login URL is missing.');
          }

          return url;
        })
      );
  }

  private async fetchAllActivities(): Promise<RemoteActivity[]> {
    const { activities } = await firstValueFrom(
      this.http.get<ActivitiesResponse>('/api/ghostfolio/activities')
    );

    return activities ?? [];
  }
}

function getFallbackMarketPrice({
  quantity,
  valueInBaseCurrency
}: {
  quantity?: number;
  valueInBaseCurrency?: number;
}): number {
  if (
    typeof quantity === 'number' &&
    quantity !== 0 &&
    typeof valueInBaseCurrency === 'number'
  ) {
    return valueInBaseCurrency / quantity;
  }

  return 0;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsedValue = new Date(value);

  if (Number.isNaN(parsedValue.getTime())) {
    return null;
  }

  return parsedValue;
}

function getNumberValue(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return value;
}

function getStringValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value;
}
