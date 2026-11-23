import React, { useMemo, useState } from 'react';
import {
  Award,
  Calendar,
  Download,
  GraduationCap,
  Plus,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AppUser,
  EmployeeRecord,
  SystemConfigBundle,
  TrainingCourseRecord,
  TrainingEnrollmentRecord,
} from '../types/hrms';
import { hrmsApi } from '../lib/api';
import { hasPermission } from '../utils/permissions';
import { exportTrainingToExcel, formatIQD } from '../utils/exporters';

interface TrainingViewProps {
  user: AppUser;
  config: SystemConfigBundle;
  employees: EmployeeRecord[];
  courses: TrainingCourseRecord[];
  enrollments: TrainingEnrollmentRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const TrainingView: React.FC<TrainingViewProps> = ({
  user,
  config,
  employees,
  courses,
  enrollments,
  onRefresh,
  onNotify,
}) => {
  const [tab, setTab] = useState<'catalog' | 'enrollments'>('catalog');
  const [showCreateCourse, setShowCreateCourse] = useState(false);
  const [applyCourse, setApplyCourse] = useState<TrainingCourseRecord | null>(null);
  const [applyEmpId, setApplyEmpId] = useState('');
  const [evalModal, setEvalModal] = useState<TrainingEnrollmentRecord | null>(null);
  const [evalForm, setEvalForm] = useState({ attendancePercent: 100, evaluationScore: 90, evaluationNotes: '', markCompleted: true });
  const [submitting, setSubmitting] = useState(false);

  const [courseForm, setCourseForm] = useState({
    code: '',
    title: '',
    category: config.orgCatalogs.trainingCategories[0] || 'السلامة المهنية HSE',
    deliveryType: 'داخلي' as 'داخلي' | 'خارجي' | 'إلكتروني',
    provider: 'مركز التدريب والتطوير — شركة نفط البصرة',
    instructor: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    location: 'مركز تدريب البصرة',
    totalSeats: 25,
    budgetIQD: 0,
    trainingPlanYear: new Date().getFullYear(),
  });

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await hrmsApi.createCourse({
        ...courseForm,
        totalSeats: Number(courseForm.totalSeats),
        budgetIQD: Number(courseForm.budgetIQD),
        trainingPlanYear: Number(courseForm.trainingPlanYear),
      });
      setShowCreateCourse(false);
      onNotify('تمت إضافة الدورة التدريبية إلى خطة التدريب.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل إنشاء الدورة التدريبية.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (courseId: number, status: TrainingCourseRecord['status']) => {
    try {
      await hrmsApi.updateCourse(courseId, { status });
      onNotify(`تم تحديث حالة الدورة إلى «${status}».`, 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تحديث حالة الدورة.', 'error');
    }
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyCourse) return;
    const empId = Number(applyEmpId || user.employeeId || employees[0]?.id);
    if (!empId) {
      onNotify('يرجى تحديد المنتسب المرشح للدورة.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.applyToCourse(applyCourse.id, empId);
      setApplyCourse(null);
      onNotify('تم تقديم طلب الترشيح للدورة وربطه بمسار الموافقات بنجاح.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تقديم طلب الترشيح.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evalModal) return;
    setSubmitting(true);
    try {
      await hrmsApi.updateEnrollment(evalModal.id, {
        attendancePercent: Number(evalForm.attendancePercent),
        evaluationScore: Number(evalForm.evaluationScore),
        evaluationNotes: evalForm.evaluationNotes,
        markCompleted: evalForm.markCompleted,
      });
      setEvalModal(null);
      onNotify(
        evalForm.markCompleted
          ? 'تم إنجاز الدورة وأرشفة شهادة الإتمام تلقائياً في ملف المنتسب والخط الزمني.'
          : 'تم تحديث نسبة الحضور والتقييم.',
        'success'
      );
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل حفظ التقييم.', 'error');
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
            onClick={() => setTab('catalog')}
            className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'catalog'
                ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            دليل وخطط الدورات ({courses.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('enrollments')}
            className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'enrollments'
                ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            الترشيحات والحضور والشهادات ({enrollments.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={() => exportTrainingToExcel(courses, enrollments, employees)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>تصدير Excel</span>
            </button>
          )}
          {hasPermission(user.role, 'manage_training') && (
            <button
              type="button"
              onClick={() => setShowCreateCourse(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة دورة تدريبية</span>
            </button>
          )}
        </div>
      </div>

      {tab === 'catalog' ? (
        courses.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center space-y-2">
            <GraduationCap className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
            <p className="text-xs text-slate-500">لا توجد دورات تدريبية مسجلة في الخطة التدريبية بعد.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {courses.map((c) => {
              const enrolled = c.enrolledCount || 0;
              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span dir="ltr" className="font-mono font-bold text-[#0B1F3A] dark:text-[#E5B94C]">
                        {c.code}
                      </span>
                      <span className="font-semibold">
                        {c.deliveryType} · {c.status}
                      </span>
                    </div>
                    <h3 className="mt-1.5 text-sm font-extrabold text-slate-900 dark:text-white">{c.title}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {c.category} · {c.provider}
                    </p>
                    <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <p className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-[#C69214]" />
                        <span dir="ltr" className="font-mono tabular-nums">
                          {c.startDate} → {c.endDate}
                        </span>
                      </p>
                      <p>المدرب: {c.instructor} · الموقع: {c.location}</p>
                      <p className="tabular-nums">
                        المقاعد: {enrolled} / {c.totalSeats} · الميزانية: {formatIQD(c.budgetIQD)} · خطة {c.trainingPlanYear}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    {c.status === 'مفتوح للتسجيل' && user.role !== 'READ_ONLY' && (
                      <button
                        type="button"
                        onClick={() => {
                          setApplyCourse(c);
                          setApplyEmpId(String(user.employeeId || employees[0]?.id || ''));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3 py-1.5 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>ترشيح / تقديم</span>
                      </button>
                    )}

                    {hasPermission(user.role, 'manage_training') && (
                      <select
                        value={c.status}
                        onChange={(e) => handleStatusChange(c.id, e.target.value)}
                        aria-label="تغيير حالة الدورة"
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold"
                      >
                        <option value="مفتوح للتسجيل">مفتوح للتسجيل</option>
                        <option value="جاري الانعقاد">جاري الانعقاد</option>
                        <option value="مكتمل">مكتمل</option>
                        <option value="مؤجل">مؤجل</option>
                        <option value="ملغى">ملغى</option>
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-bold">المنتسب</th>
                  <th className="px-4 py-3 font-bold">الدورة التدريبية</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                  <th className="px-4 py-3 font-bold">الحضور / التقييم</th>
                  <th className="px-4 py-3 font-bold">إدارة الإنجاز والشهادة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {enrollments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      لا توجد ترشيحات تدريبية بعد.
                    </td>
                  </tr>
                ) : (
                  enrollments.map((enr) => {
                    const emp = empMap.get(enr.employeeId);
                    const c = courseMap.get(enr.courseId);
                    return (
                      <tr key={enr.id}>
                        <td className="px-4 py-3 font-bold">{emp?.fullName || `#${enr.employeeId}`}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{c?.title || `#${enr.courseId}`}</p>
                          <p dir="ltr" className="font-mono text-[11px] text-slate-400">{c?.code}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">{enr.status}</td>
                        <td className="px-4 py-3 tabular-nums">
                          الحضور: {enr.attendancePercent}%{' '}
                          {enr.evaluationScore !== null && enr.evaluationScore !== undefined
                            ? `· التقييم: ${enr.evaluationScore}/100`
                            : ''}
                        </td>
                        <td className="px-4 py-3">
                          {hasPermission(user.role, 'manage_training') && (
                            <button
                              type="button"
                              onClick={() => {
                                setEvalModal(enr);
                                setEvalForm({
                                  attendancePercent: enr.attendancePercent || 100,
                                  evaluationScore: enr.evaluationScore ?? 90,
                                  evaluationNotes: enr.evaluationNotes || '',
                                  markCompleted: enr.status !== 'مكتمل',
                                });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Award className="h-3.5 w-3.5 text-[#C69214]" />
                              <span>تقييم وإصدار شهادة</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Course Modal */}
      {showCreateCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <h3 className="text-base font-extrabold">إضافة دورة تدريبية جديدة</h3>
              <button type="button" onClick={() => setShowCreateCourse(false)} className="p-1 text-slate-400 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCourse} className="flex-1 overflow-y-auto p-6 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">رمز الدورة *</label>
                  <input
                    required
                    dir="ltr"
                    placeholder="TRN-HSE-2026"
                    value={courseForm.code}
                    onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">التصنيف *</label>
                  <select
                    value={courseForm.category}
                    onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    {config.orgCatalogs.trainingCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">عنوان الدورة *</label>
                  <input
                    required
                    value={courseForm.title}
                    onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">نوع التنفيذ *</label>
                  <select
                    value={courseForm.deliveryType}
                    onChange={(e) => setCourseForm({ ...courseForm, deliveryType: e.target.value as 'داخلي' | 'خارجي' | 'إلكتروني' })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    <option value="داخلي">داخلي</option>
                    <option value="خارجي">خارجي</option>
                    <option value="إلكتروني">إلكتروني</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">الجهة المنفذة *</label>
                  <input
                    required
                    value={courseForm.provider}
                    onChange={(e) => setCourseForm({ ...courseForm, provider: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">اسم المدرب *</label>
                  <input
                    required
                    value={courseForm.instructor}
                    onChange={(e) => setCourseForm({ ...courseForm, instructor: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">الموقع *</label>
                  <input
                    required
                    value={courseForm.location}
                    onChange={(e) => setCourseForm({ ...courseForm, location: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ البدء *</label>
                  <input
                    type="date"
                    required
                    value={courseForm.startDate}
                    onChange={(e) => setCourseForm({ ...courseForm, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ الانتهاء *</label>
                  <input
                    type="date"
                    required
                    value={courseForm.endDate}
                    onChange={(e) => setCourseForm({ ...courseForm, endDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">عدد المقاعد *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={courseForm.totalSeats}
                    onChange={(e) => setCourseForm({ ...courseForm, totalSeats: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">الميزانية التقديرية (د.ع)</label>
                  <input
                    type="number"
                    min={0}
                    value={courseForm.budgetIQD}
                    onChange={(e) => setCourseForm({ ...courseForm, budgetIQD: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateCourse(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  حفظ الدورة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Apply to Course Modal */}
      {applyCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-sm font-extrabold mb-3">ترشيح منتسب لدورة: {applyCourse.title}</h3>
            <form onSubmit={handleApply} className="space-y-4 text-xs">
              <select
                required
                value={applyEmpId}
                onChange={(e) => setApplyEmpId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
              >
                <option value="">اختر المنتسب...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeCode})
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApplyCourse(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-4 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  إرسال الترشيح
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attendance & Evaluation Modal */}
      {evalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-sm font-extrabold mb-4">تقييم التدريب وأرشفة الشهادة</h3>
            <form onSubmit={handleSaveEvaluation} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">نسبة الحضور (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={evalForm.attendancePercent}
                    onChange={(e) => setEvalForm({ ...evalForm, attendancePercent: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">درجة التقييم (/100)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={evalForm.evaluationScore}
                    onChange={(e) => setEvalForm({ ...evalForm, evaluationScore: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">ملاحظات المدرب / التقييم</label>
                <textarea
                  rows={2}
                  value={evalForm.evaluationNotes}
                  onChange={(e) => setEvalForm({ ...evalForm, evaluationNotes: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={evalForm.markCompleted}
                  onChange={(e) => setEvalForm({ ...evalForm, markCompleted: e.target.checked })}
                />
                <span>إنجاز الدورة وأرشفة الشهادة تلقائياً في ملف المنتسب</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEvalModal(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-4 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  حفظ التقييم
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
