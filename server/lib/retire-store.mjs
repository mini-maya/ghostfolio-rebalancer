import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HEADER = ['user', 'retireConfig'];

export function createRetireStore({ retireFilePath }) {
  return {
    async getRetireConfig(user) {
      const records = await readRecords(retireFilePath);
      const record = records.find((candidate) => candidate.user === user);

      if (!record) {
        return null;
      }

      return parseRetireConfig(record.retireConfig);
    },

    async updateRetireConfig(user, retireConfig) {
      await ensureStorageFile(retireFilePath);

      const records = await readRecords(retireFilePath);
      const nextRecords = records.filter((record) => record.user !== user);

      nextRecords.push({
        retireConfig: JSON.stringify(retireConfig),
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
      await writeFile(retireFilePath, stringifyRetireCsv([]), 'utf8');
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

  return parseRetireCsv(fileContent);
}

async function writeRecords(retireFilePath, records) {
  await writeFile(retireFilePath, stringifyRetireCsv(records), 'utf8');
}

function parseRetireConfig(value) {
  if (!value) {
    return null;
  }

  return JSON.parse(value);
}

function parseRetireCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length === 0) {
    return [];
  }

  const [headerLine, ...recordLines] = lines;
  const header = parseCsvLine(headerLine);

  if (header.length !== HEADER.length || header.some((value, index) => value !== HEADER[index])) {
    throw new Error('The stored retire config file has an unexpected header.');
  }

  return recordLines.map((line) => {
    const [user = '', retireConfig = ''] = parseCsvLine(line);

    return {
      retireConfig,
      user
    };
  });
}

function stringifyRetireCsv(records) {
  const lines = [HEADER.map(escapeCsvField).join(';')];

  for (const record of records) {
    lines.push([record.user, record.retireConfig].map(escapeCsvField).join(';'));
  }

  return `${lines.join('\n')}\n`;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 2;
        continue;
      }

      inQuotes = !inQuotes;
      index += 1;
      continue;
    }

    if (character === ';' && !inQuotes) {
      values.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  values.push(current);

  return values;
}

function escapeCsvField(value) {
  const normalizedValue = String(value ?? '');

  if (!/[;"\n\r]/.test(normalizedValue)) {
    return normalizedValue;
  }

  return `"${normalizedValue.replaceAll('"', '""')}"`;
}
