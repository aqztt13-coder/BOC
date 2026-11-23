import { auth } from './firebase';
import type {
  AppreciationRecord,
  AppUser,
  AuditLogRecord,
  BackupSnapshotRecord,
  CareerEventRecord,
  DocumentRecord,
  EmployeeRecord,
  LeaveRequestRecord,
  NotificationRecord,
  PenaltyRecordItem,
  SystemConfigBundle,
  TrainingCourseRecord,
  TrainingEnrollmentRecord,
  TransactionRecord,
  UserRole,
} from '../types/hrms';

// Session token held strictly in JS/React memory (never localStorage or sessionStorage)
let inMemorySessionToken: string | null = null;

export function setInMemorySessionToken(token: string | null) {
  inMemorySessionToken = token;
}

export function getInMemorySessionToken(): string | null {
  return inMemorySessionToken;
}

export interface EmailOtpPreview {
  to: string;
  from: string;
  subject: string;
  bodyAr: string;
  otpCode: string;
  expiresMinutes: number;
  sentAt: string;
}

export interface LoginResponse {
  requiresPasswordReset: boolean;
  purpose?: 'FIRST_LOGIN' | 'FORGOT_PASSWORD';
  employeeCode?: string;
  displayName?: string;
  maskedEmail?: string;
  emailPreview?: EmailOtpPreview;
  token?: string;
  user?: AppUser;
}

export interface BootstrapResponse {
  user: AppUser;
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  appreciations: AppreciationRecord[];
  penalties: PenaltyRecordItem[];
  documents: DocumentRecord[];
  transactions: TransactionRecord[];
  courses: TrainingCourseRecord[];
  enrollments: TrainingEnrollmentRecord[];
  leaveRequests: LeaveRequestRecord[];
  notifications: NotificationRecord[];
  auditLogs: AuditLogRecord[];
  users: AppUser[];
  backups: BackupSnapshotRecord[];
}

export interface GlobalSearchResult {
  employees: EmployeeRecord[];
  transactions: TransactionRecord[];
  documents: Array<{
    id: number;
    documentNumber: string;
    title: string;
    category: string;
    employeeId: number | null;
    department: string;
  }>;
  courses: TrainingCourseRecord[];
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const errMsg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `خطأ في الخادم (${res.status})`;
    throw new ApiError(errMsg, res.status);
  }
  return data as T;
}

export async function publicFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...options, headers, cache: 'no-store' });
  return parseJsonResponse<T>(res);
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let token = inMemorySessionToken;
  if (!token && auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  }
  if (!token) {
    throw new ApiError('يرجى تسجيل الدخول أولاً.', 401);
  }

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    cache: 'no-store',
  });

  return parseJsonResponse<T>(res);
}

export const authApi = {
  status: () => publicFetch<{ initialized: boolean; employeeCount: number }>('/api/auth/status'),

  bootstrapWorkspace: (payload: {
    hrEmployeeCode: string;
    hrFullName: string;
    hrEmail: string;
    hrPassword: string;
    employeeInitialPassword?: string;
    includeSampleBocData: boolean;
  }) =>
    publicFetch<{ token: string; user: AppUser; firstLoginDemoCode: string | null }>(
      '/api/auth/bootstrap-workspace',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  login: (employeeCode: string, password: string) =>
    publicFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employeeCode, password }),
    }),

  forgotPassword: (employeeCode: string) =>
    publicFetch<{
      ok: boolean;
      employeeCode: string;
      displayName: string;
      maskedEmail: string;
      emailPreview: EmailOtpPreview;
    }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ employeeCode }),
    }),

  resetPassword: (payload: { employeeCode: string; otpCode: string; newPassword: string }) =>
    publicFetch<{ ok: boolean; token: string; user: AppUser }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: async () => {
    const token = inMemorySessionToken;
    inMemorySessionToken = null;
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
      } catch {
        // ignore network failures during logout
      }
    }
  },
};

export const hrmsApi = {
  bootstrap: () => apiFetch<BootstrapResponse>('/api/bootstrap'),

  search: (q: string) => apiFetch<GlobalSearchResult>(`/api/search?q=${encodeURIComponent(q)}`),

  // Employees
  createEmployee: (
    payload: Partial<EmployeeRecord> & {
      provisionAccount?: boolean;
      initialPassword?: string;
      accountRole?: UserRole;
    }
  ) =>
    apiFetch<EmployeeRecord>('/api/employees', { method: 'POST', body: JSON.stringify(payload) }),
  updateEmployee: (id: number, payload: Partial<EmployeeRecord>) =>
    apiFetch<EmployeeRecord>(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteEmployee: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/employees/${id}`, { method: 'DELETE' }),
  getEmployeeTimeline: (id: number) =>
    apiFetch<CareerEventRecord[]>(`/api/employees/${id}/timeline`),
  addCareerEvent: (
    id: number,
    payload: { eventType: string; title: string; description: string; eventDate: string; referenceNumber?: string }
  ) =>
    apiFetch<CareerEventRecord>(`/api/employees/${id}/timeline`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Promotions & Increments Workflow
  initiatePromotionWorkflow: (payload: {
    employeeId: number;
    kind: 'PROMOTION_REVIEW' | 'INCREMENT_REVIEW';
    explanation: string[];
    effectiveDate: string;
  }) =>
    apiFetch<TransactionRecord>('/api/promotions/initiate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Appreciations & Penalties
  createAppreciation: (payload: {
    employeeId: number;
    letterNumber: string;
    issueDate: string;
    issuingAuthority: string;
    subject: string;
    seniorityMonths: number;
  }) =>
    apiFetch<AppreciationRecord>('/api/appreciations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createPenalty: (payload: {
    employeeId: number;
    orderNumber: string;
    issueDate: string;
    penaltyType: string;
    delayMonths?: number;
    reason: string;
  }) =>
    apiFetch<PenaltyRecordItem>('/api/penalties', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Documents
  uploadDocument: (payload: {
    documentNumber: string;
    title: string;
    category: string;
    issueDate: string;
    expiryDate?: string | null;
    issuingAuthority: string;
    employeeId?: number | null;
    transactionId?: number | null;
    department?: string;
    oilfield?: string;
    description?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: string;
    fileContentBase64?: string | null;
  }) =>
    apiFetch<DocumentRecord>('/api/documents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  downloadDocument: (id: number) =>
    apiFetch<{
      id: number;
      documentNumber: string;
      title: string;
      fileName: string;
      mimeType: string;
      fileContentBase64: string | null;
      verificationCode: string;
    }>(`/api/documents/${id}/download`),
  deleteDocument: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/documents/${id}`, { method: 'DELETE' }),

  // Transactions
  createTransaction: (payload: {
    transactionType: string;
    title: string;
    employeeId: number;
    payload?: Record<string, unknown>;
  }) =>
    apiFetch<TransactionRecord>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  performTransactionAction: (
    id: number,
    payload: {
      action: 'APPROVE' | 'REJECT' | 'RETURN' | 'RESUBMIT' | 'ESCALATE' | 'COMPLETE' | 'ARCHIVE';
      comment?: string;
    }
  ) =>
    apiFetch<TransactionRecord>(`/api/transactions/${id}/action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Training
  createCourse: (payload: {
    code: string;
    title: string;
    titleEn?: string;
    category: string;
    deliveryType: 'داخلي' | 'خارجي' | 'إلكتروني';
    provider: string;
    instructor: string;
    startDate: string;
    endDate: string;
    location: string;
    totalSeats: number;
    budgetIQD?: number;
    trainingPlanYear?: number;
    status?: 'مفتوح للتسجيل' | 'جاري الانعقاد' | 'مكتمل' | 'مؤجل' | 'ملغى';
  }) =>
    apiFetch<TrainingCourseRecord>('/api/courses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCourse: (id: number, payload: Partial<TrainingCourseRecord>) =>
    apiFetch<TrainingCourseRecord>(`/api/courses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  applyToCourse: (courseId: number, employeeId: number) =>
    apiFetch<{ enrollment: TrainingEnrollmentRecord; transaction: TransactionRecord }>(
      `/api/courses/${courseId}/apply`,
      { method: 'POST', body: JSON.stringify({ employeeId }) }
    ),
  updateEnrollment: (
    id: number,
    payload: {
      attendancePercent?: number;
      evaluationScore?: number | null;
      evaluationNotes?: string | null;
      markCompleted?: boolean;
    }
  ) =>
    apiFetch<TrainingEnrollmentRecord>(`/api/enrollments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Leaves
  createLeave: (payload: {
    employeeId: number;
    leaveType: string;
    startDate: string;
    endDate: string;
    reason: string;
  }) =>
    apiFetch<{ leave: LeaveRequestRecord; transaction: TransactionRecord }>('/api/leaves', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adjustLeaveBalance: (payload: {
    employeeId: number;
    balanceType: 'annual' | 'sick';
    deltaDays: number;
    reason: string;
  }) =>
    apiFetch<EmployeeRecord>('/api/leaves/adjust-balance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Notifications
  markNotificationRead: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () =>
    apiFetch<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  // Admin
  updateUser: (
    id: number,
    payload: {
      role?: AppUser['role'];
      department?: string;
      oilfield?: string;
      employeeId?: number | null;
      isActive?: boolean;
    }
  ) =>
    apiFetch<AppUser>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  saveSettings: (payload: Partial<SystemConfigBundle>) =>
    apiFetch<SystemConfigBundle>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  exportBackup: (backupType: 'DATABASE' | 'DOCUMENTS' | 'FULL', notes?: string) =>
    apiFetch<{ snapshot: BackupSnapshotRecord; bundle: Record<string, unknown> }>(
      '/api/admin/backups/export',
      { method: 'POST', body: JSON.stringify({ backupType, notes }) }
    ),
  restoreBackup: (bundle: Record<string, unknown>) =>
    apiFetch<{ ok: boolean; restoredCount: number }>('/api/admin/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ bundle }),
    }),
};
