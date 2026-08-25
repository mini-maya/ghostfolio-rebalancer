import { routes } from './app.routes';

describe('routes', () => {
  it('includes the retire page behind the auth guard', () => {
    const retireRoute = routes.find(({ path }) => path === 'retire');

    expect(retireRoute).toBeDefined();
    expect(retireRoute?.canActivate?.length).toBe(1);
    expect(retireRoute?.title).toBe('Retire – Ghostfolio Rebalancer');
  });

  it('includes the tax page behind the auth guard', () => {
    const taxRoute = routes.find(({ path }) => path === 'tax');

    expect(taxRoute).toBeDefined();
    expect(taxRoute?.canActivate?.length).toBe(1);
    expect(taxRoute?.title).toBe('Tax – Ghostfolio Rebalancer');
  });
});
