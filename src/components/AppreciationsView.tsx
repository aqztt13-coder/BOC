import React, { useMemo, useState } from 'react';
import { Award, Download, FileCheck2, Plus, ShieldAlert, X } from 'lucide-react';
import type {
  AppreciationRecord,
  AppUser,
  EmployeeRecord,
  PenaltyRecordItem,
  SystemConfigBundle,
} from '../types/hrms';
import { hrmsApi } from '../lib/api';
import { hasPermission } from '../utils/permissions';
import { exportAppreciationsAndPenaltiesToExcel } from '../utils/exporters';
import type { OfficialPreviewTarget } from './OfficialDocumentModal';

interface AppreciationsViewProps {
  user: AppUser;
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  appreciations: AppreciationRecord[];
  penalties: PenaltyRecordItem[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPreviewOfficial: (target: OfficialPreviewTarget) => void;
}

export const AppreciationsView: React.FC<AppreciationsViewProps> = ({
  user,
  config,
  employees,
  appreciations,
  penalties,
  onRefresh,
  onNotify,
  onPreviewOfficial,
}) => {
  const [tab, setTab] = useState<'appreciations' | 'penalties'>('appreciations');
  const [showAppModal, setShowAppModal] = useState(false);
  const [showPenModal, setShowPenModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [appForm, setAppForm] = useState({
    employeeId: '',
    letterNumber: '',
    issueDate: new Date().toISOString().slice(0, 10),
    issuingAuthority: 'السيد مدير عام شركة نفط البصرة',
    subject: '',
    seniorityMonths: 1,
  });

  const penaltyTypes = useMemo(() => Object.keys(config.hrRules.penaltyDelays), [config.hrRules.penaltyDelays]);

  const [penForm, setPenForm] = useState({
    employeeId: '',
    orderNumber: '',
    issueDate: new Date().toISOString().slice(0, 10),
    penaltyType: penaltyTypes[0] || 'لفت نظر',
    delayMonths: config.hrRules.penaltyDelays[penaltyTypes[0] || 'لفت نظر'] ?? 3,
    reason: '',
  });

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const handleSaveAppreciation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await hrmsApi.createAppreciation({
        ...appForm,
        employeeId: Number(appForm.employeeId),
        seniorityMonths: Number(appForm.seniorityMonths),
      });
      setShowAppModal(false);
      setAppForm({
        employeeId: '',
        letterNumber: '',
        issueDate: new Date().toISOString().slice(0, 10),
        issuingAuthority: 'السيد مدير عام شركة نفط البصرة',
        subject: '',
        seniorityMonths: 1,
      });
      onNotify('تم تسجيل كتاب الشكر وتحديث احتساب القِدَم وأرشفته تلقائياً.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تسجيل كتاب الشكر.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePenalty = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await hrmsApi.createPenalty({
        ...penForm,
        employeeId: Number(penForm.employeeId),
        delayMonths: Number(penForm.delayMonths),
      });
      setShowPenModal(false);
      onNotify('تم تسجيل العقوبة الإدارية واحتساب أثر التأخير تلقائياً.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تسجيل العقوبة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('appreciations')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold cursor-pointer ${
              tab === 'appreciations'
                ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Award className="h-3.5 w-3.5" />
            <span>كتب الشكر والتقدير ({appreciations.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('penalties')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold cursor-pointer ${
              tab === 'penalties'
                ? 'bg-red-700 text-white'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>العقوبات الإدارية ({penalties.length})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={() => exportAppreciationsAndPenaltiesToExcel(employees, appreciations, penalties)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>تصدير Excel</span>
            </button>
          )}
          {hasPermission(user.role, 'manage_appreciations') && (
            <button
              type="button"
              onClick={() => setShowAppModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>تسجيل كتاب شكر</span>
            </button>
          )}
          {hasPermission(user.role, 'manage_penalties') && (
            <button
              type="button"
              onClick={() => setShowPenModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2 text-xs font-bold text-red-700 dark:text-red-300 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>تسجيل عقوبة</span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'appreciations' ? (
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-bold">المنتسب</th>
                  <th className="px-4 py-3 font-bold">العدد والتاريخ</th>
                  <th className="px-4 py-3 font-bold">الجهة المانحة</th>
                  <th className="px-4 py-3 font-bold">الموضوع</th>
                  <th className="px-4 py-3 font-bold">القِدَم</th>
                  <th className="px-4 py-3 font-bold">الوثيقة الرسمية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {appreciations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      لا توجد كتب شكر وتقدير مسجلة حتى الآن.
                    </td>
                  </tr>
                ) : (
                  appreciations.map((a) => {
                    const emp = empMap.get(a.employeeId);
                    return (
                      <tr key={a.id}>
                        <td className="px-4 py-3 font-bold">{emp?.fullName || `#${a.employeeId}`}</td>
                        <td className="px-4 py-3">
                          <span dir="ltr" className="font-mono block">{a.letterNumber}</span>
                          <span dir="ltr" className="font-mono text-[11px] text-slate-400">{a.issueDate}</span>
                        </td>
                        <td className="px-4 py-3">{a.issuingAuthority}</td>
                        <td className="px-4 py-3 max-w-xs">{a.subject}</td>
                        <td className="px-4 py-3 font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          +{a.seniorityMonths} شهر
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => onPreviewOfficial({ kind: 'appreciation', record: a, employee: emp })}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <FileCheck2 className="h-3.5 w-3.5 text-[#C69214]" />
                            <span>PDF + QR</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-bold">المنتسب</th>
                  <th className="px-4 py-3 font-bold">رقم الأمر والتاريخ</th>
                  <th className="px-4 py-3 font-bold">نوع العقوبة</th>
                  <th className="px-4 py-3 font-bold">مدة التأخير</th>
                  <th className="px-4 py-3 font-bold">السبب</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {penalties.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      لا توجد عقوبات إدارية مسجلة حتى الآن.
                    </td>
                  </tr>
                ) : (
                  penalties.map((p) => {
                    const emp = empMap.get(p.employeeId);
                    return (
                      <tr key={p.id}>
                        <td className="px-4 py-3 font-bold">{emp?.fullName || `#${p.employeeId}`}</td>
                        <td className="px-4 py-3">
                          <span dir="ltr" className="font-mono block">{p.orderNumber}</span>
                          <span dir="ltr" className="font-mono text-[11px] text-slate-400">{p.issueDate}</span>
                        </td>
                        <td className="px-4 py-3 font-bold text-red-700 dark:text-red-400">{p.penaltyType}</td>
                        <td className="px-4 py-3 font-bold text-red-600 dark:text-red-400 tabular-nums">
                          -{p.delayMonths} شهر
                        </td>
                        <td className="px-4 py-3">{p.reason}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Appreciation Modal */}
      {showAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-extrabold">تسجيل كتاب شكر وتقدير جديد</h3>
              <button type="button" onClick={() => setShowAppModal(false)} className="p-1 text-slate-400 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveAppreciation} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">المنتسب *</label>
                <select
                  required
                  value={appForm.employeeId}
                  onChange={(e) => setAppForm({ ...appForm, employeeId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                >
                  <option value="">اختر المنتسب...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName} ({e.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">العدد *</label>
                  <input
                    required
                    dir="ltr"
                    value={appForm.letterNumber}
                    onChange={(e) => setAppForm({ ...appForm, letterNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">التاريخ *</label>
                  <input
                    type="date"
                    required
                    value={appForm.issueDate}
                    onChange={(e) => setAppForm({ ...appForm, issueDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-semibold mb-1">الجهة المانحة *</label>
                  <input
                    required
                    value={appForm.issuingAuthority}
                    onChange={(e) => setAppForm({ ...appForm, issuingAuthority: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">أشهر القِدَم *</label>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    required
                    value={appForm.seniorityMonths}
                    onChange={(e) => setAppForm({ ...appForm, seniorityMonths: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">الموضوع *</label>
                <textarea
                  rows={2}
                  required
                  value={appForm.subject}
                  onChange={(e) => setAppForm({ ...appForm, subject: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAppModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  حفظ الكتاب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Penalty Modal */}
      {showPenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-extrabold text-red-700 dark:text-red-400">تسجيل عقوبة إدارية</h3>
              <button type="button" onClick={() => setShowPenModal(false)} className="p-1 text-slate-400 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSavePenalty} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">المنتسب *</label>
                <select
                  required
                  value={penForm.employeeId}
                  onChange={(e) => setPenForm({ ...penForm, employeeId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                >
                  <option value="">اختر المنتسب...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName} ({e.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">رقم الأمر الإداري *</label>
                  <input
                    required
                    dir="ltr"
                    value={penForm.orderNumber}
                    onChange={(e) => setPenForm({ ...penForm, orderNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">التاريخ *</label>
                  <input
                    type="date"
                    required
                    value={penForm.issueDate}
                    onChange={(e) => setPenForm({ ...penForm, issueDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">نوع العقوبة *</label>
                  <select
                    value={penForm.penaltyType}
                    onChange={(e) => {
                      const pt = e.target.value;
                      setPenForm({
                        ...penForm,
                        penaltyType: pt,
                        delayMonths: config.hrRules.penaltyDelays[pt] ?? 3,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    {penaltyTypes.map((pt) => (
                      <option key={pt} value={pt}>
                        {pt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">تأخير الاستحقاق (أشهر)</label>
                  <input
                    type="number"
                    min={0}
                    max={36}
                    value={penForm.delayMonths}
                    onChange={(e) => setPenForm({ ...penForm, delayMonths: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">السبب *</label>
                <textarea
                  rows={2}
                  required
                  value={penForm.reason}
                  onChange={(e) => setPenForm({ ...penForm, reason: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPenModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-red-700 px-5 py-2 font-bold text-white cursor-pointer"
                >
                  تسجيل العقوبة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
