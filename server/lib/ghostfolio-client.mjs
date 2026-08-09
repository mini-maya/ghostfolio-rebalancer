import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import { HttpError } from './errors.mjs';

const ghostfolioCaPath = getGhostfolioCaPath();
const ghostfolioCaCertificate = loadGhostfolioCaCertificate(ghostfolioCaPath);
const ghostfolioHttpsAgent = ghostfolioCaCertificate
  ? new https.Agent({
      ca: ghostfolioCaCertificate
    })
  : null;

export async function authenticate(baseUrl, accessToken) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const response = await requestGhostfolioJson(
    normalizedBaseUrl,
    'api/v1/auth/anonymous',
    {
      body: JSON.stringify({ accessToken }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      method: 'POST'
    }
  );

  const authToken = response?.authToken;

  if (!authToken) {
    throw new HttpError(502, 'Ghostfolio authentication did not return a bearer token.');
  }

  return {
    authToken,
    baseUrl: normalizedBaseUrl
  };
}

export async function fetchActivities(baseUrl, bearerToken) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const take = 500;
  const allActivities = [];
  let count = 0;
  let skip = 0;

  do {
    const response = await requestGhostfolioJson(
      normalizedBaseUrl,
      'api/v1/activities',
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${bearerToken}`
        },
        method: 'GET'
      },
      {
        skip,
        take
      }
    );

    const pageActivities = Array.isArray(response?.activities) ? response.activities : [];
    count = typeof response?.count === 'number' ? response.count : count;
    allActivities.push(...pageActivities);
    skip += pageActivities.length;

    if (pageActivities.length === 0) {
      break;
    }
  } while (allActivities.length < count);

  return {
    activities: allActivities,
    count: allActivities.length
  };
}

export async function fetchHoldings(baseUrl, bearerToken) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return requestGhostfolioJson(normalizedBaseUrl, 'api/v1/portfolio/holdings', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`
    },
    method: 'GET'
  });
}

export function normalizeBaseUrl(baseUrl) {
  const normalizedUrl = new URL(baseUrl);

  return normalizedUrl.toString().replace(/\/$/, '');
}

async function requestJson(url, options, query = {}) {
  const requestUrl = appendQuery(url, query);
  let response;

  try {
    response = await sendRequest(new URL(requestUrl), options);
  } catch (error) {
    if (isTlsVerificationError(error)) {
      throw new HttpError(
        502,
        ghostfolioCaCertificate
          ? 'TLS certificate validation for the remote Ghostfolio instance failed.'
          : `TLS certificate validation for the remote Ghostfolio instance failed. Mount the trusted CA as ${ghostfolioCaPath} so the backend can verify Ghostfolio.`
      );
    }

    throw new HttpError(
      502,
      'The remote Ghostfolio instance is not reachable.',
      { isNetworkError: true }
    );
  }

  const contentType = readHeaderValue(response.headers['content-type']);
  const responseBody = contentType.includes('application/json')
    ? parseJsonSafely(response.body)
    : response.body;

  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new HttpError(
        response.statusCode,
        'Authentication against the remote Ghostfolio instance failed.'
      );
    }

    throw new HttpError(
      502,
      `The remote Ghostfolio request failed with status ${response.statusCode}.`
    );
  }

  return responseBody;
}

async function requestGhostfolioJson(baseUrl, path, options, query = {}) {
  const candidates = buildRequestBaseUrlCandidates(baseUrl);
  let lastNetworkError = null;

  for (const candidateBaseUrl of candidates) {
    try {
      return await requestJson(buildApiUrl(candidateBaseUrl, path), options, query);
    } catch (error) {
      if (!(error instanceof HttpError) || !error.isNetworkError) {
        throw error;
      }

      lastNetworkError = error;
    }
  }

  throw lastNetworkError ?? new HttpError(502, 'The remote Ghostfolio instance is not reachable.');
}

function appendQuery(url, query) {
  const requestUrl = new URL(url);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    requestUrl.searchParams.set(key, String(value));
  }

  return requestUrl.toString();
}

function buildApiUrl(baseUrl, path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function buildRequestBaseUrlCandidates(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const candidates = [normalizedBaseUrl];
  const parsedUrl = new URL(normalizedBaseUrl);

  if (
    parsedUrl.hostname === 'localhost' ||
    parsedUrl.hostname === '127.0.0.1' ||
    parsedUrl.hostname === '::1' ||
    parsedUrl.hostname === '[::1]'
  ) {
    const dockerHostUrl = new URL(normalizedBaseUrl);
    dockerHostUrl.hostname = 'host.docker.internal';
    candidates.push(dockerHostUrl.toString().replace(/\/$/, ''));
  }

  return [...new Set(candidates)];
}

function getGhostfolioCaPath() {
  return process.env.GHOSTFOLIO_CA_CERT_PATH?.trim() || '/data/ca.crt';
}

function loadGhostfolioCaCertificate(caPath) {
  try {
    return fs.readFileSync(caPath);
  } catch {
    return null;
  }
}

function isTlsVerificationError(error) {
  const code = error?.code;

  return (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_SIGNATURE_FAILURE' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID'
  );
}

function sendRequest(url, options) {
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        agent: url.protocol === 'https:' ? ghostfolioHttpsAgent ?? undefined : undefined,
        headers: options.headers,
        method: options.method ?? 'GET'
      },
      (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            statusCode: response.statusCode ?? 0
          });
        });
      }
    );

    request.on('error', reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

function readHeaderValue(headerValue) {
  return Array.isArray(headerValue) ? headerValue.join(', ') : headerValue ?? '';
}

function parseJsonSafely(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
