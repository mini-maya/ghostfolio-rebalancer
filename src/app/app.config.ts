import {
  APP_INITIALIZER,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { AuthService } from './app/auth/auth.service';
import { routes } from './app.routes';
import { RuntimeConfigService } from './app/runtime-config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    {
      provide: APP_INITIALIZER,
      deps: [RuntimeConfigService, AuthService],
      multi: true,
      useFactory: initializeApplication
    }
  ]
};

function initializeApplication(
  runtimeConfigService: RuntimeConfigService,
  authService: AuthService
) {
  return async () => {
    await runtimeConfigService.load();
    await authService.initialize();
  };
}
