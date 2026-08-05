import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

type ThemeMode = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'ghostfolio-rebalancer-theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  protected readonly themeMode = signal<ThemeMode>(readStoredThemeMode());
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
