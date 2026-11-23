import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Briefcase,
  CalendarDays,
  Clock,
  Download,
  Edit3,
  FileText,
  GraduationCap,
  Plus,
  Search,
  Trash2,
  UserCheck,
  Workflow,
  X,
} from 'lucide-react';
import type {
  AppreciationRecord,
  AppUser,
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
import { hrmsApi } from '../lib/api';
import { calculateEmployeeProgression } from '../utils/hrEngine';
import { exportEmployeesToExcel, formatIQD } from '../utils/exporters';
import { hasPermission } from '../utils/permissions';

interface EmployeesViewProps {
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
  selectedEmployeeId: number | null;
  openCreateModalSignal: number;
  onSelectEmployee: (id: number | null) => void;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onDownloadDocument: (docId: number) => void;
}

type ProfileTab =
  | 'overview'
  | 'timeline'
  | 'progression'
  | 'appreciations'
  | 'training'
  | 'leaves'
  | 'transactions'
  | 'documents';

const EMPTY_FORM = {
  employeeCode: '',
  nationalId: '',
  fullName: '',
  fullNameEn: '',
  birthDate: '',
  gender: 'ذكر',
  jobTitle: '',
  jobTitleEn: '',
  department: '',
  oilfield: '',
  section: '',
  grade: 6,
  step: 1,
  hireDate: new Date().toISOString().slice(0, 10),
  lastPromotionDate: new Date().toISOString().slice(0, 10),
  lastIncrementDate: new Date().toISOString().slice(0, 10),
  academicDegree: 'بكالوريوس',
  specialization: '',
  email: '',
  phone: '',
  basicSalaryIQD: 600000,
  annualLeaveBalance: 30,
  sickLeaveBalance: 30,
  status: 'نشط',
  notes: '',
  provisionAccount: true,
  initialPassword: '',
  accountRole: 'EMPLOYEE' as 'EMPLOYEE' | 'DEPT_MANAGER' | 'HR_MANAGER' | 'SECTION_MANAGER',
};

export const EmployeesView: React.FC<EmployeesViewProps> = ({
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
  selectedEmployeeId,
  openCreateModalSignal,
  onSelectEmployee,
  onRefresh,
  onNotify,
  onDownloadDocument,
}) => {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [fieldFilter, setFieldFilter] = useState('ALL');
  const [gradeFilter, setGradeFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [timeline, setTimeline] = useState<CareerEventRecord[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [newEvent, setNewEvent] = useState({
    eventType: 'تنسيب / نقل',
    title: '',
    description: '',
    eventDate: new Date().toISOString().slice(0, 10),
    referenceNumber: '',
  });

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (openCreateModalSignal > 0 && hasPermission(user.role, 'create_employee')) {
      setEditingEmployee(null);
      setForm({
        ...EMPTY_FORM,
        department: config.orgCatalogs.departments[0] || '',
        oilfield: config.orgCatalogs.oilfields[0] || '',
        section: config.orgCatalogs.sections[0] || '',
        jobTitle: config.orgCatalogs.jobTitles[0] || '',
        academicDegree: config.orgCatalogs.academicDegrees[0] || 'بكالوريوس',
      });
      setShowFormModal(true);
    }
  }, [openCreateModalSignal, user.role, config.orgCatalogs]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) || employees[0] || null,
    [employees, selectedEmployeeId]
  );

  useEffect(() => {
    if (!selectedEmployee) {
      setTimeline([]);
      return;
    }
    let cancelled = false;
    setTimelineLoading(true);
    hrmsApi
      .getEmployeeTimeline(selectedEmployee.id)
      .then((evts) => {
        if (!cancelled) setTimeline(evts);
      })
      .catch(() => {
        if (!cancelled) setTimeline([]);
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEmployee?.id]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (deptFilter !== 'ALL' && e.department !== deptFilter) return false;
      if (fieldFilter !== 'ALL' && e.oilfield !== fieldFilter) return false;
      if (gradeFilter !== 'ALL' && String(e.grade) !== gradeFilter) return false;
      if (q) {
        return (
          e.fullName.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.jobTitle.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employees, search, deptFilter, fieldFilter, gradeFilter]);

  const openCreate = () => {
    setEditingEmployee(null);
    setForm({
      ...EMPTY_FORM,
      department: config.orgCatalogs.departments[0] || '',
      oilfield: config.orgCatalogs.oilfields[0] || '',
      section: config.orgCatalogs.sections[0] || '',
      jobTitle: config.orgCatalogs.jobTitles[0] || '',
      academicDegree: config.orgCatalogs.academicDegrees[0] || 'بكالوريوس',
    });
    setShowFormModal(true);
  };

  const openEdit = (emp: EmployeeRecord) => {
    setEditingEmployee(emp);
    setForm({
      employeeCode: emp.employeeCode,
      nationalId: emp.nationalId || '',
      fullName: emp.fullName,
      fullNameEn: emp.fullNameEn || '',
      birthDate: emp.birthDate || '',
      gender: emp.gender || 'ذكر',
      jobTitle: emp.jobTitle,
      jobTitleEn: emp.jobTitleEn || '',
      department: emp.department,
      oilfield: emp.oilfield,
      section: emp.section || '',
      grade: emp.grade,
      step: emp.step,
      hireDate: emp.hireDate,
      lastPromotionDate: emp.lastPromotionDate,
      lastIncrementDate: emp.lastIncrementDate,
      academicDegree: emp.academicDegree,
      specialization: emp.specialization || '',
      email: emp.email || '',
      phone: emp.phone || '',
      basicSalaryIQD: emp.basicSalaryIQD,
      annualLeaveBalance: emp.annualLeaveBalance,
      sickLeaveBalance: emp.sickLeaveBalance,
      status: emp.status,
      notes: emp.notes || '',
      provisionAccount: false,
      initialPassword: '',
      accountRole: 'EMPLOYEE',
    });
    setShowFormModal(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingEmployee) {
        await hrmsApi.updateEmployee(editingEmployee.id, form);
        onNotify('تم تحديث الملف الوظيفي بنجاح.', 'success');
      } else {
        const created = await hrmsApi.createEmployee(form);
        onSelectEmployee(created.id);
        onNotify(`تم تسجيل المنتسب ${created.fullName} بنجاح.`, 'success');
      }
      setShowFormModal(false);
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل حفظ السجل الوظيفي.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    setSubmitting(true);
    try {
      await hrmsApi.deleteEmployee(confirmDeleteId);
      setConfirmDeleteId(null);
      onSelectEmployee(null);
      onNotify('تمت أرشفة السجل الوظيفي وحذفه بشكل ناعم مع الاحتفاظ بسجل التدقيق.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل أرشفة السجل.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCareerEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !newEvent.title.trim()) return;
    setSubmitting(true);
    try {
      const created = await hrmsApi.addCareerEvent(selectedEmployee.id, newEvent);
      setTimeline((prev) => [created, ...prev]);
      setNewEvent({
        eventType: 'تنسيب / نقل',
        title: '',
        description: '',
        eventDate: new Date().toISOString().slice(0, 10),
        referenceNumber: '',
      });
      onNotify('تمت إضافة الحدث إلى الخط الزمني للمسار الوظيفي.', 'success');
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل إضافة الحدث الوظيفي.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const empProgression = useMemo(() => {
    if (!selectedEmployee) return null;
    return calculateEmployeeProgression(selectedEmployee, appreciations, penalties, todayISO, config.hrRules);
  }, [selectedEmployee, appreciations, penalties, todayISO, config.hrRules]);

  const empAppreciations = useMemo(
    () => (selectedEmployee ? appreciations.filter((a) => a.employeeId === selectedEmployee.id) : []),
    [selectedEmployee, appreciations]
  );
  const empPenalties = useMemo(
    () => (selectedEmployee ? penalties.filter((p) => p.employeeId === selectedEmployee.id) : []),
    [selectedEmployee, penalties]
  );
  const empDocs = useMemo(
    () => (selectedEmployee ? documents.filter((d) => d.employeeId === selectedEmployee.id) : []),
    [selectedEmployee, documents]
  );
  const empTxns = useMemo(
    () => (selectedEmployee ? transactions.filter((t) => t.employeeId === selectedEmployee.id) : []),
    [selectedEmployee, transactions]
  );
  const empEnrollments = useMemo(
    () => (selectedEmployee ? enrollments.filter((e) => e.employeeId === selectedEmployee.id) : []),
    [selectedEmployee, enrollments]
  );
  const empLeaves = useMemo(
    () => (selectedEmployee ? leaveRequests.filter((l) => l.employeeId === selectedEmployee.id) : []),
    [selectedEmployee, leaveRequests]
  );
  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[210px]">
            <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم، الرقم الوظيفي، العنوان..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 ps-9 pe-3 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="ALL">كل الأقسام</option>
            {config.orgCatalogs.departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="ALL">كل الحقول</option>
            {config.orgCatalogs.oilfields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="ALL">كل الدرجات</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((g) => (
              <option key={g} value={String(g)}>
                الدرجة {g}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasPermission(user.role, 'export_reports') && (
            <button
              type="button"
              onClick={() => exportEmployeesToExcel(filteredEmployees)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>تصدير Excel</span>
            </button>
          )}
          {hasPermission(user.role, 'create_employee') && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 hover:opacity-90 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>إضافة منتسب</span>
            </button>
          )}
        </div>
      </div>

      {/* Master-Detail Enterprise Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Directory List */}
        <div className="xl:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col max-h-[760px]">
          <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">دليل المنتسبين</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {filteredEmployees.length} سجل
            </span>
          </div>

          {filteredEmployees.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <UserCheck className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto" aria-hidden="true" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                لا توجد سجلات منتسبين مطابقة حالياً.
              </p>
              {hasPermission(user.role, 'create_employee') && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>تسجيل أول منتسب</span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto">
              {filteredEmployees.map((emp) => {
                const isSelected = selectedEmployee?.id === emp.id;
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => onSelectEmployee(emp.id)}
                    className={`w-full text-right px-4 py-3.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#0B1F3A]/5 dark:bg-[#C69214]/15 border-s-2 border-[#C69214]'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{emp.fullName}</span>
                      <span dir="ltr" className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {emp.employeeCode}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 truncate">
                      {emp.jobTitle} · {emp.department}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>{emp.oilfield}</span>
                      <span className="tabular-nums">
                        د{emp.grade} / م{emp.step} · {emp.status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Comprehensive Digital Profile */}
        <div className="xl:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          {!selectedEmployee ? (
            <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">
              اختر منتسباً من الدليل لعرض ملفه الوظيفي الرقمي الكامل أو أضف سجلاً جديداً.
            </div>
          ) : (
            <div>
              {/* Profile Header */}
              <div className="border-b border-slate-200 dark:border-slate-800 p-5 bg-slate-50/70 dark:bg-slate-800/30">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                        {selectedEmployee.fullName}
                      </h2>
                      <span dir="ltr" className="font-mono text-xs font-bold text-[#0B1F3A] dark:text-[#E5B94C]">
                        {selectedEmployee.employeeCode}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      {selectedEmployee.jobTitle} · {selectedEmployee.department} · {selectedEmployee.oilfield}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                      الدرجة {selectedEmployee.grade} / المرحلة {selectedEmployee.step} · المؤهل:{' '}
                      {selectedEmployee.academicDegree} · الحالة: {selectedEmployee.status}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {hasPermission(user.role, 'edit_employee') && (
                      <button
                        type="button"
                        onClick={() => openEdit(selectedEmployee)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>تعديل الملف</span>
                      </button>
                    )}
                    {hasPermission(user.role, 'delete_employee') && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(selectedEmployee.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>أرشفة</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Organized Profile Tabs */}
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-200 dark:border-slate-700 pt-3">
                  {[
                    { id: 'overview', label: 'البيانات الوظيفية', icon: Briefcase },
                    { id: 'timeline', label: 'الخط الزمني', icon: Clock },
                    { id: 'progression', label: 'الترفيع والعلاوة', icon: Award },
                    { id: 'appreciations', label: `الشكر والعقوبات (${empAppreciations.length + empPenalties.length})`, icon: Award },
                    { id: 'training', label: `التدريب (${empEnrollments.length})`, icon: GraduationCap },
                    { id: 'leaves', label: `الإجازات (${empLeaves.length})`, icon: CalendarDays },
                    { id: 'transactions', label: `المعاملات (${empTxns.length})`, icon: Workflow },
                    { id: 'documents', label: `الوثائق (${empDocs.length})`, icon: FileText },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as ProfileTab)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        activeTab === tab.id
                          ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Content */}
              <div className="p-5">
                {activeTab === 'overview' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                      {[
                        { k: 'الاسم بالإنجليزية', v: selectedEmployee.fullNameEn || '—' },
                        { k: 'رقم البطاقة الوطنية', v: selectedEmployee.nationalId || '—', ltr: true },
                        { k: 'تاريخ الميلاد', v: selectedEmployee.birthDate || '—', ltr: true },
                        { k: 'الشعبة', v: selectedEmployee.section || '—' },
                        { k: 'التخصص الأكاديمي', v: selectedEmployee.specialization || '—' },
                        { k: 'تاريخ التعيين', v: selectedEmployee.hireDate, ltr: true },
                        { k: 'آخر ترفيع', v: selectedEmployee.lastPromotionDate, ltr: true },
                        { k: 'آخر علاوة', v: selectedEmployee.lastIncrementDate, ltr: true },
                        { k: 'الراتب الاسمي', v: formatIQD(selectedEmployee.basicSalaryIQD) },
                        { k: 'رصيد الاعتيادية', v: `${selectedEmployee.annualLeaveBalance} يوماً` },
                        { k: 'رصيد المرضية', v: `${selectedEmployee.sickLeaveBalance} يوماً` },
                        { k: 'البريد والهاتف', v: `${selectedEmployee.email || '—'} · ${selectedEmployee.phone || '—'}` },
                      ].map((row) => (
                        <div
                          key={row.k}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-800/30"
                        >
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{row.k}</p>
                          <p className="mt-1 font-bold text-slate-900 dark:text-white tabular-nums">
                            {row.ltr ? (
                              <span dir="ltr" className="inline-block font-mono">
                                {row.v}
                              </span>
                            ) : (
                              row.v
                            )}
                          </p>
                        </div>
                      ))}
                    </div>

                    {selectedEmployee.notes && (
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-xs">
                        <p className="font-bold text-slate-800 dark:text-slate-200 mb-1">ملاحظات الموارد البشرية الداخلية</p>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{selectedEmployee.notes}</p>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'timeline' && (
                  <div className="space-y-4">
                    {hasPermission(user.role, 'edit_employee') && (
                      <form
                        onSubmit={handleAddCareerEvent}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
                      >
                        <input
                          type="text"
                          required
                          placeholder="نوع الحدث (نقل / تكليف / شهادة...)"
                          value={newEvent.eventType}
                          onChange={(e) => setNewEvent({ ...newEvent, eventType: e.target.value })}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                        />
                        <input
                          type="text"
                          required
                          placeholder="عنوان الحدث الوظيفي"
                          value={newEvent.title}
                          onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                        />
                        <input
                          type="date"
                          required
                          value={newEvent.eventDate}
                          onChange={(e) => setNewEvent({ ...newEvent, eventDate: e.target.value })}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                        />
                        <button
                          type="submit"
                          disabled={submitting}
                          className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3 py-2 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
                        >
                          إضافة للخط الزمني
                        </button>
                      </form>
                    )}

                    {timelineLoading ? (
                      <p className="text-xs text-slate-400 py-6 text-center">جاري تحميل الخط الزمني...</p>
                    ) : timeline.length === 0 ? (
                      <p className="text-xs text-slate-400 py-6 text-center">لا توجد أحداث وظيفية مسجلة.</p>
                    ) : (
                      <div className="space-y-3">
                        {timeline.map((ev) => (
                          <div
                            key={ev.id}
                            className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 flex items-start justify-between gap-4"
                          >
                            <div>
                              <p className="text-xs font-bold text-slate-900 dark:text-white">
                                {ev.eventType} — {ev.title}
                              </p>
                              {ev.description && (
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{ev.description}</p>
                              )}
                              <p className="text-[11px] text-slate-400 mt-1">
                                بواسطة: {ev.createdBy} {ev.referenceNumber ? `· مرجع: ${ev.referenceNumber}` : ''}
                              </p>
                            </div>
                            <span dir="ltr" className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
                              {ev.eventDate}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'progression' && empProgression && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                        <p className="text-slate-500 dark:text-slate-400">استحقاق العلاوة الفعلي</p>
                        <p dir="ltr" className="mt-1 font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                          {empProgression.effectiveIncrementDate}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                        <p className="text-slate-500 dark:text-slate-400">استحقاق الترفيع الفعلي</p>
                        <p dir="ltr" className="mt-1 font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                          {empProgression.gradeYearsRequired > 0 ? empProgression.effectivePromotionDate : 'الدرجة الأولى'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                        <p className="text-slate-500 dark:text-slate-400">صافي التعديل (قِدَم - عقوبة)</p>
                        <p className="mt-1 font-bold text-slate-900 dark:text-white tabular-nums">
                          {empProgression.netAdjustmentMonths > 0
                            ? `+${empProgression.netAdjustmentMonths} شهر`
                            : `${empProgression.netAdjustmentMonths} شهر`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                        <p className="text-slate-500 dark:text-slate-400">التقاعد المتوقع</p>
                        <p dir="ltr" className="mt-1 font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                          {empProgression.retirementDate || 'غير محدد'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        تفصيل خطوات الاحتساب الشفافة (وفق إعدادات النظام)
                      </h4>
                      <ul className="list-disc ps-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                        {empProgression.explanationSteps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {activeTab === 'appreciations' && (
                  <div className="space-y-4 text-xs">
                    <h4 className="font-bold text-slate-900 dark:text-white">كتب الشكر والتقدير ({empAppreciations.length})</h4>
                    {empAppreciations.length === 0 ? (
                      <p className="text-slate-400">لا توجد كتب شكر مسجلة.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                        {empAppreciations.map((a) => (
                          <div key={a.id} className="p-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="font-bold text-slate-900 dark:text-white">
                                {a.issuingAuthority} — {a.subject}
                              </p>
                              <p className="text-slate-500 mt-0.5">
                                العدد: <span dir="ltr" className="font-mono">{a.letterNumber}</span> · قِدَم: +{a.seniorityMonths} شهر
                              </p>
                            </div>
                            <span dir="ltr" className="font-mono text-slate-500 tabular-nums">{a.issueDate}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <h4 className="font-bold text-slate-900 dark:text-white pt-2">العقوبات الإدارية ({empPenalties.length})</h4>
                    {empPenalties.length === 0 ? (
                      <p className="text-slate-400">لا توجد عقوبات إدارية مسجلة.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                        {empPenalties.map((p) => (
                          <div key={p.id} className="p-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="font-bold text-red-700 dark:text-red-400">
                                {p.penaltyType} (تأخير {p.delayMonths} شهر)
                              </p>
                              <p className="text-slate-500 mt-0.5">
                                الأمر: <span dir="ltr" className="font-mono">{p.orderNumber}</span> · {p.reason}
                              </p>
                            </div>
                            <span dir="ltr" className="font-mono text-slate-500 tabular-nums">{p.issueDate}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'training' && (
                  <div className="text-xs space-y-2">
                    {empEnrollments.length === 0 ? (
                      <p className="text-slate-400 py-6 text-center">لا توجد مشاركات تدريبية لهذا المنتسب.</p>
                    ) : (
                      empEnrollments.map((enr) => {
                        const c = courseMap.get(enr.courseId);
                        return (
                          <div
                            key={enr.id}
                            className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-3"
                          >
                            <div>
                              <p className="font-bold text-slate-900 dark:text-white">{c?.title || `دورة #${enr.courseId}`}</p>
                              <p className="text-slate-500 mt-0.5">
                                الحالة: {enr.status} · الحضور: {enr.attendancePercent}%{' '}
                                {enr.evaluationScore !== null && enr.evaluationScore !== undefined
                                  ? `· التقييم: ${enr.evaluationScore}/100`
                                  : ''}
                              </p>
                            </div>
                            <span dir="ltr" className="font-mono text-slate-500">{enr.appliedDate}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {activeTab === 'leaves' && (
                  <div className="text-xs space-y-2">
                    {empLeaves.length === 0 ? (
                      <p className="text-slate-400 py-6 text-center">لا توجد طلبات إجازة مسجلة لهذا المنتسب.</p>
                    ) : (
                      empLeaves.map((lv) => (
                        <div
                          key={lv.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">
                              {lv.leaveType} ({lv.days} أيام)
                            </p>
                            <p className="text-slate-500 mt-0.5">{lv.reason} · الحالة: {lv.status}</p>
                          </div>
                          <span dir="ltr" className="font-mono text-slate-500 tabular-nums">
                            {lv.startDate} → {lv.endDate}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'transactions' && (
                  <div className="text-xs space-y-2">
                    {empTxns.length === 0 ? (
                      <p className="text-slate-400 py-6 text-center">لا توجد معاملات إدارية مسجلة.</p>
                    ) : (
                      empTxns.map((t) => (
                        <div
                          key={t.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">{t.title}</p>
                            <p className="text-slate-500 mt-0.5">
                              رقم المعاملة: <span dir="ltr" className="font-mono">{t.transactionNumber}</span> · الحالة:{' '}
                              <strong>{t.status}</strong>
                            </p>
                          </div>
                          <span dir="ltr" className="font-mono text-slate-500">{t.createdAt.slice(0, 10)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'documents' && (
                  <div className="text-xs space-y-2">
                    {empDocs.length === 0 ? (
                      <p className="text-slate-400 py-6 text-center">لا توجد وثائق مؤرشفة مرتبطة بهذا المنتسب.</p>
                    ) : (
                      empDocs.map((d) => (
                        <div
                          key={d.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">{d.title}</p>
                            <p className="text-slate-500 mt-0.5">
                              {d.category} · <span dir="ltr" className="font-mono">{d.documentNumber}</span> ·{' '}
                              <span dir="ltr" className="font-mono">{d.issueDate}</span>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onDownloadDocument(d.id)}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold text-[#0B1F3A] dark:text-[#E5B94C] hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            معاينة / تحميل
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Employee Modal */}
      {showFormModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                {editingEmployee ? `تعديل بيانات: ${editingEmployee.fullName}` : 'تسجيل منتسب جديد في قاعدة البيانات'}
              </h3>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block font-semibold mb-1">الرقم الوظيفي *</label>
                  <input
                    required
                    dir="ltr"
                    placeholder="BOC-1001"
                    value={form.employeeCode}
                    onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">الاسم الرباعي الكامل (عربي) *</label>
                  <input
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">رقم البطاقة الوطنية</label>
                  <input
                    dir="ltr"
                    value={form.nationalId}
                    onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ الميلاد (لاحتساب التقاعد)</label>
                  <input
                    type="date"
                    value={form.birthDate}
                    onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">العنوان الوظيفي *</label>
                  <input
                    required
                    list="boc-job-titles"
                    value={form.jobTitle}
                    onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                  <datalist id="boc-job-titles">
                    {config.orgCatalogs.jobTitles.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-semibold mb-1">القسم / الهيئة *</label>
                  <select
                    required
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    {config.orgCatalogs.departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">الحقل النفطي / الموقع *</label>
                  <select
                    required
                    value={form.oilfield}
                    onChange={(e) => setForm({ ...form, oilfield: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    {config.orgCatalogs.oilfields.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">الشعبة</label>
                  <input
                    list="boc-sections"
                    value={form.section}
                    onChange={(e) => setForm({ ...form, section: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                  <datalist id="boc-sections">
                    {config.orgCatalogs.sections.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-semibold mb-1">الدرجة الوظيفية (1-10) *</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    required
                    value={form.grade}
                    onChange={(e) => setForm({ ...form, grade: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">المرحلة (1-11) *</label>
                  <input
                    type="number"
                    min={1}
                    max={11}
                    required
                    value={form.step}
                    onChange={(e) => setForm({ ...form, step: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">التحصيل الدراسي *</label>
                  <select
                    required
                    value={form.academicDegree}
                    onChange={(e) => setForm({ ...form, academicDegree: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    {config.orgCatalogs.academicDegrees.map((deg) => (
                      <option key={deg} value={deg}>
                        {deg}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ التعيين *</label>
                  <input
                    type="date"
                    required
                    value={form.hireDate}
                    onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ آخر ترفيع *</label>
                  <input
                    type="date"
                    required
                    value={form.lastPromotionDate}
                    onChange={(e) => setForm({ ...form, lastPromotionDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">تاريخ آخر علاوة *</label>
                  <input
                    type="date"
                    required
                    value={form.lastIncrementDate}
                    onChange={(e) => setForm({ ...form, lastIncrementDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">الراتب الاسمي (د.ع)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.basicSalaryIQD}
                    onChange={(e) => setForm({ ...form, basicSalaryIQD: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">رصيد الاعتيادية (أيام)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.annualLeaveBalance}
                    onChange={(e) => setForm({ ...form, annualLeaveBalance: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">الحالة الوظيفية</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  >
                    <option value="نشط">نشط</option>
                    <option value="إجازة طويلة">إجازة طويلة</option>
                    <option value="منقول">منقول</option>
                    <option value="متقاعد">متقاعد</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    dir="ltr"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">رقم الهاتف</label>
                  <input
                    dir="ltr"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">التخصص الدقيق</label>
                  <input
                    value={form.specialization}
                    onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">ملاحظات الموارد البشرية</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>

              {!editingEmployee && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-3">
                  <label className="flex items-center gap-2 font-bold text-slate-900 dark:text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.provisionAccount}
                      onChange={(e) => setForm({ ...form, provisionAccount: e.target.checked })}
                    />
                    <span>تفعيل حساب دخول للبوابة بالرقم الوظيفي + كلمة مرور أولية (إلزام التغيير عبر البريد)</span>
                  </label>
                  {form.provisionAccount && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold mb-1">كلمة المرور الأولية (8+ أحرف) *</label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          placeholder="تُسلّم للمنتسب للدخول الأول فقط"
                          value={form.initialPassword}
                          onChange={(e) => setForm({ ...form, initialPassword: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold mb-1">صلاحية الحساب (Role)</label>
                        <select
                          value={form.accountRole}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              accountRole: e.target.value as 'EMPLOYEE' | 'DEPT_MANAGER' | 'HR_MANAGER' | 'SECTION_MANAGER',
                            })
                          }
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                        >
                          <option value="EMPLOYEE">موظف (بوابة الخدمة الذاتية)</option>
                          <option value="SECTION_MANAGER">مدير شعبة</option>
                          <option value="DEPT_MANAGER">مدير قسم / هيئة</option>
                          <option value="HR_MANAGER">منتسب / مدير الموارد البشرية</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2 font-bold text-white dark:text-slate-950 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'جاري الحفظ...' : editingEmployee ? 'حفظ التعديلات' : 'حفظ المنتسب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Soft-Delete Confirmation Dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">تأكيد أرشفة السجل الوظيفي</h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              سيتم تنفيذ حذف ناعم (Soft Delete) لإخفاء السجل من القوائم النشطة مع الإبقاء الكامل على تاريخ المعاملات
              وسجل التدقيق والوثائق في قاعدة البيانات. هل ترغب بالمتابعة؟
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
              >
                تأكيد الأرشفة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
