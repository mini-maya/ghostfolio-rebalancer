import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../auth/auth.service';
import { RuntimeConfigService } from '../runtime-config';

@Component({
  selector: 'app-login-page',
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss'
})
export class LoginPage implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly runtimeConfigService = inject(RuntimeConfigService);

  protected readonly runtimeConfig = this.runtimeConfigService.config;
  protected readonly accessToken = signal(this.runtimeConfig().accessToken);
  protected readonly baseUrl = signal(this.runtimeConfig().baseUrl);
  protected readonly errorMessage = signal('');
  protected readonly infoMessage = signal('');
  protected readonly isPasswordConfirmationVisible = signal(false);
  protected readonly isTokenLoading = signal(false);
  protected readonly isUserPasswordLoading = signal(false);
  protected readonly password = signal('');
  protected readonly passwordConfirmation = signal('');
  protected readonly tokenButtonLabel = computed(() => {
    return this.isPasswordConfirmationVisible()
      ? 'Create local account'
      : 'Login with access token';
  });
  protected readonly user = signal('');

  async ngOnInit(): Promise<void> {
    if (this.authService.isAuthenticated()) {
      await this.router.navigate(['/']);
      return;
    }

    if (
      !this.runtimeConfig().hasStoredAccounts &&
      this.runtimeConfig().baseUrl &&
      this.runtimeConfig().accessToken
    ) {
      await this.submitTokenLogin(undefined, 'env-default');
    }
  }

  protected updateBaseUrl(event: Event): void {
    this.baseUrl.set((event.target as HTMLInputElement).value);
    this.resetPreparedAccountCreation();
  }

  protected updateAccessToken(event: Event): void {
    this.accessToken.set((event.target as HTMLInputElement).value);
    this.resetPreparedAccountCreation();
  }

  protected updatePassword(event: Event): void {
    this.password.set((event.target as HTMLInputElement).value);
    this.resetPreparedAccountCreation();
  }

  protected updatePasswordConfirmation(event: Event): void {
    this.passwordConfirmation.set((event.target as HTMLInputElement).value);
  }

  protected updateUser(event: Event): void {
    this.user.set((event.target as HTMLInputElement).value);
    this.resetPreparedAccountCreation();
  }

  protected async submitTokenLogin(
    event?: Event,
    source: 'env-default' | 'manual' = 'manual'
  ): Promise<void> {
    event?.preventDefault();

    if (this.isTokenLoading() || this.isUserPasswordLoading()) {
      return;
    }

    this.errorMessage.set('');
    this.infoMessage.set('');

    if (!this.baseUrl().trim()) {
      this.errorMessage.set('Please enter the Ghostfolio URL.');
      return;
    }

    if (!this.accessToken().trim()) {
      this.errorMessage.set('Please enter your account access token.');
      return;
    }

    if (this.isPasswordConfirmationVisible()) {
      if (!this.passwordConfirmation().trim()) {
        this.errorMessage.set('Please confirm the local password.');
        return;
      }

      if (this.password().trim() !== this.passwordConfirmation().trim()) {
        this.errorMessage.set('The password confirmation does not match.');
        return;
      }
    }

    const hasAnyLocalAccountInput = Boolean(this.user().trim() || this.password().trim());
    const hasCompleteLocalAccountInput = Boolean(
      this.user().trim() && this.password().trim()
    );

    if (hasAnyLocalAccountInput && !hasCompleteLocalAccountInput) {
      this.errorMessage.set(
        'Enter both a local user name and a local password to create an account.'
      );
      return;
    }

    this.isTokenLoading.set(true);

    try {
      if (this.isPasswordConfirmationVisible()) {
        await this.authService.registerAccount({
          accessToken: this.accessToken().trim(),
          baseUrl: this.baseUrl().trim(),
          password: this.password().trim(),
          passwordConfirmation: this.passwordConfirmation().trim(),
          user: this.user().trim()
        });
        await this.router.navigate(['/']);
        return;
      }

      if (hasCompleteLocalAccountInput) {
        const response = await this.authService.prepareAccountCreation(
          this.baseUrl().trim(),
          this.accessToken().trim(),
          this.user().trim(),
          this.password().trim()
        );
        this.baseUrl.set(response.baseUrl);
        this.infoMessage.set(response.message);
        this.isPasswordConfirmationVisible.set(true);
        return;
      }

      await this.authService.loginWithAccessToken(
        this.baseUrl().trim(),
        this.accessToken().trim(),
        source
      );
      await this.router.navigate(['/']);
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error));
    } finally {
      this.isTokenLoading.set(false);
    }
  }

  protected async submitUserPasswordLogin(event?: Event): Promise<void> {
    event?.preventDefault();

    if (this.isTokenLoading() || this.isUserPasswordLoading()) {
      return;
    }

    this.errorMessage.set('');
    this.infoMessage.set('');

    if (!this.user().trim()) {
      this.errorMessage.set('Please enter the local user name.');
      return;
    }

    if (!this.password().trim()) {
      this.errorMessage.set('Please enter the local password.');
      return;
    }

    this.isUserPasswordLoading.set(true);

    try {
      await this.authService.loginWithUserPassword(
        this.user().trim(),
        this.password().trim()
      );
      await this.router.navigate(['/']);
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error));
    } finally {
      this.isUserPasswordLoading.set(false);
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

      return `The request failed with status ${error.status}.`;
    }

    return 'Authentication failed. Please check your credentials.';
  }

  private resetPreparedAccountCreation(): void {
    if (!this.isPasswordConfirmationVisible()) {
      return;
    }

    this.infoMessage.set('');
    this.isPasswordConfirmationVisible.set(false);
    this.passwordConfirmation.set('');
  }
}
