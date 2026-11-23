import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { count, eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { getPermissionsForRole, hasPermission } from '../utils/permissions.ts';
import type { Permission, UserRole } from '../types/hrms.ts';

const INITIAL_OWNER_EMAIL = 'ddzek258@gmail.com';

export interface DbAuthUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  role: UserRole;
  department: string;
  oilfield: string;
  employeeId: number | null;
  isActive: boolean;
}

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  dbUser?: DbAuthUser;
  permissions?: Permission[];
}

async function getOrCreateUser(decoded: DecodedIdToken): Promise<DbAuthUser> {
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
        return updated[0] as DbAuthUser;
      }
      return row as DbAuthUser;
    }

    // First user in an empty system or initial owner receives HR_ADMIN role
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

    return inserted[0] as DbAuthUser;
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

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const dbUser = await getOrCreateUser(decoded);
    if (!dbUser.isActive) {
      return res.status(403).json({ error: 'تم تعطيل هذا الحساب من قبل مدير النظام.' });
    }
    req.firebaseUser = decoded;
    req.dbUser = dbUser;
    req.permissions = getPermissionsForRole(dbUser.role);
    next();
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
