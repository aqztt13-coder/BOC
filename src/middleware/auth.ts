import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { count, eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifySessionToken } from '../lib/authCrypto.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { getPermissionsForRole, hasPermission } from '../utils/permissions.ts';
import type { Permission, UserRole } from '../types/hrms.ts';

const INITIAL_OWNER_EMAIL = 'ddzek258@gmail.com';

export interface DbAuthUser {
  id: number;
  uid: string;
  employeeCode: string | null;
  email: string;
  displayName: string;
  photoUrl: string | null;
  role: UserRole;
  department: string;
  oilfield: string;
  employeeId: number | null;
  isActive: boolean;
  mustResetPassword?: boolean;
}

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  dbUser?: DbAuthUser;
  permissions?: Permission[];
}

function toSafeAuthUser(row: typeof users.$inferSelect): DbAuthUser {
  return {
    id: row.id,
    uid: row.uid,
    employeeCode: row.employeeCode,
    email: row.email,
    displayName: row.displayName,
    photoUrl: row.photoUrl,
    role: row.role as UserRole,
    department: row.department,
    oilfield: row.oilfield,
    employeeId: row.employeeId,
    isActive: row.isActive,
    mustResetPassword: row.mustResetPassword,
  };
}

async function getOrCreateFirebaseUser(decoded: DecodedIdToken): Promise<DbAuthUser> {
  const uid = decoded.uid;
  const email = (decoded.email || `${uid}@boc.oil.gov.iq`).toLowerCase();
  const displayName = decoded.name || email.split('@')[0];
  const photoUrl = decoded.picture || null;

  try {
    const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      if (row.email !== email || row.displayName !== displayName || row.photoUrl !== photoUrl) {
        const updated = await db
          .update(users)
          .set({ email, displayName, photoUrl, updatedAt: new Date() })
          .where(eq(users.uid, uid))
          .returning();
        return toSafeAuthUser(updated[0]);
      }
      return toSafeAuthUser(row);
    }

    const [{ value: userCount }] = await db.select({ value: count() }).from(users);
    const defaultRole: UserRole =
      Number(userCount) === 0 || email === INITIAL_OWNER_EMAIL ? 'HR_ADMIN' : 'EMPLOYEE';

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName,
        photoUrl,
        role: defaultRole,
        department: defaultRole === 'HR_ADMIN' ? 'قسم الموارد البشرية' : '',
        oilfield: defaultRole === 'HR_ADMIN' ? 'المقر العام - البصرة' : '',
        isActive: true,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email, displayName, photoUrl, updatedAt: new Date() },
      })
      .returning();

    return toSafeAuthUser(inserted[0]);
  } catch (error) {
    console.error('Failed to sync authenticated user with PostgreSQL:', error);
    throw new Error('تعذّر التحقق من حساب المستخدم في قاعدة البيانات.', { cause: error });
  }
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: يرجى تسجيل الدخول أولاً.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح: رمز المصادقة مفقود.' });
  }

  // 1. Server-signed Employee ID session token (boc1.*)
  if (token.startsWith('boc1.')) {
    const payload = verifySessionToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'انتهت جلسة الدخول أو الرمز غير صالح. يرجى تسجيل الدخول مجدداً.' });
    }
    try {
      const [row] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
      if (!row || !row.isActive || row.tokenVersion !== payload.tv) {
        return res.status(401).json({ error: 'تم إنهاء الجلسة أو تعطيل الحساب.' });
      }
      if (row.mustResetPassword) {
        return res.status(403).json({ error: 'يرجى إتمام تعيين كلمة المرور الشخصية عبر البريد الإلكتروني أولاً.' });
      }
      req.dbUser = toSafeAuthUser(row);
      req.permissions = getPermissionsForRole(row.role);
      return next();
    } catch (error) {
      console.error('Session lookup error:', error);
      return res.status(500).json({ error: 'تعذر التحقق من الجلسة في قاعدة البيانات.' });
    }
  }

  // 2. Firebase Auth ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const dbUser = await getOrCreateFirebaseUser(decoded);
    if (!dbUser.isActive) {
      return res.status(403).json({ error: 'تم تعطيل هذا الحساب من قبل مدير النظام.' });
    }
    req.firebaseUser = decoded;
    req.dbUser = dbUser;
    req.permissions = getPermissionsForRole(dbUser.role);
    return next();
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(401).json({ error: 'انتهت جلسة الدخول أو الرمز غير صالح.' });
  }
};

export const requirePermission = (permission: Permission) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.dbUser?.role;
    if (!role || !hasPermission(role, permission)) {
      return res.status(403).json({
        error: 'ليست لديك الصلاحية الكافية لتنفيذ هذا الإجراء.',
        requiredPermission: permission,
      });
    }
    next();
  };
};
