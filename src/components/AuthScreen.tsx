import React, { useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  FileCheck2,
  Globe,
  KeyRound,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UserCheck,
  Workflow,
} from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';
import { authApi, setInMemorySessionToken, type EmailOtpPreview } from '../lib/api';
import type { Language, ThemeMode } from '../types/hrms';
import operationsBanner from '../assets/images/boc_field_operations_1795428520942.jpg';

interface AuthScreenProps {
  lang: Language;
  theme: ThemeMode;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  authError: string | null;
  onEmployeeSessionAuthenticated: (token: string, infoMessage?: string) => Promise<void>;
}

type AuthStep = 'login' | 'setup' | 'forgot' | 'verify_otp';

export const AuthScreen: React.FC<AuthScreenProps> = ({
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  authError,
  onEmployeeSessionAuthenticated,
}) => {
  const [step, setStep] = useState<AuthStep>('login');
  const [statusLoading, setStatusLoading] = useState(true);
  const [workspaceInitialized, setWorkspaceInitialized] = useState(true);

  const [employeeCode, setEmployeeCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // First-Run Setup Form (user chooses their own password; zero hardcoded secrets)
  const [setupForm, setSetupForm] = useState({
    hrEmployeeCode: 'BOC-1000',
    hrFullName: 'حيدر عبدالكريم الربيعي',
    hrEmail: 'hr.director@boc.oil.gov.iq',
    hrPassword: '',
    employeeInitialPassword: '',
    includeSampleBocData: true,
  });

  // OTP Verification & Password Reset State
  const [otpPurpose, setOtpPurpose] = useState<'FIRST_LOGIN' | 'FORGOT_PASSWORD'>('FIRST_LOGIN');
  const [otpTargetCode, setOtpTargetCode] = useState('');
  const [otpDisplayName, setOtpDisplayName] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [emailPreview, setEmailPreview] = useState<EmailOtpPreview | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);

  const handleClearCacheAndReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // best-effort cache cleanup
    }
    window.location.reload();
  };

  useEffect(() => {
    let active = true;
    authApi
      .status()
      .then((res) => {
        if (!active) return;
        setBackendUnavailable(false);
        setWorkspaceInitialized(res.initialized);
        if (!res.initialized) {
          setStep('setup');
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          setBackendUnavailable(true);
        }
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    setLocalNotice(null);
    try {
      const res = await authApi.login(employeeCode.trim(), password);
      if (res.requiresPasswordReset && res.emailPreview) {
        setOtpPurpose(res.purpose || 'FIRST_LOGIN');
        setOtpTargetCode(res.employeeCode || employeeCode.trim().toUpperCase());
        setOtpDisplayName(res.displayName || '');
        setMaskedEmail(res.maskedEmail || '');
        setEmailPreview(res.emailPreview);
        setOtpCode('');
        setNewPassword('');
        setConfirmPassword('');
        setStep('verify_otp');
        return;
      }
      if (res.token) {
        setInMemorySessionToken(res.token);
        await onEmployeeSessionAuthenticated(res.token);
      }
    } catch (err: unknown) {
      setLocalError((err as Error).message || 'الرقم الوظيفي أو كلمة المرور غير صحيحة.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrapWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setupForm.hrPassword.length < 8) {
      setLocalError('كلمة مرور مدير الموارد البشرية يجب أن لا تقل عن 8 أحرف.');
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      const res = await authApi.bootstrapWorkspace({
        hrEmployeeCode: setupForm.hrEmployeeCode.trim(),
        hrFullName: setupForm.hrFullName.trim(),
        hrEmail: setupForm.hrEmail.trim(),
        hrPassword: setupForm.hrPassword,
        employeeInitialPassword: setupForm.employeeInitialPassword.trim() || setupForm.hrPassword,
        includeSampleBocData: setupForm.includeSampleBocData,
      });
      setWorkspaceInitialized(true);
      setInMemorySessionToken(res.token);
      const notice = res.firstLoginDemoCode
        ? `تمت تهيئة النظام بنجاح. يمكنك أيضاً اختبار الدخول الأول بالرقم الوظيفي (${res.firstLoginDemoCode}) لتجربة التحقق عبر البريد الإلكتروني.`
        : 'تمت تهيئة حساب مدير الموارد البشرية بنجاح.';
      await onEmployeeSessionAuthenticated(res.token, notice);
    } catch (err: unknown) {
      setLocalError((err as Error).message || 'فشل تهيئة النظام.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      const res = await authApi.forgotPassword(employeeCode.trim());
      setOtpPurpose('FORGOT_PASSWORD');
      setOtpTargetCode(res.employeeCode);
      setOtpDisplayName(res.displayName);
      setMaskedEmail(res.maskedEmail);
      setEmailPreview(res.emailPreview);
      setOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
      setStep('verify_otp');
    } catch (err: unknown) {
      setLocalError((err as Error).message || 'تعذر إرسال رمز التحقق.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setLocalError('كلمتا المرور غير متطابقتين.');
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      const res = await authApi.resetPassword({
        employeeCode: otpTargetCode,
        otpCode: otpCode.trim(),
        newPassword,
      });
      setInMemorySessionToken(res.token);
      await onEmployeeSessionAuthenticated(
        res.token,
        'تم تأكيد البريد الإلكتروني وتعيين كلمة مرورك الشخصية بنجاح.'
      );
    } catch (err: unknown) {
      setLocalError((err as Error).message || 'تعذر التحقق من الرمز أو تحديث كلمة المرور.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
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
      } else {
        setLocalError(
          lang === 'ar'
            ? 'تعذر تسجيل الدخول عبر Google. يمكنك الدخول مباشرة بالرقم الوظيفي وكلمة المرور.'
            : 'Google sign-in failed. You may sign in directly with Employee ID & password.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#F5F7FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row"
    >
      {/* Official Brand & Visual Panel */}
      <div className="relative lg:w-[50%] bg-[#0B1F3A] text-white overflow-hidden flex flex-col justify-between p-5 sm:p-8 lg:p-14">
        <img
          src={operationsBanner}
          alt={lang === 'ar' ? 'منشآت شركة نفط البصرة' : 'Basra Oil Company Operations'}
          className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(155deg, rgba(11,31,58,0.96) 0%, rgba(11,31,58,0.84) 55%, rgba(16,42,76,0.95) 100%)',
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
            {lang === 'ar' ? 'النظام المؤسسي الموحد · الدخول بالرقم الوظيفي' : 'Enterprise HRMS · Employee ID Portal'}
          </p>
          <h2 className="mt-2 lg:mt-3 text-xl sm:text-2xl lg:text-4xl font-extrabold leading-snug lg:leading-tight text-white">
            {lang === 'ar'
              ? 'بوابة الموارد البشرية والخدمة الذاتية لمنتسبي شركة نفط البصرة'
              : 'Basra Oil Company HR Management & Employee Self-Service'}
          </h2>
          <p className="hidden lg:block mt-4 text-sm leading-relaxed text-slate-300">
            {lang === 'ar'
              ? 'نظام موحد يوجّه كل مستخدم تلقائياً حسب صلاحيته: بوابة إدارة الموارد البشرية (لوحة المؤشرات، الترفيعات والعلاوات، الموافقات، الأرشيف والتقارير) وبوابة الخدمة الذاتية الخاصة بكل منتسب.'
              : 'Unified role-routed platform: dedicated HR Management & Approvals Portal alongside a personalized Employee Self-Service Portal with Email OTP onboarding.'}
          </p>

          <div className="hidden lg:grid mt-8 grid-cols-3 gap-4 border-t border-white/10 pt-6">
            <div className="flex items-start gap-2.5">
              <KeyRound className="h-4 w-4 text-[#E5B94C] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-white">
                  {lang === 'ar' ? 'الرقم الوظيفي وOTP' : 'Employee ID & Email OTP'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {lang === 'ar' ? 'تغيير كلمة المرور الأولية عبر البريد' : 'Mandatory first-login email reset'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Workflow className="h-4 w-4 text-[#E5B94C] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-white">
                  {lang === 'ar' ? 'بوابتان منفصلتان' : 'Dual Role Portals'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {lang === 'ar' ? 'بوابة HR + بوابة المنتسب الذاتية' : 'HR Directorate + Employee Portal'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileCheck2 className="h-4 w-4 text-[#E5B94C] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-white">
                  {lang === 'ar' ? 'تطبيق ويب PWA' : 'Installable PWA'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {lang === 'ar' ? 'يعمل على الجوال واللوحي والحاسوب' : 'Mobile, tablet & desktop ready'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="hidden lg:flex relative z-10 flex-wrap items-center justify-between gap-2 text-xs text-slate-400 border-t border-white/10 pt-4">
          <span>{lang === 'ar' ? '© شركة نفط البصرة — قسم الموارد البشرية' : '© Basra Oil Company — HR Directorate'}</span>
          <span dir="ltr" className="font-mono text-[11px] text-slate-400">
            BOC-HRMS · Enterprise PWA
          </span>
        </div>
      </div>

      {/* Authentication Form Panel */}
      <div className="flex-1 flex items-center justify-center p-5 sm:p-8 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
          {statusLoading ? (
            <div className="py-12 text-center space-y-3">
              <div className="h-8 w-8 rounded-full border-2 border-[#C69214] border-t-transparent animate-spin mx-auto" />
              <p className="text-xs text-slate-500">جاري الاتصال بالخادم...</p>
            </div>
          ) : step === 'setup' ? (
            /* First-Run One-Time Setup & Optional Basra Oil Company Sample Data */
            <form onSubmit={handleBootstrapWorkspace} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1F3A] text-[#E5B94C] shrink-0">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                    إعداد النظام وحساب مدير الموارد البشرية
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    التهيئة الأولية لمرة واحدة لبدء العمل بالرقم الوظيفي وكلمة المرور
                  </p>
                </div>
              </div>

              {displayError && (
                <div role="alert" className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300">
                  {displayError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold mb-1">الرقم الوظيفي للمدير</label>
                  <input
                    required
                    dir="ltr"
                    value={setupForm.hrEmployeeCode}
                    onChange={(e) => setSetupForm({ ...setupForm, hrEmployeeCode: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">الاسم الكامل</label>
                  <input
                    required
                    value={setupForm.hrFullName}
                    onChange={(e) => setSetupForm({ ...setupForm, hrFullName: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>

              <div className="text-xs">
                <label className="block font-bold mb-1">البريد الإلكتروني الرسمي</label>
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={setupForm.hrEmail}
                  onChange={(e) => setSetupForm({ ...setupForm, hrEmail: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold mb-1">كلمة مرور المدير (8+ أحرف) *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="اختر كلمة مرور قوية"
                    value={setupForm.hrPassword}
                    onChange={(e) => setSetupForm({ ...setupForm, hrPassword: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">كلمة المرور الأولية للمنتسبين</label>
                  <input
                    type="password"
                    minLength={8}
                    placeholder="افتراضياً نفس كلمة المدير"
                    value={setupForm.employeeInitialPassword}
                    onChange={(e) => setSetupForm({ ...setupForm, employeeInitialPassword: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={setupForm.includeSampleBocData}
                  onChange={(e) => setSetupForm({ ...setupForm, includeSampleBocData: e.target.checked })}
                  className="mt-0.5"
                />
                <span className="leading-relaxed text-slate-700 dark:text-slate-300">
                  <strong>تعبئة بيانات شركة نفط البصرة الواقعية</strong> (منتسبو حقول الرميلة، الزبير، مجنون، غرب
                  القرنة، دورات، كتب شكر، إجازات، وحساب <span dir="ltr" className="font-mono font-bold">BOC-2041</span> لتجربة
                  إعادة تعيين كلمة المرور الأولية عبر البريد).
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] dark:bg-[#C69214] dark:hover:bg-[#d8a31c] text-white dark:text-slate-950 px-5 py-3 text-sm font-bold transition-colors disabled:opacity-60 cursor-pointer"
              >
                {submitting ? 'جاري التهيئة والحفظ في PostgreSQL...' : 'إنشاء الحساب والدخول إلى المنصة'}
              </button>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setStep('login')}
                  className="font-semibold text-[#0B1F3A] dark:text-[#E5B94C] hover:underline cursor-pointer"
                >
                  لديك حساب بالفعل؟ تسجيل الدخول
                </button>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  دخول Google
                </button>
              </div>
            </form>
          ) : step === 'forgot' ? (
            /* Forgot Password via Employee ID */
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  setStep('login');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                <ArrowRight className="h-3.5 w-3.5" />
                <span>العودة إلى تسجيل الدخول</span>
              </button>

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1F3A] text-[#E5B94C] shrink-0">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                    إعادة تعيين كلمة المرور عبر البريد
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    أدخل رقمك الوظيفي لإرسال رمز تحقق آمن إلى بريدك المسجل لدى الموارد البشرية
                  </p>
                </div>
              </div>

              {displayError && (
                <div role="alert" className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300">
                  {displayError}
                </div>
              )}

              <div className="text-xs">
                <label className="block font-bold mb-1.5">الرقم الوظيفي (Employee ID)</label>
                <input
                  required
                  dir="ltr"
                  placeholder="BOC-2041"
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 font-mono text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950 px-5 py-3 text-sm font-bold disabled:opacity-60 cursor-pointer"
              >
                {submitting ? 'جاري إرسال رمز التحقق...' : 'إرسال رمز التحقق إلى البريد الإلكتروني'}
              </button>
            </form>
          ) : step === 'verify_otp' ? (
            /* Mandatory First-Time Login or Forgot Password Email OTP Verification */
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-600 text-white shrink-0">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    {otpPurpose === 'FIRST_LOGIN'
                      ? 'تفعيل الحساب وتعيين كلمة مرورك الشخصية'
                      : 'تأكيد رمز البريد وتعيين كلمة مرور جديدة'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    تم إرسال رمز تحقق من 6 أرقام إلى{' '}
                    <span dir="ltr" className="inline-block font-mono font-bold text-slate-700 dark:text-slate-200">
                      {maskedEmail}
                    </span>
                  </p>
                </div>
              </div>

              {otpPurpose === 'FIRST_LOGIN' && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  <strong>مرحباً {otpDisplayName}:</strong> نظراً لاستخدامك كلمة المرور الأولية الصادرة من قسم
                  الموارد البشرية، يجب التحقق من بريدك الإلكتروني وتعيين كلمة مرور شخصية قبل الدخول إلى بوابتك.
                </div>
              )}

              {/* Official Email Dispatch Preview Card for Sandbox Testing */}
              {emailPreview && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
                    <span className="inline-flex items-center gap-1.5 font-bold text-[#0B1F3A] dark:text-[#E5B94C]">
                      <Mail className="h-3.5 w-3.5" />
                      رسالة البريد الإلكتروني المرسلة
                    </span>
                    <span dir="ltr" className="font-mono text-[10px] text-slate-500">
                      {emailPreview.to}
                    </span>
                  </div>
                  <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">{emailPreview.subject}</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{emailPreview.bodyAr}</p>
                  <div className="flex items-center justify-between rounded-lg border border-dashed border-[#C69214] bg-white dark:bg-slate-900 px-3 py-2">
                    <span className="text-[11px] text-slate-500">رمز التحقق (صالح {emailPreview.expiresMinutes} دقائق):</span>
                    <div className="flex items-center gap-2">
                      <span dir="ltr" className="font-mono text-base font-extrabold tracking-widest text-[#0B1F3A] dark:text-[#E5B94C]">
                        {emailPreview.otpCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => setOtpCode(emailPreview.otpCode)}
                        className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[10px] font-bold text-[#0B1F3A] dark:text-[#E5B94C] hover:opacity-80 cursor-pointer"
                      >
                        تعبئة الرمز
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {displayError && (
                <div role="alert" className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300">
                  {displayError}
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold mb-1">رمز التحقق (6 أرقام) *</label>
                  <input
                    required
                    dir="ltr"
                    maxLength={6}
                    placeholder="000000"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 font-mono text-center text-base tracking-[0.35em] font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">كلمة المرور الشخصية الجديدة (أحرف + أرقام، 8+ خانات) *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">تأكيد كلمة المرور الجديدة *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-3 text-sm font-bold disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>{submitting ? 'جاري التحقق وتفعيل الحساب...' : 'تأكيد الرمز والدخول إلى البوابة'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  setStep('login');
                }}
                className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                إلغاء والعودة لتسجيل الدخول
              </button>
            </form>
          ) : (
            /* Standard Employee ID + Password Login */
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1F3A] dark:bg-slate-800 text-[#E5B94C] shrink-0">
                  <Lock className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {lang === 'ar' ? 'تسجيل الدخول بالرقم الوظيفي' : 'Employee ID Sign In'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {lang === 'ar'
                      ? 'أدخل رقمك الوظيفي وكلمة المرور للوصول التلقائي إلى بوابتك'
                      : 'Enter your Employee ID & password for automatic role routing'}
                  </p>
                </div>
              </div>

              {localNotice && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                  {localNotice}
                </div>
              )}

              {backendUnavailable && (
                <div
                  role="alert"
                  className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-2"
                >
                  <p className="font-bold">
                    {lang === 'ar'
                      ? 'خادم المصادقة غير متاح على هذا الرابط (404)'
                      : 'Authentication server unreachable at this URL (404)'}
                  </p>
                  <p className="leading-relaxed text-[11px]">
                    {lang === 'ar'
                      ? 'قد تكون فاتحاً نسخة مخزّنة مؤقتاً (PWA) أو رابطاً غير متصل بالخادم الخلفي. اضغط الزر أدناه لمسح الذاكرة المؤقتة وإعادة الاتصال، أو افتح التطبيق من الرابط النشط.'
                      : 'You may be viewing a cached PWA copy or a static URL without the backend running. Clear cache to reconnect or open the live app URL.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleClearCacheAndReload}
                    className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] text-white dark:text-slate-950 px-3 py-1.5 text-[11px] font-bold hover:opacity-90 cursor-pointer"
                  >
                    {lang === 'ar' ? 'مسح الذاكرة المؤقتة وإعادة التحميل' : 'Clear Cache & Reload'}
                  </button>
                </div>
              )}

              {displayError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={handleEmployeeLogin} className="space-y-3.5 text-xs">
                <div>
                  <label htmlFor="boc-emp-id" className="block font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                    {lang === 'ar' ? 'الرقم الوظيفي (Employee ID)' : 'Employee ID'}
                  </label>
                  <div className="relative">
                    <UserCheck className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                    <input
                      id="boc-emp-id"
                      required
                      dir="ltr"
                      autoComplete="username"
                      placeholder="BOC-1000 / BOC-2041"
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 ps-9 pe-3 font-mono text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="boc-password" className="font-bold text-slate-700 dark:text-slate-200">
                      {lang === 'ar' ? 'كلمة المرور' : 'Password'}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setLocalError(null);
                        setStep('forgot');
                      }}
                      className="text-[11px] font-bold text-[#0B1F3A] dark:text-[#E5B94C] hover:underline cursor-pointer"
                    >
                      {lang === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot Password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="boc-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 ps-3.5 pe-10 text-sm text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute top-1/2 -translate-y-1/2 end-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] dark:bg-[#C69214] dark:hover:bg-[#d8a31c] text-white dark:text-slate-950 px-5 py-3 text-sm font-bold transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {submitting
                    ? lang === 'ar'
                      ? 'جاري التحقق...'
                      : 'Verifying...'
                    : lang === 'ar'
                      ? 'دخول إلى المنصة'
                      : 'Sign In'}
                </button>
              </form>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100 mb-0.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{lang === 'ar' ? 'تسجيل الدخول الأول للمنتسبين الجدد' : 'First-Time Employee Onboarding'}</span>
                </div>
                {lang === 'ar'
                  ? 'عند الدخول لأول مرة بكلمة المرور الأولية الصادرة من الموارد البشرية، سيُرسل النظام رمز تحقق إلى بريدك المسجل لتعيين كلمة مرورك الشخصية.'
                  : 'Logging in with an HR-issued temporary password automatically triggers Email OTP verification to set your personal password.'}
              </div>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="mx-3 text-[11px] font-semibold text-slate-400">
                  {lang === 'ar' ? 'أو' : 'OR'}
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer"
              >
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.46-1.71 4.29-5.27 4.29-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.81 0 3.01.77 3.7 1.43l2.52-2.44C16.78 4.1 14.68 3.2 12.17 3.2 7.18 3.2 3.14 7.24 3.14 12.5s4.04 9.3 9.03 9.3c5.21 0 8.67-3.66 8.67-8.82 0-.59-.07-1.26-.19-1.88z"
                  />
                </svg>
                <span>{lang === 'ar' ? 'تسجيل الدخول بحساب Google المعتمد' : 'Sign in with Google'}</span>
              </button>

              {!workspaceInitialized && (
                <button
                  type="button"
                  onClick={() => setStep('setup')}
                  className="w-full text-center text-xs font-bold text-[#0B1F3A] dark:text-[#E5B94C] hover:underline cursor-pointer"
                >
                  تهيئة النظام وحساب مدير الموارد البشرية لأول مرة
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
