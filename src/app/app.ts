import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './app/auth/auth.service';
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
  protected readonly ghostfolioErrorMessage = signal('');
  protected readonly isGhostfolioLoading = signal(false);
  protected readonly themeMode = signal<ThemeMode>(readStoredThemeMode());
  protected readonly showGhostfolioButton = computed(() => {
    return Boolean(this.authService.baseUrl() && this.authService.accessToken());
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
    const accessToken = this.authService.accessToken();

    this.ghostfolioErrorMessage.set('');

    if (!baseUrl || !accessToken) {
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
      const authToken = await firstValueFrom(
        this.ghostfolioApi.authenticate(baseUrl, accessToken)
      );
      const language = resolveBrowserLanguage();
      const ghostfolioAuthUrl = new URL(
        `${language}/auth/${encodeURIComponent(authToken)}`,
        `${baseUrl}/`
      ).toString();
      popup.location.replace(ghostfolioAuthUrl);
    } catch {
      if (!popup.closed) {
        popup.close();
      }
      this.ghostfolioErrorMessage.set(
        'Ghostfolio direct login failed. Please verify your access token and try again.'
      );
    } finally {
      this.isGhostfolioLoading.set(false);
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
