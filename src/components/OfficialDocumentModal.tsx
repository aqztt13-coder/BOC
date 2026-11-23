import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, ShieldCheck, X } from 'lucide-react';
import type {
  AppreciationRecord,
  DocumentRecord,
  EmployeeRecord,
  TransactionRecord,
} from '../types/hrms';
import { formatIQD } from '../utils/exporters';

export type OfficialPreviewTarget =
  | { kind: 'appreciation'; record: AppreciationRecord; employee?: EmployeeRecord }
  | { kind: 'transaction'; record: TransactionRecord; employee?: EmployeeRecord }
  | { kind: 'document'; record: DocumentRecord; employee?: EmployeeRecord };

interface OfficialDocumentModalProps {
  target: OfficialPreviewTarget | null;
  onClose: () => void;
}

export const OfficialDocumentModal: React.FC<OfficialDocumentModalProps> = ({ target, onClose }) => {
  if (!target) return null;

  const isAppreciation = target.kind === 'appreciation';
  const isTxn = target.kind === 'transaction';
  const emp = target.employee;

  const docNumber = isAppreciation
    ? target.record.letterNumber
    : isTxn
      ? target.record.transactionNumber
      : target.record.documentNumber;

  const issueDate = isAppreciation
    ? target.record.issueDate
    : isTxn
      ? (target.record.completedAt || target.record.createdAt).slice(0, 10)
      : target.record.issueDate;

  const verificationCode = isAppreciation
    ? target.record.verificationCode
    : isTxn
      ? `BOC-TXN-${target.record.transactionNumber}`
      : target.record.verificationCode;

  const docTitle = isAppreciation
    ? 'كتاب شكر وتقدير رسمي'
    : isTxn
      ? target.record.title
      : target.record.title;

  const qrPayload = JSON.stringify({
    issuer: 'Basra Oil Company (BOC)',
    ref: docNumber,
    verify: verificationCode,
    employee: emp?.employeeCode || 'N/A',
    date: issueDate,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6 print:static print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="official-doc-modal-title"
    >
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl print:max-h-none print:border-0 print:shadow-none">
        {/* Modal Chrome */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5 bg-slate-50 dark:bg-slate-900 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck className="h-5 w-5 text-[#C69214] shrink-0" aria-hidden="true" />
            <h3 id="official-doc-modal-title" className="text-sm font-bold text-slate-900 dark:text-white truncate">
              معاينة الوثيقة الرسمية الموثقة برمز التحقق (QR)
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 hover:opacity-90 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>طباعة / تصدير PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white cursor-pointer"
              aria-label="إغلاق المعاينة"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable Official Letter Sheet (Always Official White Paper) */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-8 bg-slate-100 dark:bg-slate-950 print:bg-white print:p-0">
          <div
            dir="rtl"
            className="mx-auto max-w-2xl rounded-xl border border-slate-300 bg-white p-7 sm:p-10 text-slate-900 shadow-sm print:border-0 print:shadow-none"
          >
            {/* Republic & Ministry Official Header */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#0B1F3A] pb-5">
              <div className="text-right space-y-1">
                <p className="text-xs font-bold text-slate-600">جمهورية العراق</p>
                <p className="text-sm font-extrabold text-[#0B1F3A]">وزارة النفط</p>
                <p className="text-base font-extrabold text-[#0B1F3A]">شركة نفط البصرة (BOC)</p>
                <p className="text-xs font-semibold text-slate-600">قسم الموارد البشرية والشؤون الإدارية</p>
              </div>
              <div className="text-left space-y-1 text-xs text-slate-600">
                <p>
                  العدد:{' '}
                  <span dir="ltr" className="inline-block font-mono font-bold text-slate-900">
                    {docNumber}
                  </span>
                </p>
                <p>
                  التاريخ:{' '}
                  <span dir="ltr" className="inline-block font-mono font-bold text-slate-900 tabular-nums">
                    {issueDate}
                  </span>
                </p>
                <p>
                  رمز التحقق:{' '}
                  <span dir="ltr" className="inline-block font-mono font-bold text-[#0B1F3A]">
                    {verificationCode}
                  </span>
                </p>
              </div>
            </div>

            {/* Subject Title */}
            <div className="my-7 text-center">
              <h4 className="inline-block border-b-2 border-[#C69214] pb-1.5 text-xl font-extrabold text-[#0B1F3A]">
                {docTitle}
              </h4>
            </div>

            {/* Recipient Block */}
            {emp && (
              <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <span className="text-slate-500">اسم المنتسب: </span>
                  <span className="font-bold text-slate-900">{emp.fullName}</span>
                </div>
                <div>
                  <span className="text-slate-500">الرقم الوظيفي: </span>
                  <span dir="ltr" className="inline-block font-mono font-bold text-slate-900">
                    {emp.employeeCode}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">العنوان الوظيفي: </span>
                  <span className="font-semibold text-slate-800">{emp.jobTitle}</span>
                </div>
                <div>
                  <span className="text-slate-500">القسم / الحقل: </span>
                  <span className="font-semibold text-slate-800">
                    {emp.department} · {emp.oilfield}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">الدرجة / المرحلة: </span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    الدرجة {emp.grade} / المرحلة {emp.step}
                  </span>
                </div>
                {isTxn && target.record.transactionType === 'SALARY_CERTIFICATE' && (
                  <div>
                    <span className="text-slate-500">الراتب الاسمي: </span>
                    <span className="font-bold text-slate-900 tabular-nums">{formatIQD(emp.basicSalaryIQD)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Official Body */}
            <div className="space-y-4 text-sm leading-8 text-slate-800">
              {isAppreciation && (
                <>
                  <p>تحية طيبة...</p>
                  <p>
                    تقديراً للجهود المتميزة والأداء المهني العالي المبذول في خدمة شركة نفط البصرة، قررت{' '}
                    <strong>{target.record.issuingAuthority}</strong> توجيه كتاب الشكر والتقدير هذا إليكم عن:{' '}
                    <strong>«{target.record.subject}»</strong>.
                  </p>
                  <p>
                    ويترتب على هذا الكتاب منحكم قِدَماً لأغراض العلاوة السنوية والترفيع الوظيفي بمقدار{' '}
                    <strong className="tabular-nums">{target.record.seniorityMonths}</strong> شهر وفق الضوابط
                    النافذة المعتمدة في نظام الموارد البشرية.
                  </p>
                </>
              )}

              {isTxn && (
                <>
                  <p>إلى من يهمه الأمر / تحية طيبة...</p>
                  <p>
                    نؤيد بأن المعاملة الإدارية المرقمة أعلاه والخاصة بـ <strong>{target.record.title}</strong> قد
                    استوفت جميع مراحل التدقيق والموافقات الرسمية في نظام إدارة الموارد البشرية لشركة نفط البصرة،
                    وحالتها الحالية: <strong>{target.record.status}</strong>.
                  </p>
                  {target.record.transactionType === 'CONTINUATION_OF_SERVICE' && emp && (
                    <p>
                      نؤيد استمرار المنتسب المذكور أعلاه بالخدمة الوظيفية الفعلية على الملاك الدائم في شركتنا منذ
                      تاريخ تعيينه{' '}
                      <span dir="ltr" className="inline-block font-mono font-semibold">
                        {emp.hireDate}
                      </span>{' '}
                      وحتى تاريخ إصدار هذا التأييد.
                    </p>
                  )}
                </>
              )}

              {target.kind === 'document' && (
                <>
                  <p>
                    وثيقة إلكترونية مؤرشفة رسمياً ضمن منظومة الأرشيف الرقمي لشركة نفط البصرة تحت التصنيف:{' '}
                    <strong>{target.record.category}</strong>.
                  </p>
                  <p>
                    الجهة المصدرة: <strong>{target.record.issuingAuthority}</strong>
                  </p>
                  {target.record.description && <p>{target.record.description}</p>}
                </>
              )}
            </div>

            {/* Official Footer & Live QR Code */}
            <div className="mt-10 flex items-end justify-between gap-6 border-t border-slate-200 pt-6">
              <div className="space-y-1 text-center">
                <p className="text-xs font-bold text-[#0B1F3A]">مدير قسم الموارد البشرية</p>
                <p className="text-xs text-slate-500">شركة نفط البصرة — وزارة النفط</p>
                <p className="mt-4 text-[11px] text-emerald-700 font-semibold">
                  مصدّق إلكترونياً · لا يحتاج إلى ختم ورقي عند مطابقة رمز QR
                </p>
              </div>
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 p-2.5 bg-white">
                <QRCodeSVG value={qrPayload} size={86} level="M" />
                <span dir="ltr" className="font-mono text-[10px] text-slate-500">
                  {verificationCode}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
