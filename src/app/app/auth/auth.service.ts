import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { GhostfolioApi } from '../services/ghostfolio-api';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly ghostfolioApi = inject(GhostfolioApi);

  private readonly _baseUrl = signal('');
  private readonly _accessToken = signal('');
  private readonly _isAuthenticated = signal(false);

  public readonly baseUrl = this._baseUrl.asReadonly();
  public readonly accessToken = this._accessToken.asReadonly();
  public readonly isAuthenticated = this._isAuthenticated.asReadonly();

  public async login(baseUrl: string, accessToken: string): Promise<void> {
    const normalizedBaseUrl = this.ghostfolioApi.normalizeBaseUrl(baseUrl);
    await firstValueFrom(this.ghostfolioApi.authenticate(normalizedBaseUrl, accessToken));

    this._baseUrl.set(normalizedBaseUrl);
    this._accessToken.set(accessToken);
    this._isAuthenticated.set(true);
  }

  public logout(): void {
    this._baseUrl.set('');
    this._accessToken.set('');
    this._isAuthenticated.set(false);
  }
}
