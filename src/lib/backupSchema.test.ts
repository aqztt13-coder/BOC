import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBundleChecksum, validateBackupBundle } from './backupSchema.ts';

function makeValidBundle() {
  const payload = {
    schemaVersion: 'BOC-HRMS-ENTERPRISE-V3' as const,
    backupType: 'FULL' as const,
    exportedAt: '2026-05-01T10:00:00.000Z',
    exportedBy: 'admin@boc.oil.gov.iq',
    database: {
      employees: [
        {
          id: 1,
          employeeCode: 'BOC-5001',
          fullName: 'أحمد حسن العبودي',
          jobTitle: 'مهندس مكامن',
          department: 'قسم الهندسة والمكامن',
          oilfield: 'حقل الرميلة الشمالي',
          section: 'شعبة هندسة المكامن',
          grade: 6,
          step: 3,
          hireDate: '2020-01-15',
          lastPromotionDate: '2020-01-15',
          lastIncrementDate: '2025-01-15',
          academicDegree: 'بكالوريوس',
          basicSalaryIQD: 900000,
          annualLeaveBalance: 30,
          sickLeaveBalance: 30,
          status: 'نشط',
        },
      ],
      trainingCourses: [
        {
          id: 10,
          code: 'HSE-101',
          title: 'السلامة المهنية',
        },
      ],
      appreciations: [{ employeeId: 1, letterNumber: 'APP-1', verificationCode: 'V-1' }],
      penalties: [],
      transactions: [],
      trainingEnrollments: [{ employeeId: 1, courseId: 10 }],
      leaveRequests: [{ employeeId: 1, startDate: '2026-06-01', endDate: '2026-06-03' }],
      careerEvents: [{ employeeId: 1, title: 'تعيين' }],
    },
    documentStorage: [],
  };
  return {
    ...payload,
    checksum: computeBundleChecksum(payload),
  };
}

test('valid V3 backup bundle passes schema, SHA-256 checksum, and referential integrity checks', () => {
  const bundle = makeValidBundle();
  const res = validateBackupBundle(bundle);
  assert.equal(res.ok, true);
});

test('tampered backup bundle fails SHA-256 checksum validation', () => {
  const bundle = makeValidBundle();
  bundle.database.employees[0].basicSalaryIQD = 99999999;
  const res = validateBackupBundle(bundle);
  assert.equal(res.ok, false);
});

test('backup bundle with dangling foreign key references is rejected before restore', () => {
  const base = makeValidBundle();
  const { checksum: _old, ...withoutChecksum } = base;
  withoutChecksum.database.appreciations.push({ employeeId: 9999, letterNumber: 'BAD', verificationCode: 'V-BAD' });
  const badEmpBundle = { ...withoutChecksum, checksum: computeBundleChecksum(withoutChecksum) };
  assert.equal(validateBackupBundle(badEmpBundle).ok, false);

  const base2 = makeValidBundle();
  const { checksum: _old2, ...withoutChecksum2 } = base2;
  withoutChecksum2.database.trainingEnrollments.push({ employeeId: 1, courseId: 7777 });
  const badCourseBundle = { ...withoutChecksum2, checksum: computeBundleChecksum(withoutChecksum2) };
  assert.equal(validateBackupBundle(badCourseBundle).ok, false);
});
