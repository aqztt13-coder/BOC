import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  Download,
  Info,
  Send,
  Settings,
  X,
} from 'lucide-react';
import type {
  ActiveView,
  AppreciationRecord,
  AppUser,
  EmployeeRecord,
  PenaltyRecordItem,
  PromotionCalculationResult,
  SystemConfigBundle,
} from '../types/hrms';
import { calculateEmployeeProgression } from '../utils/hrEngine';
import { exportPromotionsToExcel } from '../utils/exporters';
import { hasPermission } from '../utils/permissions';
import { hrmsApi } from '../lib/api';

interface PromotionsViewProps {
  user: AppUser;
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  appreciations: AppreciationRecord[];
  penalties: PenaltyRecordItem[];
  onRefresh: () => Promise<void>;
  onNavigate: (view: ActiveView) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const PromotionsView: React.FC<PromotionsViewProps> = ({
  user,
  config,
  employees,
  appreciations,
  penalties,
  onRefresh,
  onNavigate,
  onNotify,
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OVERDUE' | 'DUE_SOON' | 'DELAYED_BY_PENALTY' | 'RETIREMENT'>('ALL');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [inspectRow, setInspectRow] = useState<{ emp: EmployeeRecord; calc: PromotionCalculationResult } | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const rows = useMemo(() => {
    return employees
      .map((emp) => ({
        emp,
        calc: calculateEmployeeProgression(emp, appreciations, penalties, todayISO, config.hrRules),
      }))
      .filter(({ emp, calc }) => {
        if (deptFilter !== 'ALL' && emp.department !== deptFilter) return false;
        if (statusFilter === 'RETIREMENT') return calc.approachingRetirement;
        if (statusFilter !== 'ALL' && calc.progressionStatus !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => a.calc.daysToPromotion - b.calc.daysToPromotion);
  }, [employees, appreciations, penalties, todayISO, config.hrRules, deptFilter, statusFilter]);

  const handleInitiateReview = async (
    emp: EmployeeRecord,
    calc: PromotionCalculationResult,
    kind: 'PROMOTION_REVIEW' | 'INCREMENT_REVIEW'
  ) => {
    const key = `${kind}-${emp.id}`;
    setSubmittingId(key);
    try {
      const txn = await hrmsApi.initiatePromotionWorkflow({
        employeeId: emp.id,
        kind,
        explanation: calc.explanationSteps,
        effectiveDate: kind === 'PROMOTION_REVIEW' ? calc.effectivePromotionDate : calc.effectiveIncrementDate,
      });
      onNotify(`تم فتح معاملة مراجعة رسمية رقم ${txn.transactionNumber} وإرسالها لمسار الاعتماد.`, 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل فتح معاملة الاستحقاق.', 'error');
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Configurable Rules Banner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-[#C69214]" aria-hidden="true" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              محرك الترفيعات والعلاوات والقِدَم القابل للتخصيص
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            سقف قِدَم كتب الشكر: {config.hrRules.maxSeniorityMonthsPerCycle} أشهر · دورة العلاوة:{' '}
            {config.hrRules.incrementCycleMonths} شهراً · التنبيه المبكر: {config.hrRules.earlyAlertDays} يوماً · سن
            التقاعد: {config.hrRules.retirementAgeYears} عاماً. لا يتم تنفيذ أي ترفيع إلا عبر معاملة اعتماد رسمية.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {hasPermission(user.role, 'manage_settings') && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 text-[#C69214]" />
              <span>تعديل القواعد</span>
            </button>
          )}
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={() => exportPromotionsToExcel(employees, appreciations, penalties, todayISO, config.hrRules)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 hover:opacity-90 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>تصدير Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        {[
          { id: 'ALL', label: 'الكل' },
          { id: 'OVERDUE', label: 'مستحق ومتأخر' },
          { id: 'DUE_SOON', label: 'مستحق قريباً' },
          { id: 'DELAYED_BY_PENALTY', label: 'مؤخر بعقوبة' },
          { id: 'RETIREMENT', label: 'مقترب من التقاعد' },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id as typeof statusFilter)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === f.id
                ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}

        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="ms-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100"
        >
          <option value="ALL">جميع الأقسام</option>
          {config.orgCatalogs.departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 font-bold">المنتسب</th>
                <th className="px-4 py-3 font-bold">الدرجة / المرحلة</th>
                <th className="px-4 py-3 font-bold">القِدَم / التأخير</th>
                <th className="px-4 py-3 font-bold">استحقاق العلاوة</th>
                <th className="px-4 py-3 font-bold">استحقاق الترفيع</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
                <th className="px-4 py-3 font-bold">الإجراءات الرسمية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    لا توجد سجلات مطابقة لمعايير التصفية الحالية.
                  </td>
                </tr>
              ) : (
                rows.map(({ emp, calc }) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900 dark:text-white">{emp.fullName}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        <span dir="ltr" className="font-mono">{emp.employeeCode}</span> · {emp.department}
                      </p>
                    </td>
                    <td className="px-4 py-3 tabular-nums font-semibold">
                      د{emp.grade} / م{emp.step}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        +{calc.effectiveSeniorityMonths}
                      </span>{' '}
                      /{' '}
                      <span className="text-red-600 dark:text-red-400 font-semibold">
                        -{calc.totalPenaltyDelayMonths}
                      </span>{' '}
                      شهر
                    </td>
                    <td className="px-4 py-3">
                      <span dir="ltr" className="font-mono tabular-nums">
                        {calc.effectiveIncrementDate}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {calc.gradeYearsRequired > 0 ? (
                        <span dir="ltr" className="font-mono tabular-nums">
                          {calc.effectivePromotionDate}
                        </span>
                      ) : (
                        <span className="text-slate-400">الدرجة الأولى</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-bold ${
                          calc.progressionStatus === 'OVERDUE'
                            ? 'text-red-600 dark:text-red-400'
                            : calc.progressionStatus === 'DUE_SOON'
                              ? 'text-amber-700 dark:text-amber-400'
                              : calc.progressionStatus === 'DELAYED_BY_PENALTY'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {calc.progressionStatus === 'OVERDUE'
                          ? 'مستحق ومتأخر'
                          : calc.progressionStatus === 'DUE_SOON'
                            ? 'مستحق قريباً'
                            : calc.progressionStatus === 'DELAYED_BY_PENALTY'
                              ? 'مؤخر بعقوبة'
                              : 'منتظم'}
                      </span>
                      {calc.approachingRetirement && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> قرب التقاعد
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setInspectRow({ emp, calc })}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Info className="h-3 w-3" />
                          <span>تفصيل الاحتساب</span>
                        </button>
                        {hasPermission(user.role, 'manage_promotions') && (
                          <>
                            <button
                              type="button"
                              disabled={submittingId === `INCREMENT_REVIEW-${emp.id}`}
                              onClick={() => handleInitiateReview(emp, calc, 'INCREMENT_REVIEW')}
                              className="inline-flex items-center gap-1 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-2.5 py-1 text-[11px] font-bold text-teal-800 dark:text-teal-300 hover:opacity-90 cursor-pointer"
                            >
                              <Send className="h-3 w-3" />
                              <span>معاملة علاوة</span>
                            </button>
                            {emp.grade > 1 && (
                              <button
                                type="button"
                                disabled={submittingId === `PROMOTION_REVIEW-${emp.id}`}
                                onClick={() => handleInitiateReview(emp, calc, 'PROMOTION_REVIEW')}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-2.5 py-1 text-[11px] font-bold text-white dark:text-slate-950 hover:opacity-90 cursor-pointer"
                              >
                                <Send className="h-3 w-3" />
                                <span>معاملة ترفيع</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transparent Calculation Breakdown Modal */}
      {inspectRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  تفصيل احتساب الاستحقاق — {inspectRow.emp.fullName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  <span dir="ltr" className="font-mono">{inspectRow.emp.employeeCode}</span> · {inspectRow.emp.department}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectRow(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ol className="list-decimal ps-5 space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {inspectRow.calc.explanationSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setInspectRow(null)}
                className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-4 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
