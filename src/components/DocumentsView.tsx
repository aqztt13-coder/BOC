import React, { useMemo, useState } from 'react';
import {
  Download,
  Eye,
  FileText,
  Plus,
  QrCode,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppUser,
  DocumentRecord,
  EmployeeRecord,
  SystemConfigBundle,
} from '../types/hrms';
import { hrmsApi } from '../lib/api';
import { hasPermission } from '../utils/permissions';
import { exportDocumentsToExcel } from '../utils/exporters';
import type { OfficialPreviewTarget } from './OfficialDocumentModal';

interface DocumentsViewProps {
  user: AppUser;
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  documents: DocumentRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onDownloadDocument: (docId: number) => void;
  onPreviewOfficial: (target: OfficialPreviewTarget) => void;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({
  user,
  config,
  employees,
  documents,
  onRefresh,
  onNotify,
  onDownloadDocument,
  onPreviewOfficial,
}) => {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [showUpload, setShowUpload] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null);

  const [form, setForm] = useState({
    documentNumber: '',
    title: '',
    category: config.orgCatalogs.documentCategories[0] || 'أمر إداري',
    issueDate: new Date().toISOString().slice(0, 10),
    expiryDate: '',
    issuingAuthority: 'شركة نفط البصرة',
    employeeId: '',
    department: config.orgCatalogs.departments[0] || '',
    oilfield: config.orgCatalogs.oilfields[0] || '',
    description: '',
    fileName: '',
    mimeType: 'application/pdf',
    fileSize: '',
    fileContentBase64: '' as string | null,
  });

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      if (catFilter !== 'ALL' && d.category !== catFilter) return false;
      if (q) {
        return (
          d.title.toLowerCase().includes(q) ||
          d.documentNumber.toLowerCase().includes(q) ||
          d.issuingAuthority.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [documents, search, catFilter]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      onNotify('صيغة الملف غير مسموح بها. يُسمح فقط بملفات PDF وPNG وJPG وWEBP.', 'error');
      return;
    }
    if (file.size > 3.8 * 1024 * 1024) {
      onNotify('الحد الأقصى لحجم الملف المرفوع هو 3.8 ميغابايت.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setForm((prev) => ({
        ...prev,
        fileName: file.name,
        mimeType: file.type,
        fileSize: `${(file.size / 1024).toFixed(1)} KB`,
        fileContentBase64: base64,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await hrmsApi.uploadDocument({
        documentNumber: form.documentNumber,
        title: form.title,
        category: form.category,
        issueDate: form.issueDate,
        expiryDate: form.expiryDate || null,
        issuingAuthority: form.issuingAuthority,
        employeeId: form.employeeId ? Number(form.employeeId) : null,
        department: form.department,
        oilfield: form.oilfield,
        description: form.description,
        fileName: form.fileName || `${form.documentNumber}.pdf`,
        mimeType: form.mimeType,
        fileSize: form.fileSize || 'إلكتروني',
        fileContentBase64: form.fileContentBase64 || null,
      });
      setShowUpload(false);
      onNotify('تمت أرشفة الوثيقة في المخزن المحمي بنجاح وتوليد رمز تحقق QR.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل أرشفة الوثيقة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!confirmArchiveId) return;
    setSubmitting(true);
    try {
      await hrmsApi.deleteDocument(confirmArchiveId);
      setConfirmArchiveId(null);
      onNotify('تمت أرشفة الوثيقة وحذفها من القائمة النشطة مع تسجيل العملية في سجل التدقيق.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل أرشفة الوثيقة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الوثيقة، العنوان، الجهة المصدرة..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 ps-9 pe-3 text-xs"
            />
          </div>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold"
          >
            <option value="ALL">جميع التصنيفات</option>
            {config.orgCatalogs.documentCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={() => exportDocumentsToExcel(filtered, employees)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>تصدير Excel</span>
            </button>
          )}
          {hasPermission(user.role, 'upload_documents') && (
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>رفع وأرشفة وثيقة</span>
            </button>
          )}
        </div>
      </div>

      {/* Documents Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 font-bold">رقم الوثيقة والعنوان</th>
                <th className="px-4 py-3 font-bold">التصنيف</th>
                <th className="px-4 py-3 font-bold">المنتسب / القسم</th>
                <th className="px-4 py-3 font-bold">تاريخ الإصدار / الانتهاء</th>
                <th className="px-4 py-3 font-bold">رمز التحقق</th>
                <th className="px-4 py-3 font-bold">إجراءات محمية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    لا توجد وثائق مؤرشفة مطابقة حالياً.
                  </td>
                </tr>
              ) : (
                filtered.map((doc) => {
                  const emp = doc.employeeId ? empMap.get(doc.employeeId) : undefined;
                  const isExpiringSoon =
                    doc.expiryDate && (Date.parse(doc.expiryDate) - Date.parse(todayISO)) / 86_400_000 <= 60;
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900 dark:text-white">{doc.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          <span dir="ltr" className="font-mono">{doc.documentNumber}</span> · {doc.fileSize} · v{doc.version}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-semibold">{doc.category}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{emp ? emp.fullName : 'وثيقة عامة / إدارية'}</p>
                        <p className="text-[11px] text-slate-500">{doc.department || '—'}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        <span dir="ltr" className="font-mono block">{doc.issueDate}</span>
                        {doc.expiryDate && (
                          <span
                            dir="ltr"
                            className={`font-mono text-[11px] ${
                              isExpiringSoon ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-400'
                            }`}
                          >
                            ينتهي: {doc.expiryDate}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                          {doc.verificationCode}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {hasPermission(user.role, 'download_documents') && (
                            <button
                              type="button"
                              onClick={() => onDownloadDocument(doc.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Eye className="h-3 w-3" />
                              <span>معاينة/تحميل</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onPreviewOfficial({ kind: 'document', record: doc, employee: emp })}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <QrCode className="h-3 w-3 text-[#C69214]" />
                            <span>QR</span>
                          </button>
                          {hasPermission(user.role, 'edit_employee') && (
                            <button
                              type="button"
                              onClick={() => setConfirmArchiveId(doc.id)}
                              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                              aria-label="أرشفة الوثيقة"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Document Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <h3 className="text-base font-extrabold">أرشفة وثيقة رقمية في المخزن المحمي</h3>
              <button type="button" onClick={() => setShowUpload(false)} className="p-1 text-slate-400 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="flex-1 overflow-y-auto p-6 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-semibold mb-1">رقم الوثيقة / الأمر الإداري *</label>
                  <input
                    required
                    dir="ltr"
                    placeholder="BOC-DOC-2026-01"
                    value={form.documentNumber}
                    onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تصنيف الوثيقة *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    {config.orgCatalogs.documentCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">عنوان الوثيقة *</label>
                  <input
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ الإصدار *</label>
                  <input
                    type="date"
                    required
                    value={form.issueDate}
                    onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ انتهاء الصلاحية (اختياري)</label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">المنتسب المرتبط (اختياري)</label>
                  <select
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    <option value="">وثيقة عامة للقسم / الشركة</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.employeeCode})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">الجهة المصدرة *</label>
                  <input
                    required
                    value={form.issuingAuthority}
                    onChange={(e) => setForm({ ...form, issuingAuthority: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">إرفاق الملف الرسمي (PDF / PNG / JPG — حد أقصى 3.8MB)</label>
                <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 cursor-pointer hover:border-[#C69214]">
                  <Upload className="h-4 w-4 text-[#C69214]" />
                  <span>{form.fileName ? `${form.fileName} (${form.fileSize})` : 'اختر ملفاً من جهازك للرفع الآمن'}</span>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleFileChange} className="hidden" />
                </label>
              </div>

              <div>
                <label className="block font-semibold mb-1">وصف وملاحظات</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUpload(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  {submitting ? 'جاري الأرشفة...' : 'حفظ وأرشفة الوثيقة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive confirmation */}
      {confirmArchiveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h3 className="text-base font-bold">تأكيد أرشفة الوثيقة</h3>
            <p className="mt-2 text-xs text-slate-500">سيتم إخفاء الوثيقة من القائمة النشطة مع توثيق العملية في سجل التدقيق.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchiveId(null)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleArchive}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white cursor-pointer"
              >
                تأكيد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
