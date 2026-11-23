import React, { useState } from 'react';
import {
  Database,
  Download,
  Save,
  Settings,
  Shield,
  Upload,
  Users,
  Workflow,
} from 'lucide-react';
import type {
  AppUser,
  BackupSnapshotRecord,
  EmployeeRecord,
  HRRulesConfig,
  OrgCatalogsConfig,
  SystemConfigBundle,
  UserRole,
  WorkflowConfigItem,
} from '../types/hrms';
import { hrmsApi } from '../lib/api';
import { ROLE_LABELS_AR } from '../utils/permissions';

interface AdminSettingsViewProps {
  currentUser: AppUser;
  config: SystemConfigBundle;
  users: AppUser[];
  employees: EmployeeRecord[];
  backups: BackupSnapshotRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const ALL_ROLES: UserRole[] = [
  'HR_ADMIN',
  'HR_MANAGER',
  'DEPT_MANAGER',
  'SECTION_MANAGER',
  'EMPLOYEE',
  'READ_ONLY',
];

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  currentUser,
  config,
  users,
  employees,
  backups,
  onRefresh,
  onNotify,
}) => {
  const [tab, setTab] = useState<'users' | 'rules' | 'org' | 'backups'>('users');
  const [saving, setSaving] = useState(false);

  const [rulesDraft, setRulesDraft] = useState<HRRulesConfig>(config.hrRules);
  const [orgDraft, setOrgDraft] = useState<OrgCatalogsConfig>(config.orgCatalogs);
  const [workflowsDraft, setWorkflowsDraft] = useState<WorkflowConfigItem[]>(config.workflows);
  const [backupNotes, setBackupNotes] = useState('');

  const handleUpdateUser = async (
    u: AppUser,
    patch: {
      role?: UserRole;
      department?: string;
      section?: string;
      oilfield?: string;
      employeeId?: number | null;
      isActive?: boolean;
    }
  ) => {
    try {
      await hrmsApi.updateUser(u.id, patch);
      onNotify(`تم تحديث صلاحيات المستخدم ${u.email} بنجاح.`, 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل تحديث المستخدم.', 'error');
    }
  };

  const handleSaveRules = async () => {
    setSaving(true);
    try {
      await hrmsApi.saveSettings({ hrRules: rulesDraft });
      onNotify('تم حفظ قواعد الترفيعات والعلاوات والعقوبات والتقاعد في قاعدة البيانات.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل حفظ القواعد.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOrgAndWorkflows = async () => {
    setSaving(true);
    try {
      await hrmsApi.saveSettings({ orgCatalogs: orgDraft, workflows: workflowsDraft });
      onNotify('تم حفظ الهيكل التنظيمي وأنواع الإجازات وإعدادات سير العمل.', 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل حفظ إعدادات الهيكل التنظيمي.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExportBackup = async (backupType: 'DATABASE' | 'DOCUMENTS' | 'FULL') => {
    setSaving(true);
    try {
      const { snapshot, bundle } = await hrmsApi.exportBackup(backupType, backupNotes);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BOC_HRMS_${backupType}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupNotes('');
      onNotify(
        `تم إنشاء وتنزيل نسخة احتياطية موثقة (${backupType}) — ${snapshot.recordCount} سجل · SHA-256: ${snapshot.checksum.slice(0, 12)}`,
        'success'
      );
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل إنشاء النسخة الاحتياطية.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = await hrmsApi.restoreBackup(parsed);
      onNotify(`تم التحقق من سلامة النسخة الاحتياطية واستعادة ${result.restoredCount} عنصر بنجاح.`, 'success');
      await onRefresh();
    } catch (err: unknown) {
      onNotify((err as Error).message || 'فشل استعادة النسخة الاحتياطية أو فشل التحقق من Checksum.', 'error');
    } finally {
      setSaving(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        {[
          { id: 'users', label: 'المستخدمون والصلاحيات (RBAC)', icon: Users },
          { id: 'rules', label: 'قواعد الترفيع والعلاوة والتقاعد', icon: Settings },
          { id: 'org', label: 'الهيكل التنظيمي وسير العمل', icon: Workflow },
          { id: 'backups', label: 'النسخ الاحتياطي والاستعادة', icon: Database },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer ${
                tab === item.id
                  ? 'bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Users & RBAC */}
      {tab === 'users' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#C69214]" />
              <h3 className="text-xs font-bold">إدارة حسابات المستخدمين وتخصيص الأدوار والأقسام</h3>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">{users.length} مستخدم</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-bold">المستخدم</th>
                  <th className="px-4 py-3 font-bold">الدور الوظيفي (Role)</th>
                  <th className="px-4 py-3 font-bold">نطاق القسم / الشعبة / الحقل</th>
                  <th className="px-4 py-3 font-bold">ربط بملف منتسب</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <p className="font-bold">{u.displayName || '—'}</p>
                      <p dir="ltr" className="font-mono text-[11px] text-slate-500">
                        {u.email}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => handleUpdateUser(u, { role: e.target.value as UserRole })}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold"
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS_AR[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <select
                          aria-label="نطاق القسم"
                          value={u.department || ''}
                          onChange={(e) => handleUpdateUser(u, { department: e.target.value })}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs"
                        >
                          <option value="">جميع الأقسام</option>
                          {config.orgCatalogs.departments.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="نطاق الشعبة"
                          value={u.section || ''}
                          onChange={(e) => handleUpdateUser(u, { section: e.target.value })}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs"
                        >
                          <option value="">جميع الشعب</option>
                          {config.orgCatalogs.sections.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="نطاق الحقل"
                          value={u.oilfield || ''}
                          onChange={(e) => handleUpdateUser(u, { oilfield: e.target.value })}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs"
                        >
                          <option value="">جميع الحقول</option>
                          {config.orgCatalogs.oilfields.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.employeeId ?? ''}
                        onChange={(e) =>
                          handleUpdateUser(u, { employeeId: e.target.value ? Number(e.target.value) : null })
                        }
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                      >
                        <option value="">غير مرتبط بمنتسب</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.fullName} ({e.employeeCode})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={u.uid === currentUser.uid}
                        onClick={() => handleUpdateUser(u, { isActive: !u.isActive })}
                        className={`rounded-lg px-3 py-1 text-[11px] font-bold cursor-pointer disabled:opacity-40 ${
                          u.isActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                        }`}
                      >
                        {u.isActive ? 'نشط' : 'معطل'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Configurable HR Rules */}
      {tab === 'rules' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 text-xs">
          {/* Official BOC Regulation Approval Gate */}
          <div
            className={`rounded-xl border p-4 space-y-3 ${
              rulesDraft.rulesApproved
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30'
                : 'border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/30'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-extrabold text-slate-900 dark:text-white">
                  {rulesDraft.rulesApproved
                    ? 'حالة القواعد: ضوابط معتمدة رسمياً للعمل الفعلي'
                    : 'حالة القواعد: مسودة استرشادية غير معتمدة رسمياً'}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                  لا يسمح النظام بفتح أو تنفيذ معاملات الترفيع والعلاوات الرسمية إلا بعد مراجعة القواعد واعتمادها صراحةً من إدارة الموارد البشرية.
                  {config.hrRules.approvedBy && config.hrRules.approvedAt && (
                    <span className="block mt-1 font-semibold">
                      آخر اعتماد: {config.hrRules.approvedBy} ({config.hrRules.approvedAt.slice(0, 10)})
                    </span>
                  )}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(rulesDraft.rulesApproved)}
                  onChange={(e) => setRulesDraft({ ...rulesDraft, rulesApproved: e.target.checked })}
                />
                <span>اعتماد هذه القواعد رسمياً لشركة نفط البصرة</span>
              </label>
            </div>
            <div>
              <label className="block font-bold mb-1">مرجع التعليمات والضوابط المعتمدة (رقم الكتاب / القانون)</label>
              <input
                type="text"
                value={rulesDraft.regulationReference || ''}
                onChange={(e) => setRulesDraft({ ...rulesDraft, regulationReference: e.target.value })}
                placeholder="مثال: قانون رواتب موظفي الدولة رقم 22 لسنة 2008 وتعاميم وزارة النفط"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block font-bold mb-1">دورة العلاوة السنوية (أشهر)</label>
              <input
                type="number"
                value={rulesDraft.incrementCycleMonths}
                onChange={(e) => setRulesDraft({ ...rulesDraft, incrementCycleMonths: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">نافذة التنبيه المبكر (أيام)</label>
              <input
                type="number"
                value={rulesDraft.earlyAlertDays}
                onChange={(e) => setRulesDraft({ ...rulesDraft, earlyAlertDays: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">السقف الأعلى لقِدَم الشكر (أشهر)</label>
              <input
                type="number"
                value={rulesDraft.maxSeniorityMonthsPerCycle}
                onChange={(e) => setRulesDraft({ ...rulesDraft, maxSeniorityMonthsPerCycle: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">سن التقاعد القانوني (سنوات)</label>
              <input
                type="number"
                value={rulesDraft.retirementAgeYears}
                onChange={(e) => setRulesDraft({ ...rulesDraft, retirementAgeYears: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 tabular-nums"
              />
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-2">سنوات البقاء المطلوبة للترفيع حسب الدرجة (10 إلى 2)</h4>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
              {['10', '9', '8', '7', '6', '5', '4', '3', '2'].map((g) => (
                <div key={g} className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                  <label className="block text-[11px] text-slate-500 mb-1">الدرجة {g}</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={rulesDraft.gradePromotionYears[g] ?? 4}
                    onChange={(e) =>
                      setRulesDraft({
                        ...rulesDraft,
                        gradePromotionYears: { ...rulesDraft.gradePromotionYears, [g]: Number(e.target.value) },
                      })
                    }
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-2">مدد تأخير العقوبات الإدارية (أشهر)</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(rulesDraft.penaltyDelays).map(([name, months]) => (
                <div key={name} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <label className="block font-semibold mb-1">{name}</label>
                  <input
                    type="number"
                    min={0}
                    max={36}
                    value={months}
                    onChange={(e) =>
                      setRulesDraft({
                        ...rulesDraft,
                        penaltyDelays: { ...rulesDraft.penaltyDelays, [name]: Number(e.target.value) },
                      })
                    }
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveRules}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2.5 font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Save className="h-4 w-4" />
              <span>حفظ قواعد الموارد البشرية</span>
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: Org Catalogs & Workflows */}
      {tab === 'org' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold mb-1">الأقسام والهيئات (سطر لكل قسم)</label>
              <textarea
                rows={6}
                value={orgDraft.departments.join('\n')}
                onChange={(e) =>
                  setOrgDraft({
                    ...orgDraft,
                    departments: e.target.value
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الحقول النفطية والمواقع (سطر لكل موقع)</label>
              <textarea
                rows={6}
                value={orgDraft.oilfields.join('\n')}
                onChange={(e) =>
                  setOrgDraft({
                    ...orgDraft,
                    oilfields: e.target.value
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3"
              />
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-2">إعدادات مسارات الموافقات لكل نوع معاملة</h4>
            <div className="space-y-2">
              {workflowsDraft.map((wf, idx) => (
                <div
                  key={wf.transactionType}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <span className="font-bold">{wf.labelAr}</span>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={wf.requiresDeptApproval}
                        onChange={(e) => {
                          const next = [...workflowsDraft];
                          next[idx] = { ...wf, requiresDeptApproval: e.target.checked };
                          setWorkflowsDraft(next);
                        }}
                      />
                      <span>يتطلب موافقة القسم</span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={wf.requiresHrApproval}
                        onChange={(e) => {
                          const next = [...workflowsDraft];
                          next[idx] = { ...wf, requiresHrApproval: e.target.checked };
                          setWorkflowsDraft(next);
                        }}
                      />
                      <span>يتطلب اعتماد الموارد البشرية</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveOrgAndWorkflows}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-5 py-2.5 font-bold text-white dark:text-slate-950 cursor-pointer"
            >
              <Save className="h-4 w-4" />
              <span>حفظ الهيكل وسير العمل</span>
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Backup & Recovery */}
      {tab === 'backups' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 text-xs">
            <div>
              <h3 className="text-sm font-extrabold">النسخ الاحتياطي والاستعادة الموثقة بـ SHA-256 (للمسؤولين فقط)</h3>
              <p className="text-slate-500 mt-1">
                يمكنك تصدير نسخة قاعدة البيانات الهيكلية بشكل منفصل عن مخزن الوثائق الرقمية أو تصدير نسخة شاملة،
                مع التحقق الإلزامي من بصمة SHA-256 عند الاستعادة.
              </p>
            </div>

            <input
              type="text"
              placeholder="ملاحظة اختيارية للنسخة الاحتياطية (مثال: نسخة ما قبل ترفيعات الربع الثاني)"
              value={backupNotes}
              onChange={(e) => setBackupNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
            />

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleExportBackup('DATABASE')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-4 py-2 font-bold text-white dark:text-slate-950 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>نسخة قاعدة البيانات (DATABASE)</span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleExportBackup('DOCUMENTS')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-bold cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-[#C69214]" />
                <span>نسخة مخزن الوثائق (DOCUMENTS)</span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleExportBackup('FULL')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2 font-bold text-emerald-800 dark:text-emerald-300 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>نسخة شاملة (FULL)</span>
              </button>

              <label className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-2 font-bold text-amber-800 dark:text-amber-300 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                <span>استعادة من ملف JSON موثق</span>
                <input type="file" accept=".json" onChange={handleRestoreFile} className="hidden" />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3 text-xs font-bold">
              سجل لقطات النسخ الاحتياطي ({backups.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-bold">النوع</th>
                    <th className="px-4 py-3 font-bold">عدد السجلات</th>
                    <th className="px-4 py-3 font-bold">الحجم</th>
                    <th className="px-4 py-3 font-bold">بصمة SHA-256</th>
                    <th className="px-4 py-3 font-bold">المنفذ والتاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                        لم يتم إنشاء نسخ احتياطية بعد.
                      </td>
                    </tr>
                  ) : (
                    backups.map((b) => (
                      <tr key={b.id}>
                        <td className="px-4 py-3 font-bold">{b.backupType}</td>
                        <td className="px-4 py-3 tabular-nums">{b.recordCount}</td>
                        <td className="px-4 py-3 tabular-nums">{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                        <td className="px-4 py-3">
                          <span dir="ltr" className="font-mono text-[11px] text-slate-500">
                            {b.checksum.slice(0, 18)}...
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {b.createdBy} ·{' '}
                          <span dir="ltr" className="font-mono text-[11px] text-slate-400">
                            {b.createdAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
