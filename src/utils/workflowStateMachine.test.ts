import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTransactionTransition } from './workflowStateMachine.ts';
import type { WorkflowConfigItem } from '../types/hrms.ts';

const twoStageWorkflow: WorkflowConfigItem = {
  transactionType: 'LEAVE',
  labelAr: 'طلب إجازة',
  requiresDeptApproval: true,
  requiresHrApproval: true,
  escalationDays: 3,
};

test('blocks resubmission of approved, rejected, completed, or archived transactions', () => {
  for (const status of ['معتمد', 'مرفوض', 'مكتمل', 'مؤرشف']) {
    const res = evaluateTransactionTransition({
      currentStatus: status,
      currentRole: 'HR_ADMIN',
      executedAt: status === 'معتمد' ? new Date() : null,
      action: 'RESUBMIT',
      isHR: true,
      isDept: true,
      isOwner: true,
      workflow: twoStageWorkflow,
    });
    assert.equal(res.allowed, false, `RESUBMIT must be rejected for status ${status}`);
    assert.equal(res.statusCode, 409);
  }
});

test('enforces strict two-stage approval order and prevents bypassing department approval', () => {
  // Stage 1: Dept manager approves -> moves to HR review, does NOT execute final side effects
  const stage1 = evaluateTransactionTransition({
    currentStatus: 'بانتظار موافقة القسم',
    currentRole: 'DEPT_MANAGER',
    executedAt: null,
    action: 'APPROVE',
    isHR: false,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(stage1.allowed, true);
  assert.equal(stage1.nextStatus, 'بانتظار موافقة الموارد البشرية');
  assert.equal(stage1.shouldExecuteFinalEffects, false);

  // Stage 2: Dept manager cannot give final HR approval
  const deptTryingHR = evaluateTransactionTransition({
    currentStatus: 'بانتظار موافقة الموارد البشرية',
    currentRole: 'HR_MANAGER',
    executedAt: null,
    action: 'APPROVE',
    isHR: false,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(deptTryingHR.allowed, false);
  assert.equal(deptTryingHR.statusCode, 403);

  // Stage 2: HR approves -> final status + executes side effects once
  const stage2 = evaluateTransactionTransition({
    currentStatus: 'بانتظار موافقة الموارد البشرية',
    currentRole: 'HR_MANAGER',
    executedAt: null,
    action: 'APPROVE',
    isHR: true,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(stage2.allowed, true);
  assert.equal(stage2.nextStatus, 'معتمد');
  assert.equal(stage2.shouldExecuteFinalEffects, true);
});

test('idempotency guard prevents duplicate final execution when executedAt is already set', () => {
  const duplicate = evaluateTransactionTransition({
    currentStatus: 'بانتظار موافقة الموارد البشرية',
    currentRole: 'HR_MANAGER',
    executedAt: new Date('2026-05-01T10:00:00Z'),
    action: 'APPROVE',
    isHR: true,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(duplicate.allowed, false);
  assert.equal(duplicate.statusCode, 409);
});

test('allows RETURN -> RESUBMIT by owner and blocks non-owner resubmission', () => {
  const returned = evaluateTransactionTransition({
    currentStatus: 'بانتظار موافقة القسم',
    currentRole: 'DEPT_MANAGER',
    executedAt: null,
    action: 'RETURN',
    isHR: false,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(returned.allowed, true);
  assert.equal(returned.nextStatus, 'معاد للتعديل');

  const outsiderResubmit = evaluateTransactionTransition({
    currentStatus: 'معاد للتعديل',
    currentRole: 'EMPLOYEE',
    executedAt: null,
    action: 'RESUBMIT',
    isHR: false,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(outsiderResubmit.allowed, false);
  assert.equal(outsiderResubmit.statusCode, 403);

  const ownerResubmit = evaluateTransactionTransition({
    currentStatus: 'معاد للتعديل',
    currentRole: 'EMPLOYEE',
    executedAt: null,
    action: 'RESUBMIT',
    isHR: false,
    isDept: false,
    isOwner: true,
    workflow: twoStageWorkflow,
  });
  assert.equal(ownerResubmit.allowed, true);
  assert.equal(ownerResubmit.nextStatus, 'بانتظار موافقة القسم');
});

test('prevents COMPLETE before approval and ARCHIVE while pending', () => {
  const prematureComplete = evaluateTransactionTransition({
    currentStatus: 'بانتظار موافقة الموارد البشرية',
    currentRole: 'HR_MANAGER',
    executedAt: null,
    action: 'COMPLETE',
    isHR: true,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(prematureComplete.allowed, false);
  assert.equal(prematureComplete.statusCode, 409);

  const prematureArchive = evaluateTransactionTransition({
    currentStatus: 'بانتظار موافقة القسم',
    currentRole: 'DEPT_MANAGER',
    executedAt: null,
    action: 'ARCHIVE',
    isHR: true,
    isDept: true,
    isOwner: false,
    workflow: twoStageWorkflow,
  });
  assert.equal(prematureArchive.allowed, false);
  assert.equal(prematureArchive.statusCode, 409);
});
