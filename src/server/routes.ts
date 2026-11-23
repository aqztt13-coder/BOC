import { Router } from 'express';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  appreciations,
  auditLogs,
  backupSnapshots,
  careerEvents,
  documents,
  employees,
  leaveRequests,
  notifications,
  penalties,
  trainingCourses,
  trainingEnrollments,
  transactions,
  users,
} from '../db/schema.ts';
import {
  addCareerEvent,
  createNotification,
  generateCode,
  getSystemConfig,
  sha256Hex,
  todayISO,
  translateDbError,
  upsertSystemSetting,
  writeAuditLog,
} from '../db/repository.ts';
import {
  requireAuth,
  requirePermission,
  type AuthRequest,
  type DbAuthUser,
} from '../middleware/auth.ts';
import { hasPermission } from '../utils/permissions.ts';
import {
  canAccessDocument,
  canAccessEmployee,
  canManageNotification,
  canProvisionAccountRole,
  isNotificationReadForUser,
  isPrivilegedHR,
  redactEmployeeForUser,
} from '../utils/accessControl.ts';
import { evaluateTransactionTransition } from '../utils/workflowStateMachine.ts';
import {
  calculateDateRangeDays,
  canRunOfficialHRCalculation,
  getPenaltyDelayMonths,
  hasOverlappingLeave,
  validateHRRulesConfig,
} from '../utils/hrEngine.ts';
import {
  deletePrivateDocumentFile,
  readPrivateDocumentBase64,
  savePrivateDocumentFile,
  validateBase64DocumentUpload,
} from '../lib/fileValidation.ts';
import { validateBackupBundle } from '../lib/backupSchema.ts';
import { hashPassword } from '../lib/authCrypto.ts';
import type { HRRulesConfig, TransactionHistoryStep } from '../types/hrms.ts';

export const apiRouter = Router();

// Never cache private HR API responses in browser or PWA caches
apiRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

apiRouter.use(requireAuth);

const ACTIVE_WORKFLOW_STATUSES = [
  'بانتظار موافقة القسم',
  'بانتظار موافقة الموارد البشرية',
  'معاد للتعديل',
];

async function getAuthorizedEmployees(user: DbAuthUser) {
  const all = await db
    .select()
    .from(employees)
    .where(isNull(employees.deletedAt))
    .orderBy(desc(employees.updatedAt));
  return all.filter((e) => canAccessEmployee(user, e));
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function handleRouteError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown, fallback: string) {
  const err = error as { status?: number; message?: string };
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.message) {
    return res.status(err.status).json({ error: err.message });
  }
  const mapped = translateDbError(error, fallback);
  return res.status(mapped.status).json({ error: mapped.message });
}

// ============================================================================
// 1. Identity & Bootstrap
// ============================================================================
apiRouter.get('/me', async (req: AuthRequest, res) => {
  try {
    const config = await getSystemConfig();
    res.json({
      user: { ...req.dbUser!, permissions: req.permissions || [] },
      config,
    });
  } catch (error) {
    handleRouteError(res, error, 'تعذر تحميل ملف المستخدم.');
  }
});

apiRouter.get('/bootstrap', async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  try {
    const [scopedEmployeesRaw, config, allCourses, rawNotifs] = await Promise.all([
      getAuthorizedEmployees(user),
      getSystemConfig(),
      db
        .select()
        .from(trainingCourses)
        .where(isNull(trainingCourses.deletedAt))
        .orderBy(desc(trainingCourses.createdAt)),
      db
        .select()
        .from(notifications)
        .where(
          or(
            eq(notifications.recipientUid, user.uid),
            and(isNull(notifications.recipientUid), eq(notifications.recipientRole, user.role))
          )
        )
        .orderBy(desc(notifications.createdAt))
        .limit(60),
    ]);

    const scopedEmployees = scopedEmployeesRaw.map((e) => redactEmployeeForUser(user, e));
    const empMap = new Map(scopedEmployeesRaw.map((e) => [e.id, e]));
    const empIds = scopedEmployeesRaw.map((e) => e.id);
    const hasScopedEmps = empIds.length > 0;

    const [
      scopedAppreciations,
      scopedPenalties,
      candidateDocuments,
      scopedTransactions,
      scopedEnrollments,
      scopedLeaves,
      scopedAudit,
      scopedUsers,
      scopedBackups,
    ] = await Promise.all([
      hasScopedEmps
        ? db
            .select()
            .from(appreciations)
            .where(and(isNull(appreciations.deletedAt), inArray(appreciations.employeeId, empIds)))
            .orderBy(desc(appreciations.issueDate))
        : Promise.resolve([]),
      hasScopedEmps
        ? db
            .select()
            .from(penalties)
            .where(and(isNull(penalties.deletedAt), inArray(penalties.employeeId, empIds)))
            .orderBy(desc(penalties.issueDate))
        : Promise.resolve([]),
      user.role === 'READ_ONLY'
        ? Promise.resolve([])
        : db
            .select({
              id: documents.id,
              documentNumber: documents.documentNumber,
              title: documents.title,
              category: documents.category,
              issueDate: documents.issueDate,
              expiryDate: documents.expiryDate,
              issuingAuthority: documents.issuingAuthority,
              employeeId: documents.employeeId,
              transactionId: documents.transactionId,
              department: documents.department,
              oilfield: documents.oilfield,
              description: documents.description,
              fileName: documents.fileName,
              mimeType: documents.mimeType,
              fileSize: documents.fileSize,
              sha256Hash: documents.sha256Hash,
              confidentialityLevel: documents.confidentialityLevel,
              version: documents.version,
              archiveStatus: documents.archiveStatus,
              verificationCode: documents.verificationCode,
              uploadedBy: documents.uploadedBy,
              createdAt: documents.createdAt,
            })
            .from(documents)
            .where(isNull(documents.deletedAt))
            .orderBy(desc(documents.createdAt)),
      isPrivilegedHR(user.role)
        ? db.select().from(transactions).orderBy(desc(transactions.updatedAt))
        : hasScopedEmps
          ? db
              .select()
              .from(transactions)
              .where(
                or(
                  inArray(transactions.employeeId, empIds),
                  eq(transactions.createdByUid, user.uid)
                )
              )
              .orderBy(desc(transactions.updatedAt))
          : db
              .select()
              .from(transactions)
              .where(eq(transactions.createdByUid, user.uid))
              .orderBy(desc(transactions.updatedAt)),
      isPrivilegedHR(user.role)
        ? db.select().from(trainingEnrollments).orderBy(desc(trainingEnrollments.createdAt))
        : hasScopedEmps
          ? db
              .select()
              .from(trainingEnrollments)
              .where(inArray(trainingEnrollments.employeeId, empIds))
              .orderBy(desc(trainingEnrollments.createdAt))
          : Promise.resolve([]),
      isPrivilegedHR(user.role)
        ? db.select().from(leaveRequests).orderBy(desc(leaveRequests.createdAt))
        : hasScopedEmps
          ? db
              .select()
              .from(leaveRequests)
              .where(inArray(leaveRequests.employeeId, empIds))
              .orderBy(desc(leaveRequests.createdAt))
          : Promise.resolve([]),
      hasPermission(user.role, 'view_audit')
        ? db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(250)
        : Promise.resolve([]),
      hasPermission(user.role, 'manage_users')
        ? db
            .select({
              id: users.id,
              uid: users.uid,
              employeeCode: users.employeeCode,
              email: users.email,
              displayName: users.displayName,
              photoUrl: users.photoUrl,
              role: users.role,
              department: users.department,
              section: users.section,
              oilfield: users.oilfield,
              employeeId: users.employeeId,
              isActive: users.isActive,
              mustResetPassword: users.mustResetPassword,
              createdAt: users.createdAt,
            })
            .from(users)
            .orderBy(desc(users.createdAt))
        : Promise.resolve([]),
      hasPermission(user.role, 'manage_backups')
        ? db.select().from(backupSnapshots).orderBy(desc(backupSnapshots.createdAt)).limit(50)
        : Promise.resolve([]),
    ]);

    const scopedDocuments = candidateDocuments.filter((doc) => {
      const linkedEmp = doc.employeeId ? empMap.get(doc.employeeId) ?? null : null;
      return canAccessDocument(user, doc, linkedEmp);
    });

    const scopedNotifs = rawNotifs
      .filter((n) => canManageNotification(user, n))
      .map((n) => ({
        id: n.id,
        recipientUid: n.recipientUid,
        recipientRole: n.recipientRole,
        title: n.title,
        message: n.message,
        severity: n.severity,
        entityType: n.entityType,
        entityId: n.entityId,
        isRead: isNotificationReadForUser(user.uid, n),
        createdAt: n.createdAt,
      }));

    // Compute live enrolled count per course from active enrollments
    const allActiveEnrollments = await db
      .select({
        courseId: trainingEnrollments.courseId,
        status: trainingEnrollments.status,
      })
      .from(trainingEnrollments);
    const enrolledByCourse = new Map<number, number>();
    for (const enr of allActiveEnrollments) {
      if (enr.status === 'معتمد' || enr.status === 'مكتمل') {
        enrolledByCourse.set(enr.courseId, (enrolledByCourse.get(enr.courseId) || 0) + 1);
      }
    }

    const coursesWithCounts = allCourses.map((c) => ({
      ...c,
      enrolledCount: enrolledByCourse.get(c.id) || 0,
    }));

    res.json({
      user: { ...user, permissions: req.permissions || [] },
      config,
      employees: scopedEmployees,
      appreciations: scopedAppreciations,
      penalties: scopedPenalties,
      documents: scopedDocuments,
      transactions: scopedTransactions,
      courses: coursesWithCounts,
      enrollments: scopedEnrollments,
      leaveRequests: scopedLeaves,
      notifications: scopedNotifs,
      auditLogs: scopedAudit,
      users: scopedUsers,
      backups: scopedBackups,
    });
  } catch (error) {
    handleRouteError(res, error, 'تعذر تحميل بيانات النظام من قاعدة البيانات.');
  }
});

// ============================================================================
// 2. Paginated Endpoints & Unified Global Search (Permission-Scoped)
// ============================================================================
apiRouter.get('/employees', async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const q = String(req.query.q || '').trim().toLowerCase();
  const deptFilter = String(req.query.department || '').trim();
  const oilfieldFilter = String(req.query.oilfield || '').trim();
  const statusFilter = String(req.query.status || '').trim();

  try {
    const scopedRaw = await getAuthorizedEmployees(user);
    const filtered = scopedRaw.filter((e) => {
      if (deptFilter && e.department !== deptFilter) return false;
      if (oilfieldFilter && e.oilfield !== oilfieldFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      if (q) {
        return (
          e.fullName.toLowerCase().includes(q) ||
          e.fullNameEn.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.jobTitle.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q) ||
          e.oilfield.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const items = filtered.slice(offset, offset + limit).map((e) => redactEmployeeForUser(user, e));

    res.json({ items, total, page, limit, totalPages });
  } catch (error) {
    handleRouteError(res, error, 'تعذر تحميل قائمة المنتسبين.');
  }
});

apiRouter.get('/audit-logs', requirePermission('view_audit'), async (req: AuthRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const operation = String(req.query.operation || '').trim();
  const offset = (page - 1) * limit;

  try {
    const whereClause = operation ? eq(auditLogs.operation, operation) : undefined;
    const [countRows, items] = await Promise.all([
      whereClause
        ? db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(whereClause)
        : db.select({ total: sql<number>`count(*)::int` }).from(auditLogs),
      whereClause
        ? db
            .select()
            .from(auditLogs)
            .where(whereClause)
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit)
            .offset(offset)
        : db
            .select()
            .from(auditLogs)
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit)
            .offset(offset),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({ items, total, page, limit, totalPages });
  } catch (error) {
    handleRouteError(res, error, 'تعذر تحميل سجل التدقيق.');
  }
});

apiRouter.get('/search', async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) {
    return res.json({ employees: [], transactions: [], documents: [], courses: [] });
  }
  try {
    const scopedEmpsRaw = await getAuthorizedEmployees(user);
    const empMap = new Map(scopedEmpsRaw.map((e) => [e.id, e]));
    const empIds = new Set(scopedEmpsRaw.map((e) => e.id));

    const matchedEmployees = scopedEmpsRaw
      .filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          e.fullNameEn.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q) ||
          e.oilfield.toLowerCase().includes(q) ||
          e.jobTitle.toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map((e) => redactEmployeeForUser(user, e));

    const [allTxns, allDocs, allCourses] = await Promise.all([
      db.select().from(transactions).orderBy(desc(transactions.updatedAt)).limit(200),
      user.role === 'READ_ONLY'
        ? Promise.resolve([])
        : db
            .select({
              id: documents.id,
              documentNumber: documents.documentNumber,
              title: documents.title,
              category: documents.category,
              employeeId: documents.employeeId,
              department: documents.department,
              oilfield: documents.oilfield,
              confidentialityLevel: documents.confidentialityLevel,
            })
            .from(documents)
            .where(isNull(documents.deletedAt))
            .orderBy(desc(documents.createdAt))
            .limit(200),
      db.select().from(trainingCourses).where(isNull(trainingCourses.deletedAt)).limit(100),
    ]);

    const matchedTransactions = allTxns
      .filter(
        (t) =>
          (isPrivilegedHR(user.role) || empIds.has(t.employeeId) || t.createdByUid === user.uid) &&
          (t.transactionNumber.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.status.toLowerCase().includes(q))
      )
      .slice(0, 8);

    const matchedDocuments = allDocs
      .filter((d) => {
        const linkedEmp = d.employeeId ? empMap.get(d.employeeId) ?? null : null;
        return (
          canAccessDocument(user, d, linkedEmp) &&
          (d.title.toLowerCase().includes(q) ||
            d.documentNumber.toLowerCase().includes(q) ||
            d.category.toLowerCase().includes(q))
        );
      })
      .slice(0, 8);

    const matchedCourses = allCourses
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.instructor.toLowerCase().includes(q)
      )
      .slice(0, 6);

    res.json({
      employees: matchedEmployees,
      transactions: matchedTransactions,
      documents: matchedDocuments,
      courses: matchedCourses,
    });
  } catch (error) {
    handleRouteError(res, error, 'فشل تنفيذ البحث الموحد.');
  }
});

// ============================================================================
// 3. Employees CRUD + Chronological Career Timeline
// ============================================================================
const employeeCreateSchema = z.object({
  employeeCode: z.string().trim().min(3).max(40),
  nationalId: z.string().trim().max(40).optional().nullable(),
  fullName: z.string().trim().min(3).max(150),
  fullNameEn: z.string().trim().max(150).optional().default(''),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  gender: z.string().max(20).optional().default('ذكر'),
  jobTitle: z.string().trim().min(2).max(120),
  jobTitleEn: z.string().trim().max(120).optional().default(''),
  department: z.string().trim().min(2).max(120),
  oilfield: z.string().trim().min(2).max(120),
  section: z.string().trim().max(120).optional().default(''),
  grade: z.coerce.number().int().min(1).max(10),
  step: z.coerce.number().int().min(1).max(11),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastPromotionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lastIncrementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  academicDegree: z.string().trim().min(2).max(80),
  specialization: z.string().trim().max(120).optional().default(''),
  email: z.string().trim().max(150).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  basicSalaryIQD: z.coerce.number().int().min(0).default(0),
  annualLeaveBalance: z.coerce.number().int().min(0).max(365).default(30),
  sickLeaveBalance: z.coerce.number().int().min(0).max(365).default(30),
  status: z.string().trim().default('نشط'),
  notes: z.string().max(2000).optional().default(''),
  provisionAccount: z.boolean().optional().default(false),
  initialPassword: z.string().max(128).optional().default(''),
  accountRole: z
    .enum(['HR_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'SECTION_MANAGER', 'EMPLOYEE', 'READ_ONLY'])
    .optional()
    .default('EMPLOYEE'),
});

apiRouter.post('/employees', requirePermission('create_employee'), async (req: AuthRequest, res) => {
  const parsed = employeeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'بيانات المنتسب غير مكتملة أو غير صالحة.', issues: parsed.error.issues });
  }
  const { provisionAccount, initialPassword, accountRole, ...d } = parsed.data;
  const normalizedCode = d.employeeCode.toUpperCase();
  const normalizedEmail = d.email.trim().toLowerCase();

  if (provisionAccount) {
    if (!canProvisionAccountRole(req.dbUser!.role, accountRole)) {
      return res.status(403).json({
        error: 'غير مصرح بإنشاء حساب بهذا المستوى من الصلاحيات. إنشاء حسابات الإدارة العليا محصور بمدير النظام.',
      });
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'لتفعيل حساب الدخول الأولي يجب إدخال بريد إلكتروني رسمي صحيح للمنتسب.' });
    }
    if (!initialPassword || initialPassword.length < 8 || !/[A-Za-z]/.test(initialPassword) || !/\d/.test(initialPassword)) {
      return res.status(400).json({ error: 'كلمة المرور الأولية يجب أن لا تقل عن 8 أحرف وتحتوي على أحرف وأرقام.' });
    }
  }

  try {
    const created = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.employeeCode, normalizedCode))
        .limit(1);
      if (existing.length > 0) {
        throw httpError(409, `الرقم الوظيفي (${normalizedCode}) مسجل مسبقاً في قاعدة البيانات.`);
      }

      if (provisionAccount) {
        const existingUser = await tx
          .select({ id: users.id })
          .from(users)
          .where(or(eq(users.employeeCode, normalizedCode), eq(users.email, normalizedEmail)))
          .limit(1);
        if (existingUser.length > 0) {
          throw httpError(409, 'يوجد حساب مستخدم مسجل مسبقاً بهذا البريد الإلكتروني أو الرقم الوظيفي.');
        }
      }

      const [emp] = await tx
        .insert(employees)
        .values({
          ...d,
          employeeCode: normalizedCode,
          email: normalizedEmail,
          birthDate: d.birthDate || null,
          nationalId: d.nationalId || null,
          lastPromotionDate: d.lastPromotionDate || d.hireDate,
          lastIncrementDate: d.lastIncrementDate || d.hireDate,
        })
        .returning();

      if (provisionAccount) {
        await tx.insert(users).values({
          uid: `boc-emp-${normalizedCode.toLowerCase()}`,
          employeeCode: normalizedCode,
          email: normalizedEmail,
          displayName: emp.fullName,
          passwordHash: hashPassword(initialPassword),
          mustResetPassword: true,
          role: accountRole,
          department: emp.department,
          section: emp.section,
          oilfield: emp.oilfield,
          employeeId: emp.id,
          isActive: true,
        });
      }

      await addCareerEvent(
        {
          employeeId: emp.id,
          eventType: 'تعيين',
          title: 'إنشاء السجل الوظيفي والمباشرة',
          description: `${emp.jobTitle} — ${emp.department} (${emp.oilfield}) · الدرجة ${emp.grade} / المرحلة ${emp.step}`,
          eventDate: emp.hireDate,
          referenceNumber: emp.employeeCode,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        },
        tx
      );

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE',
          recordType: 'EMPLOYEE',
          recordId: emp.id,
          newValues: {
            employeeCode: emp.employeeCode,
            fullName: emp.fullName,
            department: emp.department,
            section: emp.section,
            oilfield: emp.oilfield,
            accountProvisioned: provisionAccount,
            accountRole: provisionAccount ? accountRole : null,
          },
          details: `تسجيل منتسب جديد: ${emp.fullName} (${emp.employeeCode}) في ${emp.department}${
            provisionAccount ? ` مع تفعيل حساب دخول (${accountRole}) بكلمة مرور أولية` : ''
          }`,
        },
        tx
      );

      return emp;
    });

    res.status(201).json(created);
  } catch (error) {
    handleRouteError(res, error, 'فشل حفظ سجل المنتسب.');
  }
});

apiRouter.patch('/employees/:id', requirePermission('edit_employee'), async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId)) return res.status(400).json({ error: 'معرف المنتسب غير صالح.' });

  const parsed = employeeCreateSchema
    .omit({ provisionAccount: true, initialPassword: true, accountRole: true })
    .partial()
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'قيم التعديل غير صالحة.', issues: parsed.error.issues });
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, empId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (existingRows.length === 0) throw httpError(404, 'سجل المنتسب غير موجود.');
      const prev = existingRows[0];

      const updates = {
        ...parsed.data,
        employeeCode: parsed.data.employeeCode ? parsed.data.employeeCode.toUpperCase() : prev.employeeCode,
        email: parsed.data.email !== undefined ? parsed.data.email.trim().toLowerCase() : prev.email,
        birthDate: parsed.data.birthDate === '' ? null : parsed.data.birthDate ?? prev.birthDate,
        updatedAt: new Date(),
      };

      const [saved] = await tx
        .update(employees)
        .set(updates)
        .where(eq(employees.id, empId))
        .returning();

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'UPDATE',
          recordType: 'EMPLOYEE',
          recordId: empId,
          previousValues: {
            jobTitle: prev.jobTitle,
            department: prev.department,
            section: prev.section,
            oilfield: prev.oilfield,
            grade: prev.grade,
            step: prev.step,
            status: prev.status,
          },
          newValues: {
            jobTitle: saved.jobTitle,
            department: saved.department,
            section: saved.section,
            oilfield: saved.oilfield,
            grade: saved.grade,
            step: saved.step,
            status: saved.status,
          },
          details: `تحديث بيانات الملف الوظيفي للمنتسب ${saved.fullName} (${saved.employeeCode})`,
        },
        tx
      );

      return saved;
    });

    res.json(updated);
  } catch (error) {
    handleRouteError(res, error, 'فشل تحديث سجل المنتسب.');
  }
});

apiRouter.delete('/employees/:id', requirePermission('delete_employee'), async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId)) return res.status(400).json({ error: 'معرف المنتسب غير صالح.' });
  try {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, empId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (existing.length === 0) throw httpError(404, 'السجل غير موجود أو مؤرشف مسبقاً.');

      await tx
        .update(employees)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(employees.id, empId));

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'SOFT_DELETE',
          recordType: 'EMPLOYEE',
          recordId: empId,
          previousValues: { fullName: existing[0].fullName, employeeCode: existing[0].employeeCode },
          details: `أرشفة وحذف ناعم لسجل المنتسب ${existing[0].fullName} (${existing[0].employeeCode})`,
        },
        tx
      );
    });

    res.json({ ok: true });
  } catch (error) {
    handleRouteError(res, error, 'فشل أرشفة سجل المنتسب.');
  }
});

apiRouter.get('/employees/:id/timeline', async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId)) return res.status(400).json({ error: 'معرف غير صالح.' });
  try {
    const empRows = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, empId), isNull(employees.deletedAt)))
      .limit(1);
    if (empRows.length === 0) return res.status(404).json({ error: 'غير موجود.' });
    if (!canAccessEmployee(req.dbUser!, empRows[0])) {
      return res.status(403).json({ error: 'غير مصرح بالاطلاع على المسار الوظيفي لهذا المنتسب.' });
    }
    const events = await db
      .select()
      .from(careerEvents)
      .where(eq(careerEvents.employeeId, empId))
      .orderBy(desc(careerEvents.eventDate), desc(careerEvents.createdAt));
    res.json(events);
  } catch (error) {
    handleRouteError(res, error, 'تعذر تحميل الخط الزمني للمنتسب.');
  }
});

apiRouter.post('/employees/:id/timeline', requirePermission('edit_employee'), async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId)) return res.status(400).json({ error: 'معرف غير صالح.' });
  const schema = z.object({
    eventType: z.string().trim().min(2).max(60),
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(1000).default(''),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    referenceNumber: z.string().trim().max(80).optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات الحدث الوظيفي غير مكتملة.' });
  try {
    const created = await db.transaction(async (tx) => {
      const [emp] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, empId), isNull(employees.deletedAt)))
        .limit(1);
      if (!emp) throw httpError(404, 'المنتسب غير موجود.');

      const [evt] = await tx
        .insert(careerEvents)
        .values({
          employeeId: empId,
          ...parsed.data,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        })
        .returning();

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE',
          recordType: 'CAREER_EVENT',
          recordId: evt.id,
          details: `إضافة حدث وظيفي (${evt.eventType}): ${evt.title}`,
        },
        tx
      );
      return evt;
    });
    res.status(201).json(created);
  } catch (error) {
    handleRouteError(res, error, 'فشل إضافة الحدث الوظيفي.');
  }
});

// ============================================================================
// 4. Promotions & Increments Workflow (Strict Approval & Rules Gate)
// ============================================================================
apiRouter.post('/promotions/initiate', requirePermission('manage_promotions'), async (req: AuthRequest, res) => {
  const schema = z.object({
    employeeId: z.coerce.number().int(),
    kind: z.enum(['PROMOTION_REVIEW', 'INCREMENT_REVIEW']),
    explanation: z.array(z.string()).default([]),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات طلب المراجعة غير صالحة.' });

  try {
    const config = await getSystemConfig();
    const rulesGate = canRunOfficialHRCalculation(config.hrRules);
    if (!rulesGate.allowed) {
      return res.status(422).json({ error: rulesGate.reason });
    }

    const txn = await db.transaction(async (tx) => {
      const empRows = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (empRows.length === 0) throw httpError(404, 'المنتسب غير موجود.');
      const emp = empRows[0];

      if (parsed.data.kind === 'PROMOTION_REVIEW' && emp.grade <= 1) {
        throw httpError(400, 'المنتسب يشغل الدرجة الأولى (أعلى درجة وظيفية).');
      }
      if (parsed.data.kind === 'INCREMENT_REVIEW' && emp.step >= 11) {
        throw httpError(400, 'المنتسب في أعلى مرحلة (المرحلة 11) للدرجة الحالية.');
      }

      // Block duplicate active promotion or increment transactions for the same employee
      const activeExisting = await tx
        .select({ id: transactions.id, transactionNumber: transactions.transactionNumber })
        .from(transactions)
        .where(
          and(
            eq(transactions.employeeId, emp.id),
            eq(transactions.transactionType, parsed.data.kind),
            inArray(transactions.status, ACTIVE_WORKFLOW_STATUSES)
          )
        )
        .limit(1);
      if (activeExisting.length > 0) {
        throw httpError(
          409,
          `توجد معاملة ${parsed.data.kind === 'PROMOTION_REVIEW' ? 'ترفيع' : 'علاوة'} قيد المعالجة مسبقاً لهذا المنتسب (${activeExisting[0].transactionNumber}).`
        );
      }

      const wf = config.workflows.find((w) => w.transactionType === parsed.data.kind);
      const initialStatus = wf?.requiresDeptApproval ? 'بانتظار موافقة القسم' : 'بانتظار موافقة الموارد البشرية';
      const initialRole = wf?.requiresDeptApproval ? 'DEPT_MANAGER' : 'HR_MANAGER';

      const txnNo = generateCode(parsed.data.kind === 'PROMOTION_REVIEW' ? 'PRM' : 'INC');
      const title =
        parsed.data.kind === 'PROMOTION_REVIEW'
          ? `مراجعة واعتماد ترفيع: ${emp.fullName} (إلى الدرجة ${emp.grade - 1})`
          : `مراجعة واعتماد علاوة سنوية: ${emp.fullName} (المرحلة ${Math.min(11, emp.step + 1)})`;

      const historyStep: TransactionHistoryStep = {
        timestamp: new Date().toISOString(),
        actorName: req.dbUser!.displayName || req.dbUser!.email,
        actorRole: req.dbUser!.role,
        action: 'إنشاء معاملة استحقاق وإرسالها للاعتماد',
        fromStatus: 'مسودة',
        toStatus: initialStatus,
      };

      const [createdTxn] = await tx
        .insert(transactions)
        .values({
          transactionNumber: txnNo,
          transactionType: parsed.data.kind,
          title,
          employeeId: emp.id,
          department: emp.department,
          oilfield: emp.oilfield,
          currentResponsibleRole: initialRole,
          status: initialStatus,
          payload: {
            currentGrade: emp.grade,
            currentStep: emp.step,
            targetGrade: parsed.data.kind === 'PROMOTION_REVIEW' ? emp.grade - 1 : emp.grade,
            targetStep: parsed.data.kind === 'PROMOTION_REVIEW' ? 1 : Math.min(11, emp.step + 1),
            effectiveDate: parsed.data.effectiveDate,
            regulationReference: config.hrRules.regulationReference || '',
            explanation: parsed.data.explanation,
          },
          history: [historyStep],
          createdByUid: req.dbUser!.uid,
        })
        .returning();

      await createNotification(
        {
          recipientRole: initialRole,
          title: 'معاملة ترفيع/علاوة جديدة بانتظار المراجعة',
          message: `${title} — رقم المعاملة ${txnNo}`,
          severity: 'warning',
          entityType: 'TRANSACTION',
          entityId: createdTxn.id,
        },
        tx
      );

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'INITIATE_WORKFLOW',
          recordType: parsed.data.kind,
          recordId: createdTxn.id,
          details: `فتح معاملة ${txnNo}: ${title}`,
        },
        tx
      );

      return createdTxn;
    });

    res.status(201).json(txn);
  } catch (error) {
    handleRouteError(res, error, 'فشل إنشاء معاملة الترفيع/العلاوة.');
  }
});

// ============================================================================
// 5. Appreciation Letters & Administrative Penalties
// ============================================================================
apiRouter.post('/appreciations', requirePermission('manage_appreciations'), async (req: AuthRequest, res) => {
  const schema = z.object({
    employeeId: z.coerce.number().int(),
    letterNumber: z.string().trim().min(2).max(80),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    issuingAuthority: z.string().trim().min(2).max(160),
    subject: z.string().trim().min(3).max(500),
    seniorityMonths: z.coerce.number().int().min(0).max(12),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات كتاب الشكر غير مكتملة.' });

  try {
    const created = await db.transaction(async (tx) => {
      const empRows = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (empRows.length === 0) throw httpError(404, 'المنتسب غير موجود.');
      const emp = empRows[0];

      const verificationCode = generateCode('BOC-APP');
      const [app] = await tx
        .insert(appreciations)
        .values({
          ...parsed.data,
          verificationCode,
          appliedToCurrentCycle: true,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        })
        .returning();

      await tx.insert(documents).values({
        documentNumber: `APP-${app.letterNumber}-${app.id}`,
        title: `كتاب شكر وتقدير (${app.issuingAuthority})`,
        category: 'كتاب شكر وتقدير',
        issueDate: app.issueDate,
        issuingAuthority: app.issuingAuthority,
        employeeId: emp.id,
        department: emp.department,
        oilfield: emp.oilfield,
        description: `${app.subject} — قِدَم ${app.seniorityMonths} شهر`,
        fileName: `appreciation-${app.id}.pdf`,
        mimeType: 'application/pdf',
        fileSize: 'رسمي إلكتروني',
        confidentialityLevel: 'INTERNAL',
        verificationCode: generateCode('DOC-VER'),
        uploadedBy: req.dbUser!.displayName || req.dbUser!.email,
      });

      await addCareerEvent(
        {
          employeeId: emp.id,
          eventType: 'كتاب شكر',
          title: `كتاب شكر وتقدير (+${app.seniorityMonths} شهر قِدَم)`,
          description: `${app.issuingAuthority} — ${app.subject}`,
          eventDate: app.issueDate,
          referenceNumber: app.letterNumber,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        },
        tx
      );

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE',
          recordType: 'APPRECIATION',
          recordId: app.id,
          newValues: { letterNumber: app.letterNumber, seniorityMonths: app.seniorityMonths },
          details: `تسجيل كتاب شكر رقم ${app.letterNumber} للمنتسب ${emp.fullName} (+${app.seniorityMonths} شهر قِدَم)`,
        },
        tx
      );

      return app;
    });

    res.status(201).json(created);
  } catch (error) {
    handleRouteError(res, error, 'فشل تسجيل كتاب الشكر والتقدير.');
  }
});

apiRouter.post('/penalties', requirePermission('manage_penalties'), async (req: AuthRequest, res) => {
  const schema = z.object({
    employeeId: z.coerce.number().int(),
    orderNumber: z.string().trim().min(2).max(80),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    penaltyType: z.string().trim().min(2).max(80),
    delayMonths: z.coerce.number().int().min(0).max(36).optional(),
    reason: z.string().trim().min(3).max(500),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات العقوبة الإدارية غير مكتملة.' });

  try {
    const config = await getSystemConfig();
    const created = await db.transaction(async (tx) => {
      const empRows = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (empRows.length === 0) throw httpError(404, 'المنتسب غير موجود.');
      const emp = empRows[0];

      const delayMonths =
        parsed.data.delayMonths !== undefined
          ? parsed.data.delayMonths
          : getPenaltyDelayMonths(parsed.data.penaltyType, config.hrRules);

      const [pen] = await tx
        .insert(penalties)
        .values({
          employeeId: parsed.data.employeeId,
          orderNumber: parsed.data.orderNumber,
          issueDate: parsed.data.issueDate,
          penaltyType: parsed.data.penaltyType,
          delayMonths,
          reason: parsed.data.reason,
          appliedToCurrentCycle: true,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        })
        .returning();

      await addCareerEvent(
        {
          employeeId: emp.id,
          eventType: 'عقوبة',
          title: `عقوبة إدارية: ${pen.penaltyType} (تأخير ${pen.delayMonths} أشهر)`,
          description: pen.reason,
          eventDate: pen.issueDate,
          referenceNumber: pen.orderNumber,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        },
        tx
      );

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE',
          recordType: 'PENALTY',
          recordId: pen.id,
          newValues: { orderNumber: pen.orderNumber, penaltyType: pen.penaltyType, delayMonths },
          details: `تسجيل عقوبة (${pen.penaltyType}) بأمر رقم ${pen.orderNumber} للمنتسب ${emp.fullName}`,
        },
        tx
      );

      return pen;
    });

    res.status(201).json(created);
  } catch (error) {
    handleRouteError(res, error, 'فشل تسجيل العقوبة الإدارية.');
  }
});

// ============================================================================
// 6. Centralized Digital Document Management (Magic-Byte + Private Storage + ACL)
// ============================================================================
apiRouter.post('/documents', requirePermission('upload_documents'), async (req: AuthRequest, res) => {
  const schema = z.object({
    documentNumber: z.string().trim().min(2).max(80),
    title: z.string().trim().min(2).max(180),
    category: z.string().trim().min(2).max(80),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
    issuingAuthority: z.string().trim().max(150).default('شركة نفط البصرة'),
    employeeId: z.coerce.number().int().optional().nullable(),
    transactionId: z.coerce.number().int().optional().nullable(),
    department: z.string().trim().max(120).optional().default(''),
    oilfield: z.string().trim().max(120).optional().default(''),
    description: z.string().trim().max(1000).optional().default(''),
    fileName: z.string().trim().max(180).optional().default('document.pdf'),
    mimeType: z.string().trim().max(80).optional().default('application/pdf'),
    fileSize: z.string().trim().max(40).optional().default('إلكتروني'),
    confidentialityLevel: z.enum(['INTERNAL', 'CONFIDENTIAL', 'HR_ONLY']).optional().default('INTERNAL'),
    fileContentBase64: z.string().max(6_000_000).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات الوثيقة غير صالحة أو حجم الملف كبير جداً.' });

  const d = parsed.data;
  const user = req.dbUser!;

  if ((d.confidentialityLevel === 'CONFIDENTIAL' || d.confidentialityLevel === 'HR_ONLY') && !isPrivilegedHR(user.role)) {
    return res.status(403).json({ error: 'تصنيف الوثائق السرية محصور بإدارة الموارد البشرية.' });
  }

  let validatedFile: ReturnType<typeof validateBase64DocumentUpload> | null = null;
  if (d.fileContentBase64) {
    validatedFile = validateBase64DocumentUpload(d.fileContentBase64, d.mimeType, d.fileName);
    if (!validatedFile.ok) {
      return res.status(400).json({ error: validatedFile.error });
    }
  }

  let savedStorageKey: string | null = null;
  try {
    let targetDepartment = d.department;
    let targetOilfield = d.oilfield;

    if (d.employeeId) {
      const empRows = await db
        .select()
        .from(employees)
        .where(and(eq(employees.id, d.employeeId), isNull(employees.deletedAt)))
        .limit(1);
      if (empRows.length === 0) return res.status(404).json({ error: 'المنتسب المرتبط غير موجود.' });
      if (!canAccessEmployee(user, empRows[0])) {
        return res.status(403).json({ error: 'لا تملك صلاحية رفع وثائق لهذا المنتسب.' });
      }
      targetDepartment = targetDepartment || empRows[0].department;
      targetOilfield = targetOilfield || empRows[0].oilfield;
    } else if (!isPrivilegedHR(user.role)) {
      return res.status(403).json({ error: 'يجب ربط الوثيقة بملف منتسب مصرح لك به.' });
    }

    if (validatedFile && validatedFile.ok) {
      savedStorageKey = await savePrivateDocumentFile(validatedFile.data.buffer, validatedFile.data.extension);
    }

    const created = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          documentNumber: d.documentNumber,
          title: d.title,
          category: d.category,
          issueDate: d.issueDate,
          expiryDate: d.expiryDate || null,
          issuingAuthority: d.issuingAuthority,
          employeeId: d.employeeId ?? null,
          transactionId: d.transactionId ?? null,
          department: targetDepartment,
          oilfield: targetOilfield,
          description: d.description,
          fileName: validatedFile && validatedFile.ok ? validatedFile.data.sanitizedFileName : d.fileName,
          mimeType: validatedFile && validatedFile.ok ? validatedFile.data.mimeType : d.mimeType,
          fileSize: validatedFile && validatedFile.ok ? validatedFile.data.humanSize : d.fileSize,
          storageKey: savedStorageKey,
          sha256Hash: validatedFile && validatedFile.ok ? validatedFile.data.sha256Hash : null,
          confidentialityLevel: d.confidentialityLevel,
          fileContentBase64: null,
          verificationCode: generateCode('DOC-QR'),
          uploadedBy: user.displayName || user.email,
        })
        .returning({
          id: documents.id,
          documentNumber: documents.documentNumber,
          title: documents.title,
          category: documents.category,
          issueDate: documents.issueDate,
          expiryDate: documents.expiryDate,
          issuingAuthority: documents.issuingAuthority,
          employeeId: documents.employeeId,
          transactionId: documents.transactionId,
          department: documents.department,
          oilfield: documents.oilfield,
          description: documents.description,
          fileName: documents.fileName,
          mimeType: documents.mimeType,
          fileSize: documents.fileSize,
          sha256Hash: documents.sha256Hash,
          confidentialityLevel: documents.confidentialityLevel,
          version: documents.version,
          archiveStatus: documents.archiveStatus,
          verificationCode: documents.verificationCode,
          uploadedBy: documents.uploadedBy,
          createdAt: documents.createdAt,
        });

      await writeAuditLog(
        {
          actor: user,
          operation: 'UPLOAD_DOCUMENT',
          recordType: 'DOCUMENT',
          recordId: doc.id,
          newValues: {
            documentNumber: doc.documentNumber,
            confidentialityLevel: doc.confidentialityLevel,
            sha256Hash: doc.sha256Hash,
          },
          details: `أرشفة الوثيقة «${doc.title}» (${doc.documentNumber}) — مستوى السرية: ${doc.confidentialityLevel}`,
        },
        tx
      );

      return doc;
    });

    res.status(201).json(created);
  } catch (error) {
    if (savedStorageKey) {
      await deletePrivateDocumentFile(savedStorageKey);
    }
    handleRouteError(res, error, 'فشل أرشفة الوثيقة.');
  }
});

apiRouter.get('/documents/:id/download', requirePermission('download_documents'), async (req: AuthRequest, res) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId)) return res.status(400).json({ error: 'معرف الوثيقة غير صالح.' });
  const user = req.dbUser!;

  try {
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'الوثيقة غير موجودة.' });
    const doc = rows[0];

    let linkedEmp = null;
    if (doc.employeeId) {
      const empRows = await db
        .select()
        .from(employees)
        .where(and(eq(employees.id, doc.employeeId), isNull(employees.deletedAt)))
        .limit(1);
      linkedEmp = empRows[0] ?? null;
    }

    if (!canAccessDocument(user, doc, linkedEmp)) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه الوثيقة الخاصة أو السرية.' });
    }

    let base64Content: string | null = null;
    if (doc.storageKey) {
      base64Content = await readPrivateDocumentBase64(doc.storageKey);
    }
    if (!base64Content && doc.fileContentBase64) {
      // Backward compatibility for pre-migration legacy records
      base64Content = doc.fileContentBase64;
    }

    await writeAuditLog({
      actor: user,
      operation: 'DOWNLOAD_DOCUMENT',
      recordType: 'DOCUMENT',
      recordId: doc.id,
      details: `معاينة/تحميل الوثيقة المحمية «${doc.title}» (${doc.documentNumber})`,
    });

    res.json({
      id: doc.id,
      documentNumber: doc.documentNumber,
      title: doc.title,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sha256Hash: doc.sha256Hash,
      confidentialityLevel: doc.confidentialityLevel,
      fileContentBase64: base64Content,
      verificationCode: doc.verificationCode,
    });
  } catch (error) {
    handleRouteError(res, error, 'تعذر استرجاع الوثيقة.');
  }
});

apiRouter.delete('/documents/:id', requirePermission('edit_employee'), async (req: AuthRequest, res) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId)) return res.status(400).json({ error: 'معرف الوثيقة غير صالح.' });
  try {
    await db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
        .for('update')
        .limit(1);
      if (!doc) throw httpError(404, 'الوثيقة غير موجودة.');

      await tx
        .update(documents)
        .set({ deletedAt: new Date(), archiveStatus: 'مؤرشف' })
        .where(eq(documents.id, docId));

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'SOFT_DELETE',
          recordType: 'DOCUMENT',
          recordId: docId,
          details: `أرشفة/حذف ناعم للوثيقة ${doc.documentNumber} (${doc.title})`,
        },
        tx
      );
    });
    res.json({ ok: true });
  } catch (error) {
    handleRouteError(res, error, 'فشل أرشفة الوثيقة.');
  }
});

// ============================================================================
// 7. Centralized Administrative Transactions & Atomic Workflow Engine
// ============================================================================
apiRouter.post('/transactions', async (req: AuthRequest, res) => {
  if (req.dbUser!.role === 'READ_ONLY') {
    return res.status(403).json({ error: 'حساب القراءة فقط لا يمكنه إنشاء معاملات.' });
  }
  const schema = z.object({
    transactionType: z.string().trim().min(2).max(60),
    title: z.string().trim().min(3).max(200),
    employeeId: z.coerce.number().int(),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات المعاملة غير مكتملة.' });

  if (parsed.data.transactionType === 'PROMOTION_REVIEW' || parsed.data.transactionType === 'INCREMENT_REVIEW') {
    return res.status(400).json({
      error: 'يجب إنشاء معاملات الترفيع والعلاوة عبر مسار احتساب الاستحقاق المعتمد حصراً.',
    });
  }

  try {
    const config = await getSystemConfig();
    const created = await db.transaction(async (tx) => {
      const [emp] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (!emp) throw httpError(404, 'المنتسب غير موجود.');
      if (!canAccessEmployee(req.dbUser!, emp)) {
        throw httpError(403, 'لا تملك صلاحية إنشاء معاملة لهذا المنتسب.');
      }

      const wf = config.workflows.find((w) => w.transactionType === parsed.data.transactionType);
      const initialStatus = wf?.requiresDeptApproval ? 'بانتظار موافقة القسم' : 'بانتظار موافقة الموارد البشرية';
      const initialRole = wf?.requiresDeptApproval ? 'DEPT_MANAGER' : 'HR_MANAGER';

      const txnNo = generateCode('TXN');
      const history: TransactionHistoryStep[] = [
        {
          timestamp: new Date().toISOString(),
          actorName: req.dbUser!.displayName || req.dbUser!.email,
          actorRole: req.dbUser!.role,
          action: 'تقديم معاملة جديدة',
          fromStatus: 'مسودة',
          toStatus: initialStatus,
        },
      ];

      const [txn] = await tx
        .insert(transactions)
        .values({
          transactionNumber: txnNo,
          transactionType: parsed.data.transactionType,
          title: parsed.data.title,
          employeeId: emp.id,
          department: emp.department,
          oilfield: emp.oilfield,
          currentResponsibleRole: initialRole,
          status: initialStatus,
          payload: parsed.data.payload,
          history,
          createdByUid: req.dbUser!.uid,
        })
        .returning();

      await createNotification(
        {
          recipientRole: initialRole,
          title: `معاملة جديدة: ${txn.title}`,
          message: `المنتسب: ${emp.fullName} · رقم المعاملة ${txnNo}`,
          severity: 'info',
          entityType: 'TRANSACTION',
          entityId: txn.id,
        },
        tx
      );

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE',
          recordType: 'TRANSACTION',
          recordId: txn.id,
          details: `إنشاء معاملة إدارية ${txnNo}: ${txn.title}`,
        },
        tx
      );

      return txn;
    });

    res.status(201).json(created);
  } catch (error) {
    handleRouteError(res, error, 'فشل إنشاء المعاملة الإدارية.');
  }
});

apiRouter.post('/transactions/:id/action', async (req: AuthRequest, res) => {
  const txnId = Number(req.params.id);
  if (!Number.isInteger(txnId)) return res.status(400).json({ error: 'معرف المعاملة غير صالح.' });

  const schema = z.object({
    action: z.enum(['APPROVE', 'REJECT', 'RETURN', 'RESUBMIT', 'ESCALATE', 'COMPLETE', 'ARCHIVE']),
    comment: z.string().trim().max(1000).optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'الإجراء المطلوب غير صالح.' });

  const { action, comment } = parsed.data;
  const user = req.dbUser!;

  if (user.role === 'READ_ONLY') {
    return res.status(403).json({ error: 'حساب القراءة فقط لا يمكنه تنفيذ إجراءات سير العمل.' });
  }
  if ((action === 'REJECT' || action === 'RETURN') && comment.length < 3) {
    return res.status(400).json({ error: 'يرجى كتابة سبب واضح للرفض أو الإعادة للتعديل.' });
  }

  try {
    const config = await getSystemConfig();

    const updatedTxn = await db.transaction(async (tx) => {
      // Row-level lock on transaction to serialize concurrent actions
      const [txn] = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.id, txnId))
        .for('update')
        .limit(1);
      if (!txn) throw httpError(404, 'المعاملة غير موجودة.');

      // Row-level lock on employee to serialize salary/grade/leave balance mutations
      const [emp] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, txn.employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (!emp) throw httpError(404, 'المنتسب المرتبط بالمعاملة غير موجود.');

      const isHR = hasPermission(user.role, 'approve_hr');
      const isDept = hasPermission(user.role, 'approve_dept') && canAccessEmployee(user, emp);
      const isOwner = txn.createdByUid === user.uid || (user.employeeId !== null && user.employeeId === txn.employeeId);
      const wf = config.workflows.find((w) => w.transactionType === txn.transactionType) ?? null;

      const decision = evaluateTransactionTransition({
        currentStatus: txn.status,
        currentRole: txn.currentResponsibleRole,
        executedAt: txn.executedAt,
        action,
        isHR,
        isDept,
        isOwner,
        workflow: wf,
      });

      if (!decision.allowed || !decision.nextStatus || !decision.nextRole || !decision.actionLabel) {
        throw httpError(decision.statusCode || 409, decision.error || 'الانتقال المطلوب غير مسموح.');
      }

      const nextStatus = decision.nextStatus;
      const nextRole = decision.nextRole;
      const actionLabel = decision.actionLabel;
      const completedAt = decision.setCompletedAt ? new Date() : txn.completedAt;
      const escalated = decision.setEscalated ? true : txn.escalated;
      const rejectionReason = action === 'REJECT' ? comment : txn.rejectionReason;
      const executedAt = decision.shouldExecuteFinalEffects ? new Date() : txn.executedAt;

      const prevHistory = Array.isArray(txn.history) ? (txn.history as TransactionHistoryStep[]) : [];
      const nextHistory: TransactionHistoryStep[] = [
        ...prevHistory,
        {
          timestamp: new Date().toISOString(),
          actorName: user.displayName || user.email,
          actorRole: user.role,
          action: actionLabel,
          comment: comment || undefined,
          fromStatus: txn.status,
          toStatus: nextStatus,
        },
      ];

      // Sync linked Leave Request & strictly validate/deduct balance on final approval
      if (txn.transactionType === 'LEAVE') {
        const linkedLeaves = await tx
          .select()
          .from(leaveRequests)
          .where(eq(leaveRequests.transactionId, txnId))
          .for('update')
          .limit(1);

        if (linkedLeaves.length > 0) {
          const lv = linkedLeaves[0];
          if (decision.shouldExecuteFinalEffects) {
            const leaveCfg = config.orgCatalogs.leaveTypes.find((lt) => lt.name === lv.leaveType);
            const deductTarget = leaveCfg?.deductsFrom ?? 'annual';
            if (deductTarget === 'annual') {
              if (emp.annualLeaveBalance < lv.days) {
                throw httpError(
                  409,
                  `لا يمكن اعتماد الإجازة: رصيد الإجازات الاعتيادية الحالي (${emp.annualLeaveBalance} يوماً) أقل من المدة المطلوبة (${lv.days} يوماً).`
                );
              }
              await tx
                .update(employees)
                .set({
                  annualLeaveBalance: emp.annualLeaveBalance - lv.days,
                  updatedAt: new Date(),
                })
                .where(eq(employees.id, emp.id));
            } else if (deductTarget === 'sick') {
              if (emp.sickLeaveBalance < lv.days) {
                throw httpError(
                  409,
                  `لا يمكن اعتماد الإجازة: رصيد الإجازات المرضية الحالي (${emp.sickLeaveBalance} يوماً) أقل من المدة المطلوبة (${lv.days} يوماً).`
                );
              }
              await tx
                .update(employees)
                .set({
                  sickLeaveBalance: emp.sickLeaveBalance - lv.days,
                  updatedAt: new Date(),
                })
                .where(eq(employees.id, emp.id));
            }
          }

          await tx
            .update(leaveRequests)
            .set({
              status: nextStatus,
              rejectionReason: nextStatus === 'مرفوض' ? comment : null,
              approvedBy: nextStatus === 'معتمد' ? user.displayName || user.email : lv.approvedBy,
              updatedAt: new Date(),
            })
            .where(eq(leaveRequests.id, lv.id));
        }
      }

      // Sync linked Training Enrollment with row-locked seat enforcement on approval
      if (txn.transactionType === 'TRAINING') {
        const linkedEnrollments = await tx
          .select()
          .from(trainingEnrollments)
          .where(eq(trainingEnrollments.transactionId, txnId))
          .for('update')
          .limit(1);

        if (linkedEnrollments.length > 0) {
          const enr = linkedEnrollments[0];
          if (decision.shouldExecuteFinalEffects) {
            const [course] = await tx
              .select()
              .from(trainingCourses)
              .where(eq(trainingCourses.id, enr.courseId))
              .for('update')
              .limit(1);
            if (!course) throw httpError(404, 'الدورة التدريبية المرتبطة غير موجودة.');

            const currentCourseEnrollments = await tx
              .select({ id: trainingEnrollments.id, status: trainingEnrollments.status })
              .from(trainingEnrollments)
              .where(eq(trainingEnrollments.courseId, course.id));
            const confirmedCount = currentCourseEnrollments.filter(
              (item) => item.id !== enr.id && (item.status === 'معتمد' || item.status === 'مكتمل')
            ).length;
            if (confirmedCount >= course.totalSeats) {
              throw httpError(409, 'لا يمكن الاعتماد: اكتملت جميع المقاعد المتاحة لهذه الدورة التدريبية.');
            }
          }

          await tx
            .update(trainingEnrollments)
            .set({
              status: nextStatus,
              rejectionReason: nextStatus === 'مرفوض' ? comment : null,
              updatedAt: new Date(),
            })
            .where(eq(trainingEnrollments.id, enr.id));
        }
      }

      // Execute Promotion / Annual Increment ONLY once (guarded by executedAt) after explicit HR approval
      if (
        decision.shouldExecuteFinalEffects &&
        (txn.transactionType === 'PROMOTION_REVIEW' || txn.transactionType === 'INCREMENT_REVIEW')
      ) {
        const rulesGate = canRunOfficialHRCalculation(config.hrRules);
        if (!rulesGate.allowed) {
          throw httpError(422, rulesGate.reason || 'ضوابط الاحتساب غير معتمدة.');
        }

        const effectiveDate = String((txn.payload as Record<string, unknown>)?.effectiveDate || todayISO());
        const isPromo = txn.transactionType === 'PROMOTION_REVIEW';
        if (isPromo && emp.grade <= 1) {
          throw httpError(409, 'لا يمكن تنفيذ الترفيع: المنتسب يشغل الدرجة الأولى مسبقاً.');
        }

        const nextGrade = isPromo ? Math.max(1, emp.grade - 1) : emp.grade;
        const nextStep = isPromo ? 1 : Math.min(11, emp.step + 1);
        const pct = isPromo
          ? config.hrRules.promotionSalaryIncreasePct
          : config.hrRules.incrementSalaryIncreasePct;
        const nextSalary = Math.round(emp.basicSalaryIQD * (1 + pct / 100));

        await tx
          .update(employees)
          .set({
            grade: nextGrade,
            step: nextStep,
            basicSalaryIQD: nextSalary,
            lastIncrementDate: effectiveDate,
            lastPromotionDate: isPromo ? effectiveDate : emp.lastPromotionDate,
            updatedAt: new Date(),
          })
          .where(eq(employees.id, emp.id));

        if (isPromo) {
          await tx
            .update(appreciations)
            .set({ appliedToCurrentCycle: false })
            .where(eq(appreciations.employeeId, emp.id));
          await tx
            .update(penalties)
            .set({ appliedToCurrentCycle: false })
            .where(eq(penalties.employeeId, emp.id));
        }

        const orderNumber = generateCode(isPromo ? 'ORD-PRM' : 'ORD-INC');
        await tx.insert(documents).values({
          documentNumber: orderNumber,
          title: isPromo
            ? `أمر إداري بالترفيع إلى الدرجة ${nextGrade}`
            : `أمر إداري بمنح العلاوة السنوية (المرحلة ${nextStep})`,
          category: 'أمر إداري',
          issueDate: effectiveDate,
          issuingAuthority: 'قسم الموارد البشرية - شركة نفط البصرة',
          employeeId: emp.id,
          transactionId: txn.id,
          department: emp.department,
          oilfield: emp.oilfield,
          description: `معتمد بموجب المعاملة رقم ${txn.transactionNumber}`,
          fileName: `${orderNumber}.pdf`,
          mimeType: 'application/pdf',
          fileSize: 'رسمي إلكتروني',
          confidentialityLevel: 'INTERNAL',
          verificationCode: generateCode('BOC-ORD'),
          uploadedBy: user.displayName || user.email,
        });

        await tx.insert(careerEvents).values({
          employeeId: emp.id,
          eventType: isPromo ? 'ترفيع' : 'علاوة',
          title: isPromo
            ? `ترفيع وظيفي إلى الدرجة ${nextGrade} / المرحلة 1`
            : `منح علاوة سنوية إلى المرحلة ${nextStep}`,
          description: `تم التنفيذ بعد اعتماد المعاملة رقم ${txn.transactionNumber}`,
          eventDate: effectiveDate,
          referenceNumber: orderNumber,
          createdBy: user.displayName || user.email,
        });
      }

      const [saved] = await tx
        .update(transactions)
        .set({
          status: nextStatus,
          currentResponsibleRole: nextRole,
          history: nextHistory,
          rejectionReason,
          escalated,
          completedAt,
          executedAt,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, txnId))
        .returning();

      // Notify initiator directly
      await createNotification(
        {
          recipientUid: txn.createdByUid,
          title: `تحديث حالة المعاملة ${txn.transactionNumber}`,
          message: `${actionLabel}: ${txn.title} ← ${nextStatus}`,
          severity: nextStatus === 'مرفوض' ? 'critical' : nextStatus === 'معتمد' ? 'success' : 'info',
          entityType: 'TRANSACTION',
          entityId: txn.id,
        },
        tx
      );

      // Notify next approver role if still pending
      if (nextStatus === 'بانتظار موافقة الموارد البشرية' || nextStatus === 'بانتظار موافقة القسم') {
        await createNotification(
          {
            recipientRole: nextRole,
            title: `معاملة محالة للمراجعة: ${txn.transactionNumber}`,
            message: `${txn.title} — ${emp.fullName}`,
            severity: 'warning',
            entityType: 'TRANSACTION',
            entityId: txn.id,
          },
          tx
        );
      }

      await writeAuditLog(
        {
          actor: user,
          operation: `WORKFLOW_${action}`,
          recordType: 'TRANSACTION',
          recordId: txn.id,
          previousValues: { status: txn.status, executedAt: txn.executedAt },
          newValues: { status: nextStatus, executedAt },
          details: `${actionLabel} للمعاملة ${txn.transactionNumber} (${emp.fullName})${comment ? ` — ${comment}` : ''}`,
        },
        tx
      );

      return saved;
    });

    res.json(updatedTxn);
  } catch (error) {
    handleRouteError(res, error, 'فشل تنفيذ إجراء سير العمل.');
  }
});

// ============================================================================
// 8. Training Management (Row-Locked Seat & Certificate Integrity)
// ============================================================================
const courseSchema = z.object({
  code: z.string().trim().min(2).max(40),
  title: z.string().trim().min(3).max(200),
  titleEn: z.string().trim().max(200).optional().default(''),
  category: z.string().trim().min(2).max(80),
  deliveryType: z.enum(['داخلي', 'خارجي', 'إلكتروني']),
  provider: z.string().trim().min(2).max(160),
  instructor: z.string().trim().min(2).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().trim().min(2).max(160),
  totalSeats: z.coerce.number().int().min(1).max(500),
  budgetIQD: z.coerce.number().int().min(0).default(0),
  trainingPlanYear: z.coerce.number().int().min(2020).max(2100).default(2026),
  status: z.enum(['مفتوح للتسجيل', 'جاري الانعقاد', 'مكتمل', 'مؤجل', 'ملغى']).default('مفتوح للتسجيل'),
});

apiRouter.post('/courses', requirePermission('manage_training'), async (req: AuthRequest, res) => {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات الدورة التدريبية غير مكتملة.' });
  if (calculateDateRangeDays(parsed.data.startDate, parsed.data.endDate) <= 0) {
    return res.status(400).json({ error: 'تاريخ انتهاء الدورة يجب أن يكون مساوياً أو بعد تاريخ البدء.' });
  }
  try {
    const created = await db.transaction(async (tx) => {
      const [course] = await tx
        .insert(trainingCourses)
        .values({ ...parsed.data, code: parsed.data.code.toUpperCase() })
        .returning();
      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE',
          recordType: 'TRAINING_COURSE',
          recordId: course.id,
          details: `إضافة دورة تدريبية: ${course.title} (${course.code})`,
        },
        tx
      );
      return course;
    });
    res.status(201).json({ ...created, enrolledCount: 0 });
  } catch (error) {
    handleRouteError(res, error, 'فشل إضافة الدورة التدريبية.');
  }
});

apiRouter.patch('/courses/:id', requirePermission('manage_training'), async (req: AuthRequest, res) => {
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'معرف الدورة غير صالح.' });
  const parsed = courseSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات تحديث الدورة غير صالحة.' });
  try {
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(trainingCourses)
        .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
        .for('update')
        .limit(1);
      if (!existing) throw httpError(404, 'الدورة غير موجودة.');

      const [saved] = await tx
        .update(trainingCourses)
        .set(parsed.data)
        .where(eq(trainingCourses.id, courseId))
        .returning();

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'UPDATE',
          recordType: 'TRAINING_COURSE',
          recordId: courseId,
          newValues: { status: saved.status, startDate: saved.startDate, endDate: saved.endDate },
          details: `تحديث/إعادة جدولة الدورة ${saved.code}: الحالة (${saved.status})`,
        },
        tx
      );
      return saved;
    });
    res.json(updated);
  } catch (error) {
    handleRouteError(res, error, 'فشل تحديث الدورة التدريبية.');
  }
});

apiRouter.post('/courses/:id/apply', async (req: AuthRequest, res) => {
  if (req.dbUser!.role === 'READ_ONLY') return res.status(403).json({ error: 'حساب قراءة فقط.' });
  const courseId = Number(req.params.id);
  const employeeId = Number(req.body.employeeId || req.dbUser!.employeeId);
  if (!Number.isInteger(courseId) || !Number.isInteger(employeeId)) {
    return res.status(400).json({ error: 'يرجى تحديد المنتسب والدورة التدريبية بشكل صحيح.' });
  }

  try {
    const config = await getSystemConfig();
    const result = await db.transaction(async (tx) => {
      // Lock course row so concurrent applications cannot oversell seats or duplicate
      const [course] = await tx
        .select()
        .from(trainingCourses)
        .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
        .for('update')
        .limit(1);
      if (!course) throw httpError(404, 'الدورة غير موجودة.');
      if (course.status !== 'مفتوح للتسجيل') {
        throw httpError(400, 'التسجيل مغلق لهذه الدورة حالياً.');
      }

      const [emp] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
        .limit(1);
      if (!emp) throw httpError(404, 'المنتسب غير موجود.');
      if (!canAccessEmployee(req.dbUser!, emp)) {
        throw httpError(403, 'لا تملك صلاحية التقديم لهذا المنتسب.');
      }

      const existing = await tx
        .select()
        .from(trainingEnrollments)
        .where(eq(trainingEnrollments.courseId, courseId));

      if (existing.some((e) => e.employeeId === emp.id && e.status !== 'مرفوض')) {
        throw httpError(409, 'المنتسب مقدم مسبقاً لهذه الدورة.');
      }
      const confirmedCount = existing.filter((e) => e.status === 'معتمد' || e.status === 'مكتمل').length;
      if (confirmedCount >= course.totalSeats) {
        throw httpError(409, 'اكتملت المقاعد المتاحة لهذه الدورة.');
      }

      const wf = config.workflows.find((w) => w.transactionType === 'TRAINING');
      const initialStatus = wf?.requiresDeptApproval ? 'بانتظار موافقة القسم' : 'بانتظار موافقة الموارد البشرية';
      const initialRole = wf?.requiresDeptApproval ? 'DEPT_MANAGER' : 'HR_MANAGER';

      const txnNo = generateCode('TRN');
      const [txn] = await tx
        .insert(transactions)
        .values({
          transactionNumber: txnNo,
          transactionType: 'TRAINING',
          title: `ترشيح لدورة تدريبية: ${course.title}`,
          employeeId: emp.id,
          department: emp.department,
          oilfield: emp.oilfield,
          currentResponsibleRole: initialRole,
          status: initialStatus,
          payload: { courseId: course.id, courseCode: course.code, courseTitle: course.title },
          history: [
            {
              timestamp: new Date().toISOString(),
              actorName: req.dbUser!.displayName || req.dbUser!.email,
              actorRole: req.dbUser!.role,
              action: 'تقديم طلب التحاق بدورة تدريبية',
              fromStatus: 'مسودة',
              toStatus: initialStatus,
            },
          ],
          createdByUid: req.dbUser!.uid,
        })
        .returning();

      const [enrollment] = await tx
        .insert(trainingEnrollments)
        .values({
          courseId: course.id,
          employeeId: emp.id,
          transactionId: txn.id,
          appliedDate: todayISO(),
          status: initialStatus,
        })
        .returning();

      await createNotification(
        {
          recipientRole: initialRole,
          title: 'طلب ترشيح تدريبي جديد',
          message: `${emp.fullName} — دورة ${course.title} (${txnNo})`,
          severity: 'info',
          entityType: 'TRANSACTION',
          entityId: txn.id,
        },
        tx
      );

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'APPLY_TRAINING',
          recordType: 'TRAINING_ENROLLMENT',
          recordId: enrollment.id,
          details: `تقديم ${emp.fullName} لدورة ${course.code} (${course.title})`,
        },
        tx
      );

      return { enrollment, transaction: txn };
    });

    res.status(201).json(result);
  } catch (error) {
    handleRouteError(res, error, 'فشل التقديم للدورة التدريبية.');
  }
});

apiRouter.patch('/enrollments/:id', requirePermission('manage_training'), async (req: AuthRequest, res) => {
  const enrollmentId = Number(req.params.id);
  if (!Number.isInteger(enrollmentId)) return res.status(400).json({ error: 'معرف سجل التدريب غير صالح.' });
  const schema = z.object({
    attendancePercent: z.coerce.number().int().min(0).max(100).optional(),
    evaluationScore: z.coerce.number().int().min(0).max(100).optional().nullable(),
    evaluationNotes: z.string().trim().max(500).optional().nullable(),
    markCompleted: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات التقييم والحضور غير صالحة.' });

  try {
    const updated = await db.transaction(async (tx) => {
      const [enr] = await tx
        .select()
        .from(trainingEnrollments)
        .where(eq(trainingEnrollments.id, enrollmentId))
        .for('update')
        .limit(1);
      if (!enr) throw httpError(404, 'سجل التدريب غير موجود.');

      if (parsed.data.markCompleted && enr.status !== 'معتمد' && enr.status !== 'مكتمل') {
        throw httpError(409, 'لا يمكن إصدار شهادة إتمام قبل اعتماد ترشيح المنتسب للدورة.');
      }

      const [[course], [emp]] = await Promise.all([
        tx.select().from(trainingCourses).where(eq(trainingCourses.id, enr.courseId)).limit(1),
        tx.select().from(employees).where(eq(employees.id, enr.employeeId)).limit(1),
      ]);

      let certDocId = enr.certificateDocumentId;
      let nextStatus = enr.status;

      if (parsed.data.markCompleted && course && emp) {
        nextStatus = 'مكتمل';
        if (!certDocId) {
          const certNo = generateCode('CERT');
          const [certDoc] = await tx
            .insert(documents)
            .values({
              documentNumber: certNo,
              title: `شهادة إتمام دورة تدريبية: ${course.title}`,
              category: 'شهادة دورة تدريبية',
              issueDate: todayISO(),
              issuingAuthority: course.provider,
              employeeId: emp.id,
              transactionId: enr.transactionId,
              department: emp.department,
              oilfield: emp.oilfield,
              description: `إنجاز دورة ${course.code} — نسبة الحضور ${parsed.data.attendancePercent ?? 100}%`,
              fileName: `${certNo}.pdf`,
              mimeType: 'application/pdf',
              fileSize: 'شهادة رسمية إلكترونية',
              confidentialityLevel: 'INTERNAL',
              verificationCode: generateCode('BOC-TRN'),
              uploadedBy: req.dbUser!.displayName || req.dbUser!.email,
            })
            .returning();
          certDocId = certDoc.id;

          await addCareerEvent(
            {
              employeeId: emp.id,
              eventType: 'دورة تدريبية',
              title: `إتمام دورة تدريبية: ${course.title}`,
              description: `الجهة المنفذة: ${course.provider} · رقم الشهادة: ${certNo}`,
              eventDate: todayISO(),
              referenceNumber: certNo,
              createdBy: req.dbUser!.displayName || req.dbUser!.email,
            },
            tx
          );
        }
        if (enr.transactionId) {
          await tx
            .update(transactions)
            .set({ status: 'مكتمل', completedAt: new Date(), updatedAt: new Date() })
            .where(eq(transactions.id, enr.transactionId));
        }
      }

      const [saved] = await tx
        .update(trainingEnrollments)
        .set({
          attendancePercent: parsed.data.attendancePercent ?? enr.attendancePercent,
          evaluationScore: parsed.data.evaluationScore !== undefined ? parsed.data.evaluationScore : enr.evaluationScore,
          evaluationNotes: parsed.data.evaluationNotes !== undefined ? parsed.data.evaluationNotes : enr.evaluationNotes,
          status: nextStatus,
          certificateDocumentId: certDocId,
          updatedAt: new Date(),
        })
        .where(eq(trainingEnrollments.id, enrollmentId))
        .returning();

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: parsed.data.markCompleted ? 'COMPLETE_TRAINING' : 'UPDATE_TRAINING',
          recordType: 'TRAINING_ENROLLMENT',
          recordId: enrollmentId,
          details: `تحديث حضور/تقييم ${emp?.fullName ?? ''} في دورة ${course?.code ?? ''}${
            parsed.data.markCompleted ? ' وأرشفة الشهادة تلقائياً' : ''
          }`,
        },
        tx
      );

      return saved;
    });

    res.json(updated);
  } catch (error) {
    handleRouteError(res, error, 'فشل تحديث سجل التدريب.');
  }
});

// ============================================================================
// 9. Leave Management (Row-Locked Overlap, Balance & Required Attachment Check)
// ============================================================================
apiRouter.post('/leaves', async (req: AuthRequest, res) => {
  if (req.dbUser!.role === 'READ_ONLY') return res.status(403).json({ error: 'حساب قراءة فقط.' });
  const schema = z.object({
    employeeId: z.coerce.number().int(),
    leaveType: z.string().trim().min(2).max(80),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(3).max(500),
    attachmentDocumentId: z.coerce.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات طلب الإجازة غير مكتملة.' });

  const { employeeId, leaveType, startDate, endDate, reason, attachmentDocumentId } = parsed.data;
  const days = calculateDateRangeDays(startDate, endDate);
  if (days <= 0) {
    return res.status(400).json({ error: 'تاريخ انتهاء الإجازة يجب أن يكون مساوياً أو بعد تاريخ البدء.' });
  }

  try {
    const config = await getSystemConfig();
    const result = await db.transaction(async (tx) => {
      const [emp] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (!emp) throw httpError(404, 'المنتسب غير موجود.');
      if (!canAccessEmployee(req.dbUser!, emp)) {
        throw httpError(403, 'لا تملك صلاحية تقديم إجازة لهذا المنتسب.');
      }

      const leaveCfg = config.orgCatalogs.leaveTypes.find((lt) => lt.name === leaveType);
      if (leaveCfg && days > leaveCfg.maxDaysPerRequest) {
        throw httpError(
          400,
          `الحد الأقصى المسموح به لـ «${leaveType}» هو ${leaveCfg.maxDaysPerRequest} يوماً في الطلب الواحد.`
        );
      }
      if (leaveCfg?.deductsFrom === 'annual' && emp.annualLeaveBalance < days) {
        throw httpError(400, `رصيد الإجازات الاعتيادية (${emp.annualLeaveBalance} يوماً) لا يكفي.`);
      }
      if (leaveCfg?.deductsFrom === 'sick' && emp.sickLeaveBalance < days) {
        throw httpError(400, `رصيد الإجازات المرضية (${emp.sickLeaveBalance} يوماً) لا يكفي.`);
      }

      if (leaveCfg?.requiresAttachment) {
        if (!attachmentDocumentId) {
          throw httpError(
            400,
            `يتطلب تقديم «${leaveType}» إرفاق وثيقة ثبوتية مؤرشفة (مثل تقرير طبي أو كتاب رسمي).`
          );
        }
        const [doc] = await tx
          .select({ id: documents.id, employeeId: documents.employeeId })
          .from(documents)
          .where(and(eq(documents.id, attachmentDocumentId), isNull(documents.deletedAt)))
          .limit(1);
        if (!doc || doc.employeeId !== emp.id) {
          throw httpError(400, 'الوثيقة المرفقة غير موجودة أو غير مرتبطة بملف هذا المنتسب.');
        }
      }

      const existingLeaves = await tx
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.employeeId, emp.id));

      if (hasOverlappingLeave(existingLeaves, emp.id, startDate, endDate)) {
        throw httpError(
          409,
          'يوجد تداخل زمني مع طلب إجازة آخر قائم أو معتمد لنفس المنتسب في هذه الفترة.'
        );
      }

      const wf = config.workflows.find((w) => w.transactionType === 'LEAVE');
      const initialStatus = wf?.requiresDeptApproval ? 'بانتظار موافقة القسم' : 'بانتظار موافقة الموارد البشرية';
      const initialRole = wf?.requiresDeptApproval ? 'DEPT_MANAGER' : 'HR_MANAGER';

      const txnNo = generateCode('LV');
      const [txn] = await tx
        .insert(transactions)
        .values({
          transactionNumber: txnNo,
          transactionType: 'LEAVE',
          title: `طلب ${leaveType} (${days} أيام) — ${emp.fullName}`,
          employeeId: emp.id,
          department: emp.department,
          oilfield: emp.oilfield,
          currentResponsibleRole: initialRole,
          status: initialStatus,
          payload: { leaveType, startDate, endDate, days, reason, attachmentDocumentId: attachmentDocumentId ?? null },
          history: [
            {
              timestamp: new Date().toISOString(),
              actorName: req.dbUser!.displayName || req.dbUser!.email,
              actorRole: req.dbUser!.role,
              action: 'تقديم طلب إجازة',
              fromStatus: 'مسودة',
              toStatus: initialStatus,
            },
          ],
          createdByUid: req.dbUser!.uid,
        })
        .returning();

      const [createdLeave] = await tx
        .insert(leaveRequests)
        .values({
          employeeId: emp.id,
          transactionId: txn.id,
          attachmentDocumentId: attachmentDocumentId ?? null,
          leaveType,
          startDate,
          endDate,
          days,
          reason,
          status: initialStatus,
        })
        .returning();

      await createNotification(
        {
          recipientRole: initialRole,
          title: `طلب ${leaveType} جديد`,
          message: `${emp.fullName} (${startDate} ← ${endDate} · ${days} أيام)`,
          severity: 'info',
          entityType: 'TRANSACTION',
          entityId: txn.id,
        },
        tx
      );

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE',
          recordType: 'LEAVE_REQUEST',
          recordId: createdLeave.id,
          details: `تقديم ${leaveType} للمنتسب ${emp.fullName} لمدة ${days} أيام (${startDate} ← ${endDate})`,
        },
        tx
      );

      return { leave: createdLeave, transaction: txn };
    });

    res.status(201).json(result);
  } catch (error) {
    handleRouteError(res, error, 'فشل تسجيل طلب الإجازة.');
  }
});

apiRouter.post('/leaves/adjust-balance', requirePermission('approve_hr'), async (req: AuthRequest, res) => {
  const schema = z.object({
    employeeId: z.coerce.number().int(),
    balanceType: z.enum(['annual', 'sick']),
    deltaDays: z.coerce.number().int().min(-365).max(365),
    reason: z.string().trim().min(3).max(400),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات تعديل الرصيد غير صالحة.' });

  try {
    const updated = await db.transaction(async (tx) => {
      const [emp] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (!emp) throw httpError(404, 'المنتسب غير موجود.');

      const prevAnnual = emp.annualLeaveBalance;
      const prevSick = emp.sickLeaveBalance;
      const nextAnnual =
        parsed.data.balanceType === 'annual' ? Math.max(0, prevAnnual + parsed.data.deltaDays) : prevAnnual;
      const nextSick =
        parsed.data.balanceType === 'sick' ? Math.max(0, prevSick + parsed.data.deltaDays) : prevSick;

      const [saved] = await tx
        .update(employees)
        .set({ annualLeaveBalance: nextAnnual, sickLeaveBalance: nextSick, updatedAt: new Date() })
        .where(eq(employees.id, emp.id))
        .returning();

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'ADJUST_LEAVE_BALANCE',
          recordType: 'EMPLOYEE',
          recordId: emp.id,
          previousValues: { annualLeaveBalance: prevAnnual, sickLeaveBalance: prevSick },
          newValues: { annualLeaveBalance: nextAnnual, sickLeaveBalance: nextSick },
          details: `تعديل رصيد الإجازة (${parsed.data.balanceType === 'annual' ? 'الاعتيادية' : 'المرضية'}) بمقدار ${parsed.data.deltaDays} يوم للمنتسب ${emp.fullName} — السبب: ${parsed.data.reason}`,
        },
        tx
      );

      return saved;
    });

    res.json(updated);
  } catch (error) {
    handleRouteError(res, error, 'فشل تعديل رصيد الإجازة.');
  }
});

// ============================================================================
// 10. Notifications (Strict Per-User Ownership & Role Broadcast Read Tracking)
// ============================================================================
apiRouter.patch('/notifications/:id/read', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'معرف الإشعار غير صالح.' });
  const user = req.dbUser!;

  try {
    await db.transaction(async (tx) => {
      const [notif] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.id, id))
        .for('update')
        .limit(1);
      if (!notif) throw httpError(404, 'الإشعار غير موجود.');
      if (!canManageNotification(user, notif)) {
        throw httpError(403, 'غير مصرح بإدارة إشعارات مستخدم آخر.');
      }

      if (notif.recipientUid) {
        await tx.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
      } else {
        const existingReaders = Array.isArray(notif.readByUids) ? (notif.readByUids as string[]) : [];
        if (!existingReaders.includes(user.uid)) {
          await tx
            .update(notifications)
            .set({ readByUids: [...existingReaders, user.uid] })
            .where(eq(notifications.id, id));
        }
      }
    });

    res.json({ ok: true });
  } catch (error) {
    handleRouteError(res, error, 'تعذر تحديث الإشعار.');
  }
});

apiRouter.post('/notifications/read-all', async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  try {
    await db.transaction(async (tx) => {
      // Mark personal notifications read
      await tx
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.recipientUid, user.uid));

      // Mark role-broadcast notifications read ONLY for this user in readByUids
      const roleNotifs = await tx
        .select()
        .from(notifications)
        .where(and(isNull(notifications.recipientUid), eq(notifications.recipientRole, user.role)))
        .for('update');

      for (const n of roleNotifs) {
        const readers = Array.isArray(n.readByUids) ? (n.readByUids as string[]) : [];
        if (!readers.includes(user.uid)) {
          await tx
            .update(notifications)
            .set({ readByUids: [...readers, user.uid] })
            .where(eq(notifications.id, n.id));
        }
      }
    });
    res.json({ ok: true });
  } catch (error) {
    handleRouteError(res, error, 'تعذر تحديث الإشعارات.');
  }
});

// ============================================================================
// 11. Administration: Users, Configurable Settings & Atomic Full Backups
// ============================================================================
apiRouter.patch('/admin/users/:id', requirePermission('manage_users'), async (req: AuthRequest, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'معرف المستخدم غير صالح.' });

  const schema = z.object({
    role: z.enum(['HR_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'SECTION_MANAGER', 'EMPLOYEE', 'READ_ONLY']).optional(),
    department: z.string().trim().max(120).optional(),
    section: z.string().trim().max(120).optional(),
    oilfield: z.string().trim().max(120).optional(),
    employeeId: z.coerce.number().int().nullable().optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات تعديل المستخدم غير صالحة.' });

  try {
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);
      if (!existing) throw httpError(404, 'المستخدم غير موجود.');

      if (existing.uid === req.dbUser!.uid && parsed.data.isActive === false) {
        throw httpError(400, 'لا يمكنك تعطيل حسابك النشط.');
      }
      if (existing.uid === req.dbUser!.uid && parsed.data.role && parsed.data.role !== 'HR_ADMIN') {
        throw httpError(400, 'لا يمكنك تخفيض صلاحية حسابك الإداري بنفسك.');
      }

      const willStopBeingActiveAdmin =
        existing.role === 'HR_ADMIN' &&
        existing.isActive &&
        ((parsed.data.role !== undefined && parsed.data.role !== 'HR_ADMIN') || parsed.data.isActive === false);

      if (willStopBeingActiveAdmin) {
        const activeAdmins = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'HR_ADMIN'), eq(users.isActive, true)));
        if (activeAdmins.length <= 1) {
          throw httpError(400, 'لا يمكن تعطيل أو تخفيض صلاحية آخر مدير نظام نشط في المنصة.');
        }
      }

      const revokeSessions =
        (parsed.data.role !== undefined && parsed.data.role !== existing.role) ||
        (parsed.data.isActive !== undefined && parsed.data.isActive !== existing.isActive);

      const [saved] = await tx
        .update(users)
        .set({
          ...parsed.data,
          tokenVersion: revokeSessions ? (existing.tokenVersion || 1) + 1 : existing.tokenVersion,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          uid: users.uid,
          employeeCode: users.employeeCode,
          email: users.email,
          displayName: users.displayName,
          photoUrl: users.photoUrl,
          role: users.role,
          department: users.department,
          section: users.section,
          oilfield: users.oilfield,
          employeeId: users.employeeId,
          isActive: users.isActive,
          mustResetPassword: users.mustResetPassword,
          createdAt: users.createdAt,
        });

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'UPDATE_USER_ROLE',
          recordType: 'USER',
          recordId: userId,
          previousValues: {
            role: existing.role,
            department: existing.department,
            section: existing.section,
            oilfield: existing.oilfield,
            isActive: existing.isActive,
          },
          newValues: {
            role: saved.role,
            department: saved.department,
            section: saved.section,
            oilfield: saved.oilfield,
            isActive: saved.isActive,
          },
          details: `تعديل صلاحيات المستخدم ${saved.email}: الدور (${saved.role}) · القسم (${saved.department || 'الكل'}) · الشعبة (${saved.section || 'الكل'})`,
        },
        tx
      );

      return saved;
    });

    res.json(updated);
  } catch (error) {
    handleRouteError(res, error, 'فشل تحديث صلاحيات المستخدم.');
  }
});

apiRouter.put('/admin/settings', requirePermission('manage_settings'), async (req: AuthRequest, res) => {
  const schema = z.object({
    hrRules: z.record(z.string(), z.unknown()).optional(),
    orgCatalogs: z.record(z.string(), z.unknown()).optional(),
    workflows: z.array(z.record(z.string(), z.unknown())).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'صيغة الإعدادات غير صالحة.' });

  const actorName = req.dbUser!.displayName || req.dbUser!.email;
  try {
    let nextHrRules: HRRulesConfig | undefined;
    if (parsed.data.hrRules) {
      const candidate = parsed.data.hrRules as unknown as HRRulesConfig;
      const validation = validateHRRulesConfig(candidate);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors[0] || 'قواعد الاحتساب غير صالحة.' });
      }
      const currentConfig = await getSystemConfig();
      const approvedNow = Boolean(candidate.rulesApproved);
      nextHrRules = {
        ...candidate,
        rulesApproved: approvedNow,
        approvedAt: approvedNow
          ? currentConfig.hrRules.rulesApproved && currentConfig.hrRules.approvedAt
            ? currentConfig.hrRules.approvedAt
            : new Date().toISOString()
          : null,
        approvedBy: approvedNow
          ? currentConfig.hrRules.rulesApproved && currentConfig.hrRules.approvedBy
            ? currentConfig.hrRules.approvedBy
            : actorName
          : null,
      };
    }

    await db.transaction(async (tx) => {
      if (nextHrRules) {
        await upsertSystemSetting('hr_rules', nextHrRules, actorName, tx);
      }
      if (parsed.data.orgCatalogs) {
        await upsertSystemSetting('org_catalogs', parsed.data.orgCatalogs, actorName, tx);
      }
      if (parsed.data.workflows) {
        await upsertSystemSetting('workflows', parsed.data.workflows, actorName, tx);
      }

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'UPDATE_SETTINGS',
          recordType: 'SYSTEM_SETTINGS',
          recordId: 'global',
          newValues: nextHrRules ? { rulesApproved: nextHrRules.rulesApproved, regulationReference: nextHrRules.regulationReference } : undefined,
          details: `تحديث إعدادات وقواعد نظام الموارد البشرية وسير العمل من لوحة الإدارة${
            nextHrRules?.rulesApproved ? ' (قواعد الاحتساب معتمدة رسمياً)' : ''
          }`,
        },
        tx
      );
    });

    const freshConfig = await getSystemConfig();
    res.json(freshConfig);
  } catch (error) {
    handleRouteError(res, error, 'فشل حفظ إعدادات النظام.');
  }
});

// Administrator-Only Backup & Complete Atomic Recovery
apiRouter.post('/admin/backups/export', requirePermission('manage_backups'), async (req: AuthRequest, res) => {
  const backupType = (['DATABASE', 'DOCUMENTS', 'FULL'].includes(req.body?.backupType)
    ? req.body.backupType
    : 'DATABASE') as 'DATABASE' | 'DOCUMENTS' | 'FULL';
  const notes = String(req.body?.notes || '').slice(0, 300);

  try {
    const payload: Record<string, unknown> = {
      schemaVersion: 'BOC-HRMS-ENTERPRISE-V3',
      backupType,
      exportedAt: new Date().toISOString(),
      exportedBy: req.dbUser!.email,
    };

    let recordCount = 0;

    if (backupType === 'DATABASE' || backupType === 'FULL') {
      const [emps, apps, pens, txns, crss, enrs, lvs, evts, cfgs] = await Promise.all([
        db.select().from(employees),
        db.select().from(appreciations),
        db.select().from(penalties),
        db.select().from(transactions),
        db.select().from(trainingCourses),
        db.select().from(trainingEnrollments),
        db.select().from(leaveRequests),
        db.select().from(careerEvents),
        getSystemConfig(),
      ]);
      payload.database = {
        employees: emps,
        appreciations: apps,
        penalties: pens,
        transactions: txns,
        trainingCourses: crss,
        trainingEnrollments: enrs,
        leaveRequests: lvs,
        careerEvents: evts,
        config: cfgs,
      };
      recordCount +=
        emps.length +
        apps.length +
        pens.length +
        txns.length +
        crss.length +
        enrs.length +
        lvs.length +
        evts.length;
    }

    if (backupType === 'DOCUMENTS' || backupType === 'FULL') {
      const allDocs = await db.select().from(documents);
      const hydratedDocs = await Promise.all(
        allDocs.map(async (doc) => {
          let base64 = doc.fileContentBase64;
          if (!base64 && doc.storageKey) {
            base64 = await readPrivateDocumentBase64(doc.storageKey);
          }
          return {
            ...doc,
            fileContentBase64: base64,
          };
        })
      );
      payload.documentStorage = hydratedDocs;
      recordCount += hydratedDocs.length;
    }

    const serialized = JSON.stringify(payload);
    const checksum = sha256Hex(serialized);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');

    const snapshot = await db.transaction(async (tx) => {
      const [snap] = await tx
        .insert(backupSnapshots)
        .values({
          backupType,
          status: 'مكتمل',
          recordCount,
          sizeBytes,
          checksum,
          notes,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        })
        .returning();

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'CREATE_BACKUP',
          recordType: 'BACKUP',
          recordId: snap.id,
          details: `إنشاء نسخة احتياطية (${backupType}) — ${recordCount} سجل · SHA-256: ${checksum.slice(0, 12)}...`,
        },
        tx
      );
      return snap;
    });

    res.json({ snapshot, bundle: { ...payload, checksum } });
  } catch (error) {
    handleRouteError(res, error, 'فشل إنشاء النسخة الاحتياطية.');
  }
});

apiRouter.post('/admin/backups/restore', requirePermission('manage_backups'), async (req: AuthRequest, res) => {
  const validation = validateBackupBundle(req.body?.bundle);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const bundle = validation.bundle;
  const savedStorageKeysForRollback: string[] = [];

  try {
    const summary = await db.transaction(async (tx) => {
      const counts = {
        config: 0,
        employees: 0,
        trainingCourses: 0,
        transactions: 0,
        documents: 0,
        appreciations: 0,
        penalties: 0,
        trainingEnrollments: 0,
        leaveRequests: 0,
        careerEvents: 0,
      };

      const empIdMap = new Map<number, number>();
      const courseIdMap = new Map<number, number>();
      const txnIdMap = new Map<number, number>();
      const docIdMap = new Map<number, number>();

      const dbData = bundle.database;
      const actor = req.dbUser!.email;

      // 1. Restore system settings with validation
      if (dbData?.config) {
        if (dbData.config.hrRules) {
          const hrCheck = validateHRRulesConfig(dbData.config.hrRules as unknown as HRRulesConfig);
          if (!hrCheck.valid) {
            throw httpError(400, `قواعد الاحتساب في النسخة الاحتياطية غير صالحة: ${hrCheck.errors[0]}`);
          }
          await upsertSystemSetting('hr_rules', dbData.config.hrRules, actor, tx);
          counts.config += 1;
        }
        if (dbData.config.orgCatalogs) {
          await upsertSystemSetting('org_catalogs', dbData.config.orgCatalogs, actor, tx);
          counts.config += 1;
        }
        if (dbData.config.workflows) {
          await upsertSystemSetting('workflows', dbData.config.workflows, actor, tx);
          counts.config += 1;
        }
      }

      // 2. Restore employees and build oldId -> newId map
      if (dbData?.employees) {
        for (const emp of dbData.employees) {
          const code = emp.employeeCode.toUpperCase();
          const existing = await tx
            .select({ id: employees.id })
            .from(employees)
            .where(eq(employees.employeeCode, code))
            .limit(1);

          if (existing.length > 0) {
            if (emp.id) empIdMap.set(emp.id, existing[0].id);
          } else {
            const [inserted] = await tx
              .insert(employees)
              .values({
                employeeCode: code,
                nationalId: emp.nationalId ?? null,
                fullName: emp.fullName,
                fullNameEn: emp.fullNameEn || '',
                birthDate: emp.birthDate ?? null,
                gender: emp.gender || 'ذكر',
                jobTitle: emp.jobTitle,
                jobTitleEn: emp.jobTitleEn || '',
                department: emp.department,
                oilfield: emp.oilfield,
                section: emp.section || '',
                grade: emp.grade,
                step: emp.step,
                hireDate: emp.hireDate,
                lastPromotionDate: emp.lastPromotionDate,
                lastIncrementDate: emp.lastIncrementDate,
                academicDegree: emp.academicDegree,
                specialization: emp.specialization || '',
                email: emp.email || '',
                phone: emp.phone || '',
                basicSalaryIQD: emp.basicSalaryIQD,
                annualLeaveBalance: emp.annualLeaveBalance,
                sickLeaveBalance: emp.sickLeaveBalance,
                status: emp.status,
                notes: emp.notes || '',
                deletedAt: emp.deletedAt ? new Date(emp.deletedAt) : null,
                createdAt: emp.createdAt ? new Date(emp.createdAt) : new Date(),
                updatedAt: new Date(),
              })
              .returning({ id: employees.id });
            if (emp.id) empIdMap.set(emp.id, inserted.id);
            counts.employees += 1;
          }
        }
      }

      // 3. Restore training courses
      if (dbData?.trainingCourses) {
        for (const raw of dbData.trainingCourses) {
          const code = String(raw.code || '').trim().toUpperCase();
          if (!code) continue;
          const oldId = typeof raw.id === 'number' ? raw.id : undefined;
          const existing = await tx
            .select({ id: trainingCourses.id })
            .from(trainingCourses)
            .where(eq(trainingCourses.code, code))
            .limit(1);

          if (existing.length > 0) {
            if (oldId) courseIdMap.set(oldId, existing[0].id);
          } else {
            const [inserted] = await tx
              .insert(trainingCourses)
              .values({
                code,
                title: String(raw.title || code),
                titleEn: String(raw.titleEn || ''),
                category: String(raw.category || 'عام'),
                deliveryType: String(raw.deliveryType || 'داخلي'),
                provider: String(raw.provider || 'شركة نفط البصرة'),
                instructor: String(raw.instructor || 'مدرب معتمد'),
                startDate: String(raw.startDate || todayISO()),
                endDate: String(raw.endDate || todayISO()),
                location: String(raw.location || 'البصرة'),
                totalSeats: Number(raw.totalSeats || 20),
                budgetIQD: Number(raw.budgetIQD || 0),
                trainingPlanYear: Number(raw.trainingPlanYear || 2026),
                status: String(raw.status || 'مفتوح للتسجيل'),
                deletedAt: raw.deletedAt ? new Date(String(raw.deletedAt)) : null,
              })
              .returning({ id: trainingCourses.id });
            if (oldId) courseIdMap.set(oldId, inserted.id);
            counts.trainingCourses += 1;
          }
        }
      }

      // 4. Restore transactions
      if (dbData?.transactions) {
        for (const raw of dbData.transactions) {
          const txnNo = String(raw.transactionNumber || '').trim();
          const oldEmpId = Number(raw.employeeId);
          const mappedEmpId = empIdMap.get(oldEmpId);
          if (!txnNo || !mappedEmpId) continue;

          const oldId = typeof raw.id === 'number' ? raw.id : undefined;
          const existing = await tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.transactionNumber, txnNo))
            .limit(1);

          if (existing.length > 0) {
            if (oldId) txnIdMap.set(oldId, existing[0].id);
          } else {
            const [inserted] = await tx
              .insert(transactions)
              .values({
                transactionNumber: txnNo,
                transactionType: String(raw.transactionType || 'GENERAL'),
                title: String(raw.title || txnNo),
                employeeId: mappedEmpId,
                department: String(raw.department || ''),
                oilfield: String(raw.oilfield || ''),
                currentResponsibleRole: String(raw.currentResponsibleRole || 'HR_MANAGER'),
                status: String(raw.status || 'مؤرشف'),
                payload: (raw.payload as Record<string, unknown>) || {},
                history: Array.isArray(raw.history) ? raw.history : [],
                rejectionReason: raw.rejectionReason ? String(raw.rejectionReason) : null,
                escalated: Boolean(raw.escalated),
                createdByUid: String(raw.createdByUid || req.dbUser!.uid),
                completedAt: raw.completedAt ? new Date(String(raw.completedAt)) : null,
                executedAt: raw.executedAt ? new Date(String(raw.executedAt)) : null,
              })
              .returning({ id: transactions.id });
            if (oldId) txnIdMap.set(oldId, inserted.id);
            counts.transactions += 1;
          }
        }
      }

      // 5. Restore documents (with binary validation & confined private storage)
      if (Array.isArray(bundle.documentStorage)) {
        for (const raw of bundle.documentStorage) {
          const docNo = String(raw.documentNumber || '').trim();
          if (!docNo) continue;
          const oldId = typeof raw.id === 'number' ? raw.id : undefined;

          const existing = await tx
            .select({ id: documents.id })
            .from(documents)
            .where(eq(documents.documentNumber, docNo))
            .limit(1);

          if (existing.length > 0) {
            if (oldId) docIdMap.set(oldId, existing[0].id);
            continue;
          }

          let storageKey: string | null = null;
          let shaHash: string | null = raw.sha256Hash ? String(raw.sha256Hash) : null;
          if (typeof raw.fileContentBase64 === 'string' && raw.fileContentBase64.length > 0) {
            const check = validateBase64DocumentUpload(
              raw.fileContentBase64,
              String(raw.mimeType || 'application/pdf'),
              String(raw.fileName || `${docNo}.pdf`)
            );
            if (!check.ok) {
              throw httpError(400, `ملف الوثيقة (${docNo}) داخل النسخة الاحتياطية غير صالح: ${check.error}`);
            }
            storageKey = await savePrivateDocumentFile(check.data.buffer, check.data.extension);
            savedStorageKeysForRollback.push(storageKey);
            shaHash = check.data.sha256Hash;
          }

          const mappedEmpId = typeof raw.employeeId === 'number' ? empIdMap.get(raw.employeeId) ?? null : null;
          const mappedTxnId = typeof raw.transactionId === 'number' ? txnIdMap.get(raw.transactionId) ?? null : null;

          const [inserted] = await tx
            .insert(documents)
            .values({
              documentNumber: docNo,
              title: String(raw.title || docNo),
              category: String(raw.category || 'أمر إداري'),
              issueDate: String(raw.issueDate || todayISO()),
              expiryDate: raw.expiryDate ? String(raw.expiryDate) : null,
              issuingAuthority: String(raw.issuingAuthority || 'شركة نفط البصرة'),
              employeeId: mappedEmpId,
              transactionId: mappedTxnId,
              department: String(raw.department || ''),
              oilfield: String(raw.oilfield || ''),
              description: String(raw.description || ''),
              fileName: String(raw.fileName || `${docNo}.pdf`),
              mimeType: String(raw.mimeType || 'application/pdf'),
              fileSize: String(raw.fileSize || 'رسمي إلكتروني'),
              storageKey,
              sha256Hash: shaHash,
              confidentialityLevel: String(raw.confidentialityLevel || 'INTERNAL'),
              fileContentBase64: null,
              version: Number(raw.version || 1),
              archiveStatus: String(raw.archiveStatus || 'نشط'),
              verificationCode: String(raw.verificationCode || generateCode('DOC-RST')),
              uploadedBy: String(raw.uploadedBy || actor),
              deletedAt: raw.deletedAt ? new Date(String(raw.deletedAt)) : null,
            })
            .returning({ id: documents.id });

          if (oldId) docIdMap.set(oldId, inserted.id);
          counts.documents += 1;
        }
      }

      // 6. Restore appreciations
      if (dbData?.appreciations) {
        for (const raw of dbData.appreciations) {
          const mappedEmpId = empIdMap.get(Number(raw.employeeId));
          const verCode = String(raw.verificationCode || '').trim() || generateCode('BOC-APP');
          if (!mappedEmpId) continue;

          const existing = await tx
            .select({ id: appreciations.id })
            .from(appreciations)
            .where(eq(appreciations.verificationCode, verCode))
            .limit(1);
          if (existing.length > 0) continue;

          await tx.insert(appreciations).values({
            employeeId: mappedEmpId,
            letterNumber: String(raw.letterNumber || verCode),
            issueDate: String(raw.issueDate || todayISO()),
            issuingAuthority: String(raw.issuingAuthority || 'شركة نفط البصرة'),
            subject: String(raw.subject || 'كتاب شكر وتقدير'),
            seniorityMonths: Number(raw.seniorityMonths || 1),
            appliedToCurrentCycle: Boolean(raw.appliedToCurrentCycle ?? true),
            verificationCode: verCode,
            createdBy: String(raw.createdBy || actor),
            deletedAt: raw.deletedAt ? new Date(String(raw.deletedAt)) : null,
          });
          counts.appreciations += 1;
        }
      }

      // 7. Restore penalties
      if (dbData?.penalties) {
        for (const raw of dbData.penalties) {
          const mappedEmpId = empIdMap.get(Number(raw.employeeId));
          const orderNumber = String(raw.orderNumber || '').trim();
          const issueDate = String(raw.issueDate || todayISO());
          if (!mappedEmpId || !orderNumber) continue;

          const existing = await tx
            .select({ id: penalties.id })
            .from(penalties)
            .where(
              and(
                eq(penalties.employeeId, mappedEmpId),
                eq(penalties.orderNumber, orderNumber),
                eq(penalties.issueDate, issueDate)
              )
            )
            .limit(1);
          if (existing.length > 0) continue;

          await tx.insert(penalties).values({
            employeeId: mappedEmpId,
            orderNumber,
            issueDate,
            penaltyType: String(raw.penaltyType || 'لفت نظر'),
            delayMonths: Number(raw.delayMonths || 3),
            reason: String(raw.reason || ''),
            appliedToCurrentCycle: Boolean(raw.appliedToCurrentCycle ?? true),
            createdBy: String(raw.createdBy || actor),
            deletedAt: raw.deletedAt ? new Date(String(raw.deletedAt)) : null,
          });
          counts.penalties += 1;
        }
      }

      // 8. Restore training enrollments
      if (dbData?.trainingEnrollments) {
        for (const raw of dbData.trainingEnrollments) {
          const mappedCourseId = courseIdMap.get(Number(raw.courseId));
          const mappedEmpId = empIdMap.get(Number(raw.employeeId));
          if (!mappedCourseId || !mappedEmpId) continue;

          const existing = await tx
            .select({ id: trainingEnrollments.id })
            .from(trainingEnrollments)
            .where(
              and(
                eq(trainingEnrollments.courseId, mappedCourseId),
                eq(trainingEnrollments.employeeId, mappedEmpId)
              )
            )
            .limit(1);
          if (existing.length > 0) continue;

          await tx.insert(trainingEnrollments).values({
            courseId: mappedCourseId,
            employeeId: mappedEmpId,
            transactionId: typeof raw.transactionId === 'number' ? txnIdMap.get(raw.transactionId) ?? null : null,
            appliedDate: String(raw.appliedDate || todayISO()),
            status: String(raw.status || 'بانتظار موافقة القسم'),
            attendancePercent: Number(raw.attendancePercent || 0),
            evaluationScore: raw.evaluationScore !== null && raw.evaluationScore !== undefined ? Number(raw.evaluationScore) : null,
            evaluationNotes: raw.evaluationNotes ? String(raw.evaluationNotes) : null,
            certificateDocumentId:
              typeof raw.certificateDocumentId === 'number' ? docIdMap.get(raw.certificateDocumentId) ?? null : null,
            rejectionReason: raw.rejectionReason ? String(raw.rejectionReason) : null,
          });
          counts.trainingEnrollments += 1;
        }
      }

      // 9. Restore leave requests
      if (dbData?.leaveRequests) {
        for (const raw of dbData.leaveRequests) {
          const mappedEmpId = empIdMap.get(Number(raw.employeeId));
          const startDate = String(raw.startDate || '');
          const endDate = String(raw.endDate || '');
          if (!mappedEmpId || !startDate || !endDate) continue;

          const existing = await tx
            .select({ id: leaveRequests.id })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.employeeId, mappedEmpId),
                eq(leaveRequests.startDate, startDate),
                eq(leaveRequests.endDate, endDate)
              )
            )
            .limit(1);
          if (existing.length > 0) continue;

          await tx.insert(leaveRequests).values({
            employeeId: mappedEmpId,
            transactionId: typeof raw.transactionId === 'number' ? txnIdMap.get(raw.transactionId) ?? null : null,
            attachmentDocumentId:
              typeof raw.attachmentDocumentId === 'number' ? docIdMap.get(raw.attachmentDocumentId) ?? null : null,
            leaveType: String(raw.leaveType || 'إجازة اعتيادية'),
            startDate,
            endDate,
            days: Number(raw.days || calculateDateRangeDays(startDate, endDate) || 1),
            reason: String(raw.reason || ''),
            status: String(raw.status || 'معتمد'),
            rejectionReason: raw.rejectionReason ? String(raw.rejectionReason) : null,
            approvedBy: raw.approvedBy ? String(raw.approvedBy) : null,
          });
          counts.leaveRequests += 1;
        }
      }

      // 10. Restore career events
      if (dbData?.careerEvents) {
        for (const raw of dbData.careerEvents) {
          const mappedEmpId = empIdMap.get(Number(raw.employeeId));
          const title = String(raw.title || '').trim();
          const eventDate = String(raw.eventDate || todayISO());
          if (!mappedEmpId || !title) continue;

          const existing = await tx
            .select({ id: careerEvents.id })
            .from(careerEvents)
            .where(
              and(
                eq(careerEvents.employeeId, mappedEmpId),
                eq(careerEvents.title, title),
                eq(careerEvents.eventDate, eventDate)
              )
            )
            .limit(1);
          if (existing.length > 0) continue;

          await tx.insert(careerEvents).values({
            employeeId: mappedEmpId,
            eventType: String(raw.eventType || 'حدث وظيفي'),
            title,
            description: String(raw.description || ''),
            eventDate,
            referenceNumber: String(raw.referenceNumber || ''),
            createdBy: String(raw.createdBy || actor),
          });
          counts.careerEvents += 1;
        }
      }

      const restoredCount = Object.values(counts).reduce((sum, n) => sum + n, 0);

      await writeAuditLog(
        {
          actor: req.dbUser!,
          operation: 'RESTORE_BACKUP',
          recordType: 'BACKUP',
          recordId: bundle.checksum.slice(0, 12),
          newValues: counts,
          details: `استعادة نسخة احتياطية كاملة موثقة (${bundle.schemaVersion} · SHA-256: ${bundle.checksum.slice(0, 12)}...) — تمت استعادة ${restoredCount} سجل عبر كافة الجداول`,
        },
        tx
      );

      return { restoredCount, counts };
    });

    res.json({ ok: true, restoredCount: summary.restoredCount, details: summary.counts });
  } catch (error) {
    // Roll back any newly persisted disk files when PostgreSQL transaction rolls back
    for (const key of savedStorageKeysForRollback) {
      await deletePrivateDocumentFile(key);
    }
    handleRouteError(res, error, 'فشل استعادة النسخة الاحتياطية وتم التراجع الكامل عن التغييرات.');
  }
});
