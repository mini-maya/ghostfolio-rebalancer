import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createAccountStore } from './lib/account-store.mjs';
import { ConfigurationError, HttpError } from './lib/errors.mjs';
import {
  authenticate,
  fetchActivities,
  fetchHoldings,
  normalizeBaseUrl
} from './lib/ghostfolio-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(__dirname, '../dist/ghostfolio-rebalancer/browser');
const sessions = new Map();
const sessionCookieName = 'ghostfolio-rebalancer-session';
const port = Number(process.env.PORT || 3000);
const accountsDirectory = process.env.ACCOUNTS_DIR?.trim()
  ? path.resolve(process.env.ACCOUNTS_DIR)
  : path.resolve(__dirname, '../data');
const accountStore = createAccountStore({
  accountsFilePath: path.join(accountsDirectory, 'accounts.csv'),
  encryptionKey: process.env.ACCOUNT_ENCRYPTION_KEY ?? ''
});

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.get('/api/runtime-config', async (_request, response, next) => {
  try {
    const hasStoredAccounts = await accountStore.hasAccounts();
    const baseUrl = process.env.BASE_URL ?? '';
    const accessToken = hasStoredAccounts ? '' : process.env.ACCESS_TOKEN ?? '';
    const allocationsText = process.env.ALLOCATIONS_TEXT ?? '';

    response.json({
      accessToken,
      allocationsText,
      baseUrl,
      hasInjectedDefaults: Boolean(baseUrl || accessToken || allocationsText),
      hasStoredAccounts
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/session', async (request, response, next) => {
  try {
    const session = await getSession(request);

    response.json(
      session
        ? {
            allocationsText: session.allocationsText ?? '',
            authMode: session.mode ?? '',
            authenticated: true,
            baseUrl: session.baseUrl,
            loginSource: session.loginSource ?? '',
            user: session.user ?? ''
          }
        : {
            allocationsText: '',
            authMode: '',
            authenticated: false,
            baseUrl: '',
            loginSource: '',
            user: ''
          }
    );
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/access-token-login', async (request, response, next) => {
  try {
    const { accessToken, baseUrl } = readTokenPayload(request.body);
    const authentication = await authenticate(baseUrl, accessToken);
    const session = {
      accessToken,
      allocationsText: '',
      baseUrl: authentication.baseUrl,
      bearerToken: authentication.authToken,
      loginSource: readLoginSource(request.body?.source),
      mode: 'token',
      user: ''
    };

    issueSession(response, session);
    response.json(buildSessionResponse(session));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/prepare-account', async (request, response, next) => {
  try {
    const { accessToken, baseUrl } = readTokenPayload(request.body);
    const user = readRequiredField(request.body?.user, 'Please enter a local user name.');
    readRequiredField(request.body?.password, 'Please enter a local password.');
    await assertUserDoesNotExist(user);
    const authentication = await authenticate(baseUrl, accessToken);

    response.json({
      baseUrl: authentication.baseUrl,
      message:
        'Ghostfolio authentication succeeded. Confirm the password to create the local account.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', async (request, response, next) => {
  try {
    const { accessToken, baseUrl } = readTokenPayload(request.body);
    const password = readRequiredField(request.body?.password, 'Please enter a local password.');
    const passwordConfirmation = readRequiredField(
      request.body?.passwordConfirmation,
      'Please confirm the local password.'
    );
    const user = readRequiredField(request.body?.user, 'Please enter a local user name.');

    if (password !== passwordConfirmation) {
      throw new HttpError(400, 'The password confirmation does not match.');
    }

    await assertUserDoesNotExist(user);
    const authentication = await authenticate(baseUrl, accessToken);

    await accountStore.createAccount({
      accessToken,
      allocationsText: '',
      baseUrl: authentication.baseUrl,
      bearerToken: authentication.authToken,
      password,
      user
    });

    const session = {
      allocationsText: '',
      baseUrl: authentication.baseUrl,
      mode: 'account',
      user
    };

    issueSession(response, session);
    response.json(buildSessionResponse(session));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/user-login', async (request, response, next) => {
  try {
    const password = readRequiredField(request.body?.password, 'Please enter the local password.');
    const user = readRequiredField(request.body?.user, 'Please enter the local user name.');
    const account = await accountStore.verifyAccount(user, password);

    if (!account) {
      throw new HttpError(401, 'The local user name or password is incorrect.');
    }

    const session = {
      allocationsText: account.allocationsText,
      baseUrl: account.baseUrl,
      mode: 'account',
      user: account.user
    };

    issueSession(response, session);
    response.json(buildSessionResponse(session));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    destroySession(request);
    clearSessionCookie(response);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.put('/api/account/allocations-text', async (request, response, next) => {
  try {
    const sessionId = getSessionIdFromCookie(request.headers.cookie ?? '');
    const session = sessionId ? sessions.get(sessionId) : null;

    if (!session || session.mode !== 'account' || !session.user) {
      throw new HttpError(403, 'Saving target allocations is only available for stored accounts.');
    }

    const allocationsText = readAllocationsText(request.body?.allocationsText);

    await accountStore.updateAllocationsText(session.user, allocationsText);
    session.allocationsText = allocationsText;

    response.json({ allocationsText });
  } catch (error) {
    next(error);
  }
});

app.get('/api/ghostfolio/holdings', async (request, response, next) => {
  try {
    const payload = await withActiveGhostfolioSession(request, async ({ baseUrl, bearerToken }) => {
      return fetchHoldings(baseUrl, bearerToken);
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get('/api/ghostfolio/activities', async (request, response, next) => {
  try {
    const payload = await withActiveGhostfolioSession(request, async ({ baseUrl, bearerToken }) => {
      return fetchActivities(baseUrl, bearerToken);
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get('/api/ghostfolio/direct-login-url', async (request, response, next) => {
  try {
    const language = sanitizeLanguage(request.query.language);
    const payload = await withActiveGhostfolioSession(request, async ({ baseUrl, bearerToken }) => {
      await fetchHoldings(baseUrl, bearerToken);

      return {
        baseUrl,
        bearerToken
      };
    });

    response.json({
      url: new URL(
        `${language}/auth/${encodeURIComponent(payload.bearerToken)}`,
        `${payload.baseUrl}/`
      ).toString()
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(distDirectory, { index: false }));

app.get('*', (request, response, next) => {
  if (request.path.startsWith('/api/')) {
    next(new HttpError(404, 'The requested API endpoint does not exist.'));
    return;
  }

  response.sendFile(path.join(distDirectory, 'index.html'), (error) => {
    if (error) {
      next(
        new HttpError(
          500,
          'The Angular build output is missing. Run "npm run build" before starting the server.'
        )
      );
    }
  });
});

app.use((error, _request, response, _next) => {
  if (error instanceof ConfigurationError) {
    response.status(500).json({ message: error.message });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ message: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ message: 'An unexpected server error occurred.' });
});

app.listen(port, () => {
  console.log(`Ghostfolio Rebalancer server listening on port ${port}`);
});

async function assertUserDoesNotExist(user) {
  const existingAccount = await accountStore.getAccount(user).catch((error) => {
    if (error instanceof ConfigurationError) {
      throw error;
    }

    return null;
  });

  if (existingAccount) {
    throw new HttpError(409, 'A local account with this user name already exists.');
  }
}

function buildSessionResponse(session) {
  return {
    allocationsText: session.allocationsText ?? '',
    authMode: session.mode ?? '',
    authenticated: true,
    baseUrl: session.baseUrl,
    loginSource: session.loginSource ?? '',
    user: session.user ?? ''
  };
}

function clearSessionCookie(response) {
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax'
  });
}

function destroySession(request) {
  const sessionId = getSessionIdFromCookie(request.headers.cookie ?? '');

  if (!sessionId) {
    return;
  }

  sessions.delete(sessionId);
}

async function getGhostfolioContext(session) {
  if (session.mode === 'account') {
    const account = await accountStore.getAccount(session.user);

    if (!account) {
      throw new HttpError(401, 'The local account no longer exists.');
    }

    return account;
  }

  return session;
}

async function getSession(request) {
  const sessionId = getSessionIdFromCookie(request.headers.cookie ?? '');

  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  if (session.mode === 'account') {
    const account = await accountStore.getAccount(session.user);

    if (!account) {
      sessions.delete(sessionId);
      return null;
    }

    return {
      ...session,
      allocationsText: account.allocationsText,
      baseUrl: account.baseUrl
    };
  }

  return session;
}

function getSessionIdFromCookie(cookieHeader) {
  for (const cookie of cookieHeader.split(';')) {
    const [name = '', value = ''] = cookie.trim().split('=');

    if (name === sessionCookieName) {
      return value;
    }
  }

  return '';
}

function issueSession(response, session) {
  const sessionId = randomUUID();

  sessions.set(sessionId, session);
  response.cookie(sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax'
  });
}

function isAuthFailure(error) {
  return error instanceof HttpError && (error.status === 401 || error.status === 403);
}

function readRequiredField(value, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, message);
  }

  return value.trim();
}

function readLoginSource(value) {
  return value === 'env-default' ? 'env-default' : 'manual';
}

function readAllocationsText(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Target allocations must be provided as text.');
  }

  return value.trim();
}

function readTokenPayload(payload) {
  const accessToken = readRequiredField(
    payload?.accessToken,
    'Please enter the Ghostfolio account access token.'
  );
  const baseUrl = normalizeBaseUrl(
    readRequiredField(payload?.baseUrl, 'Please enter the Ghostfolio URL.')
  );

  return {
    accessToken,
    baseUrl
  };
}

function sanitizeLanguage(language) {
  if (typeof language !== 'string') {
    return 'en';
  }

  const match = language.trim().toLowerCase().match(/^[a-z]{2}/);

  return match?.[0] ?? 'en';
}

async function withActiveGhostfolioSession(request, action) {
  const sessionId = getSessionIdFromCookie(request.headers.cookie ?? '');

  if (!sessionId) {
    throw new HttpError(401, 'Please log in first.');
  }

  const session = sessions.get(sessionId);

  if (!session) {
    throw new HttpError(401, 'Please log in first.');
  }

  const ghostfolioContext = await getGhostfolioContext(session);

  if (ghostfolioContext.bearerToken) {
    try {
      return await action({
        baseUrl: ghostfolioContext.baseUrl,
        bearerToken: ghostfolioContext.bearerToken
      });
    } catch (error) {
      if (!isAuthFailure(error)) {
        throw error;
      }
    }
  }

  const authentication = await authenticate(
    ghostfolioContext.baseUrl,
    ghostfolioContext.accessToken
  );

  if (session.mode === 'account') {
    await accountStore.updateBearerToken(session.user, authentication.authToken);
  } else {
    session.bearerToken = authentication.authToken;
    session.baseUrl = authentication.baseUrl;
  }

  return action({
    baseUrl: authentication.baseUrl,
    bearerToken: authentication.authToken
  });
}
