import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { auditLogs, careerEvents, notifications, systemSettings } from './schema.ts';
import {
  DEFAULT_HR_RULES,
  DEFAULT_ORG_CATALOGS,
  DEFAULT_WORKFLOWS,
  todayBaghdadISO,
} from '../utils/hrEngine.ts';
import type { SystemConfigBundle } from '../types/hrms.ts';
import type { DbAuthUser } from '../middleware/auth.ts';

type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

export function todayISO(): string {
  return todayBaghdadISO();
}

export function generateCode(prefix: string): string {
  const year = todayBaghdadISO().slice(0, 4);
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${year}-${rnd}`;
}

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function translateDbError(error: unknown, fallbackMessage: string): { status: number; message: string } {
  const err = error as { code?: string; cause?: { code?: string }; status?: number; message?: string };
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.message) {
    return { status: err.status, message: err.message };
  }
  const pgCode = err?.code || err?.cause?.code;
  if (pgCode === '23505') {
    return { status: 409, message: 'السجل موجود مسبقاً (تعارض في الرقم الوظيفي أو رقم الكتاب الفريد).' };
  }
  if (pgCode === '23503') {
    return { status: 400, message: 'لا يمكن إتمام العملية لوجود ارتباط بمرجع غير موجود.' };
  }
  if (pgCode === '40001' || pgCode === '40P01') {
    return { status: 409, message: 'تعارض تزامن في قاعدة البيانات. يرجى إعادة المحاولة.' };
  }
  console.error('Database operation failed:', error);
  return { status: 500, message: fallbackMessage };
}

export async function getSystemConfig(executor: DbExecutor = db): Promise<SystemConfigBundle> {
  const rows = await executor.select().from(systemSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const storedRules = map.get('hr_rules') as Partial<SystemConfigBundle['hrRules']> | undefined;
  return {
    hrRules: storedRules ? { ...DEFAULT_HR_RULES, ...storedRules } : DEFAULT_HR_RULES,
    orgCatalogs: (map.get('org_catalogs') as SystemConfigBundle['orgCatalogs']) || DEFAULT_ORG_CATALOGS,
    workflows: (map.get('workflows') as SystemConfigBundle['workflows']) || DEFAULT_WORKFLOWS,
  };
}

export async function upsertSystemSetting(
  key: string,
  value: unknown,
  updatedBy: string,
  executor: DbExecutor = db
): Promise<void> {
  await executor
    .insert(systemSettings)
    .values({ key, value, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedBy, updatedAt: new Date() },
    });
}

/**
 * Reliable, non-swallowing audit logging.
 * Accepts a Drizzle transaction handle so audit writes commit or roll back atomically
 * with the primary database mutation.
 */
export async function writeAuditLog(
  params: {
    actor: DbAuthUser;
    operation: string;
    recordType: string;
    recordId?: string | number;
    previousValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    details: string;
  },
  executor: DbExecutor = db
): Promise<void> {
  await executor.insert(auditLogs).values({
    actorUid: params.actor.uid,
    actorName: params.actor.displayName || params.actor.email,
    actorEmail: params.actor.email,
    actorRole: params.actor.role,
    operation: params.operation,
    recordType: params.recordType,
    recordId: params.recordId !== undefined ? String(params.recordId) : '',
    previousValues: params.previousValues ?? null,
    newValues: params.newValues ?? null,
    details: params.details,
  });
}

export async function createNotification(
  params: {
    recipientUid?: string | null;
    recipientRole?: string | null;
    title: string;
    message: string;
    severity?: 'info' | 'warning' | 'critical' | 'success';
    entityType?: string;
    entityId?: number;
  },
  executor: DbExecutor = db
): Promise<void> {
  await executor.insert(notifications).values({
    recipientUid: params.recipientUid ?? null,
    recipientRole: params.recipientRole ?? null,
    title: params.title,
    message: params.message,
    severity: params.severity ?? 'info',
    entityType: params.entityType ?? '',
    entityId: params.entityId ?? null,
    isRead: false,
    readByUids: [],
  });
}

export async function addCareerEvent(
  params: {
    employeeId: number;
    eventType: string;
    title: string;
    description: string;
    eventDate?: string;
    referenceNumber?: string;
    createdBy: string;
  },
  executor: DbExecutor = db
): Promise<void> {
  await executor.insert(careerEvents).values({
    employeeId: params.employeeId,
    eventType: params.eventType,
    title: params.title,
    description: params.description,
    eventDate: params.eventDate || todayISO(),
    referenceNumber: params.referenceNumber || '',
    createdBy: params.createdBy,
  });
}

export async function getSettingByKey<T>(key: string, fallback: T, executor: DbExecutor = db): Promise<T> {
  const rows = await executor.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  if (rows.length === 0) return fallback;
  return rows[0].value as T;
}
