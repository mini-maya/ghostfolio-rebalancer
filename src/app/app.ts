import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './app/auth/auth.service';
import { RuntimeConfigService } from './app/runtime-config';
import { GhostfolioApi } from './app/services/ghostfolio-api';

type ThemeMode = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'ghostfolio-rebalancer-theme';
const SUPPORTED_GHOSTFOLIO_LANGUAGES = new Set([
  'ca',
  'de',
  'en',
  'es',
  'fr',
  'it',
  'ko',
  'nl',
  'pl',
  'pt',
  'tr',
  'uk',
  'zh'
]);

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly ghostfolioApi = inject(GhostfolioApi);
  private readonly router = inject(Router);
  private readonly runtimeConfigService = inject(RuntimeConfigService);
  private readonly runtimeConfig = this.runtimeConfigService.config;
  protected readonly ghostfolioErrorMessage = signal('');
  protected readonly isGhostfolioLoading = signal(false);
  protected readonly isLoggingOut = signal(false);
  protected readonly themeMode = signal<ThemeMode>(readStoredThemeMode());
  protected readonly showGhostfolioButton = computed(() => {
    return this.authService.isAuthenticated() && Boolean(this.authService.baseUrl());
  });
  protected readonly showLogoutButton = computed(() => {
    if (!this.authService.isAuthenticated()) {
      return false;
    }

    const isEnvAutoLoginSession =
      this.authService.sessionMode() === 'token' &&
      this.authService.loginSource() === 'env-default' &&
      this.runtimeConfig().hasInjectedDefaults &&
      !this.runtimeConfig().hasStoredAccounts;

    return !isEnvAutoLoginSession;
  });
  protected readonly canOpenGhostfolio = computed(() => {
    return this.showGhostfolioButton() && !this.isGhostfolioLoading();
  });
  private readonly systemPrefersDark = signal(readSystemPrefersDark());

  constructor() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => {
      this.systemPrefersDark.set(event.matches);
    };

    mediaQuery.addEventListener('change', listener);
    this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', listener));

    effect(() => {
      const resolvedTheme =
        this.themeMode() === 'system'
          ? this.systemPrefersDark()
            ? 'dark'
            : 'light'
          : this.themeMode();

      this.document.documentElement.setAttribute('data-theme', resolvedTheme);
      this.document.documentElement.setAttribute('data-theme-mode', this.themeMode());
      window.localStorage.setItem(THEME_STORAGE_KEY, this.themeMode());
    });
  }

  protected updateThemeMode(event: Event) {
    const value = (event.target as HTMLSelectElement).value;

    if (value === 'light' || value === 'dark' || value === 'system') {
      this.themeMode.set(value);
    }
  }

  protected async openGhostfolio() {
    const baseUrl = this.authService.baseUrl();

    this.ghostfolioErrorMessage.set('');

    if (!baseUrl) {
      return;
    }

    const popup = window.open('', '_blank');

    if (!popup) {
      this.ghostfolioErrorMessage.set(
        'The browser blocked opening a new tab. Please allow popups and try again.'
      );
      return;
    }

    popup.opener = null;

    this.isGhostfolioLoading.set(true);

    try {
      const language = resolveBrowserLanguage();
      const ghostfolioAuthUrl = await firstValueFrom(
        this.ghostfolioApi.getDirectLoginUrl(language)
      );
      popup.location.replace(ghostfolioAuthUrl);
    } catch (error) {
      if (!popup.closed) {
        popup.close();
      }

      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.ghostfolioErrorMessage.set('Please sign in again before opening Ghostfolio.');
      } else {
        this.ghostfolioErrorMessage.set(
          'Ghostfolio direct login failed. Please verify your credentials and try again.'
        );
      }
    } finally {
      this.isGhostfolioLoading.set(false);
    }
  }

  protected async logout() {
    if (this.isLoggingOut()) {
      return;
    }

    this.ghostfolioErrorMessage.set('');
    this.isLoggingOut.set(true);

    try {
      await this.authService.logout();
      await this.router.navigate(['/login']);
    } catch {
      this.ghostfolioErrorMessage.set('Logout failed. Please try again.');
    } finally {
      this.isLoggingOut.set(false);
    }
  }
}

function readStoredThemeMode(): ThemeMode {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
    return storedTheme;
  }

  return 'system';
}

function readSystemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveBrowserLanguage(): string {
  const localeCandidate = navigator.language || navigator.languages?.[0] || '';
  const normalizedCandidate = localeCandidate.trim().toLowerCase();
  const languageMatch = normalizedCandidate.match(/^[a-z]{2}/);

  if (!languageMatch) {
    return 'en';
  }

  const language = languageMatch[0];

  if (!SUPPORTED_GHOSTFOLIO_LANGUAGES.has(language)) {
    return 'en';
  }

  return language;
}
