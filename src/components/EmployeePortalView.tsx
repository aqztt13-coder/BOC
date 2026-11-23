import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  FileText,
  GraduationCap,
  Send,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import type {
  AppreciationRecord,
  CareerEventRecord,
  DocumentRecord,
  EmployeeRecord,
  LeaveRequestRecord,
  PenaltyRecordItem,
  SystemConfigBundle,
  TrainingCourseRecord,
  TrainingEnrollmentRecord,
  TransactionRecord,
} from '../types/hrms';
import { calculateDateRangeDays, calculateEmployeeProgression } from '../utils/hrEngine';
import { formatIQD } from '../utils/exporters';
import { hrmsApi } from '../lib/api';
import type { OfficialPreviewTarget } from './OfficialDocumentModal';

interface EmployeePortalViewProps {
  employee: EmployeeRecord | null;
  config: SystemConfigBundle;
  appreciations: AppreciationRecord[];
  penalties: PenaltyRecordItem[];
  documents: DocumentRecord[];
  courses: TrainingCourseRecord[];
  enrollments: TrainingEnrollmentRecord[];
  leaveRequests: LeaveRequestRecord[];
  transactions: TransactionRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPreviewOfficial: (target: OfficialPreviewTarget) => void;
  onDownloadDocument: (docId: number) => void;
}

type PortalTab = 'profile' | 'progression' | 'training' | 'self_service';

export const EmployeePortalView: React.FC<EmployeePortalViewProps> = ({
  employee,
  config,
  appreciations,
  penalties,
  documents,
  courses,
  enrollments,
  leaveRequests,
  transactions,
  onRefresh,
  onNotify,
  onPreviewOfficial,
  onDownloadDocument,
}) => {
  const [activeTab, setActiveTab] = useState<PortalTab>('profile');
  const [timeline, setTimeline] = useState<CareerEventRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [leaveForm, setLeaveForm] = useState({
    leaveType: config.orgCatalogs.leaveTypes[0]?.name || 'إجازة اعتيادية',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    reason: '',
  });

  const [docRequestForm, setDocRequestForm] = useState({
    transactionType: 'CONTINUATION_OF_SERVICE',
    directedTo: '',
    notes: '',
  });

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (!employee) {
      setTimeline([]);
      return;
    }
    let active = true;
    hrmsApi
      .getEmployeeTimeline(employee.id)
      .then((evts) => {
        if (active) setTimeline(evts);
      })
      .catch(() => {
        if (active) setTimeline([]);
      });
    return () => {
      active = false;
    };
  }, [employee?.id]);

  const myAppreciations = useMemo(
    () => (employee ? appreciations.filter((a) => a.employeeId === employee.id) : []),
    [employee, appreciations]
  );
  const myPenalties = useMemo(
    () => (employee ? penalties.filter((p) => p.employeeId === employee.id) : []),
    [employee, penalties]
  );
  const myDocuments = useMemo(
    () => (employee ? documents.filter((d) => d.employeeId === employee.id) : []),
    [employee, documents]
  );
  const myEnrollments = useMemo(
    () => (employee ? enrollments.filter((e) => e.employeeId === employee.id) : []),
    [employee, enrollments]
  );
  const myLeaves = useMemo(
    () => (employee ? leaveRequests.filter((l) => l.employeeId === employee.id) : []),
    [employee, leaveRequests]
  );
  const myTransactions = useMemo(
    () => (employee ? transactions.filter((t) => t.employeeId === employee.id) : []),
    [employee, transactions]
  );

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const progression = useMemo(() => {
    if (!employee) return null;
    return calculateEmployeeProgression(employee, appreciations, penalties, todayISO, config.hrRules);
  }, [employee, appreciations, penalties, todayISO, config.hrRules]);

  if (!employee) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
        <UserCheck className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto" />
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
          حسابك غير مرتبط بملف منتسب بعد
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          يرجى التواصل مع قسم الموارد البشرية لربط حسابك برقمك الوظيفي لتفعيل بوابة الخدمة الذاتية الخاصة بك.
        </p>
      </div>
    );
  }

  const leaveDays = calculateDateRangeDays(leaveForm.startDate, leaveForm.endDate);

  const handleApplyCourse = async (courseId: number) => {
    setSubmitting(true);
    try {
      await hrmsApi.applyToCourse(courseId, employee.id);
      onNotify('تم إرسال طلب الالتحاق بالدورة التدريبية بنجاح إلى مسار الموافقات.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'تعذر التقديم للدورة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await hrmsApi.createLeave({
        employeeId: employee.id,
        leaveType: leaveForm.leaveType,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason,
      });
      setLeaveForm({
        leaveType: config.orgCatalogs.leaveTypes[0]?.name || 'إجازة اعتيادية',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        reason: '',
      });
      onNotify('تم تقديم طلب الإجازة بنجاح وهو الآن قيد المراجعة.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تقديم طلب الإجازة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const label =
      docRequestForm.transactionType === 'CONTINUATION_OF_SERVICE'
        ? 'تأييد استمرار بالخدمة'
        : docRequestForm.transactionType === 'SALARY_CERTIFICATE'
          ? 'شهادة راتب رسمية'
          : 'خلاصة خدمة ووثيقة رسمية';

    try {
      const created = await hrmsApi.createTransaction({
        transactionType: docRequestForm.transactionType,
        employeeId: employee.id,
        title: docRequestForm.directedTo.trim()
          ? `${label} — موجه إلى: ${docRequestForm.directedTo.trim()}`
          : label,
        payload: {
          directedTo: docRequestForm.directedTo.trim(),
          notes: docRequestForm.notes.trim(),
        },
      });
      setDocRequestForm({ transactionType: 'CONTINUATION_OF_SERVICE', directedTo: '', notes: '' });
      onNotify(`تم إرسال طلب ${label} بنجاح (رقم المعاملة ${created.transactionNumber}).`, 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل إرسال طلب الوثيقة.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Personal Hero Banner */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#0B1F3A] text-white p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-[#E5B94C]">بوابة الخدمة الذاتية الخاصة بالمنتسب</p>
            <h2 className="mt-1 text-2xl font-extrabold">{employee.fullName}</h2>
            <p className="mt-1 text-xs text-slate-300">
              {employee.jobTitle} · {employee.department} · {employee.oilfield}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5">
              <p className="text-[11px] text-slate-300">الرقم الوظيفي</p>
              <p dir="ltr" className="mt-1 font-mono text-sm font-extrabold text-[#E5B94C]">
                {employee.employeeCode}
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5">
              <p className="text-[11px] text-slate-300">الدرجة / المرحلة</p>
              <p className="mt-1 text-sm font-extrabold tabular-nums">
                د{employee.grade} / م{employee.step}
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5">
              <p className="text-[11px] text-slate-300">رصيد الاعتيادية</p>
              <p className="mt-1 text-sm font-extrabold tabular-nums">{employee.annualLeaveBalance} يوماً</p>
            </div>
          </div>
        </div>

        {/* Dedicated Portal Navigation Tabs */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {[
            { id: 'profile', label: 'ملفي الوظيفي والأرشيف', icon: Briefcase },
            { id: 'progression', label: 'الترفيعات والشكر والعقوبات', icon: Award },
            { id: 'training', label: 'الدورات التدريبية والشهادات', icon: GraduationCap },
            { id: 'self_service', label: 'الإجازات والوثائق الرسمية', icon: CalendarDays },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as PortalTab)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors cursor-pointer ${
                  active ? 'bg-[#C69214] text-slate-950' : 'bg-white/10 text-slate-200 hover:bg-white/20'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 1: Personal Career Profile (Read-Only) & Personal Digital Archive */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7 space-y-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mb-4">
                البيانات الشخصية والوظيفية (للعرض فقط)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  { k: 'الاسم الكامل', v: employee.fullName },
                  { k: 'الرقم الوظيفي', v: employee.employeeCode, ltr: true },
                  { k: 'العنوان الوظيفي', v: employee.jobTitle },
                  { k: 'القسم / الهيئة', v: employee.department },
                  { k: 'الحقل النفطي / الموقع', v: employee.oilfield },
                  { k: 'الشعبة', v: employee.section || '—' },
                  { k: 'الدرجة والمرحلة', v: `الدرجة ${employee.grade} / المرحلة ${employee.step}` },
                  { k: 'تاريخ التعيين والمباشرة', v: employee.hireDate, ltr: true },
                  { k: 'التحصيل الدراسي والتخصص', v: `${employee.academicDegree} — ${employee.specialization || 'عام'}` },
                  { k: 'الراتب الاسمي', v: formatIQD(employee.basicSalaryIQD) },
                  { k: 'البريد الإلكتروني الرسمي', v: employee.email || '—', ltr: true },
                  { k: 'رقم الهاتف', v: employee.phone || '—', ltr: true },
                ].map((item) => (
                  <div
                    key={item.k}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-3"
                  >
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.k}</p>
                    <p className="mt-1 font-bold text-slate-900 dark:text-white tabular-nums">
                      {item.ltr ? (
                        <span dir="ltr" className="inline-block font-mono">
                          {item.v}
                        </span>
                      ) : (
                        item.v
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-4 w-4 text-[#C69214]" />
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">المسار الوظيفي الزمني</h3>
              </div>
              {timeline.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">لا توجد أحداث مسجلة في المسار الوظيفي بعد.</p>
              ) : (
                <div className="space-y-2.5">
                  {timeline.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs flex items-start justify-between gap-3"
                    >
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">
                          {ev.eventType} — {ev.title}
                        </p>
                        {ev.description && <p className="text-slate-500 mt-0.5">{ev.description}</p>}
                      </div>
                      <span dir="ltr" className="font-mono text-slate-400 tabular-nums shrink-0">
                        {ev.eventDate}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[#C69214]" />
                <h3 className="text-sm font-extrabold">أرشيفي الرقمي الشخصي</h3>
              </div>
              <span className="text-xs text-slate-500 tabular-nums">{myDocuments.length} وثيقة</span>
            </div>
            {myDocuments.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">لا توجد وثائق مؤرشفة في ملفك حالياً.</p>
            ) : (
              <div className="space-y-2.5">
                {myDocuments.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 dark:text-white truncate">{d.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {d.category} · <span dir="ltr" className="font-mono">{d.issueDate}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDownloadDocument(d.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 font-semibold text-[#0B1F3A] dark:text-[#E5B94C] hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>معاينة</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Career Progression Tracker, Appreciation Letters (PDF+QR), Penalties */}
      {activeTab === 'progression' && progression && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <p className="text-slate-500">تاريخ العلاوة السنوية القادمة</p>
              <p dir="ltr" className="mt-1.5 font-mono text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
                {progression.effectiveIncrementDate}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                {progression.daysToIncrement < 0
                  ? `مستحقة منذ ${Math.abs(progression.daysToIncrement)} يوماً`
                  : `متبقي ${progression.daysToIncrement} يوماً`}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <p className="text-slate-500">تاريخ الترفيع الوظيفي القادم</p>
              <p dir="ltr" className="mt-1.5 font-mono text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
                {progression.gradeYearsRequired > 0 ? progression.effectivePromotionDate : 'الدرجة الأولى'}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                {progression.gradeYearsRequired > 0
                  ? progression.daysToPromotion < 0
                    ? `مستحق منذ ${Math.abs(progression.daysToPromotion)} يوماً`
                    : `متبقي ${progression.daysToPromotion} يوماً`
                  : 'أعلى درجة وظيفية'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <p className="text-slate-500">قِدَم كتب الشكر المحتسب</p>
              <p className="mt-1.5 text-lg font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                +{progression.effectiveSeniorityMonths} شهر
              </p>
              <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                من أصل {myAppreciations.length} كتب شكر مسجلة
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <p className="text-slate-500">تأخير العقوبات الإدارية</p>
              <p className="mt-1.5 text-lg font-extrabold text-red-600 dark:text-red-400 tabular-nums">
                -{progression.totalPenaltyDelayMonths} شهر
              </p>
              <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                صافي التعديل: {progression.netAdjustmentMonths} شهر
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-xs">
            <h3 className="text-sm font-extrabold mb-3">تفصيل آلية احتساب استحقاقك الحالي</h3>
            <ul className="list-disc ps-5 space-y-1.5 text-slate-600 dark:text-slate-300">
              {progression.explanationSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Personal Appreciation Letters */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-[#C69214]" />
                  <h3 className="text-sm font-extrabold">كتب الشكر والتقدير الخاصة بي</h3>
                </div>
                <span className="text-xs text-slate-500 tabular-nums">{myAppreciations.length}</span>
              </div>
              {myAppreciations.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">لا توجد كتب شكر مسجلة حالياً.</p>
              ) : (
                <div className="space-y-2.5">
                  {myAppreciations.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 text-xs flex items-start justify-between gap-3"
                    >
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{a.issuingAuthority}</p>
                        <p className="text-slate-600 dark:text-slate-300 mt-0.5">{a.subject}</p>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold mt-1 tabular-nums">
                          العدد: <span dir="ltr" className="font-mono">{a.letterNumber}</span> · قِدَم +{a.seniorityMonths} شهر
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onPreviewOfficial({ kind: 'appreciation', record: a, employee })}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#C69214] px-2.5 py-1.5 text-[11px] font-bold text-[#0B1F3A] dark:text-[#E5B94C] shrink-0 cursor-pointer"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" />
                        <span>PDF + QR</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Personal Penalties */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-600" />
                  <h3 className="text-sm font-extrabold">سجل العقوبات الإدارية</h3>
                </div>
                <span className="text-xs text-slate-500 tabular-nums">{myPenalties.length}</span>
              </div>
              {myPenalties.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-xs text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>سجلك الإداري خالٍ تماماً من أي عقوبات.</span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {myPenalties.map((p) => (
                    <div key={p.id} className="rounded-lg border border-red-200 dark:border-red-900/50 p-3.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-red-700 dark:text-red-400">
                          {p.penaltyType} (تأخير {p.delayMonths} شهر)
                        </span>
                        <span dir="ltr" className="font-mono text-slate-400">{p.issueDate}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 mt-1">{p.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Training & Courses Portal */}
      {activeTab === 'training' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-extrabold mb-4">الدورات التدريبية المتاحة للتقديم</h3>
            {courses.filter((c) => c.status === 'مفتوح للتسجيل').length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">لا توجد دورات مفتوحة للتسجيل حالياً.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {courses
                  .filter((c) => c.status === 'مفتوح للتسجيل')
                  .map((c) => {
                    const alreadyApplied = myEnrollments.some(
                      (e) => e.courseId === c.id && e.status !== 'مرفوض'
                    );
                    return (
                      <div
                        key={c.id}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span dir="ltr" className="font-mono font-bold text-[#0B1F3A] dark:text-[#E5B94C]">
                              {c.code}
                            </span>
                            <span>{c.deliveryType}</span>
                          </div>
                          <h4 className="mt-1 font-extrabold text-sm text-slate-900 dark:text-white">{c.title}</h4>
                          <p className="text-slate-500 mt-1">{c.provider} · المدرب: {c.instructor}</p>
                          <p className="text-slate-500 mt-1">
                            <span dir="ltr" className="font-mono">{c.startDate} → {c.endDate}</span> · {c.location}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={alreadyApplied || submitting}
                          onClick={() => handleApplyCourse(c.id)}
                          className="w-full rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] py-2 font-bold text-white dark:text-slate-950 disabled:opacity-50 cursor-pointer"
                        >
                          {alreadyApplied ? 'تم التقديم مسبقاً' : 'تقديم فوري للدورة'}
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-extrabold mb-4">طلبات الدورات والشهادات المكتملة ({myEnrollments.length})</h3>
            {myEnrollments.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">لم تقم بالتقديم لأي دورة تدريبية بعد.</p>
            ) : (
              <div className="space-y-2.5 text-xs">
                {myEnrollments.map((enr) => {
                  const c = courseMap.get(enr.courseId);
                  return (
                    <div
                      key={enr.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{c?.title || `دورة #${enr.courseId}`}</p>
                        <p className="text-slate-500 mt-0.5">
                          الحالة: <strong>{enr.status}</strong> · الحضور: {enr.attendancePercent}%
                          {enr.rejectionReason ? ` · سبب الرفض: ${enr.rejectionReason}` : ''}
                        </p>
                      </div>
                      {enr.certificateDocumentId && (
                        <button
                          type="button"
                          onClick={() => onDownloadDocument(enr.certificateDocumentId!)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 font-bold text-emerald-800 dark:text-emerald-300 shrink-0 cursor-pointer"
                        >
                          <Award className="h-3.5 w-3.5" />
                          <span>تحميل شهادة الإتمام</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Self-Service Leave & Official Document Requests */}
      {activeTab === 'self_service' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Leave Request Form + History */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold">تقديم طلب إجازة جديد</h3>
              <span className="text-xs font-bold text-[#0B1F3A] dark:text-[#E5B94C] tabular-nums">
                اعتيادية: {employee.annualLeaveBalance} · مرضية: {employee.sickLeaveBalance}
              </span>
            </div>
            <form onSubmit={handleSubmitLeave} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">نوع الإجازة</label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                >
                  {config.orgCatalogs.leaveTypes.map((lt) => (
                    <option key={lt.name} value={lt.name}>
                      {lt.name} (الحد الأقصى {lt.maxDaysPerRequest} يوماً)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">من تاريخ</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.startDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">إلى تاريخ</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.endDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>
              <p className="text-[11px] font-semibold text-slate-500 tabular-nums">المدة المحتسبة: {leaveDays} يوم</p>
              <div>
                <label className="block font-bold mb-1">سبب الإجازة *</label>
                <textarea
                  rows={2}
                  required
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || leaveDays <= 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] py-2.5 font-bold text-white dark:text-slate-950 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>إرسال طلب الإجازة</span>
              </button>
            </form>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2 text-xs">
              <h4 className="font-bold">طلباتي السابقة ({myLeaves.length})</h4>
              {myLeaves.length === 0 ? (
                <p className="text-slate-400">لا توجد طلبات إجازة سابقة.</p>
              ) : (
                myLeaves.map((lv) => (
                  <div key={lv.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex justify-between gap-2">
                    <div>
                      <p className="font-bold">
                        {lv.leaveType} ({lv.days} أيام)
                      </p>
                      <p className="text-[11px] text-slate-500">
                        <span dir="ltr" className="font-mono">{lv.startDate} → {lv.endDate}</span>
                      </p>
                    </div>
                    <span className="font-bold text-[#0B1F3A] dark:text-[#E5B94C]">{lv.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Official HR Document Requests (Continuation of Service / Salary Certificate) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
            <h3 className="text-sm font-extrabold">طلب وثيقة رسمية من الموارد البشرية</h3>
            <form onSubmit={handleRequestDocument} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">نوع الوثيقة الرسمية</label>
                <select
                  value={docRequestForm.transactionType}
                  onChange={(e) => setDocRequestForm({ ...docRequestForm, transactionType: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                >
                  <option value="CONTINUATION_OF_SERVICE">تأييد استمرار بالخدمة</option>
                  <option value="SALARY_CERTIFICATE">شهادة راتب رسمية</option>
                  <option value="DOCUMENT_REQUEST">خلاصة خدمة / وثيقة إدارية</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">الجهة الموجه إليها الكتاب *</label>
                <input
                  required
                  placeholder="مثال: مصرف الرشيد — فرع البصرة / مديرية الجوازات"
                  value={docRequestForm.directedTo}
                  onChange={(e) => setDocRequestForm({ ...docRequestForm, directedTo: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">ملاحظات إضافية</label>
                <textarea
                  rows={2}
                  value={docRequestForm.notes}
                  onChange={(e) => setDocRequestForm({ ...docRequestForm, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] py-2.5 font-bold text-white dark:text-slate-950 cursor-pointer"
              >
                <FileCheck2 className="h-3.5 w-3.5" />
                <span>إرسال طلب الوثيقة الرسمية</span>
              </button>
            </form>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2 text-xs">
              <h4 className="font-bold">معاملاتي وطلباتي الرسمية ({myTransactions.length})</h4>
              {myTransactions.length === 0 ? (
                <p className="text-slate-400">لا توجد معاملات إدارية مسجلة بعد.</p>
              ) : (
                myTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-bold truncate">{tx.title}</p>
                      <p className="text-[11px] text-slate-500">
                        <span dir="ltr" className="font-mono">{tx.transactionNumber}</span> · <strong>{tx.status}</strong>
                      </p>
                    </div>
                    {(tx.status === 'معتمد' || tx.status === 'مكتمل') && (
                      <button
                        type="button"
                        onClick={() => onPreviewOfficial({ kind: 'transaction', record: tx, employee })}
                        className="rounded-lg border border-[#C69214] px-2.5 py-1 text-[11px] font-bold text-[#0B1F3A] dark:text-[#E5B94C] shrink-0 cursor-pointer"
                      >
                        طباعة QR
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
