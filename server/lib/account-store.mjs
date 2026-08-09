import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { decryptJson, encryptJson, hashPassword, verifyPassword } from './crypto.mjs';
import { parseAccountCsv, stringifyAccountCsv } from './csv.mjs';
import { ConfigurationError, HttpError } from './errors.mjs';

export function createAccountStore({ accountsFilePath, encryptionKey }) {
  return {
    async createAccount({
      accessToken,
      allocationsText = '',
      baseUrl,
      bearerToken,
      password,
      user
    }) {
      await ensureStorageFile(accountsFilePath);

      const records = await readRecords(accountsFilePath);

      if (records.some((record) => record.user === user)) {
        throw new HttpError(409, 'A local account with this user name already exists.');
      }

      const { hash, salt } = hashPassword(password);
      records.push({
        allocationsText,
        baseUrl,
        payload: encryptJson(
          {
            accessToken,
            bearerToken,
            passwordHash: hash,
            passwordSalt: salt
          },
          encryptionKey
        ),
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
          allocationsText: account.allocationsText,
          baseUrl: account.baseUrl,
          payload: encryptJson(
            {
              accessToken: account.accessToken,
              bearerToken,
              passwordHash: account.passwordHash,
              passwordSalt: account.passwordSalt
            },
            encryptionKey
          ),
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
      await writeFile(accountsFilePath, stringifyAccountCsv([]), 'utf8');
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

  const payload = decryptJson(record.payload, encryptionKey);

  return {
    accessToken: payload.accessToken ?? '',
    allocationsText: record.allocationsText ?? '',
    baseUrl: record.baseUrl,
    bearerToken: payload.bearerToken ?? '',
    passwordHash: payload.passwordHash ?? '',
    passwordSalt: payload.passwordSalt ?? '',
    user: record.user
  };
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

  return parseAccountCsv(fileContent);
}

async function writeRecords(accountsFilePath, records) {
  await writeFile(accountsFilePath, stringifyAccountCsv(records), 'utf8');
}
