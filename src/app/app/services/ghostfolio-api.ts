import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map } from 'rxjs';

interface AnonymousLoginResponse {
  authToken: string;
}

interface HoldingsResponse {
  holdings: RemoteHolding[];
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

export interface Holding {
  allocationInPercentage: number;
  marketPrice: number;
  name: string;
  quantity: number;
  symbol: string;
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
        map(({ authToken }) => {
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
        map(({ holdings }) => {
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
            .filter(({ symbol }) => Boolean(symbol))
            .sort((a, b) => a.symbol.localeCompare(b.symbol));
        })
      );
  }

  private buildApiUrl(baseUrl: string, path: string): string {
    return new URL(path, `${baseUrl}/`).toString();
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
