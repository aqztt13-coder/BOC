import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  Building2,
  Database,
  FileCheck2,
  Globe,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  Workflow,
} from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';
import type { Language, ThemeMode } from '../types/hrms';
import operationsBanner from '../assets/images/boc_field_operations_1795428520942.jpg';

interface AuthScreenProps {
  lang: Language;
  theme: ThemeMode;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  authError: string | null;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  authError,
}) => {
  const [signingIn, setSigningIn] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setLocalError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setLocalError(
          lang === 'ar'
            ? 'تم إغلاق نافذة تسجيل الدخول قبل إتمام المصادقة.'
            : 'Sign-in window was closed before completing authentication.'
        );
      } else if (code === 'auth/popup-blocked') {
        setLocalError(
          lang === 'ar'
            ? 'المتصفح منع النافذة المنبثقة. يرجى السماح بالنوافذ المنبثقة ثم المحاولة مجدداً.'
            : 'Popup was blocked by the browser. Please allow popups and try again.'
        );
      } else {
        setLocalError(
          lang === 'ar'
            ? 'تعذر إتمام تسجيل الدخول الآمن. يرجى التحقق من الاتصال والمحاولة مرة أخرى.'
            : 'Unable to complete secure sign-in. Please verify your connection and try again.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#F5F7FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row"
    >
      {/* Official Brand & Visual Panel */}
      <div className="relative lg:w-[54%] bg-[#0B1F3A] text-white overflow-hidden flex flex-col justify-between p-5 sm:p-8 lg:p-16">
        <img
          src={operationsBanner}
          alt={lang === 'ar' ? 'منشآت شركة نفط البصرة' : 'Basra Oil Company Operations'}
          className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(155deg, rgba(11,31,58,0.95) 0%, rgba(11,31,58,0.82) 55%, rgba(16,42,76,0.94) 100%)',
          }}
        />

        {/* Top Emblem */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl border border-[#C69214]/40 bg-[#071529]/90 text-[#E5B94C] shrink-0">
              <Building2 className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[11px] sm:text-xs font-semibold tracking-wide text-[#E5B94C]">
                {lang === 'ar' ? 'وزارة النفط — جمهورية العراق' : 'Ministry of Oil — Republic of Iraq'}
              </p>
              <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-white">
                {lang === 'ar' ? 'شركة نفط البصرة' : 'Basra Oil Company (BOC)'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              className="rounded-lg border border-white/15 bg-white/10 p-2 text-slate-200 hover:bg-white/20 transition-colors cursor-pointer"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-[#E5B94C]" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-[#E5B94C]" aria-hidden="true" />
              <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
            </button>
          </div>
        </div>

        {/* Center Headline */}
        <div className="relative z-10 mt-5 lg:my-0 max-w-xl">
          <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-[#E5B94C]">
            {lang === 'ar' ? 'النظام المؤسسي الموحد · البوابة الآمنة' : 'Enterprise HR Platform · Secure Portal'}
          </p>
          <h2 className="mt-2 lg:mt-3 text-xl sm:text-2xl lg:text-4xl font-extrabold leading-snug lg:leading-tight text-white">
            {lang === 'ar'
              ? 'منصة إدارة الموارد البشرية والترفيعات والمعاملات الرقمية'
              : 'Enterprise Human Resources, Promotions & Workflow Platform'}
          </h2>
          <p className="hidden lg:block mt-4 text-base leading-relaxed text-slate-300">
            {lang === 'ar'
              ? 'منظومة مؤسسية متكاملة مرتبطة بقاعدة بيانات مركزية حقيقية لإدارة الملفات الوظيفية، الترفيعات والعلاوات، كتب الشكر والعقوبات، المعاملات الإدارية، الأرشيف الرقمي المحمي، التدريب، والإجازات وفق صلاحيات وصول صارمة.'
              : 'Production-grade HRMS backed by Cloud SQL PostgreSQL for digital employee profiles, configurable promotion rules, centralized administrative workflows, protected document archiving, training, and leave governance.'}
          </p>

          <div className="hidden lg:grid mt-8 grid-cols-3 gap-4 border-t border-white/10 pt-6">
            <div className="flex items-start gap-2.5">
              <Database className="h-4 w-4 text-[#E5B94C] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-white">
                  {lang === 'ar' ? 'قاعدة بيانات مركزية' : 'Live PostgreSQL DB'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {lang === 'ar' ? 'سجلات حقيقية دون بيانات تجريبية' : 'Zero mock data · Full ACID persistence'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Workflow className="h-4 w-4 text-[#E5B94C] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-white">
                  {lang === 'ar' ? 'سير عمل وموافقات' : 'Multi-Stage Workflows'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {lang === 'ar' ? 'اعتماد الأقسام والموارد البشرية' : 'Department & HR approvals with audit'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileCheck2 className="h-4 w-4 text-[#E5B94C] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-white">
                  {lang === 'ar' ? 'أرشيف موثق بـ QR' : 'Protected Archive'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {lang === 'ar' ? 'وصول محكوم بالصلاحيات وسجل تدقيق' : 'RBAC downloads & audit logging'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="hidden lg:flex relative z-10 flex-wrap items-center justify-between gap-2 text-xs text-slate-400 border-t border-white/10 pt-4">
          <span>{lang === 'ar' ? '© شركة نفط البصرة — قسم الموارد البشرية' : '© Basra Oil Company — HR Directorate'}</span>
          <span dir="ltr" className="font-mono text-[11px] text-slate-400">
            BOC-HRMS · Enterprise v2
          </span>
        </div>
      </div>

      {/* Authentication Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1F3A] dark:bg-slate-800 text-[#E5B94C]">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                {lang === 'ar' ? 'تسجيل الدخول الآمن' : 'Authorized Sign In'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {lang === 'ar'
                  ? 'المصادقة الرسمية للدخول إلى بوابة الموارد البشرية'
                  : 'Authenticate to access the Basra Oil Company HRMS'}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100 mb-1">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>{lang === 'ar' ? 'صلاحيات وصول محكومة من الخادم (RBAC)' : 'Server-Enforced RBAC Access'}</span>
            </div>
            <p>
              {lang === 'ar'
                ? 'يتم التحقق من هويتك عبر نظام المصادقة المعتمد، وتُحدد صلاحياتك (مدير نظام، مدير موارد بشرية، مدير قسم، مدير شعبة، موظف) مباشرة من قاعدة البيانات.'
                : 'Your identity is verified via official authentication and your role & department scope are enforced strictly server-side.'}
            </p>
          </div>

          {displayError && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
            >
              {displayError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={signingIn}
            className="mt-6 w-full flex items-center justify-center gap-3 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] dark:bg-[#C69214] dark:hover:bg-[#d8a31c] text-white dark:text-slate-950 px-5 py-3.5 text-sm font-bold transition-colors disabled:opacity-60 cursor-pointer"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.46-1.71 4.29-5.27 4.29-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.81 0 3.01.77 3.7 1.43l2.52-2.44C16.78 4.1 14.68 3.2 12.17 3.2 7.18 3.2 3.14 7.24 3.14 12.5s4.04 9.3 9.03 9.3c5.21 0 8.67-3.66 8.67-8.82 0-.59-.07-1.26-.19-1.88z"
              />
            </svg>
            <span>
              {signingIn
                ? lang === 'ar'
                  ? 'جاري التحقق من الهوية...'
                  : 'Authenticating...'
                : lang === 'ar'
                  ? 'تسجيل الدخول بحساب Google المعتمد'
                  : 'Sign in with Google Account'}
            </span>
          </button>

          <p className="mt-5 text-center text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {lang === 'ar'
              ? 'جميع عمليات الدخول والاستعلام والتعديل مسجلة تلقائياً في سجل التدقيق والرقابة المؤسسي.'
              : 'All sign-ins, queries, and administrative actions are logged in the immutable audit trail.'}
          </p>
        </div>
      </div>
    </div>
  );
};
