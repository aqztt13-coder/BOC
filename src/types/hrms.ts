export type UserRole =
  | 'HR_ADMIN'
  | 'HR_MANAGER'
  | 'DEPT_MANAGER'
  | 'SECTION_MANAGER'
  | 'EMPLOYEE'
  | 'READ_ONLY';

export type Permission =
  | 'view_all_employees'
  | 'view_dept_employees'
  | 'create_employee'
  | 'edit_employee'
  | 'delete_employee'
  | 'manage_promotions'
  | 'manage_appreciations'
  | 'manage_penalties'
  | 'manage_training'
  | 'approve_dept'
  | 'approve_hr'
  | 'upload_documents'
  | 'download_documents'
  | 'view_audit'
  | 'export_reports'
  | 'manage_users'
  | 'manage_settings'
  | 'manage_backups';

export type Language = 'ar' | 'en';
export type ThemeMode = 'light' | 'dark';

export type ActiveView =
  | 'dashboard'
  | 'employees'
  | 'promotions'
  | 'transactions'
  | 'documents'
  | 'appreciations'
  | 'training'
  | 'leaves'
  | 'reports'
  | 'audit'
  | 'admin';

export interface AppUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string | null;
  role: UserRole;
  department: string;
  oilfield: string;
  employeeId: number | null;
  isActive: boolean;
  permissions: Permission[];
  createdAt?: string;
}

export interface HRRulesConfig {
  gradePromotionYears: Record<string, number>; // "1".."10" -> years
  incrementCycleMonths: number;
  earlyAlertDays: number;
  retirementAgeYears: number;
  retirementWarningMonths: number;
  maxSeniorityMonthsPerCycle: number;
  penaltyDelays: Record<string, number>; // penalty name -> delay months
  promotionSalaryIncreasePct: number;
  incrementSalaryIncreasePct: number;
}

export interface LeaveTypeConfig {
  name: string;
  annualEntitlementDays: number;
  maxDaysPerRequest: number;
  deductsFrom: 'annual' | 'sick' | 'none';
  requiresAttachment: boolean;
}

export interface OrgCatalogsConfig {
  departments: string[];
  oilfields: string[];
  sections: string[];
  jobTitles: string[];
  academicDegrees: string[];
  documentCategories: string[];
  trainingCategories: string[];
  leaveTypes: LeaveTypeConfig[];
}

export interface WorkflowConfigItem {
  transactionType: string;
  labelAr: string;
  requiresDeptApproval: boolean;
  requiresHrApproval: boolean;
  escalationDays: number;
}

export interface SystemConfigBundle {
  hrRules: HRRulesConfig;
  orgCatalogs: OrgCatalogsConfig;
  workflows: WorkflowConfigItem[];
}

export interface EmployeeRecord {
  id: number;
  employeeCode: string;
  nationalId?: string | null;
  fullName: string;
  fullNameEn: string;
  birthDate?: string | null;
  gender?: string | null;
  jobTitle: string;
  jobTitleEn: string;
  department: string;
  oilfield: string;
  section: string;
  grade: number;
  step: number;
  hireDate: string;
  lastPromotionDate: string;
  lastIncrementDate: string;
  academicDegree: string;
  specialization: string;
  email: string;
  phone: string;
  basicSalaryIQD: number;
  annualLeaveBalance: number;
  sickLeaveBalance: number;
  status: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CareerEventRecord {
  id: number;
  employeeId: number;
  eventType: string;
  title: string;
  description: string;
  eventDate: string;
  referenceNumber?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AppreciationRecord {
  id: number;
  employeeId: number;
  letterNumber: string;
  issueDate: string;
  issuingAuthority: string;
  subject: string;
  seniorityMonths: number;
  verificationCode: string;
  appliedToCurrentCycle: boolean;
  createdBy: string;
  createdAt: string;
}

export interface PenaltyRecordItem {
  id: number;
  employeeId: number;
  orderNumber: string;
  issueDate: string;
  penaltyType: string;
  delayMonths: number;
  reason: string;
  appliedToCurrentCycle: boolean;
  createdBy: string;
  createdAt: string;
}

export interface DocumentRecord {
  id: number;
  documentNumber: string;
  title: string;
  category: string;
  issueDate: string;
  expiryDate?: string | null;
  issuingAuthority: string;
  employeeId?: number | null;
  transactionId?: number | null;
  department: string;
  oilfield: string;
  description?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: string;
  hasContent?: boolean;
  version: number;
  archiveStatus: string;
  verificationCode: string;
  uploadedBy: string;
  createdAt: string;
}

export interface TransactionHistoryStep {
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  comment?: string;
  fromStatus: string;
  toStatus: string;
}

export interface TransactionRecord {
  id: number;
  transactionNumber: string;
  transactionType: string;
  title: string;
  employeeId: number;
  department: string;
  oilfield: string;
  currentResponsibleRole: string;
  status: string;
  payload: Record<string, unknown>;
  history: TransactionHistoryStep[];
  rejectionReason?: string | null;
  escalated: boolean;
  completedAt?: string | null;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingCourseRecord {
  id: number;
  code: string;
  title: string;
  titleEn: string;
  category: string;
  deliveryType: string;
  provider: string;
  instructor: string;
  startDate: string;
  endDate: string;
  location: string;
  totalSeats: number;
  budgetIQD: number;
  trainingPlanYear: number;
  status: string;
  enrolledCount?: number;
  createdAt: string;
}

export interface TrainingEnrollmentRecord {
  id: number;
  courseId: number;
  employeeId: number;
  transactionId?: number | null;
  appliedDate: string;
  status: string;
  attendancePercent: number;
  evaluationScore?: number | null;
  evaluationNotes?: string | null;
  rejectionReason?: string | null;
  certificateDocumentId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestRecord {
  id: number;
  employeeId: number;
  transactionId?: number | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  rejectionReason?: string | null;
  approvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRecord {
  id: number;
  recipientUid?: string | null;
  recipientRole?: string | null;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  entityType?: string | null;
  entityId?: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogRecord {
  id: number;
  actorUid: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  operation: string;
  recordType: string;
  recordId: string;
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  details: string;
  createdAt: string;
}

export interface BackupSnapshotRecord {
  id: number;
  backupType: 'DATABASE' | 'DOCUMENTS' | 'FULL';
  status: string;
  recordCount: number;
  sizeBytes: number;
  checksum: string;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PromotionCalculationResult {
  employeeId: number;
  gradeYearsRequired: number;
  baseIncrementDate: string;
  basePromotionDate: string;
  rawSeniorityMonths: number;
  effectiveSeniorityMonths: number;
  totalPenaltyDelayMonths: number;
  netAdjustmentMonths: number;
  effectiveIncrementDate: string;
  effectivePromotionDate: string;
  daysToIncrement: number;
  daysToPromotion: number;
  isIncrementDueSoon: boolean;
  isPromotionDueSoon: boolean;
  isIncrementOverdue: boolean;
  isPromotionOverdue: boolean;
  approachingRetirement: boolean;
  retirementDate: string | null;
  progressionStatus: 'OVERDUE' | 'DUE_SOON' | 'DELAYED_BY_PENALTY' | 'ON_TRACK';
  explanationSteps: string[];
}
