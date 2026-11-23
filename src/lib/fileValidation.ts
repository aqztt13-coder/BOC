import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB decoded binary limit

export const ALLOWED_DOCUMENT_MIMES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export interface ValidatedFileUpload {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  sanitizedFileName: string;
  sizeBytes: number;
  humanSize: string;
  sha256Hash: string;
}

/**
 * Inspects actual binary file headers (magic bytes) to prevent spoofed MIME types,
 * disguised SVG/HTML/JS uploads, or corrupted payloads.
 */
export function detectMimeFromMagicBytes(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // PDF: %PDF-
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) {
    return 'application/pdf';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }

  // WebP: RIFF .... WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function sanitizeFileName(rawName: string, fallbackExt: string): string {
  const base = path.basename(String(rawName || 'document')).replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').trim();
  const clean = base.replace(/^\.+/, '').slice(0, 140) || `document${fallbackExt}`;
  return clean.toLowerCase().endsWith(fallbackExt) ? clean : `${clean}${fallbackExt}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function validateBase64DocumentUpload(
  base64Input: string,
  declaredMimeType: string,
  rawFileName: string
): { ok: true; data: ValidatedFileUpload } | { ok: false; error: string } {
  const normalizedDeclared = String(declaredMimeType || '').trim().toLowerCase();
  if (!(normalizedDeclared in ALLOWED_DOCUMENT_MIMES)) {
    return {
      ok: false,
      error: 'نوع الملف غير مسموح به. الأنواع المسموحة فقط: PDF وPNG وJPEG وWebP.',
    };
  }

  const stripped = String(base64Input || '')
    .trim()
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '');

  if (!stripped || stripped.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) {
    return { ok: false, error: 'محتوى الملف المرفوع غير صالح (Base64 غير سليم).' };
  }

  const buffer = Buffer.from(stripped, 'base64');
  if (buffer.length === 0) {
    return { ok: false, error: 'الملف المرفوع فارغ.' };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'حجم الملف يتجاوز الحد الأقصى المسموح به (4 ميغابايت).' };
  }

  const detectedMime = detectMimeFromMagicBytes(buffer);
  if (!detectedMime) {
    return {
      ok: false,
      error: 'توقيع محتوى الملف (Magic Bytes) غير معترف به أو لا يطابق صيغة PDF/صورة معتمدة.',
    };
  }

  if (detectedMime !== normalizedDeclared) {
    return {
      ok: false,
      error: `عدم تطابق نوع الملف الفعلي (${detectedMime}) مع النوع المعلن (${normalizedDeclared}).`,
    };
  }

  const extension = ALLOWED_DOCUMENT_MIMES[detectedMime];
  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    ok: true,
    data: {
      buffer,
      mimeType: detectedMime,
      extension,
      sanitizedFileName: sanitizeFileName(rawFileName, extension),
      sizeBytes: buffer.length,
      humanSize: formatBytes(buffer.length),
      sha256Hash,
    },
  };
}

const PRIVATE_DOCS_DIR = path.resolve(process.cwd(), 'private_storage', 'documents');

export function resolveSafePrivateDocumentPath(storageKey: string): string {
  if (!/^[a-f0-9-]{16,80}\.(pdf|png|jpg|webp)$/i.test(storageKey)) {
    throw new Error('مفتاح تخزين الوثيقة غير صالح.');
  }
  const resolved = path.resolve(PRIVATE_DOCS_DIR, storageKey);
  if (!resolved.startsWith(PRIVATE_DOCS_DIR + path.sep)) {
    throw new Error('تم حظر محاولة وصول خارج دليل التخزين الخاص.');
  }
  return resolved;
}

export async function savePrivateDocumentFile(
  buffer: Buffer,
  extension: string
): Promise<string> {
  await fs.mkdir(PRIVATE_DOCS_DIR, { recursive: true, mode: 0o700 });
  const key = `${crypto.randomUUID()}${extension}`;
  const targetPath = resolveSafePrivateDocumentPath(key);
  await fs.writeFile(targetPath, buffer, { mode: 0o600 });
  return key;
}

export async function readPrivateDocumentBase64(storageKey: string): Promise<string | null> {
  try {
    const targetPath = resolveSafePrivateDocumentPath(storageKey);
    const data = await fs.readFile(targetPath);
    return data.toString('base64');
  } catch {
    return null;
  }
}

export async function deletePrivateDocumentFile(storageKey: string): Promise<void> {
  try {
    const targetPath = resolveSafePrivateDocumentPath(storageKey);
    await fs.unlink(targetPath);
  } catch {
    // ignore missing file on cleanup
  }
}
