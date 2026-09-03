import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TAX_CONFIG = Object.freeze({
  assumedBasiszinsRate: 0.025,
  capitalGainsTaxRate: 0.25,
  churchTaxRate: 0,
  partialExemptionRate: 0.3,
  solidaritySurchargeRate: 0.055,
  sparerPauschbetrag: 1000
});

export function createTaxConfigStore({ taxFilePath }) {
  return {
    async getTaxConfig(user) {
      const records = await readRecords(taxFilePath);
      const record = records.find((candidate) => candidate.user === user);

      if (!record) {
        return null;
      }

      return record.taxConfig ?? null;
    },

    async updateTaxConfig(user, taxConfig) {
      await ensureStorageFile(taxFilePath);

      const records = await readRecords(taxFilePath);
      const nextRecords = records.filter((record) => record.user !== user);

      nextRecords.push({
        taxConfig: normalizeTaxConfig(taxConfig),
        user
      });

      await writeRecords(taxFilePath, nextRecords);
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

function parseTaxJson(text) {
  if (!text.trim()) {
    return [];
  }

  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error('The stored tax config file has an unexpected format.');
  }

  return parsed.map((record) => normalizeStoredTaxConfig(record));
}

function normalizeStoredTaxConfig(record) {
  if (typeof record !== 'object' || record === null) {
    throw new Error('The stored tax config file has an unexpected format.');
  }

  return {
    taxConfig: normalizeTaxConfig(record.taxConfig),
    user: readRequiredString(record.user, 'The stored tax config is malformed.')
  };
}

function normalizeTaxConfig(taxConfig) {
  if (typeof taxConfig !== 'object' || taxConfig === null) {
    throw new Error('The tax config must be provided as an object.');
  }

  return {
    assumedBasiszinsRate: readBasiszinsRate(
      taxConfig.assumedBasiszinsRate,
      DEFAULT_TAX_CONFIG.assumedBasiszinsRate
    ),
    capitalGainsTaxRate: readNonNegativeNumber(
      taxConfig.capitalGainsTaxRate,
      DEFAULT_TAX_CONFIG.capitalGainsTaxRate
    ),
    churchTaxRate: readNonNegativeNumber(taxConfig.churchTaxRate, DEFAULT_TAX_CONFIG.churchTaxRate),
    partialExemptionRate: readNonNegativeNumber(
      taxConfig.partialExemptionRate,
      DEFAULT_TAX_CONFIG.partialExemptionRate
    ),
    solidaritySurchargeRate: readNonNegativeNumber(
      taxConfig.solidaritySurchargeRate,
      DEFAULT_TAX_CONFIG.solidaritySurchargeRate
    ),
    sparerPauschbetrag: readNonNegativeNumber(
      taxConfig.sparerPauschbetrag,
      DEFAULT_TAX_CONFIG.sparerPauschbetrag
    )
  };
}

function readNonNegativeNumber(value, fallback) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : fallback;
}

// A negative Basiszins is legally floored to 0% for the Basisertrag calculation
// (§18 Abs. 4 InvStG), unlike other tax fields where a negative value is invalid
// and falls back to the configured default.
function readBasiszinsRate(value, fallback) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.max(0, numberValue);
}

function readRequiredString(value, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }

  return value.trim();
}
