import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { decryptJson, encryptJson, hashPassword, verifyPassword } from './crypto.mjs';
import { ConfigurationError, HttpError } from './errors.mjs';

const DEFAULT_REBALANCER_SETTINGS = Object.freeze({
  minimumBuyAmount: 10,
  monthlySavingsRate: 1750,
  roundingStep: 10
});

export function createAccountStore({ accountsFilePath, encryptionKey }) {
  return {
    async createAccount({
      accessToken,
      allocationsText = '',
      baseUrl,
      bearerToken,
      password,
      rebalancerSettings = DEFAULT_REBALANCER_SETTINGS,
      user
    }) {
      await ensureStorageFile(accountsFilePath);

      const records = await readRecords(accountsFilePath);

      if (records.some((record) => record.user === user)) {
        throw new HttpError(409, 'A local account with this user name already exists.');
      }

      const { hash, salt } = hashPassword(password);
      records.push({
        accessToken: encryptJson({ accessToken }, encryptionKey),
        allocationsText,
        baseUrl,
        bearerToken: encryptJson({ bearerToken }, encryptionKey),
        password: encryptJson({ passwordHash: hash, passwordSalt: salt }, encryptionKey),
        rebalancerSettings: {
          ...DEFAULT_REBALANCER_SETTINGS,
          ...rebalancerSettings
        },
        user
      });

      await writeRecords(accountsFilePath, records);
    },

    async getAccount(user) {
      const records = await readRecords(accountsFilePath);
      const record = records.find((candidate) => candidate.user === user);

      if (!record) {
        return null;
      }

      return deserializeAccount(record, encryptionKey);
    },

    async hasAccounts() {
      const records = await readRecords(accountsFilePath);

      return records.length > 0;
    },

    async updateBearerToken(user, bearerToken) {
      const records = await readRecords(accountsFilePath);
      const nextRecords = records.map((record) => {
        if (record.user !== user) {
          return record;
        }

        const account = deserializeAccount(record, encryptionKey);

        return {
          accessToken: encryptJson({ accessToken: account.accessToken }, encryptionKey),
          allocationsText: account.allocationsText,
          baseUrl: account.baseUrl,
          bearerToken: encryptJson({ bearerToken }, encryptionKey),
          password: encryptJson(
            {
              passwordHash: account.passwordHash,
              passwordSalt: account.passwordSalt
            },
            encryptionKey
          ),
          rebalancerSettings: {
            ...DEFAULT_REBALANCER_SETTINGS,
            ...account.rebalancerSettings
          },
          user: account.user
        };
      });

      await writeRecords(accountsFilePath, nextRecords);
    },

    async updateAllocationsText(user, allocationsText) {
      const records = await readRecords(accountsFilePath);
      const nextRecords = records.map((record) => {
        if (record.user !== user) {
          return record;
        }

        return {
          ...record,
          allocationsText
        };
      });

      await writeRecords(accountsFilePath, nextRecords);
    },

    async updateRebalancerSettings(user, rebalancerSettings) {
      const records = await readRecords(accountsFilePath);
      const nextRecords = records.map((record) => {
        if (record.user !== user) {
          return record;
        }

        return {
          ...record,
          rebalancerSettings: {
            ...DEFAULT_REBALANCER_SETTINGS,
            ...record.rebalancerSettings,
            ...rebalancerSettings
          }
        };
      });

      await writeRecords(accountsFilePath, nextRecords);
    },

    async verifyAccount(user, password) {
      const account = await this.getAccount(user);

      if (!account) {
        return null;
      }

      const isValidPassword = verifyPassword(
        password,
        account.passwordHash,
        account.passwordSalt
      );

      return isValidPassword ? account : null;
    }
  };
}

async function ensureStorageFile(accountsFilePath) {
  await mkdir(path.dirname(accountsFilePath), { recursive: true });

  try {
    await readFile(accountsFilePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      await writeFile(accountsFilePath, '[]', 'utf8');
      return;
    }

    throw error;
  }
}

function deserializeAccount(record, encryptionKey) {
  if (!encryptionKey?.trim()) {
    throw new ConfigurationError(
      'ACCOUNT_ENCRYPTION_KEY must be set to use stored accounts.'
    );
  }

  const accessToken = decryptRequiredJson(record.accessToken, encryptionKey);
  const bearerToken = decryptRequiredJson(record.bearerToken, encryptionKey);
  const password = decryptRequiredJson(record.password, encryptionKey);

  return {
    accessToken: accessToken?.accessToken ?? '',
    allocationsText: record.allocationsText ?? '',
    baseUrl: record.baseUrl,
    bearerToken: bearerToken?.bearerToken ?? '',
    passwordHash: password?.passwordHash ?? '',
    passwordSalt: password?.passwordSalt ?? '',
    rebalancerSettings: {
      ...DEFAULT_REBALANCER_SETTINGS,
      ...(record.rebalancerSettings ?? {})
    },
    user: record.user
  };
}

function decryptRequiredJson(value, encryptionKey) {
  if (!value || typeof value !== 'string') {
    throw new ConfigurationError('The stored account data is malformed.');
  }

  return decryptJson(value, encryptionKey);
}

function isMissingFileError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readRecords(accountsFilePath) {
  await ensureStorageFile(accountsFilePath);

  const fileContent = await readFile(accountsFilePath, 'utf8');

  return parseAccountJson(fileContent);
}

async function writeRecords(accountsFilePath, records) {
  await writeFile(accountsFilePath, JSON.stringify(records, null, 2), 'utf8');
}

function parseAccountJson(text) {
  if (!text.trim()) {
    return [];
  }

  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error('The stored account file has an unexpected format.');
  }

  return parsed;
}
