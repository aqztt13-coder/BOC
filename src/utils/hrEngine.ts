import type {
  AppreciationRecord,
  EmployeeRecord,
  HRRulesConfig,
  LeaveRequestRecord,
  OrgCatalogsConfig,
  PenaltyRecordItem,
  PromotionCalculationResult,
  SystemConfigBundle,
  WorkflowConfigItem,
} from '../types/hrms';

export const DEFAULT_HR_RULES: HRRulesConfig = {
  gradePromotionYears: {
    '10': 4,
    '9': 4,
    '8': 4,
    '7': 4,
    '6': 4,
    '5': 5,
    '4': 5,
    '3': 5,
    '2': 5,
    '1': 0,
  },
  incrementCycleMonths: 12,
  earlyAlertDays: 30,
  retirementAgeYears: 60,
  retirementWarningMonths: 12,
  maxSeniorityMonthsPerCycle: 6,
  penaltyDelays: {
    'لفت نظر': 3,
    'إنذار': 6,
    'قطع راتب': 6,
    'توبيخ': 12,
  },
  promotionSalaryIncreasePct: 12,
  incrementSalaryIncreasePct: 3.5,
};

export const DEFAULT_ORG_CATALOGS: OrgCatalogsConfig = {
  departments: [
    'قسم الموارد البشرية',
    'هيئة تشغيل الرميلة',
    'هيئة تشغيل الزبير',
    'هيئة تشغيل مجنون',
    'هيئة تشغيل غرب القرنة',
    'قسم الهندسة والمكامن',
    'قسم الحفر والاستصلاح',
    'قسم الصحة والسلامة والبيئة HSE',
    'الهيئة المالية والرقابة',
    'قسم تقنية المعلومات والاتصالات',
  ],
  oilfields: [
    'حقل الرميلة الشمالي',
    'حقل الرميلة الجنوبي',
    'حقل الزبير',
    'حقل مجنون',
    'حقل غرب القرنة 1',
    'حقل غرب القرنة 2',
    'المقر العام - البصرة',
  ],
  sections: [
    'شعبة الملاك والترفيعات',
    'شعبة التدريب والتطوير',
    'شعبة الإجازات والرواتب',
    'شعبة هندسة المكامن',
    'شعبة الإنتاج وعزل الغاز',
    'شعبة السيطرة والآلات الدقيقة SCADA',
    'شعبة السلامة المهنية',
    'شعبة الحفر',
  ],
  jobTitles: [
    'مهندس مكامن أقدم',
    'رئيس مهندسين أقدم',
    'مهندس إنتاج نفطي',
    'مهندس حفر آبار',
    'جيولوجي أقدم',
    'مهندس سلامة مهنية وبيئة',
    'مهندس سيطرة وآلات دقيقة',
    'فني تشغيل محطات',
    'مدير موارد بشرية',
    'محاسب أقدم',
    'مبرمج أقدم',
  ],
  academicDegrees: ['دكتوراه', 'ماجستير', 'بكالوريوس', 'دبلوم فني', 'إعدادية صناعة', 'إعدادية'],
  documentCategories: [
    'أمر إداري',
    'سجل وظيفي',
    'شهادة جامعية',
    'كتاب شكر وتقدير',
    'أمر عقوبة إدارية',
    'شهادة دورة تدريبية',
    'مخاطبة رسمية',
    'هوية ووثيقة تعريفية',
  ],
  trainingCategories: [
    'السلامة المهنية HSE',
    'هندسة النفط والمكامن',
    'الحفر والسيطرة على الآبار',
    'السيطرة والأنظمة الرقمية',
    'الإدارة والمشاريع',
    'الجودة والتدقيق ISO',
  ],
  leaveTypes: [
    {
      name: 'إجازة اعتيادية',
      annualEntitlementDays: 30,
      maxDaysPerRequest: 30,
      deductsFrom: 'annual',
      requiresAttachment: false,
    },
    {
      name: 'إجازة مرضية',
      annualEntitlementDays: 30,
      maxDaysPerRequest: 14,
      deductsFrom: 'sick',
      requiresAttachment: true,
    },
    {
      name: 'إجازة زمنية',
      annualEntitlementDays: 12,
      maxDaysPerRequest: 2,
      deductsFrom: 'annual',
      requiresAttachment: false,
    },
    {
      name: 'إجازة أمومة / أبوة',
      annualEntitlementDays: 90,
      maxDaysPerRequest: 90,
      deductsFrom: 'none',
      requiresAttachment: true,
    },
  ],
};

export const DEFAULT_WORKFLOWS: WorkflowConfigItem[] = [
  {
    transactionType: 'LEAVE',
    labelAr: 'طلب إجازة',
    requiresDeptApproval: true,
    requiresHrApproval: true,
    escalationDays: 3,
  },
  {
    transactionType: 'TRAINING',
    labelAr: 'طلب ترشيح لدورة تدريبية',
    requiresDeptApproval: true,
    requiresHrApproval: true,
    escalationDays: 5,
  },
  {
    transactionType: 'CONTINUATION_OF_SERVICE',
    labelAr: 'تأييد استمرار بالخدمة',
    requiresDeptApproval: false,
    requiresHrApproval: true,
    escalationDays: 2,
  },
  {
    transactionType: 'SALARY_CERTIFICATE',
    labelAr: 'شهادة راتب',
    requiresDeptApproval: false,
    requiresHrApproval: true,
    escalationDays: 2,
  },
  {
    transactionType: 'PROMOTION_REVIEW',
    labelAr: 'مراجعة واعتماد ترفيع وظيفي',
    requiresDeptApproval: true,
    requiresHrApproval: true,
    escalationDays: 7,
  },
  {
    transactionType: 'INCREMENT_REVIEW',
    labelAr: 'مراجعة واعتماد علاوة سنوية',
    requiresDeptApproval: false,
    requiresHrApproval: true,
    escalationDays: 5,
  },
  {
    transactionType: 'DOCUMENT_REQUEST',
    labelAr: 'طلب وثيقة أو خلاصة خدمة',
    requiresDeptApproval: false,
    requiresHrApproval: true,
    escalationDays: 3,
  },
  {
    transactionType: 'CORRESPONDENCE',
    labelAr: 'مخاطبة إدارية رسمية',
    requiresDeptApproval: true,
    requiresHrApproval: true,
    escalationDays: 4,
  },
];

export const DEFAULT_SYSTEM_CONFIG: SystemConfigBundle = {
  hrRules: DEFAULT_HR_RULES,
  orgCatalogs: DEFAULT_ORG_CATALOGS,
  workflows: DEFAULT_WORKFLOWS,
};

export function getPromotionYearsForGrade(grade: number, rules: HRRulesConfig = DEFAULT_HR_RULES): number {
  const configured = rules.gradePromotionYears[String(grade)];
  if (typeof configured === 'number' && configured >= 0) {
    return configured;
  }
  if (grade >= 6) return 4;
  if (grade >= 2) return 5;
  return 0;
}

export function getPenaltyDelayMonths(penaltyType: string, rules: HRRulesConfig = DEFAULT_HR_RULES): number {
  const configured = rules.penaltyDelays[penaltyType];
  if (typeof configured === 'number' && configured >= 0) {
    return configured;
  }
  return 3;
}

export function addMonthsISO(isoDate: string, monthsToAdd: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const maxDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, maxDayInTargetMonth);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function daysBetweenISO(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}

export function calculateRetirementInfo(
  birthDate: string | null | undefined,
  referenceDateISO: string,
  rules: HRRulesConfig = DEFAULT_HR_RULES
): { retirementDate: string | null; approachingRetirement: boolean } {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { retirementDate: null, approachingRetirement: false };
  }
  const retirementDate = addMonthsISO(birthDate, rules.retirementAgeYears * 12);
  const daysLeft = daysBetweenISO(referenceDateISO, retirementDate);
  const warningDays = rules.retirementWarningMonths * 30;
  return {
    retirementDate,
    approachingRetirement: daysLeft <= warningDays,
  };
}

export function calculateEmployeeProgression(
  employee: EmployeeRecord,
  appreciations: AppreciationRecord[],
  penalties: PenaltyRecordItem[],
  referenceDateISO: string,
  rules: HRRulesConfig = DEFAULT_HR_RULES
): PromotionCalculationResult {
  const gradeYearsRequired = getPromotionYearsForGrade(employee.grade, rules);
  const baseIncrementDate = addMonthsISO(employee.lastIncrementDate, rules.incrementCycleMonths);
  const basePromotionDate =
    gradeYearsRequired > 0
      ? addMonthsISO(employee.lastPromotionDate, gradeYearsRequired * 12)
      : employee.lastPromotionDate;

  const activeAppreciations = appreciations.filter(
    (a) => a.employeeId === employee.id && a.appliedToCurrentCycle
  );
  const activePenalties = penalties.filter(
    (p) => p.employeeId === employee.id && p.appliedToCurrentCycle
  );

  const rawSeniorityMonths = activeAppreciations.reduce((sum, item) => sum + item.seniorityMonths, 0);
  const effectiveSeniorityMonths = Math.min(rawSeniorityMonths, rules.maxSeniorityMonthsPerCycle);
  const totalPenaltyDelayMonths = activePenalties.reduce((sum, item) => sum + item.delayMonths, 0);

  const netAdjustmentMonths = effectiveSeniorityMonths - totalPenaltyDelayMonths;

  const effectiveIncrementDate = addMonthsISO(baseIncrementDate, -netAdjustmentMonths);
  const effectivePromotionDate =
    gradeYearsRequired > 0
      ? addMonthsISO(basePromotionDate, -netAdjustmentMonths)
      : basePromotionDate;

  const daysToIncrement = daysBetweenISO(referenceDateISO, effectiveIncrementDate);
  const daysToPromotion =
    gradeYearsRequired > 0 ? daysBetweenISO(referenceDateISO, effectivePromotionDate) : 9999;

  const isIncrementOverdue = daysToIncrement < 0;
  const isPromotionOverdue = gradeYearsRequired > 0 && daysToPromotion < 0;
  const isIncrementDueSoon = daysToIncrement >= 0 && daysToIncrement <= rules.earlyAlertDays;
  const isPromotionDueSoon =
    gradeYearsRequired > 0 && daysToPromotion >= 0 && daysToPromotion <= rules.earlyAlertDays;

  let progressionStatus: PromotionCalculationResult['progressionStatus'] = 'ON_TRACK';
  if (isPromotionOverdue || isIncrementOverdue) {
    progressionStatus = 'OVERDUE';
  } else if (isPromotionDueSoon || isIncrementDueSoon) {
    progressionStatus = 'DUE_SOON';
  } else if (totalPenaltyDelayMonths > effectiveSeniorityMonths) {
    progressionStatus = 'DELAYED_BY_PENALTY';
  }

  const { retirementDate, approachingRetirement } = calculateRetirementInfo(
    employee.birthDate,
    referenceDateISO,
    rules
  );

  // Transparent calculation breakdown
  const explanationSteps: string[] = [
    `الدرجة الحالية (${employee.grade}) / المرحلة (${employee.step}) — مدة البقاء المعتمدة للترفيع وفق إعدادات النظام: ${
      gradeYearsRequired > 0 ? `${gradeYearsRequired} سنوات` : 'أعلى درجة وظيفية (الدرجة الأولى)'
    }.`,
    `تاريخ العلاوة الأساسي (${rules.incrementCycleMonths} شهراً من ${employee.lastIncrementDate}): ${baseIncrementDate}.`,
  ];

  if (gradeYearsRequired > 0) {
    explanationSteps.push(
      `تاريخ الترفيع الأساسي (${gradeYearsRequired} سنوات من ${employee.lastPromotionDate}): ${basePromotionDate}.`
    );
  }
  if (rawSeniorityMonths > 0) {
    explanationSteps.push(
      `مجموع قِدَم كتب الشكر النشطة: +${rawSeniorityMonths} شهر (المحتسب وفق السقف الأعلى ${rules.maxSeniorityMonthsPerCycle} أشهر: +${effectiveSeniorityMonths} شهر).`
    );
  } else {
    explanationSteps.push('لا توجد كتب شكر وتقدير فعّالة في الدورة الحالية.');
  }
  if (totalPenaltyDelayMonths > 0) {
    explanationSteps.push(`مجموع تأخير العقوبات الإدارية النشطة: -${totalPenaltyDelayMonths} شهر.`);
  } else {
    explanationSteps.push('لا توجد عقوبات إدارية مؤثرة في الدورة الحالية.');
  }
  explanationSteps.push(
    `صافي التعديل: ${
      netAdjustmentMonths > 0
        ? `تقديم بمقدار ${netAdjustmentMonths} شهر`
        : netAdjustmentMonths < 0
          ? `تأخير بمقدار ${Math.abs(netAdjustmentMonths)} شهر`
          : 'دون تغيير (0 شهر)'
    } ← تاريخ العلاوة الفعلي: ${effectiveIncrementDate}${
      gradeYearsRequired > 0 ? ` · تاريخ الترفيع الفعلي: ${effectivePromotionDate}` : ''
    }.`
  );

  return {
    employeeId: employee.id,
    gradeYearsRequired,
    baseIncrementDate,
    basePromotionDate,
    rawSeniorityMonths,
    effectiveSeniorityMonths,
    totalPenaltyDelayMonths,
    netAdjustmentMonths,
    effectiveIncrementDate,
    effectivePromotionDate,
    daysToIncrement,
    daysToPromotion,
    isIncrementDueSoon,
    isPromotionDueSoon,
    isIncrementOverdue,
    isPromotionOverdue,
    approachingRetirement,
    retirementDate,
    progressionStatus,
    explanationSteps,
  };
}

export function hasOverlappingLeave(
  existingLeaves: Pick<LeaveRequestRecord, 'employeeId' | 'startDate' | 'endDate' | 'status'>[],
  employeeId: number,
  startDate: string,
  endDate: string
): boolean {
  return existingLeaves.some(
    (lv) =>
      lv.employeeId === employeeId &&
      lv.status !== 'مرفوض' &&
      lv.startDate <= endDate &&
      lv.endDate >= startDate
  );
}

export function calculateDateRangeDays(startDate: string, endDate: string): number {
  const diff = daysBetweenISO(startDate, endDate);
  return diff >= 0 ? diff + 1 : 0;
}
