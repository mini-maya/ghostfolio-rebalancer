import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface SessionResponse {
  allocationsText: string;
  authMode: string;
  authenticated: boolean;
  baseUrl: string;
  loginSource: string;
  user: string;
}

interface PreparedAccountResponse {
  baseUrl: string;
  message: string;
}

interface AllocationsTextResponse {
  allocationsText: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _baseUrl = signal('');
  private readonly _allocationsText = signal('');
  private readonly _isAuthenticated = signal(false);
  private readonly _loginSource = signal('');
  private readonly _sessionMode = signal('');
  private readonly _user = signal('');
  private initializePromise?: Promise<void>;
  private isInitialized = false;

  public readonly baseUrl = this._baseUrl.asReadonly();
  public readonly allocationsText = this._allocationsText.asReadonly();
  public readonly isAuthenticated = this._isAuthenticated.asReadonly();
  public readonly loginSource = this._loginSource.asReadonly();
  public readonly sessionMode = this._sessionMode.asReadonly();
  public readonly user = this._user.asReadonly();

  public async initialize(force = false): Promise<void> {
    if (this.isInitialized && !force) {
      return;
    }

    if (this.initializePromise && !force) {
      return this.initializePromise;
    }

    this.initializePromise = firstValueFrom(this.http.get<SessionResponse>('/api/session'))
      .then((session) => {
        this.applySession(session);
        this.isInitialized = true;
      })
      .finally(() => {
        this.initializePromise = undefined;
      });

    return this.initializePromise;
  }

  public async loginWithAccessToken(
    baseUrl: string,
    accessToken: string,
    source: 'env-default' | 'manual' = 'manual'
  ): Promise<void> {
    const session = await firstValueFrom(
      this.http.post<SessionResponse>('/api/auth/access-token-login', {
        accessToken,
        baseUrl,
        source
      })
    );

    this.applySession(session);
  }

  public async loginWithUserPassword(user: string, password: string): Promise<void> {
    const session = await firstValueFrom(
      this.http.post<SessionResponse>('/api/auth/user-login', {
        password,
        user
      })
    );

    this.applySession(session);
  }

  public async logout(): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/auth/logout', {}, { responseType: 'text' })
    );

    this.resetSession();
  }

  public async prepareAccountCreation(
    baseUrl: string,
    accessToken: string,
    user: string,
    password: string
  ): Promise<PreparedAccountResponse> {
    return firstValueFrom(
      this.http.post<PreparedAccountResponse>('/api/auth/prepare-account', {
        accessToken,
        baseUrl,
        password,
        user
      })
    );
  }

  public async registerAccount({
    accessToken,
    baseUrl,
    password,
    passwordConfirmation,
    user
  }: {
    accessToken: string;
    baseUrl: string;
    password: string;
    passwordConfirmation: string;
    user: string;
  }): Promise<void> {
    const session = await firstValueFrom(
      this.http.post<SessionResponse>('/api/auth/register', {
        accessToken,
        baseUrl,
        password,
        passwordConfirmation,
        user
      })
    );

    this.applySession(session);
  }

  public async updateAccountAllocationsText(allocationsText: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.put<AllocationsTextResponse>('/api/account/allocations-text', {
        allocationsText
      })
    );

    this._allocationsText.set(response.allocationsText);
  }

  private applySession(session: SessionResponse): void {
    if (!session.authenticated) {
      this.resetSession();
      return;
    }

    this._allocationsText.set(session.allocationsText);
    this._baseUrl.set(session.baseUrl);
    this._user.set(session.user);
    this._loginSource.set(session.loginSource);
    this._sessionMode.set(session.authMode);
    this._isAuthenticated.set(true);
    this.isInitialized = true;
  }

  private resetSession(): void {
    this._allocationsText.set('');
    this._baseUrl.set('');
    this._loginSource.set('');
    this._sessionMode.set('');
    this._user.set('');
    this._isAuthenticated.set(false);
    this.isInitialized = true;
  }
}
