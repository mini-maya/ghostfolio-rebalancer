import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { HttpError } from './errors.mjs';

export function createTaxStore({ taxFilePath }) {
  return {
    async createTaxEvent(taxEvent) {
      await ensureStorageFile(taxFilePath);

      const records = await readRecords(taxFilePath);
      const nextRecord = normalizeTaxEvent({ taxEvent });

      assertUniqueTaxEvent(records, nextRecord);
      records.push(nextRecord);

      await writeRecords(taxFilePath, records);

      return nextRecord;
    },

    async deleteTaxEvent(taxEventId) {
      const records = await readRecords(taxFilePath);
      const nextRecords = records.filter((record) => record.id !== taxEventId);

      if (nextRecords.length === records.length) {
        throw new HttpError(404, 'The requested tax event was not found.');
      }

      await writeRecords(taxFilePath, nextRecords);
    },

    async listTaxEvents() {
      const records = await readRecords(taxFilePath);

      return sortTaxEvents(records);
    },

    async updateTaxEvent(taxEventId, taxEvent) {
      const records = await readRecords(taxFilePath);
      const currentRecordIndex = records.findIndex((record) => {
        return record.id === taxEventId;
      });

      if (currentRecordIndex < 0) {
        throw new HttpError(404, 'The requested tax event was not found.');
      }

      const nextRecord = normalizeTaxEvent({ id: taxEventId, taxEvent });

      assertUniqueTaxEvent(records, nextRecord, taxEventId);
      records[currentRecordIndex] = nextRecord;

      await writeRecords(taxFilePath, records);

      return nextRecord;
    }
  };
}

async function ensureStorageFile(taxFilePath) {
  await mkdir(path.dirname(taxFilePath), { recursive: true });

  try {
    await readFile(taxFilePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      await writeFile(taxFilePath, '[]', 'utf8');
      return;
    }

    throw error;
  }
}

function assertUniqueTaxEvent(records, taxEvent, excludedId = '') {
  const hasDuplicate = records.some((record) => {
    if (excludedId && record.id === excludedId) {
      return false;
    }

    return record.accountId === taxEvent.accountId && record.symbolId === taxEvent.symbolId && record.taxYear === taxEvent.taxYear;
  });

  if (hasDuplicate) {
    throw new HttpError(
      409,
      'A tax event for the selected account, symbol and tax year already exists.'
    );
  }
}

function isMissingFileError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readRecords(taxFilePath) {
  await ensureStorageFile(taxFilePath);

  const fileContent = await readFile(taxFilePath, 'utf8');

  return parseTaxJson(fileContent);
}

async function writeRecords(taxFilePath, records) {
  await writeFile(taxFilePath, JSON.stringify(records, null, 2), 'utf8');
}

function normalizeTaxEvent({ id = randomUUID(), taxEvent }) {
  if (typeof taxEvent !== 'object' || taxEvent === null) {
    throw new HttpError(400, 'Tax event data must be provided as an object.');
  }

  const accountId = readRequiredString(taxEvent.accountId, 'The tax event account must be provided.');
  const symbolId = readRequiredString(taxEvent.symbolId, 'The tax event symbol must be provided.').toUpperCase();
  const taxYear = readPositiveIntegerStrict(taxEvent.taxYear, 'The tax year must be a positive integer.');
  const quantity = readPositiveNumber(taxEvent.quantity, 'The tax quantity must be greater than zero.');
  const vorabpauschalePerShare = readNonNegativeNumber(
    taxEvent.vorabpauschalePerShare,
    'The tax amount per share must be zero or greater.'
  );
  const vorabpauschalePerShareAfterTeilfreistellung = readNonNegativeNumber(
    taxEvent.vorabpauschalePerShareAfterTeilfreistellung,
    'The tax amount per share after partial exemption must be zero or greater.'
  );

  return {
    accountId,
    id,
    quantity,
    symbolId,
    taxYear,
    vorabpauschalePerShare,
    vorabpauschalePerShareAfterTeilfreistellung
  };
}

function parseTaxJson(text) {
  if (!text.trim()) {
    return [];
  }

  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error('The stored tax event file has an unexpected format.');
  }

  return parsed.map((record) => normalizeStoredTaxEvent(record));
}

function normalizeStoredTaxEvent(record) {
  if (typeof record !== 'object' || record === null) {
    throw new Error('The stored tax event file has an unexpected format.');
  }

  return {
    accountId: readRequiredString(record.accountId, 'The stored tax event is malformed.'),
    id: readRequiredString(record.id, 'The stored tax event is malformed.'),
    quantity: readPositiveNumber(record.quantity, 'The stored tax event is malformed.'),
    symbolId: readRequiredString(record.symbolId, 'The stored tax event is malformed.').toUpperCase(),
    taxYear: readPositiveIntegerStrict(record.taxYear, 'The stored tax event is malformed.'),
    vorabpauschalePerShare: readNonNegativeNumber(
      record.vorabpauschalePerShare,
      'The stored tax event is malformed.'
    ),
    vorabpauschalePerShareAfterTeilfreistellung: readNonNegativeNumber(
      record.vorabpauschalePerShareAfterTeilfreistellung,
      'The stored tax event is malformed.'
    )
  };
}

function readNonNegativeNumber(value, message) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new HttpError(400, message);
  }

  return numberValue;
}

function readPositiveIntegerStrict(value, message) {
  const numberValue = Number(value);
  const roundedValue = Math.round(numberValue);

  if (!Number.isFinite(numberValue) || roundedValue <= 0 || Math.abs(numberValue - roundedValue) > 1e-9) {
    throw new HttpError(400, message);
  }

  return roundedValue;
}

function readPositiveNumber(value, message) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new HttpError(400, message);
  }

  return numberValue;
}

function readRequiredString(value, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, message);
  }

  return value.trim();
}

function sortTaxEvents(records) {
  return [...records].sort((left, right) => {
    if (left.taxYear !== right.taxYear) {
      return right.taxYear - left.taxYear;
    }

    const accountComparison = left.accountId.localeCompare(right.accountId, undefined, {
      numeric: true,
      sensitivity: 'base'
    });

    if (accountComparison !== 0) {
      return accountComparison;
    }

    return left.symbolId.localeCompare(right.symbolId, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
}
