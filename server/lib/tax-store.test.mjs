import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

import { createTaxStore } from './tax-store.mjs';

test('creates, loads, updates and deletes tax events', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ghostfolio-tax-store-'));
  const taxFilePath = path.join(tempDirectory, 'taxEvents.json');
  const taxStore = createTaxStore({ taxFilePath });

  try {
    const createdTaxEvent = await taxStore.createTaxEvent({
      accountId: 'account-1',
      quantity: 143.27,
      symbolId: 'vwce',
      taxYear: 2026,
      vorabpauschalePerShare: 2.3,
      vorabpauschalePerShareAfterTeilfreistellung: 1.61
    });

    assert.equal(createdTaxEvent.symbolId, 'VWCE');

    const reloadedTaxStore = createTaxStore({ taxFilePath });
    const listedTaxEvents = await reloadedTaxStore.listTaxEvents();

    assert.equal(listedTaxEvents.length, 1);
    assert.equal(listedTaxEvents[0].quantity, 143.27);

    const updatedTaxEvent = await reloadedTaxStore.updateTaxEvent(createdTaxEvent.id, {
        accountId: 'account-1',
        quantity: 150,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 2.5,
        vorabpauschalePerShareAfterTeilfreistellung: 1.75
    });

    assert.equal(updatedTaxEvent.quantity, 150);
    assert.equal(updatedTaxEvent.vorabpauschalePerShare, 2.5);

    await reloadedTaxStore.deleteTaxEvent(createdTaxEvent.id);
    assert.equal((await reloadedTaxStore.listTaxEvents()).length, 0);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});

test('rejects duplicate tax events for the same account, symbol and year', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ghostfolio-tax-store-'));
  const taxFilePath = path.join(tempDirectory, 'taxEvents.json');
  const taxStore = createTaxStore({ taxFilePath });

  try {
    await taxStore.createTaxEvent({
      accountId: 'account-1',
      quantity: 1,
      symbolId: 'VWCE',
      taxYear: 2026,
      vorabpauschalePerShare: 1,
      vorabpauschalePerShareAfterTeilfreistellung: 1
    });

    await assert.rejects(
      taxStore.createTaxEvent({
        accountId: 'account-1',
        quantity: 2,
        symbolId: 'VWCE',
        taxYear: 2026,
        vorabpauschalePerShare: 2,
        vorabpauschalePerShareAfterTeilfreistellung: 2
      }),
      (error) => {
        return error.status === 409;
      }
    );
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});
