import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { formatMoney } from '../data/mockData.js';
import {
  CheckCircle2, HelpCircle, XCircle, AlertTriangle, Clock, Undo2, Mic,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// What people asked for over WhatsApp, and what happened.
//
// A reader over the audit rows the executor already writes — including the
// refusals, which is the point. "I sent it and nothing happened" is the
// commonest support question a natural-language interface produces, and it is
// almost never a bug: the sender was outside their permissions, the confidence
// was too low to act on, or a name matched nobody. Each of those has a row
// here saying so, in the same words the sender was given.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META = {
  executed:              { label: 'Done',        icon: CheckCircle2,  cls: 'bg-[#DCFCE7] text-[#15803D]' },
  clarifying:            { label: 'Asked back',  icon: HelpCircle,    cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  awaiting_confirmation: { label: 'Confirming',  icon: Clock,         cls: 'bg-[#FEF3C7] text-[#B45309]' },
  cancelled:             { label: 'Cancelled',   icon: XCircle,       cls: 'bg-[#F3F4F6] text-[#6B7280]' },
  rejected:              { label: 'Refused',     icon: XCircle,       cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
  failed:                { label: 'Error',       icon: AlertTriangle, cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
};

const FILTERS = [
  { id: 'all',        label: 'All'        },
  { id: 'executed',   label: 'Done'       },
  { id: 'clarifying', label: 'Asked back' },
  { id: 'rejected',   label: 'Refused'    },
  { id: 'failed',     label: 'Errors'     },
];

export default function CommandLogView() {
  const { role } = useApp();
  const [rows, setRows]     = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState(null);

  const usingApi = Boolean(import.meta.env.VITE_API_URL);

  useEffect(() => {
    if (!usingApi) { setLoad(false); return; }
    let alive = true;
    api.get('/api/commands?limit=200')
      .then((data) => { if (alive) setRows(data ?? []); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoad(false); });
    return () => { alive = false; };
  }, [usingApi]);

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  if (role !== 'Admin') {
    return <Note>Only an Admin can see the WhatsApp command log.</Note>;
  }
  if (!usingApi) {
    return <Note>The command log reads live data and is not available in the demo build.</Note>;
  }
  if (loading) return <Note>Loading…</Note>;
  if (error)   return <Note>{error}</Note>;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map((f) => {
          const count = f.id === 'all' ? rows.length : rows.filter((r) => r.status === f.id).length;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filter === f.id
                  ? 'bg-[#1E1B3A] text-white'
                  : 'bg-white border border-[#E5E7EB] text-[#374151] hover:bg-gray-50'
              }`}
            >
              {f.label}<span className={`num ml-1.5 ${filter === f.id ? 'text-white/70' : 'text-[#9CA3AF]'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Note>Nothing here yet.</Note>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => <CommandRow key={r.id} row={r} />)}
        </ul>
      )}
    </div>
  );
}

function CommandRow({ row }) {
  const meta = STATUS_META[row.status] ?? STATUS_META.failed;
  const Icon = meta.icon;

  return (
    <li className="fd-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.cls}`}>
              <Icon size={11} /> {meta.label}
            </span>
            <span className="text-xs font-semibold text-[#374151]">{row.sender?.name ?? 'Unknown'}</span>
            {row.senderPhoneLast4 && (
              <span className="num text-[11px] text-[#9CA3AF]">••••{row.senderPhoneLast4}</span>
            )}
            {row.intent && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#F3F4F6] text-[#374151]">
                {row.intent}
              </span>
            )}
            {typeof row.confidence === 'number' && (
              <span className="num text-[10px] text-[#9CA3AF]">
                {Math.round(row.confidence * 100)}% sure
              </span>
            )}
            {row.confirmed && (
              <span className="text-[10px] text-[#15803D] font-semibold">confirmed</span>
            )}
            {row.undoneAt && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#B45309] font-semibold">
                <Undo2 size={10} /> undone
              </span>
            )}
          </div>

          {/* What they actually sent. A voice note shows the transcript that was
              acted on, not the fact that audio arrived. */}
          <p className="text-sm text-[#111827] mt-1.5 break-words">
            {row.transcription && <Mic size={12} className="inline mr-1 text-[#9CA3AF]" />}
            “{row.transcription || row.rawText || '—'}”
          </p>

          {/* Why it was refused, in the same sentence the sender was given. */}
          {row.errorReason && (
            <p className="text-xs text-[#6B7280] mt-1 break-words">↳ {row.errorReason}</p>
          )}

          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            {row.summary?.contact && <Pill>{row.summary.contact}</Pill>}
            {row.summary?.amount != null && <Pill>{formatMoney(row.summary.amount)}</Pill>}
            {row.summary?.reference && <Pill>{row.summary.reference}</Pill>}
            {row.summary?.targets?.map((t) => <Pill key={t}>{t}</Pill>)}
            {row.task ? (
              <Pill>{row.task.id} · {row.task.title}</Pill>
            ) : row.taskId ? (
              // The command named a ticket that does not exist — which is
              // usually the reason nothing happened, so it is said plainly.
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEE2E2] text-[#B91C1C]">
                {row.taskId} not found
              </span>
            ) : null}
          </div>
        </div>

        <time className="text-[10px] text-[#9CA3AF] shrink-0 whitespace-nowrap">
          {new Date(row.createdAt).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </time>
      </div>
    </li>
  );
}

const Pill = ({ children }) => (
  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F3F4F6] text-[#374151]">
    {children}
  </span>
);

const Note = ({ children }) => (
  <div className="fd-card p-8 text-center">
    <p className="text-sm text-[#6B7280]">{children}</p>
  </div>
);
