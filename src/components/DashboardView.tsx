import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpLeft,
  Award,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  GraduationCap,
  Plus,
  Users,
  Workflow,
} from 'lucide-react';
import type {
  ActiveView,
  AppreciationRecord,
  AppUser,
  DocumentRecord,
  EmployeeRecord,
  LeaveRequestRecord,
  PenaltyRecordItem,
  SystemConfigBundle,
  TrainingCourseRecord,
  TrainingEnrollmentRecord,
  TransactionRecord,
} from '../types/hrms';
import { calculateEmployeeProgression } from '../utils/hrEngine';
import { exportGenericReportToExcel } from '../utils/exporters';
import { hasPermission } from '../utils/permissions';

interface DashboardViewProps {
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
  onNavigate: (view: ActiveView) => void;
  onSelectEmployee: (empId: number) => void;
  onQuickCreateEmployee: () => void;
}

const CHART_COLORS = ['#0B1F3A', '#1E4E79', '#C69214', '#0F766E', '#475569', '#B45309'];

export const DashboardView: React.FC<DashboardViewProps> = ({
  user,
  config,
  employees,
  appreciations,
  penalties,
  documents,
  transactions,
  courses,
  enrollments,
  leaveRequests,
  onNavigate,
  onSelectEmployee,
  onQuickCreateEmployee,
}) => {
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [fieldFilter, setFieldFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (deptFilter !== 'ALL' && e.department !== deptFilter) return false;
      if (fieldFilter !== 'ALL' && e.oilfield !== fieldFilter) return false;
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
      return true;
    });
  }, [employees, deptFilter, fieldFilter, statusFilter]);

  const filteredEmpIds = useMemo(() => new Set(filteredEmployees.map((e) => e.id)), [filteredEmployees]);

  const metrics = useMemo(() => {
    const activeCount = filteredEmployees.filter((e) => e.status === 'نشط').length;
    const inactiveCount = filteredEmployees.length - activeCount;

    let promotionsDue = 0;
    let incrementsDue = 0;
    let approachingRetirement = 0;

    const urgentAlerts: Array<{
      id: string;
      empId: number;
      empName: string;
      department: string;
      label: string;
      date: string;
      severity: 'critical' | 'warning';
    }> = [];

    for (const emp of filteredEmployees) {
      const calc = calculateEmployeeProgression(emp, appreciations, penalties, todayISO, config.hrRules);
      if (calc.isPromotionDueSoon || calc.isPromotionOverdue) {
        promotionsDue += 1;
        urgentAlerts.push({
          id: `promo-${emp.id}`,
          empId: emp.id,
          empName: emp.fullName,
          department: emp.department,
          label: calc.isPromotionOverdue ? 'ترفيع مستحق (متأخر)' : 'ترفيع مستحق قريباً',
          date: calc.effectivePromotionDate,
          severity: calc.isPromotionOverdue ? 'critical' : 'warning',
        });
      }
      if (calc.isIncrementDueSoon || calc.isIncrementOverdue) {
        incrementsDue += 1;
        urgentAlerts.push({
          id: `inc-${emp.id}`,
          empId: emp.id,
          empName: emp.fullName,
          department: emp.department,
          label: calc.isIncrementOverdue ? 'علاوة سنوية مستحقة' : 'علاوة قريبة الاستحقاق',
          date: calc.effectiveIncrementDate,
          severity: calc.isIncrementOverdue ? 'critical' : 'warning',
        });
      }
      if (calc.approachingRetirement && calc.retirementDate) {
        approachingRetirement += 1;
        urgentAlerts.push({
          id: `ret-${emp.id}`,
          empId: emp.id,
          empName: emp.fullName,
          department: emp.department,
          label: 'اقتراب السن القانوني للتقاعد',
          date: calc.retirementDate,
          severity: 'warning',
        });
      }
    }

    const scopedTxns = transactions.filter((t) => deptFilter === 'ALL' || t.department === deptFilter);
    const pendingTxns = scopedTxns.filter(
      (t) =>
        t.status === 'بانتظار موافقة القسم' ||
        t.status === 'بانتظار موافقة الموارد البشرية' ||
        t.status === 'معاد للتعديل'
    );

    const activeCourses = courses.filter((c) => c.status === 'مفتوح للتسجيل' || c.status === 'جاري الانعقاد');
    const scopedEnrollments = enrollments.filter((e) => filteredEmpIds.has(e.employeeId));
    const completedEnrollments = scopedEnrollments.filter((e) => e.status === 'مكتمل').length;

    const scopedLeaves = leaveRequests.filter((lv) => filteredEmpIds.has(lv.employeeId));
    const approvedLeaves = scopedLeaves.filter((lv) => lv.status === 'معتمد').length;
    const pendingLeaves = scopedLeaves.filter(
      (lv) => lv.status === 'بانتظار موافقة القسم' || lv.status === 'بانتظار موافقة الموارد البشرية'
    ).length;

    const expiringDocs = documents.filter((d) => {
      if (!d.expiryDate) return false;
      const diff = (Date.parse(d.expiryDate) - Date.parse(todayISO)) / 86_400_000;
      return diff <= 60;
    });

    return {
      total: filteredEmployees.length,
      activeCount,
      inactiveCount,
      promotionsDue,
      incrementsDue,
      approachingRetirement,
      pendingTxnsCount: pendingTxns.length,
      activeCoursesCount: activeCourses.length,
      trainingTotal: scopedEnrollments.length,
      trainingCompleted: completedEnrollments,
      approvedLeaves,
      pendingLeaves,
      expiringDocsCount: expiringDocs.length,
      urgentAlerts: urgentAlerts.slice(0, 8),
    };
  }, [
    filteredEmployees,
    filteredEmpIds,
    appreciations,
    penalties,
    transactions,
    courses,
    enrollments,
    leaveRequests,
    documents,
    deptFilter,
    todayISO,
    config.hrRules,
  ]);

  const byDepartment = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of filteredEmployees) {
      counts.set(e.department, (counts.get(e.department) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredEmployees]);

  const byOilfield = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of filteredEmployees) {
      counts.set(e.oilfield, (counts.get(e.oilfield) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredEmployees]);

  const byGrade = useMemo(() => {
    const counts = new Map<number, number>();
    for (const e of filteredEmployees) {
      counts.set(e.grade, (counts.get(e.grade) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([grade, count]) => ({ name: `درجة ${grade}`, count }));
  }, [filteredEmployees]);

  const byQualification = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of filteredEmployees) {
      counts.set(e.academicDegree, (counts.get(e.academicDegree) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredEmployees]);

  const recentEmployees = useMemo(() => filteredEmployees.slice(0, 6), [filteredEmployees]);

  const handleExportSummary = () => {
    exportGenericReportToExcel(
      [
        { المؤشر: 'إجمالي المنتسبين', القيمة: metrics.total },
        { المؤشر: 'المنتسبون النشطون', القيمة: metrics.activeCount },
        { المؤشر: 'غير النشطين / مجازون / منقولون', القيمة: metrics.inactiveCount },
        { المؤشر: 'ترفيعات مستحقة أو قريبة', القيمة: metrics.promotionsDue },
        { المؤشر: 'علاوات سنوية مستحقة أو قريبة', القيمة: metrics.incrementsDue },
        { المؤشر: 'مقتربون من التقاعد', القيمة: metrics.approachingRetirement },
        { المؤشر: 'المعاملات قيد الانتظار', القيمة: metrics.pendingTxnsCount },
        { المؤشر: 'الدورات التدريبية النشطة', القيمة: metrics.activeCoursesCount },
        { المؤشر: 'المشاركات التدريبية المكتملة', القيمة: metrics.trainingCompleted },
        { المؤشر: 'الإجازات المعتمدة', القيمة: metrics.approvedLeaves },
        { المؤشر: 'وثائق قريبة الانتهاء (60 يوماً)', القيمة: metrics.expiringDocsCount },
      ],
      'ملخص مؤشرات الموارد البشرية',
      'Dashboard_Summary'
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Filter Bar & Quick Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="تصفية حسب القسم"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="ALL">جميع الأقسام والهيئات</option>
            {config.orgCatalogs.departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
            aria-label="تصفية حسب الحقل النفطي"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="ALL">جميع الحقول والمواقع</option>
            {config.orgCatalogs.oilfields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="تصفية حسب الحالة"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="ALL">جميع الحالات الوظيفية</option>
            <option value="نشط">نشط</option>
            <option value="إجازة طويلة">إجازة طويلة</option>
            <option value="منقول">منقول</option>
            <option value="متقاعد">متقاعد</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPermission(user.role, 'create_employee') && (
            <button
              type="button"
              onClick={onQuickCreateEmployee}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 hover:opacity-90 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>تسجيل منتسب جديد</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('transactions')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            <Workflow className="h-3.5 w-3.5 text-[#C69214]" aria-hidden="true" />
            <span>المعاملات</span>
          </button>
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={handleExportSummary}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>تصدير الملخص</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty Database Onboarding Banner (Zero Mock Data) */}
      {employees.length === 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              قاعدة البيانات المركزية جاهزة للعمل الفعلي — بدون أي بيانات تجريبية
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
              تم ربط النظام بقاعدة بيانات PostgreSQL حقيقية فارغة تماماً بناءً على طلبك. ابدأ بتسجيل أول منتسب أو
              إضافة دورة تدريبية أو تهيئة الهيكل التنظيمي من لوحة الإدارة وستتحدث جميع المؤشرات والرسوم البيانية
              فوراً وبشكل حقيقي.
            </p>
          </div>
          {hasPermission(user.role, 'create_employee') && (
            <button
              type="button"
              onClick={onQuickCreateEmployee}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-4 py-2.5 text-xs font-bold text-white dark:text-slate-950 hover:opacity-90 shrink-0 cursor-pointer"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>إضافة أول منتسب الآن</span>
            </button>
          )}
        </div>
      )}

      {/* Primary KPI Grid (High-Density Enterprise Strip) */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3.5">
        <button
          type="button"
          onClick={() => onNavigate('employees')}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-[#C69214] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">إجمالي المنتسبين</span>
            <Users className="h-4 w-4 text-[#0B1F3A] dark:text-[#E5B94C]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">{metrics.total}</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            نشط: {metrics.activeCount} · غير نشط: {metrics.inactiveCount}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('promotions')}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-[#C69214] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">استحقاقات الترفيع</span>
            <Award className="h-4 w-4 text-[#C69214]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {metrics.promotionsDue}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            العلاوات المستحقة: {metrics.incrementsDue}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('transactions')}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-[#C69214] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">معاملات قيد الإجراء</span>
            <Workflow className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {metrics.pendingTxnsCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            الإجمالي المسجل: {transactions.length}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('training')}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-[#C69214] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">الدورات النشطة</span>
            <GraduationCap className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {metrics.activeCoursesCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            مكتمل: {metrics.trainingCompleted} / {metrics.trainingTotal}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('leaves')}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-[#C69214] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">الإجازات</span>
            <CalendarClock className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {metrics.pendingLeaves}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            معتمدة: {metrics.approvedLeaves}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('promotions')}
          className="text-right rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-[#C69214] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">قرب التقاعد والوثائق</span>
            <Briefcase className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {metrics.approachingRetirement}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            وثائق تنتهي قريباً: {metrics.expiringDocsCount}
          </p>
        </button>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Employees by Department */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">توزيع القوى العاملة حسب القسم / الهيئة</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">بيانات حية من قاعدة البيانات</p>
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
              {byDepartment.length} أقسام
            </span>
          </div>
          {byDepartment.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              لا توجد سجلات منتسبين لعرض التوزيع البياني بعد.
            </div>
          ) : (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDepartment} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-18} textAnchor="end" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="عدد المنتسبين" radius={[5, 5, 0, 0]}>
                    {byDepartment.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Employees by Oilfield */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">توزيع المنتسبين حسب الحقل النفطي والموقع</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">الرميلة · الزبير · مجنون · غرب القرنة · المقر العام</p>
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
              {byOilfield.length} مواقع
            </span>
          </div>
          {byOilfield.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              لا توجد بيانات حقول مسجلة بعد.
            </div>
          ) : (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byOilfield} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="عدد المنتسبين" fill="#C69214" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Secondary Breakdown: Grade + Academic Qualification */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">توزيع الدرجات الوظيفية</h3>
          {byGrade.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">لا توجد بيانات درجات وظيفية بعد.</p>
          ) : (
            <div className="h-52 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byGrade}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="العدد" fill="#0B1F3A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">توزيع المؤهلات الأكاديمية</h3>
          {byQualification.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">لا توجد مؤهلات مسجلة بعد.</p>
          ) : (
            <div className="space-y-3">
              {byQualification.map((item) => {
                const pct = metrics.total > 0 ? Math.round((item.count / metrics.total) * 100) : 0;
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{item.name}</span>
                      <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                        {item.count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-[#0B1F3A] dark:bg-[#C69214]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Split: Urgent HR Alerts & Recently Updated Employees */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Urgent HR Alerts */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                تنبيهات الاستحقاقات والتقاعد القادمة
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('promotions')}
              className="text-xs font-semibold text-[#0B1F3A] dark:text-[#E5B94C] hover:underline cursor-pointer"
            >
              عرض الكل
            </button>
          </div>
          {metrics.urgentAlerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 text-xs text-slate-600 dark:text-slate-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>لا توجد استحقاقات متأخرة أو تنبيهات عاجلة حالياً ضمن النطاق المحدد.</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {metrics.urgentAlerts.map((al) => (
                <div key={al.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelectEmployee(al.empId)}
                      className="text-xs font-bold text-slate-900 dark:text-white hover:text-[#C69214] truncate block cursor-pointer"
                    >
                      {al.empName}
                    </button>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {al.department} ·{' '}
                      <span
                        className={
                          al.severity === 'critical'
                            ? 'text-red-600 dark:text-red-400 font-semibold'
                            : 'text-amber-700 dark:text-amber-400 font-semibold'
                        }
                      >
                        {al.label}
                      </span>
                    </p>
                  </div>
                  <span dir="ltr" className="font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                    {al.date}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recently Added / Updated Employees */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#0B1F3A] dark:text-[#E5B94C]" aria-hidden="true" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">أحدث السجلات الوظيفية المضافة أو المحدّثة</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('employees')}
              className="text-xs font-semibold text-[#0B1F3A] dark:text-[#E5B94C] hover:underline cursor-pointer"
            >
              الدليل الكامل
            </button>
          </div>
          {recentEmployees.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">لم تتم إضافة أي منتسبين بعد.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentEmployees.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => onSelectEmployee(emp.id)}
                  className="w-full py-3 flex items-center justify-between gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 px-2 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{emp.fullName}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {emp.jobTitle} · {emp.department} · {emp.oilfield}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span dir="ltr" className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {emp.employeeCode}
                    </span>
                    <ArrowUpLeft className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
