import crypto from 'node:crypto';
import { z } from 'zod';

const isoDateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const employeeBackupItemSchema = z.object({
  id: z.number().int().positive().optional(),
  employeeCode: z.string().min(2).max(40),
  nationalId: z.string().nullable().optional(),
  fullName: z.string().min(2).max(160),
  fullNameEn: z.string().optional().default(''),
  birthDate: isoDateStr.nullable().optional(),
  gender: z.string().nullable().optional(),
  jobTitle: z.string().min(1),
  jobTitleEn: z.string().optional().default(''),
  department: z.string().min(1),
  oilfield: z.string().min(1),
  section: z.string().optional().default(''),
  grade: z.number().int().min(1).max(10),
  step: z.number().int().min(1).max(11),
  hireDate: isoDateStr,
  lastPromotionDate: isoDateStr,
  lastIncrementDate: isoDateStr,
  academicDegree: z.string().min(1),
  specialization: z.string().optional().default(''),
  email: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  basicSalaryIQD: z.number().int().min(0).default(0),
  annualLeaveBalance: z.number().int().min(0).max(365).default(30),
  sickLeaveBalance: z.number().int().min(0).max(365).default(30),
  status: z.string().default('نشط'),
  notes: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const backupDatabaseSchema = z.object({
  employees: z.array(employeeBackupItemSchema).optional().default([]),
  appreciations: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  penalties: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  transactions: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  trainingCourses: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  trainingEnrollments: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  leaveRequests: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  careerEvents: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  config: z
    .object({
      hrRules: z.record(z.string(), z.unknown()).optional(),
      orgCatalogs: z.record(z.string(), z.unknown()).optional(),
      workflows: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
});

export const backupBundleSchema = z.object({
  schemaVersion: z.enum(['BOC-HRMS-ENTERPRISE-V2', 'BOC-HRMS-ENTERPRISE-V3']),
  backupType: z.enum(['DATABASE', 'DOCUMENTS', 'FULL']),
  exportedAt: z.string().min(10),
  exportedBy: z.string().min(3),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  database: backupDatabaseSchema.optional(),
  documentStorage: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type ValidatedBackupBundle = z.infer<typeof backupBundleSchema>;

export function computeBundleChecksum(bundleWithoutChecksum: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(bundleWithoutChecksum)).digest('hex');
}

export function validateBackupBundle(rawBundle: unknown):
  | { ok: true; bundle: ValidatedBackupBundle }
  | { ok: false; error: string } {
  const parsed = backupBundleSchema.safeParse(rawBundle);
  if (!parsed.success) {
    return {
      ok: false,
      error: `هيكل ملف النسخة الاحتياطية غير صالح: ${parsed.error.issues[0]?.path.join('.') || 'root'}`,
    };
  }

  const rawObj = rawBundle as Record<string, unknown>;
  const clone: Record<string, unknown> = { ...rawObj };
  const providedChecksum = String(clone.checksum || '');
  delete clone.checksum;

  const calculated = computeBundleChecksum(clone);
  if (!providedChecksum || calculated !== providedChecksum) {
    return {
      ok: false,
      error: 'فشل التحقق من سلامة النسخة الاحتياطية (SHA-256 Checksum غير مطابق).',
    };
  }

  // Referential integrity pre-check for database records
  const dbSection = parsed.data.database;
  if (dbSection) {
    const empIds = new Set(
      dbSection.employees
        .map((e) => e.id)
        .filter((id): id is number => typeof id === 'number')
    );
    const courseIds = new Set(
      dbSection.trainingCourses
        .map((c) => Number(c.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );

    if (empIds.size > 0) {
      for (const app of dbSection.appreciations) {
        if (typeof app.employeeId === 'number' && !empIds.has(app.employeeId)) {
          return {
            ok: false,
            error: `فشل التحقق المرجعي: كتاب شكر مرتبط بمعرف منتسب غير موجود (${app.employeeId}).`,
          };
        }
      }
      for (const pen of dbSection.penalties) {
        if (typeof pen.employeeId === 'number' && !empIds.has(pen.employeeId)) {
          return {
            ok: false,
            error: `فشل التحقق المرجعي: عقوبة مرتبطة بمعرف منتسب غير موجود (${pen.employeeId}).`,
          };
        }
      }
      for (const lv of dbSection.leaveRequests) {
        if (typeof lv.employeeId === 'number' && !empIds.has(lv.employeeId)) {
          return {
            ok: false,
            error: `فشل التحقق المرجعي: إجازة مرتبطة بمعرف منتسب غير موجود (${lv.employeeId}).`,
          };
        }
      }
    }

    if (courseIds.size > 0) {
      for (const enr of dbSection.trainingEnrollments) {
        if (typeof enr.courseId === 'number' && !courseIds.has(enr.courseId)) {
          return {
            ok: false,
            error: `فشل التحقق المرجعي: ترشيح تدريبي مرتبط بدورة غير موجودة (${enr.courseId}).`,
          };
        }
      }
    }
  }

  return { ok: true, bundle: parsed.data };
}
