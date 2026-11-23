import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { Language } from '../types/hrms';

interface PWAInstallButtonProps {
  lang: Language;
  label: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ lang, label }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-[#0B1F3A] dark:text-slate-100 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C69214] whitespace-nowrap shrink-0"
        aria-label={label}
      >
        <Download className="h-3.5 w-3.5 text-[#C69214]" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0B1F3A] text-[#E5B94C]">
                  <Smartphone className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 id="pwa-guide-title" className="text-base font-bold text-slate-900 dark:text-white">
                    {lang === 'ar' ? 'تثبيت تطبيق موارد البصرة (PWA)' : 'Install BOC HRMS App'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'ar' ? 'يعمل كتطبيق مستقل على الهاتف وسطح المكتب' : 'Standalone desktop & mobile enterprise app'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label={lang === 'ar' ? 'إغلاق نافذة التثبيت' : 'Close install guide'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {isIOS ? (
                <ol className="list-decimal space-y-2 ps-5">
                  <li>
                    {lang === 'ar'
                      ? 'اضغط على زر المشاركة (Share) في شريط متصفح Safari السفلي.'
                      : 'Tap the Share button in the Safari toolbar.'}
                  </li>
                  <li>
                    {lang === 'ar'
                      ? 'اختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen).'
                      : 'Scroll down and tap "Add to Home Screen".'}
                  </li>
                  <li>
                    {lang === 'ar'
                      ? 'اضغط "إضافة" ليظهر تطبيق شركة نفط البصرة مباشرة على جهازك.'
                      : 'Tap Add to launch BOC HRMS directly from your home screen.'}
                  </li>
                </ol>
              ) : (
                <ol className="list-decimal space-y-2 ps-5">
                  <li>
                    {lang === 'ar'
                      ? 'من شريط العنوان في متصفح Chrome أو Edge، اضغط على أيقونة التثبيت (Install).'
                      : 'Click the Install icon in the Chrome or Edge address bar.'}
                  </li>
                  <li>
                    {lang === 'ar'
                      ? 'أو افتح قائمة المتصفح واختر "تثبيت التطبيق / إضافة إلى الشاشة الرئيسية".'
                      : 'Or open the browser menu and select "Install App / Add to Home Screen".'}
                  </li>
                </ol>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg bg-[#0B1F3A] dark:bg-[#C69214] px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:opacity-90"
              >
                {lang === 'ar' ? 'حسناً' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC<{ text: string }> = ({ text }) => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 start-4 z-50 flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/90 px-3.5 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 shadow-md"
    >
      <WifiOff className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
};
