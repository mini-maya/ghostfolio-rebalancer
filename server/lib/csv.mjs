const HEADER = ['user', 'baseUrl', 'allocationsText', 'payload'];

export function parseAccountCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length === 0) {
    return [];
  }

  const [headerLine, ...recordLines] = lines;
  const header = parseCsvLine(headerLine);

  if (header.length !== HEADER.length || header.some((value, index) => value !== HEADER[index])) {
    throw new Error('The stored account file has an unexpected header.');
  }

  return recordLines.map((line) => {
    const [user = '', baseUrl = '', allocationsText = '', payload = ''] = parseCsvLine(line);

    return {
      allocationsText,
      baseUrl,
      payload,
      user
    };
  });
}

export function stringifyAccountCsv(records) {
  const lines = [HEADER.map(escapeCsvField).join(';')];

  for (const record of records) {
    lines.push(
      [record.user, record.baseUrl, record.allocationsText, record.payload]
        .map(escapeCsvField)
        .join(';')
    );
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
