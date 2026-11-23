import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonthsISO,
  calculateDateRangeDays,
  calculateEmployeeProgression,
  calculateRetirementInfo,
  DEFAULT_HR_RULES,
  hasOverlappingLeave,
} from './hrEngine';
import { hasPermission } from './permissions';
import type { AppreciationRecord, EmployeeRecord, HRRulesConfig, PenaltyRecordItem } from '../types/hrms';

const sampleEmp: EmployeeRecord = {
  id: 1,
  employeeCode: 'BOC-20001',
  fullName: 'منتسب تجريبي للاختبار',
  fullNameEn: 'Test Staff',
  birthDate: '1967-03-01',
  jobTitle: 'مهندس مكامن',
  jobTitleEn: 'Reservoir Engineer',
  department: 'قسم الهندسة والمكامن',
  oilfield: 'حقل الرميلة الشمالي',
  section: 'شعبة المكامن',
  grade: 6,
  step: 4,
  hireDate: '2016-01-01',
  lastPromotionDate: '2022-12-15',
  lastIncrementDate: '2025-12-15',
  academicDegree: 'بكالوريوس',
  specialization: 'هندسة النفط',
  email: 'staff@boc.oil.gov.iq',
  phone: '07801112233',
  basicSalaryIQD: 850000,
  annualLeaveBalance: 25,
  sickLeaveBalance: 20,
  status: 'نشط',
};

test('configurable promotion rules override default grade durations and cap seniority', () => {
  const customRules: HRRulesConfig = {
    ...DEFAULT_HR_RULES,
    gradePromotionYears: { ...DEFAULT_HR_RULES.gradePromotionYears, '6': 3 },
    maxSeniorityMonthsPerCycle: 2,
  };
  const appreciations: AppreciationRecord[] = [
    {
      id: 1,
      employeeId: 1,
      letterNumber: 'L-1',
      issueDate: '2025-01-01',
      issuingAuthority: 'مدير عام',
      subject: 'جهود متميزة',
      seniorityMonths: 3,
      verificationCode: 'V-1',
      appliedToCurrentCycle: true,
      createdBy: 'admin',
      createdAt: '2025-01-01T00:00:00Z',
    },
  ];
  // Base with 3 yrs from 2022-12-15 = 2025-12-15, capped seniority 2m -> 2025-10-15
  const calc = calculateEmployeeProgression(sampleEmp, appreciations, [], '2026-11-23', customRules);
  assert.equal(calc.gradeYearsRequired, 3);
  assert.equal(calc.rawSeniorityMonths, 3);
  assert.equal(calc.effectiveSeniorityMonths, 2);
  assert.equal(calc.effectivePromotionDate, '2025-10-15');
  assert.ok(calc.explanationSteps.length >= 5);
});

test('penalties delay progression and reflect transparently in calculation breakdown', () => {
  const penalties: PenaltyRecordItem[] = [
    {
      id: 10,
      employeeId: 1,
      orderNumber: 'P-10',
      issueDate: '2026-01-10',
      penaltyType: 'إنذار',
      delayMonths: 6,
      reason: 'مخالفة إدارية',
      appliedToCurrentCycle: true,
      createdBy: 'admin',
      createdAt: '2026-01-10T00:00:00Z',
    },
  ];
  const calc = calculateEmployeeProgression(sampleEmp, [], penalties, '2026-11-23', DEFAULT_HR_RULES);
  assert.equal(calc.totalPenaltyDelayMonths, 6);
  assert.equal(calc.effectivePromotionDate, '2027-06-15');
  assert.equal(calc.progressionStatus, 'DELAYED_BY_PENALTY');
});

test('retirement horizon identifies staff within configured warning window', () => {
  // Born 1967-03-01 + 60 years = 2027-03-01 (< 12 months from 2026-11-23)
  const info = calculateRetirementInfo('1967-03-01', '2026-11-23', DEFAULT_HR_RULES);
  assert.equal(info.retirementDate, '2027-03-01');
  assert.equal(info.approachingRetirement, true);

  const younger = calculateRetirementInfo('1990-06-01', '2026-11-23', DEFAULT_HR_RULES);
  assert.equal(younger.approachingRetirement, false);
});

test('overlapping leave detection catches conflicts and ignores rejected requests', () => {
  const leaves = [
    { employeeId: 1, startDate: '2026-12-01', endDate: '2026-12-05', status: 'معتمد' },
    { employeeId: 1, startDate: '2026-12-10', endDate: '2026-12-12', status: 'مرفوض' },
  ];
  assert.equal(hasOverlappingLeave(leaves, 1, '2026-12-04', '2026-12-08'), true);
  assert.equal(hasOverlappingLeave(leaves, 1, '2026-12-06', '2026-12-09'), false);
  assert.equal(hasOverlappingLeave(leaves, 1, '2026-12-10', '2026-12-11'), false);
  assert.equal(calculateDateRangeDays('2026-12-01', '2026-12-05'), 5);
  assert.equal(addMonthsISO('2025-01-31', 1), '2025-02-28');
});

test('RBAC permission matrix enforces strict role boundaries', () => {
  assert.equal(hasPermission('HR_ADMIN', 'manage_backups'), true);
  assert.equal(hasPermission('HR_MANAGER', 'manage_backups'), false);
  assert.equal(hasPermission('HR_MANAGER', 'approve_hr'), true);
  assert.equal(hasPermission('DEPT_MANAGER', 'approve_dept'), true);
  assert.equal(hasPermission('DEPT_MANAGER', 'approve_hr'), false);
  assert.equal(hasPermission('EMPLOYEE', 'create_employee'), false);
  assert.equal(hasPermission('READ_ONLY', 'edit_employee'), false);
});
