import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import type {
  AppreciationRecord,
  EmployeeRecord,
  LeaveRequestRecord,
  PenaltyRecordItem,
  SystemConfigBundle,
  TrainingCourseRecord,
  TrainingEnrollmentRecord,
  TransactionRecord,
} from '../types/hrms';
import { calculateEmployeeProgression } from '../utils/hrEngine';
import { exportGenericReportToExcel, formatIQD } from '../utils/exporters';

interface ReportsViewProps {
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  appreciations: AppreciationRecord[];
  penalties: PenaltyRecordItem[];
  courses: TrainingCourseRecord[];
  enrollments: TrainingEnrollmentRecord[];
  leaveRequests: LeaveRequestRecord[];
  transactions: TransactionRecord[];
}

type ReportKind =
  | 'employees'
  | 'promotions'
  | 'retirement'
  | 'appreciations'
  | 'penalties'
  | 'training'
  | 'leaves'
  | 'transactions';

const REPORT_TEMPLATES: Array<{ id: ReportKind; label: string }> = [
  { id: 'employees', label: 'تقرير المنتسبين (حسب القسم/الحقل/الدرجة)' },
  { id: 'promotions', label: 'تقرير استحقاقات الترفيعات والعلاوات' },
  { id: 'retirement', label: 'تقرير المقتربين من سن التقاعد' },
  { id: 'appreciations', label: 'تقرير كتب الشكر والتقدير والقِدَم' },
  { id: 'penalties', label: 'تقرير العقوبات الإدارية وأثر التأخير' },
  { id: 'training', label: 'تقرير المشاركة التدريبية والحضور' },
  { id: 'leaves', label: 'تقرير الإجازات والأرصدة' },
  { id: 'transactions', label: 'تقرير المعاملات الإدارية وحالاتها' },
];

export const ReportsView: React.FC<ReportsViewProps> = ({
  config,
  employees,
  appreciations,
  penalties,
  courses,
  enrollments,
  leaveRequests,
  transactions,
}) => {
  const [reportKind, setReportKind] = useState<ReportKind>('employees');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [fieldFilter, setFieldFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const scopedEmployees = useMemo(
    () =>
      employees.filter((e) => {
        if (deptFilter !== 'ALL' && e.department !== deptFilter) return false;
        if (fieldFilter !== 'ALL' && e.oilfield !== fieldFilter) return false;
        return true;
      }),
    [employees, deptFilter, fieldFilter]
  );

  const scopedEmpIds = useMemo(() => new Set(scopedEmployees.map((e) => e.id)), [scopedEmployees]);

  const rows = useMemo<Record<string, unknown>[]>(() => {
    if (reportKind === 'employees') {
      return scopedEmployees.map((e) => ({
        'الرقم الوظيفي': e.employeeCode,
        'الاسم الكامل': e.fullName,
        'العنوان الوظيفي': e.jobTitle,
        'القسم': e.department,
        'الحقل': e.oilfield,
        'الدرجة/المرحلة': `${e.grade}/${e.step}`,
        'المؤهل': e.academicDegree,
        'الراتب الاسمي': formatIQD(e.basicSalaryIQD),
        'الحالة': e.status,
      }));
    }
    if (reportKind === 'promotions') {
      return scopedEmployees.map((e) => {
        const c = calculateEmployeeProgression(e, appreciations, penalties, todayISO, config.hrRules);
        return {
          'الرقم الوظيفي': e.employeeCode,
          'الاسم': e.fullName,
          'القسم': e.department,
          'الدرجة/المرحلة': `${e.grade}/${e.step}`,
          'قِدَم الشكر': `+${c.effectiveSeniorityMonths} شهر`,
          'تأخير العقوبة': `-${c.totalPenaltyDelayMonths} شهر`,
          'استحقاق العلاوة': c.effectiveIncrementDate,
          'استحقاق الترفيع': c.gradeYearsRequired > 0 ? c.effectivePromotionDate : 'الدرجة الأولى',
          'الحالة': c.progressionStatus,
        };
      });
    }
    if (reportKind === 'retirement') {
      return scopedEmployees
        .map((e) => ({
          emp: e,
          calc: calculateEmployeeProgression(e, appreciations, penalties, todayISO, config.hrRules),
        }))
        .filter((x) => x.calc.approachingRetirement)
        .map(({ emp, calc }) => ({
          'الرقم الوظيفي': emp.employeeCode,
          'الاسم': emp.fullName,
          'القسم': emp.department,
          'تاريخ الميلاد': emp.birthDate || '—',
          'تاريخ التقاعد المتوقع': calc.retirementDate || '—',
          'الدرجة': emp.grade,
        }));
    }
    if (reportKind === 'appreciations') {
      return appreciations
        .filter((a) => scopedEmpIds.has(a.employeeId))
        .map((a) => ({
          'العدد': a.letterNumber,
          'التاريخ': a.issueDate,
          'المنتسب': empMap.get(a.employeeId)?.fullName || String(a.employeeId),
          'الجهة المانحة': a.issuingAuthority,
          'القِدَم': `+${a.seniorityMonths} شهر`,
          'الموضوع': a.subject,
        }));
    }
    if (reportKind === 'penalties') {
      return penalties
        .filter((p) => scopedEmpIds.has(p.employeeId))
        .map((p) => ({
          'رقم الأمر': p.orderNumber,
          'التاريخ': p.issueDate,
          'المنتسب': empMap.get(p.employeeId)?.fullName || String(p.employeeId),
          'العقوبة': p.penaltyType,
          'التأخير': `-${p.delayMonths} شهر`,
          'السبب': p.reason,
        }));
    }
    if (reportKind === 'training') {
      return enrollments
        .filter((enr) => scopedEmpIds.has(enr.employeeId))
        .map((enr) => ({
          'المنتسب': empMap.get(enr.employeeId)?.fullName || String(enr.employeeId),
          'الدورة': courseMap.get(enr.courseId)?.title || String(enr.courseId),
          'تاريخ التقديم': enr.appliedDate,
          'الحالة': enr.status,
          'الحضور %': `${enr.attendancePercent}%`,
          'التقييم': enr.evaluationScore ?? '—',
        }));
    }
    if (reportKind === 'leaves') {
      return leaveRequests
        .filter((l) => scopedEmpIds.has(l.employeeId))
        .map((l) => ({
          'المنتسب': empMap.get(l.employeeId)?.fullName || String(l.employeeId),
          'النوع': l.leaveType,
          'من': l.startDate,
          'إلى': l.endDate,
          'الأيام': l.days,
          'الحالة': l.status,
        }));
    }
    return transactions
      .filter((t) => (deptFilter === 'ALL' || t.department === deptFilter) && (fieldFilter === 'ALL' || t.oilfield === fieldFilter))
      .map((t) => ({
        'رقم المعاملة': t.transactionNumber,
        'العنوان': t.title,
        'المنتسب': empMap.get(t.employeeId)?.fullName || String(t.employeeId),
        'القسم': t.department,
        'الحالة': t.status,
        'التاريخ': t.createdAt.slice(0, 10),
      }));
  }, [
    reportKind,
    scopedEmployees,
    scopedEmpIds,
    appreciations,
    penalties,
    enrollments,
    leaveRequests,
    transactions,
    empMap,
    courseMap,
    todayISO,
    config.hrRules,
    deptFilter,
    fieldFilter,
  ]);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const activeTemplateLabel = REPORT_TEMPLATES.find((t) => t.id === reportKind)?.label || 'تقرير';

  return (
    <div className="space-y-5">
      {/* Report Configuration Controls */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={reportKind}
              onChange={(e) => {
                setReportKind(e.target.value as ReportKind);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
            >
              {REPORT_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.label}
                </option>
              ))}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => {
                setDeptFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold"
            >
              <option value="ALL">جميع الأقسام</option>
              {config.orgCatalogs.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={fieldFilter}
              onChange={(e) => {
                setFieldFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold"
            >
              <option value="ALL">جميع الحقول</option>
              {config.orgCatalogs.oilfields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 shrink-0 print:hidden">
            <button
              type="button"
              onClick={() => exportGenericReportToExcel(rows, activeTemplateLabel, reportKind)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>تصدير Excel</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>طباعة / PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Report Preview Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-[#C69214]" />
            <h3 className="text-xs font-bold">{activeTemplateLabel}</h3>
          </div>
          <span className="text-xs text-slate-500 tabular-nums">{rows.length} سجل</span>
        </div>

        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              لا توجد بيانات حقيقية مطابقة لمعايير هذا التقرير حالياً.
            </div>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="px-4 py-3 font-bold whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pageRows.map((row, idx) => (
                  <tr key={idx}>
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-3 whitespace-nowrap tabular-nums">
                        {String(row[col] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {rows.length > pageSize && (
          <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between text-xs print:hidden">
            <span className="text-slate-500 tabular-nums">
              صفحة {safePage} من {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 disabled:opacity-40 cursor-pointer"
              >
                السابق
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 disabled:opacity-40 cursor-pointer"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
