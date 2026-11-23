import { Router } from 'express';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
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
import { hasPermission, isHRWideRole } from '../utils/permissions.ts';
import {
  calculateDateRangeDays,
  getPenaltyDelayMonths,
  hasOverlappingLeave,
} from '../utils/hrEngine.ts';
import type { TransactionHistoryStep } from '../types/hrms.ts';

export const apiRouter = Router();

// Never cache private HR API responses in browser or PWA caches
apiRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

apiRouter.use(requireAuth);

function canAccessEmployee(
  user: DbAuthUser,
  emp: { id: number; department: string }
): boolean {
  if (isHRWideRole(user.role)) return true;
  if (user.role === 'DEPT_MANAGER' || user.role === 'SECTION_MANAGER') {
    return !!user.department && emp.department === user.department;
  }
  return user.employeeId !== null && emp.id === user.employeeId;
}

async function getAuthorizedEmployees(user: DbAuthUser) {
  const all = await db
    .select()
    .from(employees)
    .where(isNull(employees.deletedAt))
    .orderBy(desc(employees.updatedAt));
  return all.filter((e) => canAccessEmployee(user, e));
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
    const mapped = translateDbError(error, 'تعذر تحميل ملف المستخدم.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.get('/bootstrap', async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  try {
    const [
      scopedEmployees,
      config,
      allCourses,
      allNotifs,
    ] = await Promise.all([
      getAuthorizedEmployees(user),
      getSystemConfig(),
      db.select().from(trainingCourses).where(isNull(trainingCourses.deletedAt)).orderBy(desc(trainingCourses.createdAt)),
      db
        .select()
        .from(notifications)
        .where(
          or(
            eq(notifications.recipientUid, user.uid),
            eq(notifications.recipientRole, user.role)
          )
        )
        .orderBy(desc(notifications.createdAt))
        .limit(60),
    ]);

    const empIds = scopedEmployees.map((e) => e.id);
    const hasScopedEmps = empIds.length > 0;

    const [
      scopedAppreciations,
      scopedPenalties,
      scopedDocuments,
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
      isHRWideRole(user.role)
        ? db
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
              version: documents.version,
              archiveStatus: documents.archiveStatus,
              verificationCode: documents.verificationCode,
              uploadedBy: documents.uploadedBy,
              createdAt: documents.createdAt,
            })
            .from(documents)
            .where(isNull(documents.deletedAt))
            .orderBy(desc(documents.createdAt))
        : hasScopedEmps
          ? db
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
                version: documents.version,
                archiveStatus: documents.archiveStatus,
                verificationCode: documents.verificationCode,
                uploadedBy: documents.uploadedBy,
                createdAt: documents.createdAt,
              })
              .from(documents)
              .where(and(isNull(documents.deletedAt), inArray(documents.employeeId, empIds)))
              .orderBy(desc(documents.createdAt))
          : Promise.resolve([]),
      isHRWideRole(user.role)
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
      isHRWideRole(user.role)
        ? db.select().from(trainingEnrollments).orderBy(desc(trainingEnrollments.createdAt))
        : hasScopedEmps
          ? db
              .select()
              .from(trainingEnrollments)
              .where(inArray(trainingEnrollments.employeeId, empIds))
              .orderBy(desc(trainingEnrollments.createdAt))
          : Promise.resolve([]),
      isHRWideRole(user.role)
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
        ? db.select().from(users).orderBy(desc(users.createdAt))
        : Promise.resolve([]),
      hasPermission(user.role, 'manage_backups')
        ? db.select().from(backupSnapshots).orderBy(desc(backupSnapshots.createdAt)).limit(50)
        : Promise.resolve([]),
    ]);

    // Compute live enrolled count per course from active enrollments
    const allActiveEnrollments = await db.select().from(trainingEnrollments);
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
      notifications: allNotifs,
      auditLogs: scopedAudit,
      users: scopedUsers,
      backups: scopedBackups,
    });
  } catch (error) {
    const mapped = translateDbError(error, 'تعذر تحميل بيانات النظام من قاعدة البيانات.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 2. Unified Global Intelligent Search (Permission-Scoped)
// ============================================================================
apiRouter.get('/search', async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) {
    return res.json({ employees: [], transactions: [], documents: [], courses: [] });
  }
  try {
    const scopedEmps = await getAuthorizedEmployees(user);
    const empIds = new Set(scopedEmps.map((e) => e.id));

    const matchedEmployees = scopedEmps
      .filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          e.fullNameEn.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q) ||
          e.oilfield.toLowerCase().includes(q) ||
          e.jobTitle.toLowerCase().includes(q)
      )
      .slice(0, 8);

    const [allTxns, allDocs, allCourses] = await Promise.all([
      db.select().from(transactions).orderBy(desc(transactions.updatedAt)).limit(200),
      db
        .select({
          id: documents.id,
          documentNumber: documents.documentNumber,
          title: documents.title,
          category: documents.category,
          employeeId: documents.employeeId,
          department: documents.department,
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
          (isHRWideRole(user.role) || empIds.has(t.employeeId) || t.createdByUid === user.uid) &&
          (t.transactionNumber.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.status.toLowerCase().includes(q))
      )
      .slice(0, 8);

    const matchedDocuments = allDocs
      .filter(
        (d) =>
          (isHRWideRole(user.role) || (d.employeeId !== null && empIds.has(d.employeeId))) &&
          (d.title.toLowerCase().includes(q) ||
            d.documentNumber.toLowerCase().includes(q) ||
            d.category.toLowerCase().includes(q))
      )
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
    const mapped = translateDbError(error, 'فشل تنفيذ البحث الموحد.');
    res.status(mapped.status).json({ error: mapped.message });
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
});

apiRouter.post('/employees', requirePermission('create_employee'), async (req: AuthRequest, res) => {
  const parsed = employeeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'بيانات المنتسب غير مكتملة أو غير صالحة.', issues: parsed.error.issues });
  }
  const d = parsed.data;
  const normalizedCode = d.employeeCode.toUpperCase();
  try {
    const existing = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.employeeCode, normalizedCode))
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: `الرقم الوظيفي (${normalizedCode}) مسجل مسبقاً في قاعدة البيانات.` });
    }

    const [created] = await db
      .insert(employees)
      .values({
        ...d,
        employeeCode: normalizedCode,
        birthDate: d.birthDate || null,
        nationalId: d.nationalId || null,
        lastPromotionDate: d.lastPromotionDate || d.hireDate,
        lastIncrementDate: d.lastIncrementDate || d.hireDate,
      })
      .returning();

    await addCareerEvent({
      employeeId: created.id,
      eventType: 'تعيين',
      title: 'إنشاء السجل الوظيفي والمباشرة',
      description: `${created.jobTitle} — ${created.department} (${created.oilfield}) · الدرجة ${created.grade} / المرحلة ${created.step}`,
      eventDate: created.hireDate,
      referenceNumber: created.employeeCode,
      createdBy: req.dbUser!.displayName || req.dbUser!.email,
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE',
      recordType: 'EMPLOYEE',
      recordId: created.id,
      newValues: { employeeCode: created.employeeCode, fullName: created.fullName, department: created.department },
      details: `تسجيل منتسب جديد: ${created.fullName} (${created.employeeCode}) في ${created.department}`,
    });

    res.status(201).json(created);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل حفظ سجل المنتسب.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.patch('/employees/:id', requirePermission('edit_employee'), async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId)) return res.status(400).json({ error: 'معرف المنتسب غير صالح.' });

  const parsed = employeeCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'قيم التعديل غير صالحة.', issues: parsed.error.issues });
  }

  try {
    const existingRows = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, empId), isNull(employees.deletedAt)))
      .limit(1);
    if (existingRows.length === 0) return res.status(404).json({ error: 'سجل المنتسب غير موجود.' });
    const prev = existingRows[0];

    const updates = {
      ...parsed.data,
      employeeCode: parsed.data.employeeCode ? parsed.data.employeeCode.toUpperCase() : prev.employeeCode,
      birthDate: parsed.data.birthDate === '' ? null : parsed.data.birthDate ?? prev.birthDate,
      updatedAt: new Date(),
    };

    const [updated] = await db
      .update(employees)
      .set(updates)
      .where(eq(employees.id, empId))
      .returning();

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'UPDATE',
      recordType: 'EMPLOYEE',
      recordId: empId,
      previousValues: {
        jobTitle: prev.jobTitle,
        department: prev.department,
        oilfield: prev.oilfield,
        grade: prev.grade,
        step: prev.step,
        status: prev.status,
      },
      newValues: {
        jobTitle: updated.jobTitle,
        department: updated.department,
        oilfield: updated.oilfield,
        grade: updated.grade,
        step: updated.step,
        status: updated.status,
      },
      details: `تحديث بيانات الملف الوظيفي للمنتسب ${updated.fullName} (${updated.employeeCode})`,
    });

    res.json(updated);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تحديث سجل المنتسب.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.delete('/employees/:id', requirePermission('delete_employee'), async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId)) return res.status(400).json({ error: 'معرف المنتسب غير صالح.' });
  try {
    const existing = await db.select().from(employees).where(eq(employees.id, empId)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'السجل غير موجود.' });

    // Soft delete to protect career & audit integrity
    await db
      .update(employees)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(employees.id, empId));

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'SOFT_DELETE',
      recordType: 'EMPLOYEE',
      recordId: empId,
      previousValues: { fullName: existing[0].fullName, employeeCode: existing[0].employeeCode },
      details: `أرشفة وحذف ناعم لسجل المنتسب ${existing[0].fullName} (${existing[0].employeeCode})`,
    });

    res.json({ ok: true });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل أرشفة سجل المنتسب.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.get('/employees/:id/timeline', async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId)) return res.status(400).json({ error: 'معرف غير صالح.' });
  try {
    const empRows = await db.select().from(employees).where(eq(employees.id, empId)).limit(1);
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
    const mapped = translateDbError(error, 'تعذر تحميل الخط الزمني للمنتسب.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.post('/employees/:id/timeline', requirePermission('edit_employee'), async (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
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
    const [created] = await db
      .insert(careerEvents)
      .values({
        employeeId: empId,
        ...parsed.data,
        createdBy: req.dbUser!.displayName || req.dbUser!.email,
      })
      .returning();
    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE',
      recordType: 'CAREER_EVENT',
      recordId: created.id,
      details: `إضافة حدث وظيفي (${created.eventType}): ${created.title}`,
    });
    res.status(201).json(created);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل إضافة الحدث الوظيفي.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 4. Promotions & Increments Workflow (No Auto-Finalization Without Approval)
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
    const empRows = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
      .limit(1);
    if (empRows.length === 0) return res.status(404).json({ error: 'المنتسب غير موجود.' });
    const emp = empRows[0];

    if (parsed.data.kind === 'PROMOTION_REVIEW' && emp.grade <= 1) {
      return res.status(400).json({ error: 'المنتسب يشغل الدرجة الأولى (أعلى درجة وظيفية).' });
    }

    const config = await getSystemConfig();
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

    const [txn] = await db
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
          explanation: parsed.data.explanation,
        },
        history: [historyStep],
        createdByUid: req.dbUser!.uid,
      })
      .returning();

    await createNotification({
      recipientRole: initialRole,
      title: 'معاملة ترفيع/علاوة جديدة بانتظار المراجعة',
      message: `${title} — رقم المعاملة ${txnNo}`,
      severity: 'warning',
      entityType: 'TRANSACTION',
      entityId: txn.id,
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'INITIATE_WORKFLOW',
      recordType: parsed.data.kind,
      recordId: txn.id,
      details: `فتح معاملة ${txnNo}: ${title}`,
    });

    res.status(201).json(txn);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل إنشاء معاملة الترفيع/العلاوة.');
    res.status(mapped.status).json({ error: mapped.message });
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
    const empRows = await db.select().from(employees).where(eq(employees.id, parsed.data.employeeId)).limit(1);
    if (empRows.length === 0) return res.status(404).json({ error: 'المنتسب غير موجود.' });
    const emp = empRows[0];

    const verificationCode = generateCode('BOC-APP');
    const [created] = await db
      .insert(appreciations)
      .values({
        ...parsed.data,
        verificationCode,
        appliedToCurrentCycle: true,
        createdBy: req.dbUser!.displayName || req.dbUser!.email,
      })
      .returning();

    // Auto-archive reference record in centralized documents
    await db.insert(documents).values({
      documentNumber: `APP-${created.letterNumber}`,
      title: `كتاب شكر وتقدير (${created.issuingAuthority})`,
      category: 'كتاب شكر وتقدير',
      issueDate: created.issueDate,
      issuingAuthority: created.issuingAuthority,
      employeeId: emp.id,
      department: emp.department,
      oilfield: emp.oilfield,
      description: `${created.subject} — قِدَم ${created.seniorityMonths} شهر`,
      fileName: `appreciation-${created.id}.pdf`,
      mimeType: 'application/pdf',
      fileSize: 'رسمي إلكتروني',
      verificationCode: generateCode('DOC-VER'),
      uploadedBy: req.dbUser!.displayName || req.dbUser!.email,
    });

    await addCareerEvent({
      employeeId: emp.id,
      eventType: 'كتاب شكر',
      title: `كتاب شكر وتقدير (+${created.seniorityMonths} شهر قِدَم)`,
      description: `${created.issuingAuthority} — ${created.subject}`,
      eventDate: created.issueDate,
      referenceNumber: created.letterNumber,
      createdBy: req.dbUser!.displayName || req.dbUser!.email,
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE',
      recordType: 'APPRECIATION',
      recordId: created.id,
      newValues: { letterNumber: created.letterNumber, seniorityMonths: created.seniorityMonths },
      details: `تسجيل كتاب شكر رقم ${created.letterNumber} للمنتسب ${emp.fullName} (+${created.seniorityMonths} شهر قِدَم)`,
    });

    res.status(201).json(created);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تسجيل كتاب الشكر والتقدير.');
    res.status(mapped.status).json({ error: mapped.message });
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
    const empRows = await db.select().from(employees).where(eq(employees.id, parsed.data.employeeId)).limit(1);
    if (empRows.length === 0) return res.status(404).json({ error: 'المنتسب غير موجود.' });
    const emp = empRows[0];

    const config = await getSystemConfig();
    const delayMonths =
      parsed.data.delayMonths !== undefined
        ? parsed.data.delayMonths
        : getPenaltyDelayMonths(parsed.data.penaltyType, config.hrRules);

    const [created] = await db
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

    await addCareerEvent({
      employeeId: emp.id,
      eventType: 'عقوبة',
      title: `عقوبة إدارية: ${created.penaltyType} (تأخير ${created.delayMonths} أشهر)`,
      description: created.reason,
      eventDate: created.issueDate,
      referenceNumber: created.orderNumber,
      createdBy: req.dbUser!.displayName || req.dbUser!.email,
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE',
      recordType: 'PENALTY',
      recordId: created.id,
      newValues: { orderNumber: created.orderNumber, penaltyType: created.penaltyType, delayMonths },
      details: `تسجيل عقوبة (${created.penaltyType}) بأمر رقم ${created.orderNumber} للمنتسب ${emp.fullName}`,
    });

    res.status(201).json(created);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تسجيل العقوبة الإدارية.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 6. Centralized Digital Document Management (Private Access Control)
// ============================================================================
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

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
    fileContentBase64: z.string().max(5_500_000).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات الوثيقة غير صالحة أو حجم الملف كبير جداً.' });

  const d = parsed.data;
  if (d.fileContentBase64 && !ALLOWED_MIME_TYPES.has(d.mimeType)) {
    return res.status(400).json({ error: 'صيغة الملف غير مسموح بها (يُقبل PDF وPNG وJPG فقط).' });
  }

  try {
    // Enforce employee scope if non-HR uploads
    if (d.employeeId) {
      const empRows = await db.select().from(employees).where(eq(employees.id, d.employeeId)).limit(1);
      if (empRows.length === 0) return res.status(404).json({ error: 'المنتسب المرتبط غير موجود.' });
      if (!canAccessEmployee(req.dbUser!, empRows[0])) {
        return res.status(403).json({ error: 'لا تملك صلاحية رفع وثائق لهذا المنتسب.' });
      }
    }

    const [created] = await db
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
        department: d.department,
        oilfield: d.oilfield,
        description: d.description,
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
        fileContentBase64: d.fileContentBase64 ?? null,
        verificationCode: generateCode('DOC-QR'),
        uploadedBy: req.dbUser!.displayName || req.dbUser!.email,
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
        department: documents.department,
        oilfield: documents.oilfield,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        fileSize: documents.fileSize,
        version: documents.version,
        archiveStatus: documents.archiveStatus,
        verificationCode: documents.verificationCode,
        uploadedBy: documents.uploadedBy,
        createdAt: documents.createdAt,
      });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'UPLOAD_DOCUMENT',
      recordType: 'DOCUMENT',
      recordId: created.id,
      details: `أرشفة الوثيقة «${created.title}» (${created.documentNumber})`,
    });

    res.status(201).json(created);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل أرشفة الوثيقة.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.get('/documents/:id/download', requirePermission('download_documents'), async (req: AuthRequest, res) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId)) return res.status(400).json({ error: 'معرف الوثيقة غير صالح.' });
  try {
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'الوثيقة غير موجودة.' });
    const doc = rows[0];

    if (doc.employeeId && !isHRWideRole(req.dbUser!.role)) {
      const empRows = await db.select().from(employees).where(eq(employees.id, doc.employeeId)).limit(1);
      if (empRows.length > 0 && !canAccessEmployee(req.dbUser!, empRows[0])) {
        return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه الوثيقة الخاصة.' });
      }
    }

    await writeAuditLog({
      actor: req.dbUser!,
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
      fileContentBase64: doc.fileContentBase64,
      verificationCode: doc.verificationCode,
    });
  } catch (error) {
    const mapped = translateDbError(error, 'تعذر استرجاع الوثيقة.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.delete('/documents/:id', requirePermission('edit_employee'), async (req: AuthRequest, res) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId)) return res.status(400).json({ error: 'معرف الوثيقة غير صالح.' });
  try {
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
    if (!doc) return res.status(404).json({ error: 'الوثيقة غير موجودة.' });
    await db.update(documents).set({ deletedAt: new Date(), archiveStatus: 'مؤرشف' }).where(eq(documents.id, docId));
    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'SOFT_DELETE',
      recordType: 'DOCUMENT',
      recordId: docId,
      details: `أرشفة/حذف ناعم للوثيقة ${doc.documentNumber} (${doc.title})`,
    });
    res.json({ ok: true });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل أرشفة الوثيقة.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 7. Centralized Administrative Transactions & Workflow Engine
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

  try {
    const [emp] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, parsed.data.employeeId), isNull(employees.deletedAt)))
      .limit(1);
    if (!emp) return res.status(404).json({ error: 'المنتسب غير موجود.' });
    if (!canAccessEmployee(req.dbUser!, emp)) {
      return res.status(403).json({ error: 'لا تملك صلاحية إنشاء معاملة لهذا المنتسب.' });
    }

    const config = await getSystemConfig();
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

    const [created] = await db
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

    await createNotification({
      recipientRole: initialRole,
      title: `معاملة جديدة: ${created.title}`,
      message: `المنتسب: ${emp.fullName} · رقم المعاملة ${txnNo}`,
      severity: 'info',
      entityType: 'TRANSACTION',
      entityId: created.id,
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE',
      recordType: 'TRANSACTION',
      recordId: created.id,
      details: `إنشاء معاملة إدارية ${txnNo}: ${created.title}`,
    });

    res.status(201).json(created);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل إنشاء المعاملة الإدارية.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.post('/transactions/:id/action', async (req: AuthRequest, res) => {
  const txnId = Number(req.params.id);
  const schema = z.object({
    action: z.enum(['APPROVE', 'REJECT', 'RETURN', 'RESUBMIT', 'ESCALATE', 'COMPLETE', 'ARCHIVE']),
    comment: z.string().trim().max(1000).optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'الإجراء المطلوب غير صالح.' });

  const { action, comment } = parsed.data;
  const user = req.dbUser!;

  if ((action === 'REJECT' || action === 'RETURN') && comment.length < 3) {
    return res.status(400).json({ error: 'يرجى كتابة سبب واضح للرفض أو الإعادة للتعديل.' });
  }

  try {
    const [txn] = await db.select().from(transactions).where(eq(transactions.id, txnId)).limit(1);
    if (!txn) return res.status(404).json({ error: 'المعاملة غير موجودة.' });

    const [emp] = await db.select().from(employees).where(eq(employees.id, txn.employeeId)).limit(1);
    if (!emp) return res.status(404).json({ error: 'المنتسب المرتبط بالمعاملة غير موجود.' });

    // Permission enforcement per workflow stage
    const isHR = hasPermission(user.role, 'approve_hr');
    const isDept = hasPermission(user.role, 'approve_dept') && (isHR || user.department === txn.department);
    const isOwner = txn.createdByUid === user.uid || user.employeeId === txn.employeeId;

    if (action === 'RESUBMIT' && !isOwner && !isHR) {
      return res.status(403).json({ error: 'يمكن لصاحب الطلب فقط إعادة إرسال المعاملة.' });
    }
    if ((action === 'APPROVE' || action === 'REJECT' || action === 'RETURN') && txn.status === 'بانتظار موافقة القسم' && !isDept) {
      return res.status(403).json({ error: 'تتطلب هذه المرحلة صلاحية مدير القسم أو الموارد البشرية.' });
    }
    if ((action === 'APPROVE' || action === 'REJECT' || action === 'RETURN') && txn.status === 'بانتظار موافقة الموارد البشرية' && !isHR) {
      return res.status(403).json({ error: 'تتطلب هذه المرحلة صلاحية اعتماد الموارد البشرية.' });
    }
    if ((action === 'COMPLETE' || action === 'ARCHIVE' || action === 'ESCALATE') && !isHR && !isDept) {
      return res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء.' });
    }

    let nextStatus = txn.status;
    let nextRole = txn.currentResponsibleRole;
    let completedAt: Date | null = txn.completedAt;
    let escalated = txn.escalated;
    let rejectionReason = txn.rejectionReason;
    let actionLabel = '';

    if (action === 'APPROVE') {
      if (txn.status === 'بانتظار موافقة القسم') {
        nextStatus = 'بانتظار موافقة الموارد البشرية';
        nextRole = 'HR_MANAGER';
        actionLabel = 'موافقة القسم وإحالة للموارد البشرية';
      } else if (txn.status === 'بانتظار موافقة الموارد البشرية') {
        nextStatus = 'معتمد';
        nextRole = 'HR_ADMIN';
        completedAt = new Date();
        actionLabel = 'اعتماد نهائي من الموارد البشرية';
      } else {
        return res.status(400).json({ error: 'المعاملة ليست في مرحلة قابلة للاعتماد.' });
      }
    } else if (action === 'REJECT') {
      nextStatus = 'مرفوض';
      rejectionReason = comment;
      completedAt = new Date();
      actionLabel = 'رفض المعاملة';
    } else if (action === 'RETURN') {
      nextStatus = 'معاد للتعديل';
      nextRole = 'EMPLOYEE';
      actionLabel = 'إعادة المعاملة للتعديل والاستكمال';
    } else if (action === 'RESUBMIT') {
      nextStatus = 'بانتظار موافقة القسم';
      nextRole = 'DEPT_MANAGER';
      actionLabel = 'إعادة تقديم المعاملة بعد التعديل';
    } else if (action === 'ESCALATE') {
      escalated = true;
      nextRole = 'HR_ADMIN';
      actionLabel = 'تصعيد المعاملة للإدارة العليا';
    } else if (action === 'COMPLETE') {
      nextStatus = 'مكتمل';
      completedAt = new Date();
      actionLabel = 'إنجاز المعاملة';
    } else if (action === 'ARCHIVE') {
      nextStatus = 'مؤرشف';
      actionLabel = 'أرشفة المعاملة';
    }

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

    const config = await getSystemConfig();

    // Atomic side-effects when HR gives final approval
    const updatedTxn = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(transactions)
        .set({
          status: nextStatus,
          currentResponsibleRole: nextRole,
          history: nextHistory,
          rejectionReason,
          escalated,
          completedAt,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, txnId))
        .returning();

      // Sync linked Leave Request & deduct balance on final approval
      if (txn.transactionType === 'LEAVE') {
        const linkedLeaves = await tx
          .select()
          .from(leaveRequests)
          .where(eq(leaveRequests.transactionId, txnId))
          .limit(1);

        if (linkedLeaves.length > 0) {
          const lv = linkedLeaves[0];
          await tx
            .update(leaveRequests)
            .set({
              status: nextStatus,
              rejectionReason: nextStatus === 'مرفوض' ? comment : null,
              approvedBy: nextStatus === 'معتمد' ? user.displayName || user.email : null,
              updatedAt: new Date(),
            })
            .where(eq(leaveRequests.id, lv.id));

          if (nextStatus === 'معتمد') {
            const leaveCfg = config.orgCatalogs.leaveTypes.find((lt) => lt.name === lv.leaveType);
            const deductTarget = leaveCfg?.deductsFrom ?? 'annual';
            if (deductTarget === 'annual') {
              await tx
                .update(employees)
                .set({
                  annualLeaveBalance: Math.max(0, emp.annualLeaveBalance - lv.days),
                  updatedAt: new Date(),
                })
                .where(eq(employees.id, emp.id));
            } else if (deductTarget === 'sick') {
              await tx
                .update(employees)
                .set({
                  sickLeaveBalance: Math.max(0, emp.sickLeaveBalance - lv.days),
                  updatedAt: new Date(),
                })
                .where(eq(employees.id, emp.id));
            }
          }
        }
      }

      // Sync linked Training Enrollment
      if (txn.transactionType === 'TRAINING') {
        await tx
          .update(trainingEnrollments)
          .set({
            status: nextStatus,
            rejectionReason: nextStatus === 'مرفوض' ? comment : null,
            updatedAt: new Date(),
          })
          .where(eq(trainingEnrollments.transactionId, txnId));
      }

      // Execute Promotion / Annual Increment ONLY after explicit HR approval!
      if (
        nextStatus === 'معتمد' &&
        (txn.transactionType === 'PROMOTION_REVIEW' || txn.transactionType === 'INCREMENT_REVIEW')
      ) {
        const effectiveDate = String((txn.payload as Record<string, unknown>)?.effectiveDate || todayISO());
        const isPromo = txn.transactionType === 'PROMOTION_REVIEW';
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

      return saved;
    });

    await createNotification({
      recipientUid: txn.createdByUid,
      recipientRole: nextRole,
      title: `تحديث حالة المعاملة ${txn.transactionNumber}`,
      message: `${actionLabel}: ${txn.title} ← ${nextStatus}`,
      severity: nextStatus === 'مرفوض' ? 'critical' : nextStatus === 'معتمد' ? 'success' : 'info',
      entityType: 'TRANSACTION',
      entityId: txn.id,
    });

    await writeAuditLog({
      actor: user,
      operation: `WORKFLOW_${action}`,
      recordType: 'TRANSACTION',
      recordId: txn.id,
      previousValues: { status: txn.status },
      newValues: { status: nextStatus },
      details: `${actionLabel} للمعاملة ${txn.transactionNumber} (${emp.fullName})${comment ? ` — ${comment}` : ''}`,
    });

    res.json(updatedTxn);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تنفيذ إجراء سير العمل.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 8. Training Management
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
  try {
    const [created] = await db
      .insert(trainingCourses)
      .values({ ...parsed.data, code: parsed.data.code.toUpperCase() })
      .returning();
    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE',
      recordType: 'TRAINING_COURSE',
      recordId: created.id,
      details: `إضافة دورة تدريبية: ${created.title} (${created.code})`,
    });
    res.status(201).json({ ...created, enrolledCount: 0 });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل إضافة الدورة التدريبية.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.patch('/courses/:id', requirePermission('manage_training'), async (req: AuthRequest, res) => {
  const courseId = Number(req.params.id);
  const parsed = courseSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات تحديث الدورة غير صالحة.' });
  try {
    const [updated] = await db
      .update(trainingCourses)
      .set(parsed.data)
      .where(eq(trainingCourses.id, courseId))
      .returning();
    if (!updated) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'UPDATE',
      recordType: 'TRAINING_COURSE',
      recordId: courseId,
      newValues: { status: updated.status, startDate: updated.startDate, endDate: updated.endDate },
      details: `تحديث/إعادة جدولة الدورة ${updated.code}: الحالة (${updated.status})`,
    });
    res.json(updated);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تحديث الدورة التدريبية.');
    res.status(mapped.status).json({ error: mapped.message });
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
    const [[course], [emp]] = await Promise.all([
      db.select().from(trainingCourses).where(eq(trainingCourses.id, courseId)).limit(1),
      db.select().from(employees).where(and(eq(employees.id, employeeId), isNull(employees.deletedAt))).limit(1),
    ]);
    if (!course) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    if (!emp) return res.status(404).json({ error: 'المنتسب غير موجود.' });
    if (!canAccessEmployee(req.dbUser!, emp)) {
      return res.status(403).json({ error: 'لا تملك صلاحية التقديم لهذا المنتسب.' });
    }
    if (course.status !== 'مفتوح للتسجيل') {
      return res.status(400).json({ error: 'التسجيل مغلق لهذه الدورة حالياً.' });
    }

    const existing = await db
      .select()
      .from(trainingEnrollments)
      .where(eq(trainingEnrollments.courseId, courseId));

    if (existing.some((e) => e.employeeId === emp.id && e.status !== 'مرفوض')) {
      return res.status(409).json({ error: 'المنتسب مقدم مسبقاً لهذه الدورة.' });
    }
    const confirmedCount = existing.filter((e) => e.status === 'معتمد' || e.status === 'مكتمل').length;
    if (confirmedCount >= course.totalSeats) {
      return res.status(400).json({ error: 'اكتملت المقاعد المتاحة لهذه الدورة.' });
    }

    const config = await getSystemConfig();
    const wf = config.workflows.find((w) => w.transactionType === 'TRAINING');
    const initialStatus = wf?.requiresDeptApproval ? 'بانتظار موافقة القسم' : 'بانتظار موافقة الموارد البشرية';
    const initialRole = wf?.requiresDeptApproval ? 'DEPT_MANAGER' : 'HR_MANAGER';

    const txnNo = generateCode('TRN');
    const [txn] = await db
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

    const [enrollment] = await db
      .insert(trainingEnrollments)
      .values({
        courseId: course.id,
        employeeId: emp.id,
        transactionId: txn.id,
        appliedDate: todayISO(),
        status: initialStatus,
      })
      .returning();

    await createNotification({
      recipientRole: initialRole,
      title: 'طلب ترشيح تدريبي جديد',
      message: `${emp.fullName} — دورة ${course.title} (${txnNo})`,
      severity: 'info',
      entityType: 'TRANSACTION',
      entityId: txn.id,
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'APPLY_TRAINING',
      recordType: 'TRAINING_ENROLLMENT',
      recordId: enrollment.id,
      details: `تقديم ${emp.fullName} لدورة ${course.code} (${course.title})`,
    });

    res.status(201).json({ enrollment, transaction: txn });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل التقديم للدورة التدريبية.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.patch('/enrollments/:id', requirePermission('manage_training'), async (req: AuthRequest, res) => {
  const enrollmentId = Number(req.params.id);
  const schema = z.object({
    attendancePercent: z.coerce.number().int().min(0).max(100).optional(),
    evaluationScore: z.coerce.number().int().min(0).max(100).optional().nullable(),
    evaluationNotes: z.string().trim().max(500).optional().nullable(),
    markCompleted: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات التقييم والحضور غير صالحة.' });

  try {
    const [enr] = await db.select().from(trainingEnrollments).where(eq(trainingEnrollments.id, enrollmentId)).limit(1);
    if (!enr) return res.status(404).json({ error: 'سجل التدريب غير موجود.' });
    const [[course], [emp]] = await Promise.all([
      db.select().from(trainingCourses).where(eq(trainingCourses.id, enr.courseId)).limit(1),
      db.select().from(employees).where(eq(employees.id, enr.employeeId)).limit(1),
    ]);

    let certDocId = enr.certificateDocumentId;
    let nextStatus = enr.status;

    if (parsed.data.markCompleted && course && emp) {
      nextStatus = 'مكتمل';
      if (!certDocId) {
        const certNo = generateCode('CERT');
        const [certDoc] = await db
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
            verificationCode: generateCode('BOC-TRN'),
            uploadedBy: req.dbUser!.displayName || req.dbUser!.email,
          })
          .returning();
        certDocId = certDoc.id;

        await addCareerEvent({
          employeeId: emp.id,
          eventType: 'دورة تدريبية',
          title: `إتمام دورة تدريبية: ${course.title}`,
          description: `الجهة المنفذة: ${course.provider} · رقم الشهادة: ${certNo}`,
          eventDate: todayISO(),
          referenceNumber: certNo,
          createdBy: req.dbUser!.displayName || req.dbUser!.email,
        });
      }
      if (enr.transactionId) {
        await db
          .update(transactions)
          .set({ status: 'مكتمل', completedAt: new Date(), updatedAt: new Date() })
          .where(eq(transactions.id, enr.transactionId));
      }
    }

    const [updated] = await db
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

    await writeAuditLog({
      actor: req.dbUser!,
      operation: parsed.data.markCompleted ? 'COMPLETE_TRAINING' : 'UPDATE_TRAINING',
      recordType: 'TRAINING_ENROLLMENT',
      recordId: enrollmentId,
      details: `تحديث حضور/تقييم ${emp?.fullName ?? ''} في دورة ${course?.code ?? ''}${parsed.data.markCompleted ? ' وأرشفة الشهادة تلقائياً' : ''}`,
    });

    res.json(updated);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تحديث سجل التدريب.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 9. Leave Management (Overlapping Leave Detection + Balance Adjustments)
// ============================================================================
apiRouter.post('/leaves', async (req: AuthRequest, res) => {
  if (req.dbUser!.role === 'READ_ONLY') return res.status(403).json({ error: 'حساب قراءة فقط.' });
  const schema = z.object({
    employeeId: z.coerce.number().int(),
    leaveType: z.string().trim().min(2).max(80),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(3).max(500),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات طلب الإجازة غير مكتملة.' });

  const { employeeId, leaveType, startDate, endDate, reason } = parsed.data;
  const days = calculateDateRangeDays(startDate, endDate);
  if (days <= 0) {
    return res.status(400).json({ error: 'تاريخ انتهاء الإجازة يجب أن يكون مساوياً أو بعد تاريخ البدء.' });
  }

  try {
    const [emp] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
      .limit(1);
    if (!emp) return res.status(404).json({ error: 'المنتسب غير موجود.' });
    if (!canAccessEmployee(req.dbUser!, emp)) {
      return res.status(403).json({ error: 'لا تملك صلاحية تقديم إجازة لهذا المنتسب.' });
    }

    const config = await getSystemConfig();
    const leaveCfg = config.orgCatalogs.leaveTypes.find((lt) => lt.name === leaveType);
    if (leaveCfg && days > leaveCfg.maxDaysPerRequest) {
      return res.status(400).json({
        error: `الحد الأقصى المسموح به لـ «${leaveType}» هو ${leaveCfg.maxDaysPerRequest} يوماً في الطلب الواحد.`,
      });
    }
    if (leaveCfg?.deductsFrom === 'annual' && emp.annualLeaveBalance < days) {
      return res.status(400).json({ error: `رصيد الإجازات الاعتيادية (${emp.annualLeaveBalance} يوماً) لا يكفي.` });
    }
    if (leaveCfg?.deductsFrom === 'sick' && emp.sickLeaveBalance < days) {
      return res.status(400).json({ error: `رصيد الإجازات المرضية (${emp.sickLeaveBalance} يوماً) لا يكفي.` });
    }

    const existingLeaves = await db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.employeeId, emp.id));

    if (hasOverlappingLeave(existingLeaves, emp.id, startDate, endDate)) {
      return res.status(409).json({
        error: 'يوجد تداخل زمني مع طلب إجازة آخر قائم أو معتمد لنفس المنتسب في هذه الفترة.',
      });
    }

    const wf = config.workflows.find((w) => w.transactionType === 'LEAVE');
    const initialStatus = wf?.requiresDeptApproval ? 'بانتظار موافقة القسم' : 'بانتظار موافقة الموارد البشرية';
    const initialRole = wf?.requiresDeptApproval ? 'DEPT_MANAGER' : 'HR_MANAGER';

    const txnNo = generateCode('LV');
    const [txn] = await db
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
        payload: { leaveType, startDate, endDate, days, reason },
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

    const [createdLeave] = await db
      .insert(leaveRequests)
      .values({
        employeeId: emp.id,
        transactionId: txn.id,
        leaveType,
        startDate,
        endDate,
        days,
        reason,
        status: initialStatus,
      })
      .returning();

    await createNotification({
      recipientRole: initialRole,
      title: `طلب ${leaveType} جديد`,
      message: `${emp.fullName} (${startDate} ← ${endDate} · ${days} أيام)`,
      severity: 'info',
      entityType: 'TRANSACTION',
      entityId: txn.id,
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE',
      recordType: 'LEAVE_REQUEST',
      recordId: createdLeave.id,
      details: `تقديم ${leaveType} للمنتسب ${emp.fullName} لمدة ${days} أيام (${startDate} ← ${endDate})`,
    });

    res.status(201).json({ leave: createdLeave, transaction: txn });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تسجيل طلب الإجازة.');
    res.status(mapped.status).json({ error: mapped.message });
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
    const [emp] = await db.select().from(employees).where(eq(employees.id, parsed.data.employeeId)).limit(1);
    if (!emp) return res.status(404).json({ error: 'المنتسب غير موجود.' });

    const prevAnnual = emp.annualLeaveBalance;
    const prevSick = emp.sickLeaveBalance;
    const nextAnnual =
      parsed.data.balanceType === 'annual' ? Math.max(0, prevAnnual + parsed.data.deltaDays) : prevAnnual;
    const nextSick =
      parsed.data.balanceType === 'sick' ? Math.max(0, prevSick + parsed.data.deltaDays) : prevSick;

    const [updated] = await db
      .update(employees)
      .set({ annualLeaveBalance: nextAnnual, sickLeaveBalance: nextSick, updatedAt: new Date() })
      .where(eq(employees.id, emp.id))
      .returning();

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'ADJUST_LEAVE_BALANCE',
      recordType: 'EMPLOYEE',
      recordId: emp.id,
      previousValues: { annualLeaveBalance: prevAnnual, sickLeaveBalance: prevSick },
      newValues: { annualLeaveBalance: nextAnnual, sickLeaveBalance: nextSick },
      details: `تعديل رصيد الإجازة (${parsed.data.balanceType === 'annual' ? 'الاعتيادية' : 'المرضية'}) بمقدار ${parsed.data.deltaDays} يوم للمنتسب ${emp.fullName} — السبب: ${parsed.data.reason}`,
    });

    res.json(updated);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تعديل رصيد الإجازة.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 10. Notifications
// ============================================================================
apiRouter.patch('/notifications/:id/read', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'معرف الإشعار غير صالح.' });
  try {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
    res.json({ ok: true });
  } catch (error) {
    const mapped = translateDbError(error, 'تعذر تحديث الإشعار.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.post('/notifications/read-all', async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(or(eq(notifications.recipientUid, user.uid), eq(notifications.recipientRole, user.role)));
    res.json({ ok: true });
  } catch (error) {
    const mapped = translateDbError(error, 'تعذر تحديث الإشعارات.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// ============================================================================
// 11. Administration: Users, Configurable Settings & Backups (HR_ADMIN Only)
// ============================================================================
apiRouter.patch('/admin/users/:id', requirePermission('manage_users'), async (req: AuthRequest, res) => {
  const userId = Number(req.params.id);
  const schema = z.object({
    role: z.enum(['HR_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'SECTION_MANAGER', 'EMPLOYEE', 'READ_ONLY']).optional(),
    department: z.string().trim().max(120).optional(),
    oilfield: z.string().trim().max(120).optional(),
    employeeId: z.coerce.number().int().nullable().optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'بيانات تعديل المستخدم غير صالحة.' });

  try {
    const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'المستخدم غير موجود.' });
    if (existing.uid === req.dbUser!.uid && parsed.data.isActive === false) {
      return res.status(400).json({ error: 'لا يمكنك تعطيل حسابك النشط.' });
    }

    const [updated] = await db
      .update(users)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'UPDATE_USER_ROLE',
      recordType: 'USER',
      recordId: userId,
      previousValues: { role: existing.role, department: existing.department, isActive: existing.isActive },
      newValues: { role: updated.role, department: updated.department, isActive: updated.isActive },
      details: `تعديل صلاحيات المستخدم ${updated.email}: الدور (${updated.role}) · القسم (${updated.department || 'الكل'})`,
    });

    res.json(updated);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تحديث صلاحيات المستخدم.');
    res.status(mapped.status).json({ error: mapped.message });
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
    if (parsed.data.hrRules) {
      await upsertSystemSetting('hr_rules', parsed.data.hrRules, actorName);
    }
    if (parsed.data.orgCatalogs) {
      await upsertSystemSetting('org_catalogs', parsed.data.orgCatalogs, actorName);
    }
    if (parsed.data.workflows) {
      await upsertSystemSetting('workflows', parsed.data.workflows, actorName);
    }

    const freshConfig = await getSystemConfig();
    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'UPDATE_SETTINGS',
      recordType: 'SYSTEM_SETTINGS',
      recordId: 'global',
      details: 'تحديث إعدادات وقواعد نظام الموارد البشرية وسير العمل من لوحة الإدارة',
    });

    res.json(freshConfig);
  } catch (error) {
    const mapped = translateDbError(error, 'فشل حفظ إعدادات النظام.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// Administrator-Only Backup & Recovery (Distinguishing Database vs Document Storage)
apiRouter.post('/admin/backups/export', requirePermission('manage_backups'), async (req: AuthRequest, res) => {
  const backupType = (['DATABASE', 'DOCUMENTS', 'FULL'].includes(req.body?.backupType)
    ? req.body.backupType
    : 'DATABASE') as 'DATABASE' | 'DOCUMENTS' | 'FULL';
  const notes = String(req.body?.notes || '').slice(0, 300);

  try {
    const payload: Record<string, unknown> = {
      schemaVersion: 'BOC-HRMS-ENTERPRISE-V2',
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
      recordCount += emps.length + apps.length + pens.length + txns.length + crss.length + enrs.length + lvs.length + evts.length;
    }

    if (backupType === 'DOCUMENTS' || backupType === 'FULL') {
      const allDocs = await db.select().from(documents);
      payload.documentStorage = allDocs;
      recordCount += allDocs.length;
    }

    const serialized = JSON.stringify(payload);
    const checksum = sha256Hex(serialized);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');

    const [snapshot] = await db
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

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'CREATE_BACKUP',
      recordType: 'BACKUP',
      recordId: snapshot.id,
      details: `إنشاء نسخة احتياطية (${backupType}) — ${recordCount} سجل · SHA-256: ${checksum.slice(0, 12)}...`,
    });

    res.json({ snapshot, bundle: { ...payload, checksum } });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل إنشاء النسخة الاحتياطية.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

apiRouter.post('/admin/backups/restore', requirePermission('manage_backups'), async (req: AuthRequest, res) => {
  const { bundle } = req.body || {};
  if (!bundle || typeof bundle !== 'object' || bundle.schemaVersion !== 'BOC-HRMS-ENTERPRISE-V2') {
    return res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح أو غير متوافق مع إصدار النظام.' });
  }
  const providedChecksum = String(bundle.checksum || '');
  const clone = { ...bundle };
  delete clone.checksum;
  const calculated = sha256Hex(JSON.stringify(clone));
  if (!providedChecksum || calculated !== providedChecksum) {
    return res.status(400).json({ error: 'فشل التحقق من سلامة النسخة الاحتياطية (Checksum غير مطابق).' });
  }

  try {
    let restoredCount = 0;
    await db.transaction(async (tx) => {
      const dbData = bundle.database as Record<string, unknown> | undefined;
      if (dbData?.config) {
        const cfg = dbData.config as Record<string, unknown>;
        const actor = req.dbUser!.email;
        if (cfg.hrRules) await upsertSystemSetting('hr_rules', cfg.hrRules, actor);
        if (cfg.orgCatalogs) await upsertSystemSetting('org_catalogs', cfg.orgCatalogs, actor);
        if (cfg.workflows) await upsertSystemSetting('workflows', cfg.workflows, actor);
        restoredCount += 1;
      }
      if (Array.isArray(dbData?.employees)) {
        for (const emp of dbData.employees as (typeof employees.$inferInsert)[]) {
          await tx
            .insert(employees)
            .values({
              ...emp,
              id: undefined,
              createdAt: emp.createdAt ? new Date(emp.createdAt) : new Date(),
              updatedAt: new Date(),
              deletedAt: emp.deletedAt ? new Date(emp.deletedAt) : null,
            })
            .onConflictDoNothing({ target: employees.employeeCode });
          restoredCount += 1;
        }
      }
    });

    await writeAuditLog({
      actor: req.dbUser!,
      operation: 'RESTORE_BACKUP',
      recordType: 'BACKUP',
      recordId: providedChecksum.slice(0, 12),
      details: `استعادة نسخة احتياطية موثقة (SHA-256: ${providedChecksum.slice(0, 12)}...) — تمت معالجة ${restoredCount} عنصر`,
    });

    res.json({ ok: true, restoredCount });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل استعادة النسخة الاحتياطية.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});
