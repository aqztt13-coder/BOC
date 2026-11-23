import type { UserRole } from '../types/hrms.ts';

export interface ScopedActor {
  uid: string;
  role: UserRole;
  department: string;
  section?: string;
  oilfield: string;
  employeeId: number | null;
}

export interface EmployeeScopeTarget {
  id: number;
  department: string;
  section?: string | null;
  oilfield?: string | null;
}

export interface DocumentScopeTarget {
  id: number;
  employeeId: number | null;
  department: string;
  oilfield?: string | null;
  confidentialityLevel?: string | null;
}

export interface NotificationScopeTarget {
  recipientUid?: string | null;
  recipientRole?: string | null;
  readByUids?: unknown;
}

export function isPrivilegedHR(role: UserRole): boolean {
  return role === 'HR_ADMIN' || role === 'HR_MANAGER';
}

/**
 * Strict hierarchical organizational access control:
 * - HR_ADMIN / HR_MANAGER: full organizational visibility.
 * - READ_ONLY: read-only organizational metadata (sensitive PII & documents redacted/blocked).
 * - DEPT_MANAGER: matching department (and matching oilfield if assigned to the manager).
 * - SECTION_MANAGER: matching department + matching section (if assigned) + matching oilfield (if assigned).
 * - EMPLOYEE: strictly own employeeId only.
 */
export function canAccessEmployee(actor: ScopedActor, emp: EmployeeScopeTarget): boolean {
  if (actor.role === 'HR_ADMIN' || actor.role === 'HR_MANAGER' || actor.role === 'READ_ONLY') {
    return true;
  }

  if (actor.role === 'DEPT_MANAGER') {
    if (!actor.department || emp.department !== actor.department) return false;
    if (actor.oilfield && emp.oilfield && emp.oilfield !== actor.oilfield) return false;
    return true;
  }

  if (actor.role === 'SECTION_MANAGER') {
    if (!actor.department || emp.department !== actor.department) return false;
    if (actor.section && (emp.section || '') !== actor.section) return false;
    if (actor.oilfield && emp.oilfield && emp.oilfield !== actor.oilfield) return false;
    return true;
  }

  return actor.employeeId !== null && emp.id === actor.employeeId;
}

/**
 * Protects sensitive personal & compensation fields (nationalId, basicSalaryIQD, phone, notes).
 * Only HR_ADMIN, HR_MANAGER, and the employee themselves receive unredacted PII & salary.
 */
export function canViewSensitiveEmployeeFields(actor: ScopedActor, employeeId: number): boolean {
  if (isPrivilegedHR(actor.role)) return true;
  return actor.employeeId !== null && actor.employeeId === employeeId;
}

export function redactEmployeeForUser<
  T extends {
    id: number;
    nationalId?: string | null;
    basicSalaryIQD: number;
    phone: string;
    notes?: string | null;
  },
>(actor: ScopedActor, emp: T): T {
  if (canViewSensitiveEmployeeFields(actor, emp.id)) {
    return emp;
  }
  return {
    ...emp,
    nationalId: null,
    basicSalaryIQD: 0,
    phone: '',
    notes: '',
  };
}

/**
 * Strict document access control:
 * - READ_ONLY can NEVER access or download private documents.
 * - CONFIDENTIAL / HR_ONLY documents are restricted strictly to HR_ADMIN & HR_MANAGER.
 * - Unlinked documents (employeeId === null) are NEVER accessible to EMPLOYEE, SECTION_MANAGER, or READ_ONLY.
 *   DEPT_MANAGER may access non-confidential unlinked documents ONLY for their own department.
 * - Linked documents require full organizational employee access (canAccessEmployee).
 */
export function canAccessDocument(
  actor: ScopedActor,
  doc: DocumentScopeTarget,
  linkedEmployee?: EmployeeScopeTarget | null
): boolean {
  if (actor.role === 'READ_ONLY') return false;

  const level = (doc.confidentialityLevel || 'INTERNAL').toUpperCase();
  if (isPrivilegedHR(actor.role)) return true;

  if (level === 'CONFIDENTIAL' || level === 'HR_ONLY') {
    return false;
  }

  // Unlinked documents (administrative / general)
  if (doc.employeeId === null || doc.employeeId === undefined) {
    if (actor.role === 'DEPT_MANAGER') {
      if (!actor.department || !doc.department || doc.department !== actor.department) {
        return false;
      }
      if (actor.oilfield && doc.oilfield && doc.oilfield !== actor.oilfield) {
        return false;
      }
      return true;
    }
    return false;
  }

  // Linked employee document
  if (!linkedEmployee) {
    // If linked employee record cannot be verified (e.g., deleted/missing), deny non-HR access
    return false;
  }
  return canAccessEmployee(actor, linkedEmployee);
}

/**
 * Strict notification ownership verification so users can only view/mark their own notifications.
 */
export function canManageNotification(actor: ScopedActor, notif: NotificationScopeTarget): boolean {
  if (notif.recipientUid) {
    return notif.recipientUid === actor.uid;
  }
  if (notif.recipientRole) {
    return notif.recipientRole === actor.role;
  }
  return false;
}

export function isNotificationReadForUser(actorUid: string, notif: NotificationScopeTarget & { isRead: boolean }): boolean {
  if (notif.recipientUid) {
    return Boolean(notif.isRead);
  }
  const readers = Array.isArray(notif.readByUids) ? (notif.readByUids as string[]) : [];
  return Boolean(notif.isRead) || readers.includes(actorUid);
}

/**
 * Prevent privilege escalation when provisioning user accounts.
 * Only HR_ADMIN may create HR_ADMIN or HR_MANAGER accounts.
 */
export function canProvisionAccountRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'HR_ADMIN') return true;
  if (actorRole === 'HR_MANAGER') {
    return targetRole === 'EMPLOYEE' || targetRole === 'READ_ONLY' || targetRole === 'SECTION_MANAGER' || targetRole === 'DEPT_MANAGER';
  }
  return false;
}
