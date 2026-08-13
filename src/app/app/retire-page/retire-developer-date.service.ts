import { computed, inject, Injectable, signal } from '@angular/core';
import { startOfMonth } from 'date-fns';

import { RuntimeConfigService } from '../runtime-config';

@Injectable({
  providedIn: 'root'
})
export class RetireDeveloperDateService {
  private readonly runtimeConfigService = inject(RuntimeConfigService);
  private readonly overrideCurrentDate = signal<Date | null>(null);

  public readonly currentDate = computed(() => {
    if (!this.runtimeConfigService.config().developerMode) {
      return startOfMonth(new Date());
    }

    return this.overrideCurrentDate() ?? startOfMonth(new Date());
  });

  public setCurrentDate(date: Date): void {
    if (!this.runtimeConfigService.config().developerMode) {
      return;
    }

    this.overrideCurrentDate.set(startOfMonth(date));
  }

  public reset(): void {
    this.overrideCurrentDate.set(null);
  }
}
