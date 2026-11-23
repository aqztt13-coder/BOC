import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User as FirebaseUser } from 'firebase/auth';
import {
  ArrowLeftRight,
  Award,
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  FileSpreadsheet,
  Globe,
  GraduationCap,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  UserCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { auth } from './lib/firebase';
import {
  authApi,
  getInMemorySessionToken,
  hrmsApi,
  setInMemorySessionToken,
  type BootstrapResponse,
  type GlobalSearchResult,
} from './lib/api';
import { TRANSLATIONS } from './i18n/translations';
import { hasPermission, ROLE_LABELS_AR, ROLE_LABELS_EN } from './utils/permissions';
import type { ActiveView, Language, ThemeMode } from './types/hrms';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { EmployeesView } from './components/EmployeesView';
import { PromotionsView } from './components/PromotionsView';
import { TransactionsView } from './components/TransactionsView';
import { DocumentsView } from './components/DocumentsView';
import { AppreciationsView } from './components/AppreciationsView';
import { TrainingView } from './components/TrainingView';
import { LeavesAndRequestsView } from './components/LeavesAndRequestsView';
import { ReportsView } from './components/ReportsView';
import { AuditView } from './components/AuditView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { EmployeePortalView } from './components/EmployeePortalView';
import { OfficialDocumentModal, type OfficialPreviewTarget } from './components/OfficialDocumentModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';

interface ToastState {
  id: number;
  message: string;
  type: 'success' | 'error';
}

interface NavItemDef {
  id: ActiveView;
  icon: React.ComponentType<{ className?: string }>;
  visible: (role: string) => boolean;
}

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('boc_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [hasCustomSession, setHasCustomSession] = useState<boolean>(Boolean(getInMemorySessionToken()));
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [data, setData] = useState<BootstrapResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Dual-Portal Routing: 'hr' vs 'employee' (strictly enforced for EMPLOYEE role; switchable by HR_ADMIN/HR_MANAGER for preview/testing)
  const [portalMode, setPortalMode] = useState<'hr' | 'employee'>('hr');
  const [previewEmployeeId, setPreviewEmployeeId] = useState<number | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [createEmployeeSignal, setCreateEmployeeSignal] = useState(0);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [officialPreview, setOfficialPreview] = useState<OfficialPreviewTarget | null>(null);

  // Global Search Modal
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GlobalSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  // Notification Popover
  const [notifOpen, setNotifOpen] = useState(false);

  // Protected Document Preview Modal
  const [docDownloadPreview, setDocDownloadPreview] = useState<{
    title: string;
    fileName: string;
    mimeType: string;
    fileContentBase64: string;
  } | null>(null);

  const t = TRANSLATIONS[lang];

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ id: Date.now(), message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Apply Dark Mode & Language Direction to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('boc_theme', theme);
    } catch {
      // ignore
    }
  }, [theme, lang]);

  // Scroll to top when switching views or portals
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeView, portalMode]);

  // Ctrl+K Global Search shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const fetchBootstrap = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const payload = await hrmsApi.bootstrap();
      setData(payload);
      // Automatic role-based portal routing
      if (payload.user.role === 'EMPLOYEE') {
        setPortalMode('employee');
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || 'تعذر تحميل بيانات النظام من قاعدة البيانات.';
      setAuthError(msg);
      notify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const handleEmployeeSessionAuthenticated = useCallback(
    async (token: string, infoMessage?: string) => {
      setInMemorySessionToken(token);
      setHasCustomSession(true);
      await fetchBootstrap();
      if (infoMessage) {
        notify(infoMessage, 'success');
      }
    },
    [fetchBootstrap, notify]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      setAuthReady(true);
      if (user) {
        fetchBootstrap();
      } else if (!getInMemorySessionToken()) {
        setData(null);
      }
    });
    return () => unsub();
  }, [fetchBootstrap]);

  // Debounced Global Search
  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await hrmsApi.search(searchQuery.trim());
        setSearchResults(res);
      } catch {
        setSearchResults(null);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQuery]);

  const handleSignOut = async () => {
    try {
      await authApi.logout();
      setHasCustomSession(false);
      if (auth.currentUser) {
        await signOut(auth);
      }
      setData(null);
      setPortalMode('hr');
      setPreviewEmployeeId(null);
      setActiveView('dashboard');
    } catch {
      notify('تعذر تسجيل الخروج.', 'error');
    }
  };

  const handleDownloadDocument = async (docId: number) => {
    try {
      const doc = await hrmsApi.downloadDocument(docId);
      if (doc.fileContentBase64) {
        setDocDownloadPreview({
          title: doc.title,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          fileContentBase64: doc.fileContentBase64,
        });
      } else {
        const foundDoc = data?.documents.find((d) => d.id === docId);
        if (foundDoc) {
          const emp = foundDoc.employeeId
            ? data?.employees.find((e) => e.id === foundDoc.employeeId)
            : undefined;
          setOfficialPreview({ kind: 'document', record: foundDoc, employee: emp });
        }
      }
    } catch (err: unknown) {
      notify((err as Error).message || 'تعذر فتح الوثيقة المحمية.', 'error');
    }
  };

  const navGroups = useMemo<Array<{ title: string; items: NavItemDef[] }>>(
    () => [
      {
        title: t.navGroups.overview,
        items: [{ id: 'dashboard', icon: LayoutDashboard, visible: () => true }],
      },
      {
        title: t.navGroups.workforce,
        items: [
          { id: 'employees', icon: Users, visible: () => true },
          { id: 'promotions', icon: Award, visible: () => true },
          { id: 'appreciations', icon: ShieldAlert, visible: () => true },
        ],
      },
      {
        title: t.navGroups.operations,
        items: [
          { id: 'transactions', icon: Workflow, visible: () => true },
          { id: 'documents', icon: FileArchive, visible: () => true },
          { id: 'training', icon: GraduationCap, visible: () => true },
          { id: 'leaves', icon: CalendarDays, visible: () => true },
        ],
      },
      {
        title: t.navGroups.governance,
        items: [
          { id: 'reports', icon: FileSpreadsheet, visible: (r) => hasPermission(r, 'export_reports') },
          { id: 'audit', icon: History, visible: (r) => hasPermission(r, 'view_audit') },
          {
            id: 'admin',
            icon: Settings,
            visible: (r) =>
              hasPermission(r, 'manage_users') ||
              hasPermission(r, 'manage_settings') ||
              hasPermission(r, 'manage_backups'),
          },
        ],
      },
    ],
    [t.navGroups]
  );

  // 1. Auth Initializing State
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 rounded-full border-2 border-[#C69214] border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t.common.loading}</p>
        </div>
      </div>
    );
  }

  const isAuthenticated = Boolean(fbUser || hasCustomSession);

  // 2. Unauthenticated Screen (Employee ID + Password + Email OTP Reset + Google Sign-In)
  if (!isAuthenticated || !data) {
    if (isAuthenticated && loading) {
      return (
        <div className="min-h-screen bg-[#F5F7FA] dark:bg-slate-950 flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <div className="h-10 w-10 rounded-full border-2 border-[#C69214] border-t-transparent animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              جاري التحقق من صلاحيات الحساب وتحميل قاعدة بيانات شركة نفط البصرة...
            </p>
          </div>
        </div>
      );
    }
    return (
      <AuthScreen
        lang={lang}
        theme={theme}
        onToggleLang={() => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'))}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        authError={authError}
        onEmployeeSessionAuthenticated={handleEmployeeSessionAuthenticated}
      />
    );
  }

  const user = data.user;
  const isStrictEmployee = user.role === 'EMPLOYEE';
  const canSwitchPortal = user.role === 'HR_ADMIN' || user.role === 'HR_MANAGER';
  const effectivePortal: 'hr' | 'employee' = isStrictEmployee ? 'employee' : portalMode;

  const activeEmployeeForPortal =
    (previewEmployeeId && !isStrictEmployee
      ? data.employees.find((e) => e.id === previewEmployeeId)
      : null) ||
    (user.employeeId ? data.employees.find((e) => e.id === user.employeeId) : null) ||
    data.employees[0] ||
    null;

  const unreadNotifs = data.notifications.filter((n) => !n.isRead).length;
  const roleLabel = lang === 'ar' ? ROLE_LABELS_AR[user.role] : ROLE_LABELS_EN[user.role];

  const handleMarkNotifRead = async (notifId: number, entityType?: string | null) => {
    try {
      await hrmsApi.markNotificationRead(notifId);
      setData((prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) => (n.id === notifId ? { ...n, isRead: true } : n)),
            }
          : prev
      );
      setNotifOpen(false);
      if (entityType === 'TRANSACTION' && effectivePortal === 'hr') setActiveView('transactions');
    } catch {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await hrmsApi.markAllNotificationsRead();
      setData((prev) =>
        prev
          ? { ...prev, notifications: prev.notifications.map((n) => ({ ...n, isRead: true })) }
          : prev
      );
    } catch {
      // ignore
    }
  };

  const SidebarContent = (
    <div className="flex flex-col h-full bg-[#0B1F3A] text-white">
      {/* Brand Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#071529] border border-[#C69214]/40 text-[#E5B94C] shrink-0">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-[#E5B94C] truncate">{t.ministryName}</p>
              <p className="text-xs font-extrabold text-white truncate">{t.companyName}</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          className="hidden lg:inline-flex rounded-lg p-1.5 text-slate-300 hover:bg-white/10 cursor-pointer"
          aria-label="طي أو توسيع القائمة"
        >
          {sidebarCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((it) => it.visible(user.role));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.title}>
              {!sidebarCollapsed && (
                <p className="px-2.5 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {group.title}
                </p>
              )}
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={t.nav[item.id]}
                      onClick={() => {
                        setActiveView(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#C69214] text-slate-950 font-bold'
                          : 'text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!sidebarCollapsed && <span className="truncate">{t.nav[item.id]}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Signed-in User Footer */}
      <div className="border-t border-white/10 p-3">
        {!sidebarCollapsed ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{user.displayName || user.email}</p>
              <p className="text-[10px] text-[#E5B94C] truncate">
                {user.employeeCode ? `${user.employeeCode} · ` : ''}
                {roleLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              title={t.signOut}
              className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
              aria-label={t.signOut}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSignOut}
            title={t.signOut}
            className="w-full flex justify-center rounded-lg p-2 text-slate-300 hover:bg-white/10 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen w-full overflow-x-clip bg-[#F5F7FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex"
    >
      {/* Desktop Sticky Sidebar (HR Management Portal Only) */}
      {effectivePortal === 'hr' && (
        <aside
          className={`hidden lg:block sticky top-0 h-screen shrink-0 transition-all duration-200 print:hidden ${
            sidebarCollapsed ? 'w-18' : 'w-64'
          }`}
        >
          {SidebarContent}
        </aside>
      )}

      {/* Mobile Drawer (HR Management Portal Only) */}
      {effectivePortal === 'hr' && mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full shadow-2xl">{SidebarContent}</div>
          <div className="flex-1 bg-slate-950/60" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Enterprise Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 sm:px-6 py-3 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-3 min-w-0">
              {effectivePortal === 'hr' ? (
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="lg:hidden rounded-lg border border-slate-200 dark:border-slate-700 p-2 cursor-pointer"
                  aria-label="فتح القائمة"
                >
                  <Menu className="h-4 w-4" />
                </button>
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0B1F3A] text-[#E5B94C] shrink-0">
                  <Building2 className="h-5 w-5" />
                </div>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{t.companyName}</span>
                  {lang === 'ar' ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="font-semibold text-[#0B1F3A] dark:text-[#E5B94C] truncate">
                    {effectivePortal === 'employee'
                      ? lang === 'ar'
                        ? 'بوابة المنتسب للخدمة الذاتية'
                        : 'Employee Self-Service Portal'
                      : t.nav[activeView]}
                  </span>
                </div>
                <h1 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                  {effectivePortal === 'employee'
                    ? lang === 'ar'
                      ? 'بوابة الخدمة الذاتية الخاصة بالمنتسب'
                      : 'Individual Employee Portal'
                    : t.nav[activeView]}
                </h1>
              </div>
            </div>

            {/* Header Controls + Role / Portal Switcher for HR Admins */}
            <div className="flex flex-wrap items-center gap-2 max-w-full">
              {canSwitchPortal && (
                <div className="flex flex-wrap items-center gap-1.5 max-w-full">
                  <button
                    type="button"
                    onClick={() => setPortalMode((m) => (m === 'hr' ? 'employee' : 'hr'))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#C69214] bg-[#C69214]/10 px-2.5 sm:px-3 py-2 text-xs font-bold text-[#0B1F3A] dark:text-[#E5B94C] hover:bg-[#C69214]/20 cursor-pointer"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {effectivePortal === 'hr'
                        ? lang === 'ar'
                          ? 'تبديل إلى بوابة الموظف'
                          : 'Switch to Employee Portal'
                        : lang === 'ar'
                          ? 'العودة لبوابة الموارد البشرية'
                          : 'Return to HR Portal'}
                    </span>
                  </button>

                  {effectivePortal === 'employee' && data.employees.length > 0 && (
                    <select
                      aria-label="اختيار المنتسب لمعاينة بوابته"
                      value={activeEmployeeForPortal?.id ?? ''}
                      onChange={(e) => setPreviewEmployeeId(Number(e.target.value))}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs font-semibold max-w-[175px] sm:max-w-[190px]"
                    >
                      {data.employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName} ({e.employeeCode})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {effectivePortal === 'hr' && (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-300 hover:border-[#C69214] cursor-pointer"
                  aria-label={t.common.search}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline max-w-[150px] truncate">{t.common.search} (Ctrl+K)</span>
                </button>
              )}

              {/* Notification Bell */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  className="relative rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                  aria-label={t.notifications}
                >
                  <Bell className="h-4 w-4" />
                  {unreadNotifs > 0 && (
                    <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white tabular-nums">
                      {unreadNotifs}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute end-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden z-40">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                      <span className="text-xs font-bold">{t.notifications}</span>
                      {unreadNotifs > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-[11px] font-semibold text-[#0B1F3A] dark:text-[#E5B94C] hover:underline cursor-pointer"
                        >
                          {t.markAllRead}
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {data.notifications.length === 0 ? (
                        <p className="p-6 text-center text-xs text-slate-400">{t.noNotifications}</p>
                      ) : (
                        data.notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => handleMarkNotifRead(n.id, n.entityType)}
                            className={`w-full text-right p-3.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer ${
                              !n.isRead ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                            }`}
                          >
                            <p className="font-bold text-slate-900 dark:text-white">{n.title}</p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{n.message}</p>
                            <span dir="ltr" className="font-mono text-[10px] text-slate-400 mt-1 block">
                              {n.createdAt.slice(0, 16).replace('T', ' ')}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={fetchBootstrap}
                disabled={loading}
                title={t.common.refresh}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                aria-label={t.common.refresh}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-[#C69214]' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                aria-label={theme === 'dark' ? t.lightMode : t.darkMode}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4 text-[#E5B94C]" /> : <Moon className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
              >
                <Globe className="h-3.5 w-3.5 text-[#C69214]" />
                <span>{t.languageSwitch}</span>
              </button>

              <PWAInstallButton lang={lang} label={t.installApp} />

              {effectivePortal === 'employee' && (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-300 cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>{t.signOut}</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Active Portal Workspace */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">
          {effectivePortal === 'employee' ? (
            <EmployeePortalView
              employee={activeEmployeeForPortal}
              config={data.config}
              appreciations={data.appreciations}
              penalties={data.penalties}
              documents={data.documents}
              courses={data.courses}
              enrollments={data.enrollments}
              leaveRequests={data.leaveRequests}
              transactions={data.transactions}
              onRefresh={fetchBootstrap}
              onNotify={notify}
              onPreviewOfficial={setOfficialPreview}
              onDownloadDocument={handleDownloadDocument}
            />
          ) : (
            <>
              {activeView === 'dashboard' && (
                <DashboardView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  appreciations={data.appreciations}
                  penalties={data.penalties}
                  documents={data.documents}
                  transactions={data.transactions}
                  courses={data.courses}
                  enrollments={data.enrollments}
                  leaveRequests={data.leaveRequests}
                  onNavigate={setActiveView}
                  onSelectEmployee={(id) => {
                    setSelectedEmployeeId(id);
                    setActiveView('employees');
                  }}
                  onQuickCreateEmployee={() => {
                    setActiveView('employees');
                    setCreateEmployeeSignal((s) => s + 1);
                  }}
                />
              )}

              {activeView === 'employees' && (
                <EmployeesView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  appreciations={data.appreciations}
                  penalties={data.penalties}
                  documents={data.documents}
                  transactions={data.transactions}
                  courses={data.courses}
                  enrollments={data.enrollments}
                  leaveRequests={data.leaveRequests}
                  selectedEmployeeId={selectedEmployeeId}
                  openCreateModalSignal={createEmployeeSignal}
                  onSelectEmployee={setSelectedEmployeeId}
                  onRefresh={fetchBootstrap}
                  onNotify={notify}
                  onDownloadDocument={handleDownloadDocument}
                />
              )}

              {activeView === 'promotions' && (
                <PromotionsView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  appreciations={data.appreciations}
                  penalties={data.penalties}
                  onRefresh={fetchBootstrap}
                  onNavigate={setActiveView}
                  onNotify={notify}
                />
              )}

              {activeView === 'appreciations' && (
                <AppreciationsView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  appreciations={data.appreciations}
                  penalties={data.penalties}
                  onRefresh={fetchBootstrap}
                  onNotify={notify}
                  onPreviewOfficial={setOfficialPreview}
                />
              )}

              {activeView === 'transactions' && (
                <TransactionsView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  transactions={data.transactions}
                  onRefresh={fetchBootstrap}
                  onNotify={notify}
                  onPreviewOfficial={setOfficialPreview}
                />
              )}

              {activeView === 'documents' && (
                <DocumentsView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  documents={data.documents}
                  onRefresh={fetchBootstrap}
                  onNotify={notify}
                  onDownloadDocument={handleDownloadDocument}
                  onPreviewOfficial={setOfficialPreview}
                />
              )}

              {activeView === 'training' && (
                <TrainingView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  courses={data.courses}
                  enrollments={data.enrollments}
                  onRefresh={fetchBootstrap}
                  onNotify={notify}
                />
              )}

              {activeView === 'leaves' && (
                <LeavesAndRequestsView
                  user={user}
                  config={data.config}
                  employees={data.employees}
                  leaveRequests={data.leaveRequests}
                  onRefresh={fetchBootstrap}
                  onNotify={notify}
                />
              )}

              {activeView === 'reports' && (
                <ReportsView
                  config={data.config}
                  employees={data.employees}
                  appreciations={data.appreciations}
                  penalties={data.penalties}
                  courses={data.courses}
                  enrollments={data.enrollments}
                  leaveRequests={data.leaveRequests}
                  transactions={data.transactions}
                />
              )}

              {activeView === 'audit' && <AuditView auditLogs={data.auditLogs} />}

              {activeView === 'admin' && (
                <AdminSettingsView
                  currentUser={user}
                  config={data.config}
                  users={data.users}
                  employees={data.employees}
                  backups={data.backups}
                  onRefresh={fetchBootstrap}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Global Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 pt-20"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
              <Search className="h-4 w-4 text-[#C69214]" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.globalSearchPlaceholder}
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="p-1 text-slate-400 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-4 text-xs space-y-4">
              {searching && <p className="text-center text-slate-400 py-4">جاري البحث في قاعدة البيانات...</p>}
              {!searching && searchQuery.trim().length < 2 && (
                <p className="text-center text-slate-400 py-4">اكتب حرفين على الأقل للبحث الموحد عبر النظام.</p>
              )}
              {!searching && searchResults && (
                <>
                  {searchResults.employees.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-500 mb-1.5">المنتسبون ({searchResults.employees.length})</p>
                      <div className="space-y-1">
                        {searchResults.employees.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                              setSelectedEmployeeId(e.id);
                              setActiveView('employees');
                              setSearchOpen(false);
                            }}
                            className="w-full text-right rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between cursor-pointer"
                          >
                            <span className="font-bold">{e.fullName}</span>
                            <span dir="ltr" className="font-mono text-slate-400">{e.employeeCode}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.transactions.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-500 mb-1.5">المعاملات ({searchResults.transactions.length})</p>
                      <div className="space-y-1">
                        {searchResults.transactions.map((tx) => (
                          <button
                            key={tx.id}
                            type="button"
                            onClick={() => {
                              setActiveView('transactions');
                              setSearchOpen(false);
                            }}
                            className="w-full text-right rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between cursor-pointer"
                          >
                            <span className="font-bold">{tx.title}</span>
                            <span dir="ltr" className="font-mono text-slate-400">{tx.transactionNumber}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.documents.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-500 mb-1.5">الوثائق ({searchResults.documents.length})</p>
                      <div className="space-y-1">
                        {searchResults.documents.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              setActiveView('documents');
                              setSearchOpen(false);
                            }}
                            className="w-full text-right rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between cursor-pointer"
                          >
                            <span className="font-bold">{d.title}</span>
                            <span dir="ltr" className="font-mono text-slate-400">{d.documentNumber}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.courses.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-500 mb-1.5">الدورات التدريبية ({searchResults.courses.length})</p>
                      <div className="space-y-1">
                        {searchResults.courses.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setActiveView('training');
                              setSearchOpen(false);
                            }}
                            className="w-full text-right rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between cursor-pointer"
                          >
                            <span className="font-bold">{c.title}</span>
                            <span dir="ltr" className="font-mono text-slate-400">{c.code}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.employees.length === 0 &&
                    searchResults.transactions.length === 0 &&
                    searchResults.documents.length === 0 &&
                    searchResults.courses.length === 0 && (
                      <p className="text-center text-slate-400 py-4">لا توجد نتائج مطابقة لـ «{searchQuery}».</p>
                    )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Protected Uploaded File Viewer Modal */}
      {docDownloadPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
              <h3 className="text-sm font-bold truncate">{docDownloadPreview.title}</h3>
              <div className="flex items-center gap-2">
                <a
                  href={`data:${docDownloadPreview.mimeType};base64,${docDownloadPreview.fileContentBase64}`}
                  download={docDownloadPreview.fileName}
                  className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-3 py-1.5 text-xs font-bold text-white dark:text-slate-950"
                >
                  تنزيل الملف
                </a>
                <button
                  type="button"
                  onClick={() => setDocDownloadPreview(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
              {docDownloadPreview.mimeType.startsWith('image/') ? (
                <img
                  src={`data:${docDownloadPreview.mimeType};base64,${docDownloadPreview.fileContentBase64}`}
                  alt={docDownloadPreview.title}
                  className="max-h-[75vh] object-contain rounded-lg"
                />
              ) : (
                <iframe
                  title={docDownloadPreview.title}
                  src={`data:${docDownloadPreview.mimeType};base64,${docDownloadPreview.fileContentBase64}`}
                  className="w-full h-[75vh] rounded-lg border border-slate-200 dark:border-slate-800 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Official Letterhead + QR Modal */}
      <OfficialDocumentModal target={officialPreview} onClose={() => setOfficialPreview(null)} />

      {/* Toast Feedback */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 end-5 z-50 max-w-sm rounded-xl border px-4 py-3 text-xs font-bold shadow-xl ${
            toast.type === 'error'
              ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
          }`}
        >
          {toast.message}
        </div>
      )}

      <OfflineIndicator text={t.offlineBanner} />
    </div>
  );
}
