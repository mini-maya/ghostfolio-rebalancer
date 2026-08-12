import { Routes } from '@angular/router';

import { ActivityPage } from './app/activity-page/activity-page';
import { authGuard } from './app/auth/auth.guard';
import { LoginPage } from './app/login-page/login-page';
import { RebalancerPage } from './app/rebalancer-page/rebalancer-page';
import { RetirePage } from './app/retire-page/retire-page';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'rebalancer'
  },
  {
    canActivate: [authGuard],
    component: RebalancerPage,
    path: 'rebalancer',
    title: 'Ghostfolio Rebalancer'
  },
  {
    canActivate: [authGuard],
    component: ActivityPage,
    path: 'activity',
    title: 'Activity – Ghostfolio Rebalancer'
  },
  {
    canActivate: [authGuard],
    component: RetirePage,
    path: 'retire',
    title: 'Retire – Ghostfolio Rebalancer'
  },
  {
    component: LoginPage,
    path: 'login',
    title: 'Login – Ghostfolio Rebalancer'
  }
];
