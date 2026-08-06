import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../auth/auth.service';
import { getRuntimeConfig } from '../runtime-config';

@Component({
  selector: 'app-login-page',
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss'
})
export class LoginPage implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly runtimeConfig = getRuntimeConfig();

  protected readonly baseUrl = signal(this.runtimeConfig.baseUrl);
  protected readonly accessToken = signal(this.runtimeConfig.accessToken);
  protected readonly errorMessage = signal('');
  protected readonly isLoading = signal(false);

  async ngOnInit(): Promise<void> {
    if (this.runtimeConfig.baseUrl && this.runtimeConfig.accessToken) {
      await this.submit();
    }
  }

  protected updateBaseUrl(event: Event): void {
    this.baseUrl.set((event.target as HTMLInputElement).value);
  }

  protected updateAccessToken(event: Event): void {
    this.accessToken.set((event.target as HTMLInputElement).value);
  }

  protected async submit(event?: Event): Promise<void> {
    event?.preventDefault();

    if (this.isLoading()) {
      return;
    }

    this.errorMessage.set('');

    if (!this.baseUrl().trim()) {
      this.errorMessage.set('Please enter the Ghostfolio URL.');
      return;
    }

    if (!this.accessToken().trim()) {
      this.errorMessage.set('Please enter your account access token.');
      return;
    }

    this.isLoading.set(true);

    try {
      await this.authService.login(this.baseUrl().trim(), this.accessToken().trim());
      await this.router.navigate(['/']);
    } catch (error) {
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
        return 'The remote Ghostfolio instance is not reachable or blocks this request via CORS.';
      }

      if (error.status === 401 || error.status === 403) {
        return 'Authentication failed. Please check your access token.';
      }

      return `The request failed with status ${error.status}.`;
    }

    return 'Authentication failed. Please check your credentials.';
  }
}
