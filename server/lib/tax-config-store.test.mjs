import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTaxConfigStore } from './tax-config-store.mjs';

test('creates, loads and updates tax config records', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ghostfolio-tax-config-'));
  const taxFilePath = path.join(tempDirectory, 'tax.json');
  const taxConfigStore = createTaxConfigStore({ taxFilePath });

  try {
    await taxConfigStore.updateTaxConfig('local-user', {
      capitalGainsTaxRate: 0.25,
      churchTaxRate: 0.08,
      partialExemptionRate: 0.3,
      solidaritySurchargeRate: 0.055,
      sparerPauschbetrag: 1000
    });

    const reloadedTaxConfigStore = createTaxConfigStore({ taxFilePath });
    const taxConfig = await reloadedTaxConfigStore.getTaxConfig('local-user');

    assert.deepEqual(taxConfig, {
      capitalGainsTaxRate: 0.25,
      churchTaxRate: 0.08,
      partialExemptionRate: 0.3,
      solidaritySurchargeRate: 0.055,
      sparerPauschbetrag: 1000
    });

    await reloadedTaxConfigStore.updateTaxConfig('local-user', {
      capitalGainsTaxRate: 0.2,
      churchTaxRate: 0.05,
      partialExemptionRate: 0.25,
      solidaritySurchargeRate: 0.051,
      sparerPauschbetrag: 2000
    });

    const updatedTaxConfig = await reloadedTaxConfigStore.getTaxConfig('local-user');

    assert.deepEqual(updatedTaxConfig, {
      capitalGainsTaxRate: 0.2,
      churchTaxRate: 0.05,
      partialExemptionRate: 0.25,
      solidaritySurchargeRate: 0.051,
      sparerPauschbetrag: 2000
    });
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});

test('defaults sparerPauschbetrag to 1000 EUR when missing or invalid', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ghostfolio-tax-config-'));
  const taxFilePath = path.join(tempDirectory, 'tax.json');
  const taxConfigStore = createTaxConfigStore({ taxFilePath });

  try {
    await taxConfigStore.updateTaxConfig('local-user', {
      capitalGainsTaxRate: 0.25,
      churchTaxRate: 0,
      partialExemptionRate: 0.3,
      solidaritySurchargeRate: 0.055
    });

    const taxConfig = await taxConfigStore.getTaxConfig('local-user');

    assert.equal(taxConfig.sparerPauschbetrag, 1000);

    await taxConfigStore.updateTaxConfig('local-user', {
      capitalGainsTaxRate: 0.25,
      churchTaxRate: 0,
      partialExemptionRate: 0.3,
      solidaritySurchargeRate: 0.055,
      sparerPauschbetrag: -5
    });

    const negativeTaxConfig = await taxConfigStore.getTaxConfig('local-user');

    assert.equal(negativeTaxConfig.sparerPauschbetrag, 1000);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});
