import * as XLSX from 'xlsx';
import type {
  AppreciationRecord,
  DocumentRecord,
  EmployeeRecord,
  HRRulesConfig,
  LeaveRequestRecord,
  PenaltyRecordItem,
  TrainingCourseRecord,
  TrainingEnrollmentRecord,
  TransactionRecord,
} from '../types/hrms';
import { calculateEmployeeProgression, DEFAULT_HR_RULES } from './hrEngine';

function downloadWorksheet(rows: Record<string, unknown>[], sheetName: string, fileName: string) {
  const safeRows = rows.length > 0 ? rows : [{ ملاحظة: 'لا توجد سجلات مطابقة لمعايير التصفية الحالية' }];
  const ws = XLSX.utils.json_to_sheet(safeRows);
  ws['!views'] = [{ RTL: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

export function exportGenericReportToExcel(
  rows: Record<string, unknown>[],
  sheetName: string,
  filePrefix: string
) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadWorksheet(rows, sheetName, `BOC_${filePrefix}_${stamp}.xlsx`);
}

export function exportEmployeesToExcel(employees: EmployeeRecord[]) {
  const rows = employees.map((e) => ({
    'الرقم الوظيفي': e.employeeCode,
    'الاسم الكامل': e.fullName,
    'العنوان الوظيفي': e.jobTitle,
    'القسم / الهيئة': e.department,
    'الحقل / الموقع': e.oilfield,
    'الشعبة': e.section,
    'الدرجة': e.grade,
    'المرحلة': e.step,
    'التحصيل الدراسي': e.academicDegree,
    'التخصص': e.specialization,
    'تاريخ التعيين': e.hireDate,
    'تاريخ الميلاد': e.birthDate || '—',
    'الراتب الاسمي (د.ع)': e.basicSalaryIQD,
    'رصيد الاعتيادية': e.annualLeaveBalance,
    'رصيد المرضية': e.sickLeaveBalance,
    'الحالة': e.status,
  }));
  exportGenericReportToExcel(rows, 'سجل المنتسبين', 'Employees');
}

export function exportPromotionsToExcel(
  employees: EmployeeRecord[],
  appreciations: AppreciationRecord[],
  penalties: PenaltyRecordItem[],
  referenceDateISO: string,
  rules: HRRulesConfig = DEFAULT_HR_RULES
) {
  const rows = employees.map((e) => {
    const calc = calculateEmployeeProgression(e, appreciations, penalties, referenceDateISO, rules);
    return {
      'الرقم الوظيفي': e.employeeCode,
      'الاسم الكامل': e.fullName,
      'القسم / الهيئة': e.department,
      'الحقل': e.oilfield,
      'الدرجة / المرحلة': `${e.grade} / ${e.step}`,
      'قِدَم الشكر المحتسب (أشهر)': calc.effectiveSeniorityMonths,
      'تأخير العقوبات (أشهر)': calc.totalPenaltyDelayMonths,
      'صافي التعديل (أشهر)': calc.netAdjustmentMonths,
      'استحقاق العلاوة الفعلي': calc.effectiveIncrementDate,
      'استحقاق الترفيع الفعلي': calc.gradeYearsRequired > 0 ? calc.effectivePromotionDate : 'أعلى درجة',
      'تاريخ التقاعد المتوقع': calc.retirementDate || 'غير محدد',
      'الحالة':
        calc.progressionStatus === 'OVERDUE'
          ? 'مستحق ومتأخر'
          : calc.progressionStatus === 'DUE_SOON'
            ? 'مستحق قريباً'
            : calc.progressionStatus === 'DELAYED_BY_PENALTY'
              ? 'مؤخر بعقوبة'
              : 'منتظم',
    };
  });
  exportGenericReportToExcel(rows, 'الترفيعات والعلاوات', 'Promotions');
}

export function exportAppreciationsAndPenaltiesToExcel(
  employees: EmployeeRecord[],
  appreciations: AppreciationRecord[],
  penalties: PenaltyRecordItem[]
) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const rows = [
    ...appreciations.map((a) => ({
      'النوع': 'كتاب شكر وتقدير',
      'الرقم': a.letterNumber,
      'التاريخ': a.issueDate,
      'المنتسب': empMap.get(a.employeeId)?.fullName || String(a.employeeId),
      'القسم': empMap.get(a.employeeId)?.department || '—',
      'الجهة / التصنيف': a.issuingAuthority,
      'التأثير (أشهر)': `+${a.seniorityMonths}`,
      'الموضوع / السبب': a.subject,
    })),
    ...penalties.map((p) => ({
      'النوع': 'عقوبة إدارية',
      'الرقم': p.orderNumber,
      'التاريخ': p.issueDate,
      'المنتسب': empMap.get(p.employeeId)?.fullName || String(p.employeeId),
      'القسم': empMap.get(p.employeeId)?.department || '—',
      'الجهة / التصنيف': p.penaltyType,
      'التأثير (أشهر)': `-${p.delayMonths}`,
      'الموضوع / السبب': p.reason,
    })),
  ];
  exportGenericReportToExcel(rows, 'كتب الشكر والعقوبات', 'Appreciations_Penalties');
}

export function exportTrainingToExcel(
  courses: TrainingCourseRecord[],
  enrollments: TrainingEnrollmentRecord[],
  employees: EmployeeRecord[]
) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const rows = enrollments.map((enr) => {
    const c = courseMap.get(enr.courseId);
    const e = empMap.get(enr.employeeId);
    return {
      'رمز الدورة': c?.code || '—',
      'اسم الدورة': c?.title || '—',
      'التصنيف': c?.category || '—',
      'الجهة المنفذة': c?.provider || '—',
      'المنتسب': e?.fullName || String(enr.employeeId),
      'القسم': e?.department || '—',
      'تاريخ التقديم': enr.appliedDate,
      'الحالة': enr.status,
      'نسبة الحضور %': enr.attendancePercent,
      'التقييم': enr.evaluationScore ?? '—',
    };
  });
  exportGenericReportToExcel(rows, 'الدورات والمشاركات', 'Training');
}

export function exportLeavesToExcel(leaves: LeaveRequestRecord[], employees: EmployeeRecord[]) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const rows = leaves.map((lv) => {
    const e = empMap.get(lv.employeeId);
    return {
      'المنتسب': e?.fullName || String(lv.employeeId),
      'الرقم الوظيفي': e?.employeeCode || '—',
      'القسم': e?.department || '—',
      'نوع الإجازة': lv.leaveType,
      'من تاريخ': lv.startDate,
      'إلى تاريخ': lv.endDate,
      'عدد الأيام': lv.days,
      'الحالة': lv.status,
      'السبب': lv.reason,
    };
  });
  exportGenericReportToExcel(rows, 'سجل الإجازات', 'Leaves');
}

export function exportTransactionsToExcel(txns: TransactionRecord[], employees: EmployeeRecord[]) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const rows = txns.map((t) => ({
    'رقم المعاملة': t.transactionNumber,
    'النوع': t.transactionType,
    'العنوان': t.title,
    'المنتسب': empMap.get(t.employeeId)?.fullName || String(t.employeeId),
    'القسم': t.department,
    'الحقل': t.oilfield,
    'المرحلة الحالية': t.currentResponsibleRole,
    'الحالة': t.status,
    'تاريخ الإنشاء': t.createdAt.slice(0, 10),
  }));
  exportGenericReportToExcel(rows, 'المعاملات الإدارية', 'Transactions');
}

export function exportDocumentsToExcel(docs: DocumentRecord[], employees: EmployeeRecord[]) {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const rows = docs.map((d) => ({
    'رقم الوثيقة': d.documentNumber,
    'العنوان': d.title,
    'التصنيف': d.category,
    'المنتسب المرتبط': d.employeeId ? empMap.get(d.employeeId)?.fullName || String(d.employeeId) : 'عام / إداري',
    'تاريخ الإصدار': d.issueDate,
    'تاريخ الانتهاء': d.expiryDate || '—',
    'الجهة المصدرة': d.issuingAuthority,
    'رمز التحقق': d.verificationCode,
  }));
  exportGenericReportToExcel(rows, 'الأرشيف الرقمي', 'Documents');
}

export function formatIQD(amount: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(amount || 0)) + ' د.ع';
}
