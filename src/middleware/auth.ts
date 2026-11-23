import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifySessionToken } from '../lib/authCrypto.ts';
import { db } from '../db/index.ts';
import { employees, users } from '../db/schema.ts';
import { getPermissionsForRole, hasPermission } from '../utils/permissions.ts';
import type { Permission, UserRole } from '../types/hrms.ts';

export interface DbAuthUser {
  id: number;
  uid: string;
  employeeCode: string | null;
  email: string;
  displayName: string;
  photoUrl: string | null;
  role: UserRole;
  department: string;
  section: string;
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

function getExplicitBootstrapAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_BOOTSTRAP_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes('@'))
  );
}

export function toSafeAuthUser(row: typeof users.$inferSelect): DbAuthUser {
  return {
    id: row.id,
    uid: row.uid,
    employeeCode: row.employeeCode,
    email: row.email,
    displayName: row.displayName,
    photoUrl: row.photoUrl,
    role: row.role as UserRole,
    department: row.department,
    section: row.section || '',
    oilfield: row.oilfield,
    employeeId: row.employeeId,
    isActive: row.isActive,
    mustResetPassword: row.mustResetPassword,
  };
}

/**
 * Resolves an authenticated Firebase user against PostgreSQL WITHOUT:
 * - Hardcoded administrator emails in source code
 * - Automatic HR_ADMIN privilege escalation for the first registered user
 * - Unauthorized open self-registration of unlinked external accounts
 */
async function resolveAuthorizedFirebaseUser(decoded: DecodedIdToken): Promise<DbAuthUser | null> {
  const uid = decoded.uid;
  const email = (decoded.email || '').trim().toLowerCase();
  const displayName = decoded.name || (email ? email.split('@')[0] : uid);
  const photoUrl = decoded.picture || null;

  // 1. Existing user matched by Firebase UID (preserves all existing admin & staff accounts)
  const existingByUid = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
  if (existingByUid.length > 0) {
    const row = existingByUid[0];
    if (
      (email && row.email !== email) ||
      (displayName && row.displayName !== displayName) ||
      row.photoUrl !== photoUrl
    ) {
      const [updated] = await db
        .update(users)
        .set({
          email: email || row.email,
          displayName: displayName || row.displayName,
          photoUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.id))
        .returning();
      return toSafeAuthUser(updated);
    }
    return toSafeAuthUser(row);
  }

  // 2. Existing pre-provisioned user matched by verified email (link Firebase UID safely without elevating role)
  if (email && decoded.email_verified !== false) {
    const existingByEmail = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existingByEmail.length > 0) {
      const row = existingByEmail[0];
      const [updated] = await db
        .update(users)
        .set({
          displayName: row.displayName || displayName,
          photoUrl: photoUrl || row.photoUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.id))
        .returning();
      return toSafeAuthUser(updated);
    }

    // 3. Explicit server-side environment bootstrap admin allowlist (never hardcoded)
    const bootstrapAdmins = getExplicitBootstrapAdminEmails();
    if (bootstrapAdmins.has(email)) {
      const [inserted] = await db
        .insert(users)
        .values({
          uid,
          email,
          displayName,
          photoUrl,
          role: 'HR_ADMIN',
          department: 'قسم الموارد البشرية',
          section: '',
          oilfield: 'المقر العام - البصرة',
          isActive: true,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return toSafeAuthUser(inserted);
    }

    // 4. Verified employee email already registered by HR -> create ONLY least-privilege EMPLOYEE linked to own record
    const [matchedEmp] = await db
      .select()
      .from(employees)
      .where(and(sql`lower(${employees.email}) = ${email}`, isNull(employees.deletedAt)))
      .limit(1);

    if (matchedEmp) {
      const [inserted] = await db
        .insert(users)
        .values({
          uid,
          employeeCode: matchedEmp.employeeCode,
          email,
          displayName: matchedEmp.fullName,
          photoUrl,
          role: 'EMPLOYEE',
          department: matchedEmp.department,
          section: matchedEmp.section || '',
          oilfield: matchedEmp.oilfield,
          employeeId: matchedEmp.id,
          isActive: true,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return toSafeAuthUser(inserted);
    }
  }

  // Reject unprovisioned external accounts (prevents unauthorized account creation)
  return null;
}

export async function authenticateBearerToken(token: string): Promise<
  | { ok: true; dbUser: DbAuthUser; firebaseUser?: DecodedIdToken }
  | { ok: false; status: number; error: string }
> {
  // 1. Server-signed Employee ID session token (boc1.*)
  if (token.startsWith('boc1.')) {
    const payload = verifySessionToken(token);
    if (!payload) {
      return {
        ok: false,
        status: 401,
        error: 'انتهت جلسة الدخول أو الرمز غير صالح. يرجى تسجيل الدخول مجدداً.',
      };
    }
    const [row] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!row || !row.isActive || row.tokenVersion !== payload.tv) {
      return { ok: false, status: 401, error: 'تم إنهاء الجلسة أو تعطيل الحساب.' };
    }
    if (row.mustResetPassword) {
      return {
        ok: false,
        status: 403,
        error: 'يرجى إتمام تعيين كلمة المرور الشخصية عبر البريد الإلكتروني أولاً.',
      };
    }
    return { ok: true, dbUser: toSafeAuthUser(row) };
  }

  // 2. Firebase Auth ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const dbUser = await resolveAuthorizedFirebaseUser(decoded);
    if (!dbUser) {
      return {
        ok: false,
        status: 403,
        error: 'هذا الحساب غير مفعّل لدى قسم الموارد البشرية. يرجى مراجعة مدير النظام لتجهيز حسابك.',
      };
    }
    if (!dbUser.isActive) {
      return { ok: false, status: 403, error: 'تم تعطيل هذا الحساب من قبل مدير النظام.' };
    }
    return { ok: true, dbUser, firebaseUser: decoded };
  } catch (error) {
    console.error('Auth verification error:', error);
    return { ok: false, status: 401, error: 'انتهت جلسة الدخول أو الرمز غير صالح.' };
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
    const result = await authenticateBearerToken(token);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    req.dbUser = result.dbUser;
    req.firebaseUser = result.firebaseUser;
    req.permissions = getPermissionsForRole(result.dbUser.role);
    return next();
  } catch (error) {
    console.error('Session lookup error:', error);
    return res.status(500).json({ error: 'تعذر التحقق من الجلسة في قاعدة البيانات.' });
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
