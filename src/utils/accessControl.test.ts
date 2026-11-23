import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessDocument,
  canAccessEmployee,
  canManageNotification,
  canProvisionAccountRole,
  isNotificationReadForUser,
  redactEmployeeForUser,
  type ScopedActor,
} from './accessControl.ts';

const hrAdmin: ScopedActor = {
  uid: 'u-admin',
  role: 'HR_ADMIN',
  department: '',
  section: '',
  oilfield: '',
  employeeId: null,
};

const hrManager: ScopedActor = {
  uid: 'u-hrm',
  role: 'HR_MANAGER',
  department: '',
  section: '',
  oilfield: '',
  employeeId: null,
};

const deptManager: ScopedActor = {
  uid: 'u-dept',
  role: 'DEPT_MANAGER',
  department: 'قسم الهندسة والمكامن',
  section: '',
  oilfield: 'حقل الرميلة الشمالي',
  employeeId: 10,
};

const sectionManager: ScopedActor = {
  uid: 'u-sec',
  role: 'SECTION_MANAGER',
  department: 'قسم الهندسة والمكامن',
  section: 'شعبة هندسة المكامن',
  oilfield: 'حقل الرميلة الشمالي',
  employeeId: 11,
};

const employeeActor: ScopedActor = {
  uid: 'u-emp',
  role: 'EMPLOYEE',
  department: 'قسم الهندسة والمكامن',
  section: 'شعبة هندسة المكامن',
  oilfield: 'حقل الرميلة الشمالي',
  employeeId: 20,
};

const readOnlyActor: ScopedActor = {
  uid: 'u-ro',
  role: 'READ_ONLY',
  department: '',
  section: '',
  oilfield: '',
  employeeId: null,
};

const targetEmp = {
  id: 20,
  department: 'قسم الهندسة والمكامن',
  section: 'شعبة هندسة المكامن',
  oilfield: 'حقل الرميلة الشمالي',
  nationalId: '199012345678',
  basicSalaryIQD: 1250000,
  phone: '07801234567',
  notes: 'ملاحظة خاصة',
};

const otherSectionEmp = {
  ...targetEmp,
  id: 21,
  section: 'شعبة الحفر',
};

const otherFieldEmp = {
  ...targetEmp,
  id: 22,
  oilfield: 'حقل مجنون',
};

test('hierarchical org scoping enforces department, section, oilfield, and employee boundaries', () => {
  assert.equal(canAccessEmployee(hrAdmin, targetEmp), true);
  assert.equal(canAccessEmployee(deptManager, targetEmp), true);
  assert.equal(canAccessEmployee(deptManager, otherSectionEmp), true);
  assert.equal(canAccessEmployee(deptManager, otherFieldEmp), false);

  assert.equal(canAccessEmployee(sectionManager, targetEmp), true);
  assert.equal(canAccessEmployee(sectionManager, otherSectionEmp), false);
  assert.equal(canAccessEmployee(sectionManager, otherFieldEmp), false);

  assert.equal(canAccessEmployee(employeeActor, targetEmp), true);
  assert.equal(canAccessEmployee(employeeActor, otherSectionEmp), false);
});

test('sensitive employee fields (nationalId, salary, phone, notes) are redacted for non-HR viewing others', () => {
  const hrView = redactEmployeeForUser(hrManager, targetEmp);
  assert.equal(hrView.basicSalaryIQD, 1250000);
  assert.equal(hrView.nationalId, '199012345678');

  const selfView = redactEmployeeForUser(employeeActor, targetEmp);
  assert.equal(selfView.basicSalaryIQD, 1250000);

  const deptView = redactEmployeeForUser(deptManager, targetEmp);
  assert.equal(deptView.basicSalaryIQD, 0);
  assert.equal(deptView.nationalId, null);
  assert.equal(deptView.phone, '');
  assert.equal(deptView.notes, '');

  const roView = redactEmployeeForUser(readOnlyActor, targetEmp);
  assert.equal(roView.basicSalaryIQD, 0);
  assert.equal(roView.nationalId, null);
});

test('document ACL blocks READ_ONLY, confidential docs, and unlinked docs for unauthorized roles', () => {
  const internalEmpDoc = {
    id: 1,
    employeeId: 20,
    department: 'قسم الهندسة والمكامن',
    oilfield: 'حقل الرميلة الشمالي',
    confidentialityLevel: 'INTERNAL',
  };
  const confidentialEmpDoc = { ...internalEmpDoc, id: 2, confidentialityLevel: 'CONFIDENTIAL' };
  const unlinkedDoc = {
    id: 3,
    employeeId: null,
    department: 'قسم الهندسة والمكامن',
    oilfield: 'حقل الرميلة الشمالي',
    confidentialityLevel: 'INTERNAL',
  };

  assert.equal(canAccessDocument(readOnlyActor, internalEmpDoc, targetEmp), false);
  assert.equal(canAccessDocument(employeeActor, internalEmpDoc, targetEmp), true);
  assert.equal(canAccessDocument(employeeActor, confidentialEmpDoc, targetEmp), false);
  assert.equal(canAccessDocument(deptManager, confidentialEmpDoc, targetEmp), false);
  assert.equal(canAccessDocument(hrAdmin, confidentialEmpDoc, targetEmp), true);

  // Unlinked docs: employee & section manager blocked; matching dept manager allowed; other dept blocked
  assert.equal(canAccessDocument(employeeActor, unlinkedDoc, null), false);
  assert.equal(canAccessDocument(sectionManager, unlinkedDoc, null), false);
  assert.equal(canAccessDocument(deptManager, unlinkedDoc, null), true);
  assert.equal(
    canAccessDocument(deptManager, { ...unlinkedDoc, department: 'الهيئة المالية والرقابة' }, null),
    false
  );
  // Linked doc whose employee is missing/deleted is denied to non-HR
  assert.equal(canAccessDocument(deptManager, internalEmpDoc, null), false);
});

test('notification ownership prevents cross-user IDOR and tracks per-user read state on role broadcasts', () => {
  const personalNotif = { recipientUid: 'u-emp', recipientRole: null, isRead: false, readByUids: [] };
  assert.equal(canManageNotification(employeeActor, personalNotif), true);
  assert.equal(canManageNotification(deptManager, personalNotif), false);

  const roleBroadcast = {
    recipientUid: null,
    recipientRole: 'DEPT_MANAGER',
    isRead: false,
    readByUids: ['other-manager'],
  };
  assert.equal(canManageNotification(deptManager, roleBroadcast), true);
  assert.equal(canManageNotification(employeeActor, roleBroadcast), false);
  assert.equal(isNotificationReadForUser('u-dept', roleBroadcast), false);
  assert.equal(isNotificationReadForUser('other-manager', roleBroadcast), true);
});

test('account provisioning blocks privilege escalation by HR_MANAGER and non-HR roles', () => {
  assert.equal(canProvisionAccountRole('HR_ADMIN', 'HR_ADMIN'), true);
  assert.equal(canProvisionAccountRole('HR_ADMIN', 'HR_MANAGER'), true);
  assert.equal(canProvisionAccountRole('HR_MANAGER', 'HR_ADMIN'), false);
  assert.equal(canProvisionAccountRole('HR_MANAGER', 'HR_MANAGER'), false);
  assert.equal(canProvisionAccountRole('HR_MANAGER', 'EMPLOYEE'), true);
  assert.equal(canProvisionAccountRole('DEPT_MANAGER', 'EMPLOYEE'), false);
});
