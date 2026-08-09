import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';

import { ConfigurationError } from './errors.mjs';

const ALGORITHM = 'aes-256-gcm';
const KEY_SIZE = 32;
const IV_SIZE = 12;
const SCRYPT_SIZE = 64;

export function encryptJson(value, encryptionKey) {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_SIZE);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

export function decryptJson(value, encryptionKey) {
  const key = deriveKey(encryptionKey);
  const [version, ivText, authTagText, encryptedText] = value.split(':');

  if (version !== 'v1' || !ivText || !authTagText || !encryptedText) {
    throw new ConfigurationError('The stored account data is malformed.');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivText, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTagText, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64')),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_SIZE);

  return {
    hash: hash.toString('base64'),
    salt: salt.toString('base64')
  };
}

export function verifyPassword(password, passwordHash, passwordSalt) {
  const expectedHash = Buffer.from(passwordHash, 'base64');
  const calculatedHash = scryptSync(
    password,
    Buffer.from(passwordSalt, 'base64'),
    expectedHash.length || SCRYPT_SIZE
  );

  return timingSafeEqual(calculatedHash, expectedHash);
}

function deriveKey(encryptionKey) {
  if (!encryptionKey?.trim()) {
    throw new ConfigurationError(
      'ACCOUNT_ENCRYPTION_KEY must be set to use stored accounts.'
    );
  }

  return createHash('sha256').update(encryptionKey).digest().subarray(0, KEY_SIZE);
}
