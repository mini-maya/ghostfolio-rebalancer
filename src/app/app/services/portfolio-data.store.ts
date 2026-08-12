import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { GhostfolioApi, type Activity, type Holding, type PortfolioPerformanceChartItem } from './ghostfolio-api';

@Injectable({
  providedIn: 'root'
})
export class PortfolioDataStore {
  private readonly authService = inject(AuthService);
  private readonly ghostfolioApi = inject(GhostfolioApi);
  readonly activities = signal<Activity[]>([]);
  readonly errorMessage = signal('');
  readonly holdings = signal<Holding[]>([]);
  readonly infoMessage = signal('');
  readonly isLoading = signal(false);
  readonly lastLoadedUrl = signal('');
  readonly portfolioPerformanceData = signal<PortfolioPerformanceChartItem[]>([]);

  async loadPortfolioData() {
    this.errorMessage.set('');
    this.infoMessage.set('');
    this.isLoading.set(true);

    try {
      const baseUrl = this.authService.baseUrl();
      const [holdings, activities, portfolioPerformanceData] = await Promise.all([
        firstValueFrom(this.ghostfolioApi.fetchHoldings()),
        firstValueFrom(this.ghostfolioApi.fetchActivities()),
        firstValueFrom(this.ghostfolioApi.fetchPortfolioPerformance())
      ]);

      this.holdings.set(holdings);
      this.activities.set(activities);
      this.portfolioPerformanceData.set(portfolioPerformanceData);
      this.lastLoadedUrl.set(baseUrl);
      this.infoMessage.set(
        `Loaded ${holdings.length} holdings, ${activities.length} activities and ${portfolioPerformanceData.length} performance points from ${baseUrl}.`
      );
    } catch (error) {
      this.activities.set([]);
      this.holdings.set([]);
      this.portfolioPerformanceData.set([]);
      this.errorMessage.set(this.getErrorMessage(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof TypeError || error instanceof Error) {
      if (error.message.includes('Invalid URL')) {
        return 'The Ghostfolio URL is invalid.';
      }
    }

    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'The application backend is not reachable.';
      }

      if (typeof error.error?.message === 'string' && error.error.message.trim()) {
        return error.error.message;
      }

      if (error.status === 401 || error.status === 403) {
        return 'Authentication against the remote Ghostfolio instance failed.';
      }

      return `The remote Ghostfolio request failed with status ${error.status}.`;
    }

    return 'Loading holdings from the remote Ghostfolio instance failed.';
  }
}
