import { HttpError } from './errors.mjs';

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
    response = await fetch(requestUrl, options);
  } catch {
    throw new HttpError(
      502,
      'The remote Ghostfolio instance is not reachable.',
      { isNetworkError: true }
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const responseBody = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(
        response.status,
        'Authentication against the remote Ghostfolio instance failed.'
      );
    }

    throw new HttpError(
      502,
      `The remote Ghostfolio request failed with status ${response.status}.`
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
