import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { checkDatabaseReadiness, db } from './src/db/index.ts';
import { appreciations, documents, employees, transactions } from './src/db/schema.ts';
import { authRouter } from './src/server/authRoutes.ts';
import { apiRouter } from './src/server/routes.ts';
import { formatBaghdadDateTime } from './src/utils/hrEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distIndexPath = path.resolve(__dirname, 'dist', 'index.html');
const isRunningUnderTsx = process.execArgv.some((arg) => arg.includes('tsx'));
const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.npm_lifecycle_event === 'start' ||
  (process.env.NODE_ENV !== 'development' &&
    process.env.npm_lifecycle_event !== 'dev' &&
    !isRunningUnderTsx &&
    fs.existsSync(distIndexPath));
const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers via Helmet (frameguard disabled for AI Studio iframe embedding)
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", 'https://apis.google.com'],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
              imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
              connectSrc: [
                "'self'",
                'https://*.googleapis.com',
                'https://*.firebaseapp.com',
                'https://identitytoolkit.googleapis.com',
                'https://securetoken.googleapis.com',
              ],
              frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // Strict payload limit (supports up to 4MB base64 PDF/image document uploads safely)
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));

  // Rate limiting for sensitive authentication & QR verification endpoints
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'تم تجاوز عدد محاولات المصادقة المسموح بها. يرجى الانتظار قليلاً والمحاولة مجدداً.' },
  });

  const verifyRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'تم تجاوز الحد المسموح لطلبات التحقق من الوثائق.' },
  });

  const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'تم تجاوز معدل الطلبات المسموح به. يرجى المحاولة بعد قليل.' },
  });

  // Real database readiness health probe (non-sensitive)
  app.get('/api/health', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const dbCheck = await checkDatabaseReadiness();
    const statusCode = dbCheck.ready ? 200 : 503;
    res.status(statusCode).json({
      ok: dbCheck.ready,
      service: 'boc-hrms',
      database: dbCheck.ready ? 'ready' : 'unavailable',
      latencyMs: dbCheck.latencyMs,
      baghdadTime: formatBaghdadDateTime(new Date()),
    });
  });

  // Public Server-Side QR Verification Endpoint (returns strictly non-sensitive verification metadata)
  app.get('/api/verify/:code', verifyRateLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code || code.length < 4 || code.length > 80 || !/^[A-Z0-9-]+$/.test(code)) {
      return res.status(400).json({ verified: false, error: 'صيغة رمز التحقق غير صالحة.' });
    }

    const legalNotice =
      'نتيجة تحقق إلكتروني من سجل النظام الداخلي لشركة نفط البصرة فقط؛ لا تُعد هذه الوثيقة مصدّقة بتوقيع رقمي قانوني ما لم تكن مختومة وموقّعة وفق الأصول الإدارية المعتمدة.';

    try {
      // 1. Check Appreciation Letters
      const [appRec] = await db
        .select({
          letterNumber: appreciations.letterNumber,
          issueDate: appreciations.issueDate,
          issuingAuthority: appreciations.issuingAuthority,
          verificationCode: appreciations.verificationCode,
          employeeId: appreciations.employeeId,
        })
        .from(appreciations)
        .where(and(eq(appreciations.verificationCode, code), isNull(appreciations.deletedAt)))
        .limit(1);

      if (appRec) {
        const [emp] = await db
          .select({ fullName: employees.fullName, employeeCode: employees.employeeCode, department: employees.department })
          .from(employees)
          .where(eq(employees.id, appRec.employeeId))
          .limit(1);

        return res.json({
          verified: true,
          recordType: 'APPRECIATION',
          verificationCode: appRec.verificationCode,
          referenceNumber: appRec.letterNumber,
          title: 'كتاب شكر وتقدير مسجل في النظام',
          issuingAuthority: appRec.issuingAuthority,
          issueDate: appRec.issueDate,
          status: 'مسجل ومطابق في قاعدة البيانات',
          employeeName: emp?.fullName || null,
          employeeCode: emp?.employeeCode || null,
          department: emp?.department || null,
          verifiedAtBaghdad: formatBaghdadDateTime(new Date()),
          legalNotice,
        });
      }

      // 2. Check Digital Documents (exclude confidential/HR_ONLY details)
      const [docRec] = await db
        .select({
          documentNumber: documents.documentNumber,
          title: documents.title,
          category: documents.category,
          issueDate: documents.issueDate,
          issuingAuthority: documents.issuingAuthority,
          archiveStatus: documents.archiveStatus,
          confidentialityLevel: documents.confidentialityLevel,
          verificationCode: documents.verificationCode,
          sha256Hash: documents.sha256Hash,
        })
        .from(documents)
        .where(and(eq(documents.verificationCode, code), isNull(documents.deletedAt)))
        .limit(1);

      if (docRec) {
        const isRestricted =
          docRec.confidentialityLevel === 'CONFIDENTIAL' || docRec.confidentialityLevel === 'HR_ONLY';
        return res.json({
          verified: true,
          recordType: 'DOCUMENT',
          verificationCode: docRec.verificationCode,
          referenceNumber: docRec.documentNumber,
          title: isRestricted ? 'وثيقة إدارية مقيدة (التفاصيل محمية)' : docRec.title,
          category: isRestricted ? 'مقيد' : docRec.category,
          issuingAuthority: docRec.issuingAuthority,
          issueDate: docRec.issueDate,
          status: docRec.archiveStatus,
          sha256Prefix: docRec.sha256Hash ? docRec.sha256Hash.slice(0, 16) : null,
          verifiedAtBaghdad: formatBaghdadDateTime(new Date()),
          legalNotice,
        });
      }

      // 3. Check Transactions (BOC-TXN-<transactionNumber> or raw transactionNumber)
      const txnLookup = code.startsWith('BOC-TXN-') ? code.slice('BOC-TXN-'.length) : code;
      const [txnRec] = await db
        .select({
          transactionNumber: transactions.transactionNumber,
          transactionType: transactions.transactionType,
          status: transactions.status,
          department: transactions.department,
          completedAt: transactions.completedAt,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(eq(transactions.transactionNumber, txnLookup))
        .limit(1);

      if (txnRec) {
        return res.json({
          verified: true,
          recordType: 'TRANSACTION',
          verificationCode: `BOC-TXN-${txnRec.transactionNumber}`,
          referenceNumber: txnRec.transactionNumber,
          title: `معاملة إدارية (${txnRec.transactionType})`,
          issuingAuthority: 'قسم الموارد البشرية - شركة نفط البصرة',
          issueDate: (txnRec.completedAt || txnRec.createdAt).toISOString().slice(0, 10),
          status: txnRec.status,
          department: txnRec.department,
          verifiedAtBaghdad: formatBaghdadDateTime(new Date()),
          legalNotice,
        });
      }

      return res.status(404).json({
        verified: false,
        error: 'لم يتم العثور على سجل مطابق لرمز التحقق المدخل في قاعدة بيانات شركة نفط البصرة.',
      });
    } catch (error) {
      console.error('QR verification lookup failed:', error);
      return res.status(500).json({ verified: false, error: 'تعذر إتمام التحقق من الخادم حالياً.' });
    }
  });

  // Employee ID Authentication & Email OTP Reset routes (rate-limited)
  app.use('/api/auth', authRateLimiter, authRouter);

  // Protected Enterprise HR API routes (rate-limited)
  app.use('/api', apiRateLimiter, apiRouter);

  // Explicit JSON 404 for unknown /api/* routes so they never fall through to SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'نقطة النهاية المطلوبة غير موجودة على الخادم.' });
  });

  const httpServer = http.createServer(app);

  if (isProduction && fs.existsSync(distIndexPath)) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Global safe error handler (never expose stack traces or raw SQL errors)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled Express error:', err);
    if (res.headersSent) return;
    const status =
      typeof (err as { status?: number })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
    const message =
      status === 413
        ? 'حجم البيانات المرسلة يتجاوز الحد الأقصى المسموح به.'
        : status >= 400 && status < 500
          ? 'طلب غير صالح.'
          : 'حدث خطأ داخلي في الخادم. يرجى المحاولة لاحقاً.';
    res.status(status).json({ error: message });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`BOC Enterprise HRMS server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
