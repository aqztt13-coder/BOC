import type { Permission, UserRole } from '../types/hrms';

export const ROLE_LABELS_AR: Record<UserRole, string> = {
  HR_ADMIN: 'مدير النظام والموارد البشرية',
  HR_MANAGER: 'مدير قسم الموارد البشرية',
  DEPT_MANAGER: 'مدير القسم / الهيئة',
  SECTION_MANAGER: 'مدير الشعبة',
  EMPLOYEE: 'موظف (الخدمة الذاتية)',
  READ_ONLY: 'مراقب / قراءة فقط',
};

export const ROLE_LABELS_EN: Record<UserRole, string> = {
  HR_ADMIN: 'HR Administrator',
  HR_MANAGER: 'HR Manager',
  DEPT_MANAGER: 'Department Manager',
  SECTION_MANAGER: 'Section Manager',
  EMPLOYEE: 'Employee',
  READ_ONLY: 'Read-Only User',
};

const ROLE_PERMISSIONS_MAP: Record<UserRole, Permission[]> = {
  HR_ADMIN: [
    'view_all_employees',
    'view_dept_employees',
    'create_employee',
    'edit_employee',
    'delete_employee',
    'manage_promotions',
    'manage_appreciations',
    'manage_penalties',
    'manage_training',
    'approve_dept',
    'approve_hr',
    'upload_documents',
    'download_documents',
    'view_audit',
    'export_reports',
    'manage_users',
    'manage_settings',
    'manage_backups',
  ],
  HR_MANAGER: [
    'view_all_employees',
    'view_dept_employees',
    'create_employee',
    'edit_employee',
    'manage_promotions',
    'manage_appreciations',
    'manage_penalties',
    'manage_training',
    'approve_dept',
    'approve_hr',
    'upload_documents',
    'download_documents',
    'view_audit',
    'export_reports',
  ],
  DEPT_MANAGER: [
    'view_dept_employees',
    'approve_dept',
    'upload_documents',
    'download_documents',
    'export_reports',
  ],
  SECTION_MANAGER: [
    'view_dept_employees',
    'approve_dept',
    'download_documents',
  ],
  EMPLOYEE: ['upload_documents', 'download_documents'],
  READ_ONLY: ['view_all_employees', 'export_reports'],
};

export function getPermissionsForRole(role: string): Permission[] {
  if (role in ROLE_PERMISSIONS_MAP) {
    return ROLE_PERMISSIONS_MAP[role as UserRole];
  }
  return ROLE_PERMISSIONS_MAP.EMPLOYEE;
}

export function hasPermission(role: string, permission: Permission): boolean {
  return getPermissionsForRole(role).includes(permission);
}

export function isHRWideRole(role: string): boolean {
  return role === 'HR_ADMIN' || role === 'HR_MANAGER' || role === 'READ_ONLY';
}
