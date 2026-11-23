import type { WorkflowConfigItem } from '../types/hrms.ts';

export type TransactionAction =
  | 'APPROVE'
  | 'REJECT'
  | 'RETURN'
  | 'RESUBMIT'
  | 'ESCALATE'
  | 'COMPLETE'
  | 'ARCHIVE';

export const TERMINAL_STATUSES = new Set(['مرفوض', 'مؤرشف']);
export const FINALIZED_STATUSES = new Set(['معتمد', 'مرفوض', 'مكتمل', 'مؤرشف']);
export const PENDING_APPROVAL_STATUSES = new Set([
  'بانتظار موافقة القسم',
  'بانتظار موافقة الموارد البشرية',
]);

export interface TransitionContext {
  currentStatus: string;
  currentRole: string;
  executedAt: Date | string | null;
  action: TransactionAction;
  isHR: boolean;
  isDept: boolean;
  isOwner: boolean;
  workflow?: WorkflowConfigItem | null;
}

export interface TransitionDecision {
  allowed: boolean;
  statusCode: number;
  error?: string;
  nextStatus?: string;
  nextRole?: string;
  actionLabel?: string;
  setCompletedAt?: boolean;
  setEscalated?: boolean;
  shouldExecuteFinalEffects?: boolean;
}

/**
 * Strict finite state machine enforcing valid administrative workflow transitions:
 * - Blocks resubmission of approved, rejected, completed, or archived transactions.
 * - Blocks bypassing department approval when configured.
 * - Blocks duplicate execution of financial/grade/leave side effects via executedAt guard.
 */
export function evaluateTransactionTransition(ctx: TransitionContext): TransitionDecision {
  const { currentStatus, action, isHR, isDept, isOwner, executedAt, workflow } = ctx;

  if (currentStatus === 'مؤرشف') {
    return {
      allowed: false,
      statusCode: 409,
      error: 'المعاملة مؤرشفة ونهائية ولا يمكن تعديلها أو إعادة إرسالها.',
    };
  }

  if (action === 'RESUBMIT') {
    if (!isOwner && !isHR) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'يمكن لصاحب الطلب أو الموارد البشرية فقط إعادة إرسال المعاملة.',
      };
    }
    if (FINALIZED_STATUSES.has(currentStatus) || currentStatus !== 'معاد للتعديل') {
      return {
        allowed: false,
        statusCode: 409,
        error: 'لا يمكن إعادة تقديم المعاملة إلا إذا كانت في حالة «معاد للتعديل».',
      };
    }
    const requiresDept = workflow ? workflow.requiresDeptApproval : true;
    return {
      allowed: true,
      statusCode: 200,
      nextStatus: requiresDept ? 'بانتظار موافقة القسم' : 'بانتظار موافقة الموارد البشرية',
      nextRole: requiresDept ? 'DEPT_MANAGER' : 'HR_MANAGER',
      actionLabel: 'إعادة تقديم المعاملة بعد التعديل',
      shouldExecuteFinalEffects: false,
    };
  }

  if (action === 'APPROVE') {
    if (currentStatus === 'بانتظار موافقة القسم') {
      if (!isDept) {
        return {
          allowed: false,
          statusCode: 403,
          error: 'تتطلب هذه المرحلة صلاحية مدير القسم المختص أو الموارد البشرية.',
        };
      }
      // Cannot skip HR approval stage when required (default true)
      const requiresHr = workflow ? workflow.requiresHrApproval : true;
      if (requiresHr) {
        return {
          allowed: true,
          statusCode: 200,
          nextStatus: 'بانتظار موافقة الموارد البشرية',
          nextRole: 'HR_MANAGER',
          actionLabel: 'موافقة القسم وإحالة للموارد البشرية',
          shouldExecuteFinalEffects: false,
        };
      }
      if (executedAt) {
        return {
          allowed: false,
          statusCode: 409,
          error: 'تم تنفيذ آثار هذه المعاملة مسبقاً ولا يمكن تكرارها.',
        };
      }
      return {
        allowed: true,
        statusCode: 200,
        nextStatus: 'معتمد',
        nextRole: 'HR_ADMIN',
        actionLabel: 'اعتماد نهائي من القسم',
        setCompletedAt: true,
        shouldExecuteFinalEffects: true,
      };
    }

    if (currentStatus === 'بانتظار موافقة الموارد البشرية') {
      if (!isHR) {
        return {
          allowed: false,
          statusCode: 403,
          error: 'تتطلب هذه المرحلة صلاحية اعتماد الموارد البشرية.',
        };
      }
      if (executedAt) {
        return {
          allowed: false,
          statusCode: 409,
          error: 'تم اعتماد وتنفيذ هذه المعاملة مسبقاً.',
        };
      }
      return {
        allowed: true,
        statusCode: 200,
        nextStatus: 'معتمد',
        nextRole: 'HR_ADMIN',
        actionLabel: 'اعتماد نهائي من الموارد البشرية',
        setCompletedAt: true,
        shouldExecuteFinalEffects: true,
      };
    }

    return {
      allowed: false,
      statusCode: 409,
      error: 'المعاملة ليست في مرحلة قابلة للاعتماد.',
    };
  }

  if (action === 'REJECT') {
    if (!PENDING_APPROVAL_STATUSES.has(currentStatus)) {
      return {
        allowed: false,
        statusCode: 409,
        error: 'لا يمكن رفض معاملة منتهية أو خارج مراحل المراجعة.',
      };
    }
    if (currentStatus === 'بانتظار موافقة القسم' && !isDept) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'تتطلب هذه المرحلة صلاحية مدير القسم أو الموارد البشرية.',
      };
    }
    if (currentStatus === 'بانتظار موافقة الموارد البشرية' && !isHR) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'تتطلب هذه المرحلة صلاحية الموارد البشرية.',
      };
    }
    return {
      allowed: true,
      statusCode: 200,
      nextStatus: 'مرفوض',
      nextRole: ctx.currentRole,
      actionLabel: 'رفض المعاملة',
      setCompletedAt: true,
      shouldExecuteFinalEffects: false,
    };
  }

  if (action === 'RETURN') {
    if (!PENDING_APPROVAL_STATUSES.has(currentStatus)) {
      return {
        allowed: false,
        statusCode: 409,
        error: 'لا يمكن إعادة معاملة منتهية أو معتمدة للتعديل.',
      };
    }
    if (currentStatus === 'بانتظار موافقة القسم' && !isDept) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'تتطلب هذه المرحلة صلاحية مدير القسم أو الموارد البشرية.',
      };
    }
    if (currentStatus === 'بانتظار موافقة الموارد البشرية' && !isHR) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'تتطلب هذه المرحلة صلاحية الموارد البشرية.',
      };
    }
    return {
      allowed: true,
      statusCode: 200,
      nextStatus: 'معاد للتعديل',
      nextRole: 'EMPLOYEE',
      actionLabel: 'إعادة المعاملة للتعديل والاستكمال',
      shouldExecuteFinalEffects: false,
    };
  }

  if (action === 'ESCALATE') {
    if (!isHR && !isDept) {
      return { allowed: false, statusCode: 403, error: 'لا تملك صلاحية تصعيد المعاملة.' };
    }
    if (!PENDING_APPROVAL_STATUSES.has(currentStatus)) {
      return {
        allowed: false,
        statusCode: 409,
        error: 'لا يمكن تصعيد معاملة مكتملة أو مرفوضة أو معادة للتعديل.',
      };
    }
    return {
      allowed: true,
      statusCode: 200,
      nextStatus: currentStatus,
      nextRole: 'HR_ADMIN',
      actionLabel: 'تصعيد المعاملة للإدارة العليا',
      setEscalated: true,
      shouldExecuteFinalEffects: false,
    };
  }

  if (action === 'COMPLETE') {
    if (!isHR) {
      return { allowed: false, statusCode: 403, error: 'يتطلب إنجاز المعاملة صلاحية الموارد البشرية.' };
    }
    if (currentStatus !== 'معتمد') {
      return {
        allowed: false,
        statusCode: 409,
        error: 'لا يمكن إنجاز المعاملة قبل اعتمادها نهائياً.',
      };
    }
    return {
      allowed: true,
      statusCode: 200,
      nextStatus: 'مكتمل',
      nextRole: 'HR_ADMIN',
      actionLabel: 'إنجاز المعاملة',
      setCompletedAt: true,
      shouldExecuteFinalEffects: false,
    };
  }

  if (action === 'ARCHIVE') {
    if (!isHR) {
      return { allowed: false, statusCode: 403, error: 'تتطلب الأرشفة صلاحية الموارد البشرية.' };
    }
    if (!['معتمد', 'مكتمل', 'مرفوض'].includes(currentStatus)) {
      return {
        allowed: false,
        statusCode: 409,
        error: 'لا يمكن أرشفة معاملة ما زالت قيد المراجعة.',
      };
    }
    return {
      allowed: true,
      statusCode: 200,
      nextStatus: 'مؤرشف',
      nextRole: 'HR_ADMIN',
      actionLabel: 'أرشفة المعاملة',
      shouldExecuteFinalEffects: false,
    };
  }

  return { allowed: false, statusCode: 400, error: 'الإجراء المطلوب غير مدعوم.' };
}
