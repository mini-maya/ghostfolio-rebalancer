import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createRetireStore({ retireFilePath }) {
  return {
    async getRetireConfig(user) {
      const records = await readRecords(retireFilePath);
      const record = records.find((candidate) => candidate.user === user);

      if (!record) {
        return null;
      }

      return record.retireConfig ?? null;
    },

    async updateRetireConfig(user, retireConfig) {
      await ensureStorageFile(retireFilePath);

      const records = await readRecords(retireFilePath);
      const nextRecords = records.filter((record) => record.user !== user);

      nextRecords.push({
        retireConfig,
        user
      });

      await writeRecords(retireFilePath, nextRecords);
    }
  };
}

async function ensureStorageFile(retireFilePath) {
  await mkdir(path.dirname(retireFilePath), { recursive: true });

  try {
    await readFile(retireFilePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      await writeFile(retireFilePath, '[]', 'utf8');
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

async function readRecords(retireFilePath) {
  await ensureStorageFile(retireFilePath);

  const fileContent = await readFile(retireFilePath, 'utf8');

  return parseRetireJson(fileContent);
}

async function writeRecords(retireFilePath, records) {
  await writeFile(retireFilePath, JSON.stringify(records, null, 2), 'utf8');
}

function parseRetireJson(text) {
  if (!text.trim()) {
    return [];
  }

  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error('The stored retire config file has an unexpected format.');
  }

  return parsed;
}
