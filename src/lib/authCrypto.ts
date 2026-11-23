import crypto from 'node:crypto';

// Read server-side secret from process.env with a secure in-memory random fallback
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const TOKEN_PREFIX = 'boc1';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export interface SessionTokenPayload {
  sub: number; // users.id
  uid: string;
  role: string;
  tv: number; // tokenVersion
  exp: number; // unix seconds
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}

export function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashOtp(otp: string, employeeCode: string): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${employeeCode.toUpperCase()}:${otp}`)
    .digest('hex');
}

export function verifyOtpHash(otp: string, employeeCode: string, storedHash: string): boolean {
  try {
    const expected = Buffer.from(storedHash, 'hex');
    const actual = Buffer.from(hashOtp(otp, employeeCode), 'hex');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function signSessionToken(
  input: Omit<SessionTokenPayload, 'exp'>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const payload: SessionTokenPayload = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${TOKEN_PREFIX}.${payloadB64}`)
    .digest('base64url');
  return `${TOKEN_PREFIX}.${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  if (!token || !token.startsWith(`${TOKEN_PREFIX}.`)) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, payloadB64, sigB64] = parts;
  if (prefix !== TOKEN_PREFIX || !payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${prefix}.${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!parsed || typeof parsed.sub !== 'number' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@boc.oil.gov.iq';
  const visible = local.length <= 2 ? local[0] || '*' : `${local.slice(0, 2)}${'*'.repeat(Math.min(5, local.length - 2))}`;
  return `${visible}@${domain}`;
}
