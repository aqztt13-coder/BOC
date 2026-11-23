import React, { useMemo, useState } from 'react';
import { CalendarDays, Download, Plus, SlidersHorizontal, X } from 'lucide-react';
import type {
  AppUser,
  DocumentRecord,
  EmployeeRecord,
  LeaveRequestRecord,
  SystemConfigBundle,
} from '../types/hrms';
import { hrmsApi } from '../lib/api';
import { calculateDateRangeDays, todayBaghdadISO } from '../utils/hrEngine';
import { hasPermission } from '../utils/permissions';
import { exportLeavesToExcel } from '../utils/exporters';

interface LeavesAndRequestsViewProps {
  user: AppUser;
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  documents: DocumentRecord[];
  leaveRequests: LeaveRequestRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const LeavesAndRequestsView: React.FC<LeavesAndRequestsViewProps> = ({
  user,
  config,
  employees,
  documents,
  leaveRequests,
  onRefresh,
  onNotify,
}) => {
  const [tab, setTab] = useState<'requests' | 'balances'>('requests');
  const [showCreate, setShowCreate] = useState(false);
  const [adjustEmp, setAdjustEmp] = useState<EmployeeRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    employeeId: '',
    leaveType: config.orgCatalogs.leaveTypes[0]?.name || 'إجازة اعتيادية',
    startDate: todayBaghdadISO(),
    endDate: todayBaghdadISO(),
    reason: '',
    attachmentDocumentId: '',
  });

  const [adjForm, setAdjForm] = useState({
    balanceType: 'annual' as 'annual' | 'sick',
    deltaDays: 5,
    reason: '',
  });

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const computedDays = calculateDateRangeDays(form.startDate, form.endDate);
  const selectedLeaveCfg = useMemo(
    () => config.orgCatalogs.leaveTypes.find((lt) => lt.name === form.leaveType),
    [config.orgCatalogs.leaveTypes, form.leaveType]
  );
  const selectedEmpIdNum = Number(form.employeeId || user.employeeId || employees[0]?.id || 0);
  const eligibleDocs = useMemo(
    () => documents.filter((d) => d.employeeId === selectedEmpIdNum),
    [documents, selectedEmpIdNum]
  );

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    const empId = Number(form.employeeId || user.employeeId || employees[0]?.id);
    if (!empId) {
      onNotify('يرجى تسجيل أو تحديد منتسب أولاً.', 'error');
      return;
    }
    if (selectedLeaveCfg?.requiresAttachment && !form.attachmentDocumentId) {
      onNotify(`يتطلب تقديم «${form.leaveType}» اختيار وثيقة مرفقة مؤرشفة للمنتسب.`, 'error');
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.createLeave({
        employeeId: empId,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason,
        attachmentDocumentId: form.attachmentDocumentId ? Number(form.attachmentDocumentId) : null,
      });
      setShowCreate(false);
      setForm({
        employeeId: '',
        leaveType: config.orgCatalogs.leaveTypes[0]?.name || 'إجازة اعتيادية',
        startDate: todayBaghdadISO(),
        endDate: todayBaghdadISO(),
        reason: '',
        attachmentDocumentId: '',
      });
      onNotify('تم تقديم طلب الإجازة بنجاح وربطه بمسار الموافقات (مع التحقق من عدم التداخل).', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تسجيل طلب الإجازة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustEmp) return;
    setSubmitting(true);
    try {
      await hrmsApi.adjustLeaveBalance({
        employeeId: adjustEmp.id,
        balanceType: adjForm.balanceType,
        deltaDays: Number(adjForm.deltaDays),
        reason: adjForm.reason,
      });
      setAdjustEmp(null);
      setAdjForm({ balanceType: 'annual', deltaDays: 5, reason: '' });
      onNotify('تم تعديل رصيد الإجازة وتوثيقه في سجل التدقيق.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تعديل الرصيد.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('requests')}
            className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'requests'
                ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            طلبات وجدول الإجازات ({leaveRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('balances')}
            className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'balances'
                ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            أرصدة الإجازات والتسويات ({employees.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={() => exportLeavesToExcel(leaveRequests, employees)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>تصدير Excel</span>
            </button>
          )}
          {user.role !== 'READ_ONLY' && (
            <button
              type="button"
              onClick={() => {
                setForm({
                  employeeId: String(user.employeeId || employees[0]?.id || ''),
                  leaveType: config.orgCatalogs.leaveTypes[0]?.name || 'إجازة اعتيادية',
                  startDate: todayBaghdadISO(),
                  endDate: todayBaghdadISO(),
                  reason: '',
                  attachmentDocumentId: '',
                });
                setShowCreate(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>تقديم طلب إجازة</span>
            </button>
          )}
        </div>
      </div>

      {/* Configurable Leave Types Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {config.orgCatalogs.leaveTypes.map((lt) => (
          <div
            key={lt.name}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 text-xs"
          >
            <p className="font-bold text-slate-900 dark:text-white">{lt.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
              الاستحقاق السنوي: {lt.annualEntitlementDays} يوماً · الحد للطلب: {lt.maxDaysPerRequest} يوماً
            </p>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'requests' ? (
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-bold">المنتسب</th>
                  <th className="px-4 py-3 font-bold">نوع الإجازة</th>
                  <th className="px-4 py-3 font-bold">الفترة والمدة</th>
                  <th className="px-4 py-3 font-bold">السبب</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {leaveRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                      <CalendarDays className="h-8 w-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                      لا توجد طلبات إجازة مسجلة بعد.
                    </td>
                  </tr>
                ) : (
                  leaveRequests.map((lv) => {
                    const emp = empMap.get(lv.employeeId);
                    return (
                      <tr key={lv.id}>
                        <td className="px-4 py-3">
                          <p className="font-bold">{emp?.fullName || `#${lv.employeeId}`}</p>
                          <p className="text-[11px] text-slate-500">{emp?.department || '—'}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">{lv.leaveType}</td>
                        <td className="px-4 py-3 tabular-nums">
                          <span dir="ltr" className="font-mono block">
                            {lv.startDate} → {lv.endDate}
                          </span>
                          <span className="text-[11px] text-slate-500">{lv.days} أيام</span>
                        </td>
                        <td className="px-4 py-3 max-w-xs">{lv.reason}</td>
                        <td className="px-4 py-3 font-bold">{lv.status}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-bold">المنتسب</th>
                  <th className="px-4 py-3 font-bold">القسم</th>
                  <th className="px-4 py-3 font-bold">رصيد الاعتيادية</th>
                  <th className="px-4 py-3 font-bold">رصيد المرضية</th>
                  <th className="px-4 py-3 font-bold">تسوية الرصيد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      لا توجد سجلات منتسبين بعد.
                    </td>
                  </tr>
                ) : (
                  employees.map((emp) => (
                    <tr key={emp.id}>
                      <td className="px-4 py-3 font-bold">{emp.fullName}</td>
                      <td className="px-4 py-3 text-slate-500">{emp.department}</td>
                      <td className="px-4 py-3 font-bold tabular-nums">{emp.annualLeaveBalance} يوماً</td>
                      <td className="px-4 py-3 font-bold tabular-nums">{emp.sickLeaveBalance} يوماً</td>
                      <td className="px-4 py-3">
                        {hasPermission(user.role, 'approve_hr') && (
                          <button
                            type="button"
                            onClick={() => setAdjustEmp(emp)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <SlidersHorizontal className="h-3 w-3 text-[#C69214]" />
                            <span>تسوية مدققة</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Leave Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-extrabold">تقديم طلب إجازة جديد</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1 text-slate-400 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmitLeave} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">المنتسب *</label>
                <select
                  required
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                >
                  <option value="">اختر المنتسب...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName} (اعتيادية: {e.annualLeaveBalance} / مرضية: {e.sickLeaveBalance})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">نوع الإجازة *</label>
                <select
                  value={form.leaveType}
                  onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                >
                  {config.orgCatalogs.leaveTypes.map((lt) => (
                    <option key={lt.name} value={lt.name}>
                      {lt.name} (الحد الأقصى للطلب: {lt.maxDaysPerRequest} يوماً)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">من تاريخ *</label>
                  <input
                    type="date"
                    required
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">إلى تاريخ *</label>
                  <input
                    type="date"
                    required
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>
              <p className="text-[11px] font-bold text-[#0B1F3A] dark:text-[#E5B94C] tabular-nums">
                عدد الأيام المحتسبة: {computedDays} يوم
              </p>
              {selectedLeaveCfg?.requiresAttachment && (
                <div>
                  <label className="block font-semibold mb-1">الوثيقة الثبوتية المرفقة (مطلوبة لهذا النوع) *</label>
                  <select
                    required
                    value={form.attachmentDocumentId}
                    onChange={(e) => setForm({ ...form, attachmentDocumentId: e.target.value })}
                    className="w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-slate-800 px-3 py-2"
                  >
                    <option value="">اختر وثيقة مؤرشفة للمنتسب (تقرير طبي / كتاب رسمي)...</option>
                    {eligibleDocs.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title} ({doc.documentNumber})
                      </option>
                    ))}
                  </select>
                  {eligibleDocs.length === 0 && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      لا توجد وثائق مؤرشفة لهذا المنتسب حالياً. يرجى رفع التقرير الطبي في شاشة «الوثائق والأرشيف» أولاً.
                    </p>
                  )}
                </div>
              )}
              <div>
                <label className="block font-semibold mb-1">السبب *</label>
                <textarea
                  rows={2}
                  required
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting || computedDays <= 0}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  إرسال الطلب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Audited Balance Adjustment Modal */}
      {adjustEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-sm font-extrabold mb-3">تسوية رصيد الإجازة — {adjustEmp.fullName}</h3>
            <form onSubmit={handleAdjustBalance} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">نوع الرصيد</label>
                  <select
                    value={adjForm.balanceType}
                    onChange={(e) => setAdjForm({ ...adjForm, balanceType: e.target.value as 'annual' | 'sick' })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    <option value="annual">الاعتيادية</option>
                    <option value="sick">المرضية</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">مقدار التعديل (+ أو -)</label>
                  <input
                    type="number"
                    required
                    value={adjForm.deltaDays}
                    onChange={(e) => setAdjForm({ ...adjForm, deltaDays: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">مبرر التسوية الرسمي (يُسجل بالتدقيق) *</label>
                <textarea
                  rows={2}
                  required
                  value={adjForm.reason}
                  onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustEmp(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-4 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  اعتماد التسوية
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
