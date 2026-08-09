import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface RuntimeConfig {
  accessToken: string;
  allocationsText: string;
  baseUrl: string;
  hasInjectedDefaults: boolean;
  hasStoredAccounts: boolean;
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  accessToken: '',
  allocationsText: '',
  baseUrl: '',
  hasInjectedDefaults: false,
  hasStoredAccounts: false
};

@Injectable({
  providedIn: 'root'
})
export class RuntimeConfigService {
  private readonly http = inject(HttpClient);
  private readonly _config = signal<RuntimeConfig>(DEFAULT_RUNTIME_CONFIG);
  private loadPromise?: Promise<void>;

  public readonly config = this._config.asReadonly();

  public async load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = firstValueFrom(this.http.get<RuntimeConfig>('/api/runtime-config'))
      .then((config) => {
        this._config.set({
          ...DEFAULT_RUNTIME_CONFIG,
          ...config
        });
      })
      .finally(() => {
        this.loadPromise = undefined;
      });

    return this.loadPromise;
  }
}
