import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOtpCode,
  hashOtp,
  hashPassword,
  maskEmail,
  signSessionToken,
  verifyOtpHash,
  verifyPassword,
  verifySessionToken,
} from './authCrypto.ts';

test('scrypt password hashing verifies matching password and rejects wrong password', () => {
  const hash1 = hashPassword('Boc@2026Secure');
  const hash2 = hashPassword('Boc@2026Secure');
  assert.notEqual(hash1, hash2, 'unique random salt per hash');
  assert.equal(verifyPassword('Boc@2026Secure', hash1), true);
  assert.equal(verifyPassword('WrongPass123', hash1), false);
  assert.equal(verifyPassword('Boc@2026Secure', null), false);
});

test('OTP generation and HMAC verification work for exact employee code only', () => {
  const otp = generateOtpCode();
  assert.match(otp, /^\d{6}$/);
  const digest = hashOtp(otp, 'BOC-2041');
  assert.equal(verifyOtpHash(otp, 'boc-2041', digest), true);
  assert.equal(verifyOtpHash(otp, 'BOC-9999', digest), false);
  assert.equal(verifyOtpHash('000000', 'BOC-2041', digest), false);
});

test('signed session token verifies valid payload, rejects tampering and expiry', () => {
  const token = signSessionToken({ sub: 42, uid: 'boc-42', role: 'HR_ADMIN', tv: 1 }, 120);
  const decoded = verifySessionToken(token);
  assert.ok(decoded);
  assert.equal(decoded.sub, 42);
  assert.equal(decoded.role, 'HR_ADMIN');

  // Tampered token fails verification
  const tampered = token.slice(0, -4) + 'AAAA';
  assert.equal(verifySessionToken(tampered), null);

  // Expired token fails verification
  const expired = signSessionToken({ sub: 42, uid: 'boc-42', role: 'EMPLOYEE', tv: 1 }, -10);
  assert.equal(verifySessionToken(expired), null);
});

test('maskEmail hides local characters while keeping domain clear', () => {
  assert.equal(maskEmail('karrar.h@boc.oil.gov.iq'), 'ka*****@boc.oil.gov.iq');
  assert.equal(maskEmail('a@boc.oil.gov.iq'), 'a@boc.oil.gov.iq');
});
