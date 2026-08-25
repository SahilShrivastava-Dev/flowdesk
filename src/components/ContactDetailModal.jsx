import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import StatusBadge from './StatusBadge.jsx';
import { useApp } from '../context/AppContext.jsx';
import {
  contactTypeStyle, formatMoney, taskKindLabel,
} from '../data/mockData.js';
import { MessageSquareOff, Phone, Mail, MapPin, Hash } from 'lucide-react';

/**
 * Everything on one party: their details, what they owe, the work filed
 * against them, and the WhatsApp thread.
 *
 * The brief asked for "related invoices/tasks/messages where applicable" and
 * this is that, in one place — because the question somebody actually has when
 * they open a party is "where do we stand with these people", which none of
 * those three answers alone.
 */
export default function ContactDetailModal({ open, onClose, contactId }) {
  const { fetchContactDetail } = useApp();
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchContactDetail(contactId)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [contactId, fetchContactDetail]);

  const style = contactTypeStyle(data?.type);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data?.name ?? 'Party'}
      subtitle={data?.companyName ?? undefined}
      maxWidth="max-w-3xl"
    >
      {error && <p className="text-sm text-[#B91C1C]">{error}</p>}
      {!data && !error && <p className="text-sm text-[#6B7280]">Loading…</p>}

      {data && (
        <div className="space-y-5">
          {/* ── Identity ───────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${style.bg} ${style.text}`}>
              {style.label}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F3F4F6] text-[#374151]">
              {data.preferredLanguage === 'hi' ? 'Messages in हिन्दी' : 'Messages in English'}
            </span>
            {data.optOutAt && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEE2E2] text-[#B91C1C]">
                <MessageSquareOff size={11} /> Opted out — no messages will be sent
              </span>
            )}
            {!data.optOutAt && !data.optInAt && (
              // Not blocking today, but worth surfacing: Meta expects a recorded
              // opt-in, and the flag that enforces it may be turned on later.
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF3C7] text-[#B45309]">
                No opt-in recorded
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Detail icon={Phone}  value={formatPhone(data.phone)} />
            <Detail icon={Mail}   value={data.email} />
            <Detail icon={MapPin} value={data.address} />
            <Detail icon={Hash}   value={data.externalRef} />
          </div>

          {data.aliases?.length > 0 && (
            <p className="text-xs text-[#6B7280]">
              Also matches on WhatsApp as: {data.aliases.join(', ')}
            </p>
          )}

          {data.notes && (
            <p className="text-sm text-[#374151] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2">
              {data.notes}
            </p>
          )}

          <Section title="Invoices" count={data.invoices?.length}>
            {data.invoices?.length ? (
              <ul className="divide-y divide-[#F3F4F6]">
                {data.invoices.map((inv) => (
                  <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="num text-sm font-semibold text-[#111827]">{inv.number}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {inv.payable ? 'We owe' : 'They owe'} · due{' '}
                        {new Date(inv.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <p className="num text-sm font-bold text-[#111827] shrink-0">
                      {formatMoney(inv.balance, inv.currency)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : <None>No invoices recorded.</None>}
          </Section>

          <Section title="Work" count={data.tasks?.length}>
            {data.tasks?.length ? (
              <ul className="divide-y divide-[#F3F4F6]">
                {data.tasks.map((t) => (
                  <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[#111827] truncate">{t.title}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {taskKindLabel(t.kind)} · {t.assignedTo?.name ?? '—'} · {t.id}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            ) : <None>No tasks filed against this party.</None>}
          </Section>

          <Section title="WhatsApp" count={data.messages?.length}>
            {data.messages?.length ? (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {data.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`text-sm rounded-xl px-3 py-2 max-w-[85%] ${
                      m.direction === 'inbound'
                        ? 'bg-[#F3F4F6] text-[#111827]'
                        : 'bg-[#DCF8C6] text-[#111827] ml-auto'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className="text-[10px] text-[#6B7280] mt-1">
                      {new Date(m.createdAt).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                      {m.deliveryStatus === 'failed' && (
                        <span className="text-[#B91C1C] font-semibold"> · not delivered</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ) : <None>Nothing has been sent to this party yet.</None>}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function Section({ title, count, children }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280] mb-1.5">
        {title}{typeof count === 'number' && count > 0 && <span className="num ml-1.5">{count}</span>}
      </h3>
      {children}
    </div>
  );
}

const None = ({ children }) => <p className="text-sm text-[#9CA3AF]">{children}</p>;

function Detail({ icon: Icon, value }) {
  if (!value) return null;
  return (
    <span className="flex items-center gap-2 text-[#374151] min-w-0">
      <Icon size={14} className="text-[#9CA3AF] shrink-0" />
      <span className="truncate">{value}</span>
    </span>
  );
}

/** "+91 98765 43210" — readable, and this panel is where the full number lives. */
function formatPhone(phone) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : null;
}
