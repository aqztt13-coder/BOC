import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. Employees (Comprehensive Digital Career Record)
export const employees = pgTable('employees', {
  id: serial('id').primaryKey(),
  employeeCode: text('employee_code').notNull().unique(),
  nationalId: text('national_id'),
  fullName: text('full_name').notNull(),
  fullNameEn: text('full_name_en').notNull().default(''),
  birthDate: text('birth_date'), // YYYY-MM-DD for retirement analytics
  gender: text('gender').default('ذكر'),
  jobTitle: text('job_title').notNull(),
  jobTitleEn: text('job_title_en').notNull().default(''),
  department: text('department').notNull(),
  oilfield: text('oilfield').notNull(),
  section: text('section').notNull().default(''),
  grade: integer('grade').notNull().default(7),
  step: integer('step').notNull().default(1),
  hireDate: text('hire_date').notNull(), // YYYY-MM-DD
  lastPromotionDate: text('last_promotion_date').notNull(),
  lastIncrementDate: text('last_increment_date').notNull(),
  academicDegree: text('academic_degree').notNull(),
  specialization: text('specialization').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  basicSalaryIQD: integer('basic_salary_iqd').notNull().default(0),
  annualLeaveBalance: integer('annual_leave_balance').notNull().default(30),
  sickLeaveBalance: integer('sick_leave_balance').notNull().default(30),
  status: text('status').notNull().default('نشط'), // نشط | مجاز | في دورة تدريبية | منسب | متقاعد | موقوف
  notes: text('notes').default(''),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. Application Users & RBAC Identity
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID or local BOC UID
  employeeCode: text('employee_code'), // Unique Employee ID for direct BOC login (enforced in app logic)
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull().default(''),
  photoUrl: text('photo_url'),
  passwordHash: text('password_hash'), // scrypt salt:hash for Employee ID login
  mustResetPassword: boolean('must_reset_password').notNull().default(false),
  tokenVersion: integer('token_version').notNull().default(1),
  role: text('role').notNull().default('EMPLOYEE'), // HR_ADMIN | HR_MANAGER | DEPT_MANAGER | SECTION_MANAGER | EMPLOYEE | READ_ONLY
  department: text('department').notNull().default(''),
  oilfield: text('oilfield').notNull().default(''),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2b. Email Verification OTPs for First-Time Login & Password Reset
export const passwordResetOtps = pgTable('password_reset_otps', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  employeeCode: text('employee_code').notNull(),
  email: text('email').notNull(),
  otpHash: text('otp_hash').notNull(),
  purpose: text('purpose').notNull().default('FIRST_LOGIN'), // FIRST_LOGIN | FORGOT_PASSWORD
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. System Settings & Configurable HR Rules (No Hardcoded Policies)
export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').notNull().default('system'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 4. Employee Chronological Career Timeline Events
export const careerEvents = pgTable('career_events', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  eventType: text('event_type').notNull(), // تعيين | ترفيع | علاوة | كتاب شكر | عقوبة | دورة تدريبية | تنسيب | ملاحظة
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  eventDate: text('event_date').notNull(),
  referenceNumber: text('reference_number').default(''),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Appreciation Letters
export const appreciations = pgTable('appreciations', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  letterNumber: text('letter_number').notNull().unique(),
  issueDate: text('issue_date').notNull(),
  issuingAuthority: text('issuing_authority').notNull(),
  subject: text('subject').notNull(),
  seniorityMonths: integer('seniority_months').notNull().default(1),
  verificationCode: text('verification_code').notNull().unique(),
  appliedToCurrentCycle: boolean('applied_to_current_cycle').notNull().default(true),
  deletedAt: timestamp('deleted_at'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Administrative Penalties
export const penalties = pgTable('penalties', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  orderNumber: text('order_number').notNull().unique(),
  issueDate: text('issue_date').notNull(),
  penaltyType: text('penalty_type').notNull(),
  delayMonths: integer('delay_months').notNull().default(3),
  reason: text('reason').notNull(),
  appliedToCurrentCycle: boolean('applied_to_current_cycle').notNull().default(true),
  deletedAt: timestamp('deleted_at'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Centralized Administrative Transactions & Workflow Engine
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  transactionNumber: text('transaction_number').notNull().unique(),
  transactionType: text('transaction_type').notNull(), // LEAVE | TRAINING | CONTINUATION_OF_SERVICE | SALARY_CERTIFICATE | PROMOTION_REVIEW | INCREMENT_REVIEW | DOCUMENT_REQUEST | CORRESPONDENCE
  title: text('title').notNull(),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  department: text('department').notNull().default(''),
  oilfield: text('oilfield').notNull().default(''),
  currentResponsibleRole: text('current_responsible_role').notNull().default('DEPT_MANAGER'),
  status: text('status').notNull().default('بانتظار موافقة القسم'),
  // Statuses: مسودة | مقدم | بانتظار موافقة القسم | بانتظار موافقة الموارد البشرية | معاد للتعديل | معتمد | مرفوض | مكتمل | مؤرشف
  payload: jsonb('payload').notNull().default({}),
  history: jsonb('history').notNull().default([]),
  rejectionReason: text('rejection_reason'),
  escalated: boolean('escalated').notNull().default(false),
  completedAt: timestamp('completed_at'),
  createdByUid: text('created_by_uid').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 8. Centralized Digital Document Archive (Protected Storage)
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  documentNumber: text('document_number').notNull().unique(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  issueDate: text('issue_date').notNull(),
  expiryDate: text('expiry_date'),
  issuingAuthority: text('issuing_authority').notNull().default('شركة نفط البصرة'),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  transactionId: integer('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  department: text('department').notNull().default(''),
  oilfield: text('oilfield').notNull().default(''),
  description: text('description').default(''),
  fileName: text('file_name').notNull().default('document.pdf'),
  mimeType: text('mime_type').notNull().default('application/pdf'),
  fileSize: text('file_size').notNull().default('0 KB'),
  fileContentBase64: text('file_content_base64'),
  version: integer('version').notNull().default(1),
  archiveStatus: text('archive_status').notNull().default('نشط'), // نشط | مؤرشف | منتهي الصلاحية
  verificationCode: text('verification_code').notNull().unique(),
  deletedAt: timestamp('deleted_at'),
  uploadedBy: text('uploaded_by').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 9. Training Courses Catalog
export const trainingCourses = pgTable('training_courses', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  titleEn: text('title_en').notNull().default(''),
  category: text('category').notNull().default('فني وهندسي'),
  deliveryType: text('delivery_type').notNull().default('داخلي'), // داخلي | خارجي | إلكتروني
  provider: text('provider').notNull(),
  instructor: text('instructor').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  location: text('location').notNull(),
  totalSeats: integer('total_seats').notNull().default(20),
  budgetIQD: integer('budget_iqd').notNull().default(0),
  trainingPlanYear: integer('training_plan_year').notNull().default(2026),
  status: text('status').notNull().default('مفتوح للتسجيل'), // مفتوح للتسجيل | جاري الانعقاد | مكتمل | مؤجل | ملغى
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 10. Training Enrollments & Evaluations
export const trainingEnrollments = pgTable('training_enrollments', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .references(() => trainingCourses.id, { onDelete: 'cascade' })
    .notNull(),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  transactionId: integer('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  appliedDate: text('applied_date').notNull(),
  status: text('status').notNull().default('بانتظار موافقة القسم'),
  attendancePercent: integer('attendance_percent').notNull().default(0),
  evaluationScore: integer('evaluation_score'),
  evaluationNotes: text('evaluation_notes'),
  rejectionReason: text('rejection_reason'),
  certificateDocumentId: integer('certificate_document_id').references(() => documents.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 11. Leave Requests
export const leaveRequests = pgTable('leave_requests', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .references(() => employees.id, { onDelete: 'cascade' })
    .notNull(),
  transactionId: integer('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  leaveType: text('leave_type').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  days: integer('days').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('بانتظار موافقة القسم'),
  rejectionReason: text('rejection_reason'),
  approvedBy: text('approved_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 12. Notification Center
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  recipientUid: text('recipient_uid'),
  recipientRole: text('recipient_role'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('info'), // info | warning | critical | success
  entityType: text('entity_type').default(''),
  entityId: integer('entity_id'),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 13. Immutable Audit Logs
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorUid: text('actor_uid').notNull(),
  actorName: text('actor_name').notNull(),
  actorEmail: text('actor_email').notNull(),
  actorRole: text('actor_role').notNull(),
  operation: text('operation').notNull(),
  recordType: text('record_type').notNull(),
  recordId: text('record_id').notNull().default(''),
  previousValues: jsonb('previous_values'),
  newValues: jsonb('new_values'),
  details: text('details').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 14. Backup & Recovery Registry (Admin Only)
export const backupSnapshots = pgTable('backup_snapshots', {
  id: serial('id').primaryKey(),
  backupType: text('backup_type').notNull(), // DATABASE | DOCUMENTS | FULL
  status: text('status').notNull().default('مكتمل'),
  recordCount: integer('record_count').notNull().default(0),
  sizeBytes: integer('size_bytes').notNull().default(0),
  checksum: text('checksum').notNull(),
  notes: text('notes').default(''),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const employeesRelations = relations(employees, ({ many }) => ({
  careerEvents: many(careerEvents),
  appreciations: many(appreciations),
  penalties: many(penalties),
  documents: many(documents),
  transactions: many(transactions),
  trainingEnrollments: many(trainingEnrollments),
  leaveRequests: many(leaveRequests),
}));

export const trainingCoursesRelations = relations(trainingCourses, ({ many }) => ({
  enrollments: many(trainingEnrollments),
}));
