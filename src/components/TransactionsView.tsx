import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileCheck2,
  Plus,
  RotateCcw,
  Send,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AppUser,
  EmployeeRecord,
  SystemConfigBundle,
  TransactionRecord,
} from '../types/hrms';
import { hrmsApi } from '../lib/api';
import { hasPermission } from '../utils/permissions';
import { exportTransactionsToExcel } from '../utils/exporters';
import type { OfficialPreviewTarget } from './OfficialDocumentModal';

interface TransactionsViewProps {
  user: AppUser;
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  transactions: TransactionRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPreviewOfficial: (target: OfficialPreviewTarget) => void;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  user,
  config,
  employees,
  transactions,
  onRefresh,
  onNotify,
  onPreviewOfficial,
}) => {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [commentModal, setCommentModal] = useState<{
    txnId: number;
    action: 'REJECT' | 'RETURN' | 'ESCALATE';
    title: string;
  } | null>(null);
  const [commentText, setCommentText] = useState('');

  const [form, setForm] = useState({
    transactionType: 'CONTINUATION_OF_SERVICE',
    employeeId: '',
    title: '',
    notes: '',
  });

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const wfLabelMap = useMemo(
    () => new Map(config.workflows.map((w) => [w.transactionType, w.labelAr])),
    [config.workflows]
  );

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (statusFilter === 'PENDING') {
        if (
          t.status !== 'بانتظار موافقة القسم' &&
          t.status !== 'بانتظار موافقة الموارد البشرية' &&
          t.status !== 'معاد للتعديل'
        ) {
          return false;
        }
      } else if (statusFilter !== 'ALL' && t.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== 'ALL' && t.transactionType !== typeFilter) return false;
      return true;
    });
  }, [transactions, statusFilter, typeFilter]);

  const selectedTxn = useMemo(
    () => filtered.find((t) => t.id === selectedId) || filtered[0] || null,
    [filtered, selectedId]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const empId = Number(form.employeeId || employees[0]?.id);
    if (!empId) {
      onNotify('يرجى تسجيل منتسب أولاً لربط المعاملة الإدارية به.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const created = await hrmsApi.createTransaction({
        transactionType: form.transactionType,
        employeeId: empId,
        title: form.title.trim() || `${wfLabelMap.get(form.transactionType) || form.transactionType}`,
        payload: { notes: form.notes },
      });
      setShowCreate(false);
      setSelectedId(created.id);
      setForm({ transactionType: 'CONTINUATION_OF_SERVICE', employeeId: '', title: '', notes: '' });
      onNotify(`تم إنشاء المعاملة الإدارية رقم ${created.transactionNumber} وإرسالها لمسار الموافقات.`, 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل إنشاء المعاملة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const executeAction = async (
    txnId: number,
    action: 'APPROVE' | 'REJECT' | 'RETURN' | 'RESUBMIT' | 'ESCALATE' | 'COMPLETE' | 'ARCHIVE',
    comment = ''
  ) => {
    setSubmitting(true);
    try {
      await hrmsApi.performTransactionAction(txnId, { action, comment });
      setCommentModal(null);
      setCommentText('');
      onNotify('تم تنفيذ إجراء سير العمل وتحديث سجل المعاملة والتدقيق.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تنفيذ الإجراء.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canActOnSelected = (txn: TransactionRecord) => {
    const isHR = hasPermission(user.role, 'approve_hr');
    const isDept = hasPermission(user.role, 'approve_dept') && (isHR || user.department === txn.department);
    const isOwner = txn.createdByUid === user.uid || user.employeeId === txn.employeeId;
    return {
      canApprove:
        (txn.status === 'بانتظار موافقة القسم' && isDept) ||
        (txn.status === 'بانتظار موافقة الموارد البشرية' && isHR),
      canResubmit: txn.status === 'معاد للتعديل' && (isOwner || isHR),
      canComplete: txn.status === 'معتمد' && isHR,
      canArchive: (txn.status === 'معتمد' || txn.status === 'مكتمل' || txn.status === 'مرفوض') && (isHR || isDept),
      canEscalate:
        (txn.status === 'بانتظار موافقة القسم' || txn.status === 'بانتظار موافقة الموارد البشرية') &&
        (isHR || isDept) &&
        !txn.escalated,
    };
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'ALL', label: 'الكل' },
            { id: 'PENDING', label: 'قيد الانتظار' },
            { id: 'معتمد', label: 'معتمد' },
            { id: 'معاد للتعديل', label: 'معاد للتعديل' },
            { id: 'مرفوض', label: 'مرفوض' },
            { id: 'مكتمل', label: 'مكتمل' },
            { id: 'مؤرشف', label: 'مؤرشف' },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                statusFilter === s.id
                  ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {s.label}
            </button>
          ))}

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold"
          >
            <option value="ALL">جميع أنواع المعاملات</option>
            {config.workflows.map((w) => (
              <option key={w.transactionType} value={w.transactionType}>
                {w.labelAr}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={() => exportTransactionsToExcel(filtered, employees)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>تصدير</span>
            </button>
          )}
          {user.role !== 'READ_ONLY' && (
            <button
              type="button"
              onClick={() => {
                setForm({
                  transactionType: 'CONTINUATION_OF_SERVICE',
                  employeeId: String(user.employeeId || employees[0]?.id || ''),
                  title: '',
                  notes: '',
                });
                setShowCreate(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إنشاء معاملة جديدة</span>
            </button>
          )}
        </div>
      </div>

      {/* Unified Inbox Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden max-h-[720px] flex flex-col">
          <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
            <h3 className="text-xs font-bold">صندوق المعاملات الإدارية الموحد</h3>
            <span className="text-xs text-slate-500 tabular-nums">{filtered.length} معاملة</span>
          </div>

          {filtered.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Workflow className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-xs text-slate-500">لا توجد معاملات إدارية في هذه الفئة حالياً.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto">
              {filtered.map((txn) => {
                const emp = empMap.get(txn.employeeId);
                const isSelected = selectedTxn?.id === txn.id;
                return (
                  <button
                    key={txn.id}
                    type="button"
                    onClick={() => setSelectedId(txn.id)}
                    className={`w-full text-right p-4 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#0B1F3A]/5 dark:bg-[#C69214]/15 border-s-2 border-[#C69214]'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span dir="ltr" className="font-mono text-[11px] font-bold text-[#0B1F3A] dark:text-[#E5B94C]">
                        {txn.transactionNumber}
                      </span>
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {txn.status}
                        {txn.escalated ? ' · مُصعّدة' : ''}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white mt-1 line-clamp-1">{txn.title}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {emp?.fullName || `منتسب #${txn.employeeId}`} · {txn.department}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Transaction Details & Actions */}
        <div className="xl:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          {!selectedTxn ? (
            <div className="py-16 text-center text-xs text-slate-400">
              اختر معاملة إدارية من الصندوق لاستعراض مسار الموافقات وتنفيذ الإجراءات.
            </div>
          ) : (
            (() => {
              const emp = empMap.get(selectedTxn.employeeId);
              const perms = canActOnSelected(selectedTxn);
              return (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span dir="ltr" className="font-mono font-bold text-[#0B1F3A] dark:text-[#E5B94C]">
                          {selectedTxn.transactionNumber}
                        </span>{' '}
                        · {wfLabelMap.get(selectedTxn.transactionType) || selectedTxn.transactionType}
                      </p>
                      <h3 className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
                        {selectedTxn.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        المنتسب: <strong>{emp?.fullName || `#${selectedTxn.employeeId}`}</strong> · {selectedTxn.department} ·{' '}
                        {selectedTxn.oilfield}
                      </p>
                    </div>
                    <div className="text-left shrink-0">
                      <p className="text-xs font-extrabold text-[#0B1F3A] dark:text-[#E5B94C]">{selectedTxn.status}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        المسؤول الحالي: {selectedTxn.currentResponsibleRole}
                      </p>
                    </div>
                  </div>

                  {selectedTxn.rejectionReason && (
                    <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300">
                      <strong>سبب الرفض: </strong>
                      {selectedTxn.rejectionReason}
                    </div>
                  )}

                  {/* Workflow Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {perms.canApprove && (
                      <>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => executeAction(selectedTxn.id, 'APPROVE')}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>موافقة واعتماد المرحلة</span>
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            setCommentModal({
                              txnId: selectedTxn.id,
                              action: 'RETURN',
                              title: 'إعادة المعاملة للتعديل والاستكمال',
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2 text-xs font-bold text-amber-800 dark:text-amber-300 cursor-pointer"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>إعادة للتعديل</span>
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            setCommentModal({
                              txnId: selectedTxn.id,
                              action: 'REJECT',
                              title: 'رفض المعاملة الإدارية',
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2 text-xs font-bold text-red-700 dark:text-red-300 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>رفض</span>
                        </button>
                      </>
                    )}
                    {perms.canResubmit && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => executeAction(selectedTxn.id, 'RESUBMIT', 'تم استكمال التعديلات المطلوبة')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>إعادة تقديم المعاملة</span>
                      </button>
                    )}
                    {perms.canEscalate && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          setCommentModal({
                            txnId: selectedTxn.id,
                            action: 'ESCALATE',
                            title: 'تصعيد المعاملة للإدارة العليا',
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold cursor-pointer"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        <span>تصعيد</span>
                      </button>
                    )}
                    {perms.canComplete && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => executeAction(selectedTxn.id, 'COMPLETE')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>إنجاز</span>
                      </button>
                    )}
                    {perms.canArchive && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => executeAction(selectedTxn.id, 'ARCHIVE')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold cursor-pointer"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        <span>أرشفة</span>
                      </button>
                    )}
                    {(selectedTxn.status === 'معتمد' || selectedTxn.status === 'مكتمل') && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewOfficial({ kind: 'transaction', record: selectedTxn, employee: emp })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#C69214] px-3 py-2 text-xs font-bold text-[#0B1F3A] dark:text-[#E5B94C] cursor-pointer"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" />
                        <span>طباعة وثيقة رسمية بـ QR</span>
                      </button>
                    )}
                  </div>

                  {/* Payload details */}
                  {selectedTxn.payload && Object.keys(selectedTxn.payload).length > 0 && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 text-xs space-y-1.5">
                      <h4 className="font-bold text-slate-800 dark:text-slate-100">بيانات وتفاصيل الطلب</h4>
                      {Array.isArray(selectedTxn.payload.explanation) ? (
                        <ul className="list-disc ps-5 space-y-1 text-slate-600 dark:text-slate-300">
                          {(selectedTxn.payload.explanation as string[]).map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 dark:text-slate-300">
                          {Object.entries(selectedTxn.payload).map(([k, v]) => (
                            <div key={k}>
                              <span className="font-semibold">{k}: </span>
                              <span>{String(v ?? '—')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Approval History Trail */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-3">
                      سجل مسار الموافقات والتحويلات ({selectedTxn.history?.length || 0})
                    </h4>
                    <div className="space-y-2.5">
                      {(selectedTxn.history || []).map((step, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs flex items-start justify-between gap-3"
                        >
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">{step.action}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {step.actorName} ({step.actorRole}) · {step.fromStatus} ← <strong>{step.toStatus}</strong>
                            </p>
                            {step.comment && (
                              <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-1">ملاحظة: {step.comment}</p>
                            )}
                          </div>
                          <span dir="ltr" className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                            {step.timestamp.slice(0, 16).replace('T', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* Create Transaction Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-extrabold">إنشاء معاملة إدارية رسمية</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1 text-slate-400 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
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
                      {e.fullName} ({e.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">نوع المعاملة *</label>
                <select
                  required
                  value={form.transactionType}
                  onChange={(e) => setForm({ ...form, transactionType: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                >
                  {config.workflows
                    .filter((w) => !['LEAVE', 'TRAINING'].includes(w.transactionType))
                    .map((w) => (
                      <option key={w.transactionType} value={w.transactionType}>
                        {w.labelAr}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">عنوان المعاملة *</label>
                <input
                  required
                  placeholder="مثال: طلب تأييد استمرار بالخدمة موجه إلى مصرف الرشيد"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">تفاصيل وملاحظات إضافية</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  إرسال للموافقة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Comment / Reason Modal for Reject / Return / Escalate */}
      {commentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-extrabold">{commentModal.title}</h3>
            <textarea
              rows={3}
              required
              placeholder="اكتب السبب أو الملاحظة الرسمية المطلوبة..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCommentModal(null);
                  setCommentText('');
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={submitting || commentText.trim().length < 3}
                onClick={() => executeAction(commentModal.txnId, commentModal.action, commentText.trim())}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
              >
                تأكيد التنفيذ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
