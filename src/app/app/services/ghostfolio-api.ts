import {HttpClient, HttpHeaders, HttpParams} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import {firstValueFrom, from, map} from 'rxjs';

interface AnonymousLoginResponse {
  authToken: string;
}

interface HoldingsResponse {
  holdings: RemoteHolding[];
}

interface ActivitiesResponse {
  activities?: RemoteActivity[];
  count?: number;
}

interface RemoteHolding {
  allocationInPercentage?: number;
  assetProfile?: {
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

  public normalizeBaseUrl(baseUrl: string): string {
    const normalizedUrl = new URL(baseUrl);

    return normalizedUrl.toString().replace(/\/$/, '');
  }

  public authenticate(baseUrl: string, accessToken: string) {
    return this.http
      .post<AnonymousLoginResponse>(this.buildApiUrl(baseUrl, 'api/v1/auth/anonymous'), {
        accessToken
      })
      .pipe(
        map(({authToken}) => {
          if (!authToken) {
            throw new Error('Authentication did not return a bearer token.');
          }

          return authToken;
        })
      );
  }

  public fetchHoldings(baseUrl: string, bearerToken: string) {
    return this.http
      .get<HoldingsResponse>(
        this.buildApiUrl(baseUrl, 'api/v1/portfolio/holdings'),
        {
          headers: new HttpHeaders({
            Authorization: `Bearer ${bearerToken}`
          })
        }
      )
      .pipe(
        map(({holdings}) => {
          return (holdings ?? [])
            .map((holding) => {
              return {
                allocationInPercentage: holding.allocationInPercentage ?? 0,
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
            .filter(({symbol}) => Boolean(symbol))
            .sort((a, b) => a.symbol.localeCompare(b.symbol));
        })
      );
  }

  public fetchActivities(baseUrl: string, bearerToken: string) {
    return from(this.fetchAllActivities(baseUrl, bearerToken)).pipe(
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

  private buildApiUrl(baseUrl: string, path: string): string {
    return new URL(path, `${baseUrl}/`).toString();
  }

  private async fetchAllActivities(
    baseUrl: string,
    bearerToken: string
  ): Promise<RemoteActivity[]> {
    const take = 500;
    const allActivities: RemoteActivity[] = [];
    let count = 0;
    let skip = 0;

    do {
      const {activities, count: totalCount} = await firstValueFrom(
        this.http.get<ActivitiesResponse>(
          this.buildApiUrl(baseUrl, 'api/v1/activities'),
          {
            headers: new HttpHeaders({
              Authorization: `Bearer ${bearerToken}`
            }),
            params: this.buildActivitiesQueryParams({skip, take})
          }
        )
      );

      const pageActivities = activities ?? [];

      allActivities.push(...pageActivities);
      count = totalCount ?? 0;
      skip += pageActivities.length;

      if (pageActivities.length === 0) {
        break;
      }
    } while (allActivities.length < count);

    return allActivities;
  }

  private buildActivitiesQueryParams({
                                       skip,
                                       take
  }: {
    skip?: number;
    take?: number;
  }): HttpParams {
    let params = new HttpParams();

    if (typeof skip === 'number') {
      params = params.append('skip', skip);
    }

    if (typeof take === 'number') {
      params = params.append('take', take);
    }

    return params;
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
