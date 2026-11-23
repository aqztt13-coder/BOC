import React, { useMemo, useState } from 'react';
import { History, Search, ShieldCheck } from 'lucide-react';
import type { AuditLogRecord } from '../types/hrms';

interface AuditViewProps {
  auditLogs: AuditLogRecord[];
}

export const AuditView: React.FC<AuditViewProps> = ({ auditLogs }) => {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const recordTypes = useMemo(
    () => Array.from(new Set(auditLogs.map((l) => l.recordType))).sort(),
    [auditLogs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (typeFilter !== 'ALL' && log.recordType !== typeFilter) return false;
      if (q) {
        return (
          log.actorName.toLowerCase().includes(q) ||
          log.actorEmail.toLowerCase().includes(q) ||
          log.details.toLowerCase().includes(q) ||
          log.operation.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [auditLogs, search, typeFilter]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالمستخدم، العملية، أو تفاصيل التغيير..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 ps-9 pe-3 text-xs"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold"
          >
            <option value="ALL">كل أنواع السجلات</option>
            {recordTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>سجل غير قابل للتعديل ({filtered.length} عملية)</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            <History className="h-8 w-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            لا توجد عمليات مسجلة في سجل التدقيق بعد.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((log) => {
              const hasDiff = Boolean(log.previousValues || log.newValues);
              const isOpen = expandedId === log.id;
              return (
                <div key={log.id} className="p-4 text-xs">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-bold text-slate-900 dark:text-white">{log.details}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        المستخدم: <strong>{log.actorName}</strong> ({log.actorRole}) ·{' '}
                        <span dir="ltr" className="font-mono">{log.operation}</span> · {log.recordType} #{log.recordId}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {hasDiff && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : log.id)}
                          className="text-[11px] font-semibold text-[#0B1F3A] dark:text-[#E5B94C] hover:underline cursor-pointer"
                        >
                          {isOpen ? 'إخفاء القيم' : 'عرض القيم السابقة والجديدة'}
                        </button>
                      )}
                      <span dir="ltr" className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {log.createdAt.slice(0, 19).replace('T', ' ')}
                      </span>
                    </div>
                  </div>
                  {isOpen && hasDiff && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 font-mono text-[11px]" dir="ltr">
                      <div>
                        <p className="font-bold text-slate-500 mb-1">Previous Values</p>
                        <pre className="whitespace-pre-wrap break-all text-slate-700 dark:text-slate-300">
                          {JSON.stringify(log.previousValues || {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="font-bold text-slate-500 mb-1">New Values</p>
                        <pre className="whitespace-pre-wrap break-all text-slate-700 dark:text-slate-300">
                          {JSON.stringify(log.newValues || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
