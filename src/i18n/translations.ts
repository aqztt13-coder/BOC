import type { ActiveView, Language } from '../types/hrms';

export interface Translations {
  companyName: string;
  ministryName: string;
  systemTitle: string;
  systemSubtitle: string;
  installApp: string;
  offlineBanner: string;
  languageSwitch: string;
  darkMode: string;
  lightMode: string;
  signOut: string;
  globalSearchPlaceholder: string;
  notifications: string;
  markAllRead: string;
  noNotifications: string;
  navGroups: {
    overview: string;
    workforce: string;
    operations: string;
    governance: string;
  };
  nav: Record<ActiveView, string>;
  common: {
    refresh: string;
    save: string;
    cancel: string;
    close: string;
    delete: string;
    edit: string;
    add: string;
    search: string;
    exportExcel: string;
    printPdf: string;
    all: string;
    noData: string;
    loading: string;
    confirmAction: string;
  };
}

export const TRANSLATIONS: Record<Language, Translations> = {
  ar: {
    companyName: 'شركة نفط البصرة',
    ministryName: 'وزارة النفط — جمهورية العراق',
    systemTitle: 'منصة إدارة الموارد البشرية المؤسسية',
    systemSubtitle: 'النظام الرقمي الموحد للملاك والترفيعات والمعاملات الإدارية',
    installApp: 'تثبيت التطبيق',
    offlineBanner: 'لا يوجد اتصال بالإنترنت — البيانات الخاصة تتطلب اتصالاً مباشراً بقاعدة البيانات.',
    languageSwitch: 'EN',
    darkMode: 'الوضع الداكن',
    lightMode: 'الوضع الفاتح',
    signOut: 'تسجيل الخروج',
    globalSearchPlaceholder: 'بحث شامل: منتسب، رقم وظيفي، معاملة، وثيقة، دورة... (Ctrl+K)',
    notifications: 'مركز الإشعارات',
    markAllRead: 'تعليم الكل كمقروء',
    noNotifications: 'لا توجد إشعارات حالياً.',
    navGroups: {
      overview: 'القيادة والتحليلات',
      workforce: 'شؤون الملاك والمسار الوظيفي',
      operations: 'المعاملات والخدمات الإدارية',
      governance: 'التقارير والتدقيق والإدارة',
    },
    nav: {
      dashboard: 'لوحة التحكم التحليلية',
      employees: 'سجل المنتسبين والملف الوظيفي',
      promotions: 'الترفيعات والعلاوات والقِدَم',
      appreciations: 'كتب الشكر والعقوبات',
      transactions: 'صندوق المعاملات وسير العمل',
      documents: 'الأرشيف الرقمي والوثائق',
      training: 'التدريب والتطوير المهني',
      leaves: 'إدارة الإجازات والأرصدة',
      reports: 'مركز التقارير والإحصاءات',
      audit: 'سجل التدقيق والرقابة',
      admin: 'الإدارة وإعدادات النظام',
    },
    common: {
      refresh: 'تحديث البيانات',
      save: 'حفظ',
      cancel: 'إلغاء',
      close: 'إغلاق',
      delete: 'أرشفة / حذف',
      edit: 'تعديل',
      add: 'إضافة',
      search: 'بحث',
      exportExcel: 'تصدير Excel',
      printPdf: 'طباعة / PDF',
      all: 'الكل',
      noData: 'لا توجد بيانات مسجلة حتى الآن.',
      loading: 'جاري التحميل من قاعدة البيانات...',
      confirmAction: 'تأكيد الإجراء',
    },
  },
  en: {
    companyName: 'Basra Oil Company',
    ministryName: 'Ministry of Oil — Republic of Iraq',
    systemTitle: 'Enterprise HRMS Platform',
    systemSubtitle: 'Unified Workforce, Promotions & Administrative Workflow System',
    installApp: 'Install App',
    offlineBanner: 'You are offline — Live HR records require an active database connection.',
    languageSwitch: 'عربي',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    signOut: 'Sign Out',
    globalSearchPlaceholder: 'Global search: employee, ID, transaction, document, course... (Ctrl+K)',
    notifications: 'Notifications',
    markAllRead: 'Mark all read',
    noNotifications: 'No notifications yet.',
    navGroups: {
      overview: 'Executive Overview',
      workforce: 'Workforce & Career Progression',
      operations: 'Transactions & HR Operations',
      governance: 'Reports, Audit & Administration',
    },
    nav: {
      dashboard: 'Analytics Dashboard',
      employees: 'Employee Directory & Profiles',
      promotions: 'Promotions & Increments',
      appreciations: 'Appreciations & Penalties',
      transactions: 'Administrative Transactions',
      documents: 'Digital Document Archive',
      training: 'Training & Development',
      leaves: 'Leaves & Balances',
      reports: 'Reports Center',
      audit: 'Audit Trail',
      admin: 'System Administration',
    },
    common: {
      refresh: 'Refresh',
      save: 'Save',
      cancel: 'Cancel',
      close: 'Close',
      delete: 'Archive / Delete',
      edit: 'Edit',
      add: 'Add',
      search: 'Search',
      exportExcel: 'Export Excel',
      printPdf: 'Print / PDF',
      all: 'All',
      noData: 'No records stored yet.',
      loading: 'Loading live data from PostgreSQL...',
      confirmAction: 'Confirm Action',
    },
  },
};
