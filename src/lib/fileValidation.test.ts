import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMimeFromMagicBytes,
  MAX_UPLOAD_BYTES,
  resolveSafePrivateDocumentPath,
  validateBase64DocumentUpload,
} from './fileValidation.ts';

test('validates real PDF and PNG magic bytes and computes SHA-256 hash', () => {
  const pdfBuf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const res = validateBase64DocumentUpload(pdfBuf.toString('base64'), 'application/pdf', '../../secret/order.pdf');
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.mimeType, 'application/pdf');
    assert.equal(res.data.extension, '.pdf');
    assert.equal(res.data.sanitizedFileName, 'order.pdf');
    assert.equal(res.data.sha256Hash.length, 64);
  }

  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  assert.equal(detectMimeFromMagicBytes(pngBuf), 'image/png');
  const pngRes = validateBase64DocumentUpload(pngBuf.toString('base64'), 'image/png', 'scan.png');
  assert.equal(pngRes.ok, true);
});

test('rejects spoofed MIME types, SVG/HTML scripts, and oversized uploads', () => {
  const htmlScript = Buffer.from('<html><script>alert(1)</script></html>');
  const spoofedPdf = validateBase64DocumentUpload(htmlScript.toString('base64'), 'application/pdf', 'evil.pdf');
  assert.equal(spoofedPdf.ok, false);

  const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgRes = validateBase64DocumentUpload(svgPayload.toString('base64'), 'image/svg+xml', 'icon.svg');
  assert.equal(svgRes.ok, false);

  // Valid PNG bytes declared as PDF must fail mismatch check
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const mismatch = validateBase64DocumentUpload(pngBuf.toString('base64'), 'application/pdf', 'fake.pdf');
  assert.equal(mismatch.ok, false);

  // Exceeding 4MB binary size must fail
  const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 128, 0x41);
  oversized.write('%PDF-1.7', 0);
  const tooBig = validateBase64DocumentUpload(oversized.toString('base64'), 'application/pdf', 'huge.pdf');
  assert.equal(tooBig.ok, false);
});

test('resolveSafePrivateDocumentPath blocks path traversal attempts', () => {
  assert.throws(() => resolveSafePrivateDocumentPath('../.env'));
  assert.throws(() => resolveSafePrivateDocumentPath('../../etc/passwd'));
  assert.throws(() => resolveSafePrivateDocumentPath('sub/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf'));

  const validKey = '12345678-1234-1234-1234-123456789abc.pdf';
  const safePath = resolveSafePrivateDocumentPath(validKey);
  assert.ok(safePath.endsWith(validKey));
});
