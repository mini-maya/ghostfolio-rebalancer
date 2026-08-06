import { Routes } from '@angular/router';

import { authGuard } from './app/auth/auth.guard';
import { LoginPage } from './app/login-page/login-page';
import { RebalancerPage } from './app/rebalancer-page/rebalancer-page';

export const routes: Routes = [
  {
    canActivate: [authGuard],
    component: RebalancerPage,
    path: '',
    title: 'Ghostfolio Rebalancer'
  },
  {
    component: LoginPage,
    path: 'login',
    title: 'Login – Ghostfolio Rebalancer'
  }
];
