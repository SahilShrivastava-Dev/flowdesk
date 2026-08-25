import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import ContactModal from '../components/ContactModal.jsx';
import InvoiceModal from '../components/InvoiceModal.jsx';
import ContactDetailModal from '../components/ContactDetailModal.jsx';
import {
  CONTACT_TYPES, contactTypeStyle, formatMoney,
} from '../data/mockData.js';
import {
  UserPlus, Pencil, Search, FileText, Archive, MessageSquareOff, Plus,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// External parties — customers, vendors, sellers, suppliers, buyers.
//
// Modelled on TeamView deliberately: the same card, the same chips, the same
// spacing. This is a directory of people you message, and it should not look
// like a different product from the directory of people you assign work to.
//
// Two things carry their weight on every row and are worth the space:
// what they owe, and whether they have opted out. The second is not a detail —
// a row marked "opted out" is one the system will refuse to message, and
// finding that out by trying is a worse experience than seeing it here.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'parties',  label: 'Parties'  },
  { id: 'invoices', label: 'Invoices' },
];

export default function PartiesView() {
  const {
    contacts, invoices, contactsLoading, loadContacts, role,
  } = useApp();

  const [tab, setTab]           = useState('parties');
  const [query, setQuery]       = useState('');
  const [typeFilter, setType]   = useState('all');
  const [editing, setEditing]   = useState(null);   // contact being edited
  const [adding, setAdding]     = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [addingInvoice, setAddingInvoice] = useState(false);

  // Lazy: the directory is a page most sessions never open.
  React.useEffect(() => { loadContacts(); }, [loadContacts]);

  const canEdit = role === 'Admin' || role === 'Manager';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (!q) return true;
      // Aliases are searched too, so the directory finds a party by the same
      // names WhatsApp does.
      return [c.name, c.companyName, c.phone, c.externalRef, ...(c.aliases ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [contacts, query, typeFilter]);

  const totalOutstanding = useMemo(
    () => contacts.reduce((sum, c) => sum + Number(c.outstandingBalance ?? 0), 0),
    [contacts],
  );

  return (
    <div className="animate-fade-in space-y-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111827]">External parties</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">
            Customers, vendors and suppliers you can message on WhatsApp by name.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {tab === 'parties' ? (
              <button onClick={() => setAdding(true)} className="fd-btn-primary">
                <UserPlus size={16} /> Add party
              </button>
            ) : (
              <button onClick={() => setAddingInvoice(true)} className="fd-btn-primary">
                <Plus size={16} /> Record invoice
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-[#E5E7EB]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-[#1E1B3A] text-[#111827]'
                : 'border-transparent text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            {t.label}
            {t.id === 'invoices' && invoices.length > 0 && (
              <span className="ml-2 num text-[11px] text-[#6B7280]">{invoices.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'parties' ? (
        <>
          {/* ── Filters ────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, company, number or alias…"
                className="fd-input pl-9"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              <Chip active={typeFilter === 'all'} onClick={() => setType('all')}>All</Chip>
              {CONTACT_TYPES.map((t) => (
                <Chip key={t.id} active={typeFilter === t.id} onClick={() => setType(t.id)}>
                  {t.label}
                </Chip>
              ))}
            </div>
          </div>

          {totalOutstanding > 0 && (
            <p className="text-sm text-[#6B7280]">
              <span className="num font-semibold text-[#111827]">{formatMoney(totalOutstanding)}</span>
              {' '}outstanding across {contacts.filter((c) => c.outstandingBalance > 0).length} parties.
            </p>
          )}

          {contactsLoading && contacts.length === 0 ? (
            <Empty>Loading parties…</Empty>
          ) : filtered.length === 0 ? (
            <Empty>
              {contacts.length === 0
                ? 'No external parties yet. Add one so you can message them from WhatsApp by name.'
                : 'No parties match that search.'}
            </Empty>
          ) : (
            <div className="space-y-3">
              {filtered.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  canEdit={canEdit}
                  onEdit={() => setEditing(c)}
                  onOpen={() => setDetailId(c.id)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <InvoiceTable invoices={invoices} />
      )}

      {adding   && <ContactModal open onClose={() => setAdding(false)} />}
      {editing  && <ContactModal open contact={editing} onClose={() => setEditing(null)} />}
      {detailId && <ContactDetailModal open contactId={detailId} onClose={() => setDetailId(null)} />}
      {addingInvoice && <InvoiceModal open onClose={() => setAddingInvoice(false)} />}
    </div>
  );
}

function ContactRow({ contact, canEdit, onEdit, onOpen }) {
  const style = contactTypeStyle(contact.type);
  const optedOut = Boolean(contact.optOutAt);

  return (
    <div className="fd-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow group">
      <button onClick={onOpen} className="flex items-center gap-4 min-w-0 flex-1 text-left">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${style.bg} ${style.text}`}>
          {initials(contact.name)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-[#111827] text-sm truncate">{contact.name}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${style.bg} ${style.text}`}>
              {style.label}
            </span>
            {optedOut && (
              // Not decoration. The system will refuse to message this row, and
              // discovering that by trying is worse than seeing it here.
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEE2E2] text-[#B91C1C]">
                <MessageSquareOff size={11} /> Opted out
              </span>
            )}
          </div>
          <p className="text-xs text-[#6B7280] truncate mt-0.5">
            {[contact.companyName, maskPhone(contact.phone), contact.address].filter(Boolean).join(' · ')}
          </p>
        </div>
      </button>

      <div className="flex items-center gap-4 shrink-0">
        {contact.outstandingBalance > 0 && (
          <div className="text-right">
            <p className="num text-sm font-bold text-[#B45309]">
              {formatMoney(contact.outstandingBalance)}
            </p>
            <p className="text-[11px] text-[#6B7280]">
              {contact.openInvoiceCount} open {contact.openInvoiceCount === 1 ? 'invoice' : 'invoices'}
            </p>
          </div>
        )}
        {canEdit && (
          <button
            onClick={onEdit}
            className="p-2 rounded-full text-[#6B7280] hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Edit"
          >
            <Pencil size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function InvoiceTable({ invoices }) {
  const { updateInvoice, role } = useApp();
  const canEdit = role === 'Admin' || role === 'Manager';

  if (invoices.length === 0) {
    return (
      <Empty>
        No invoices recorded. Adding one lets a WhatsApp reminder quote the real
        outstanding amount instead of a number somebody typed from memory.
      </Empty>
    );
  }

  const sorted = [...invoices].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  return (
    <div className="fd-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#6B7280] bg-[#F9FAFB]">
              <Th>Reference</Th><Th>Party</Th><Th>Direction</Th>
              <Th className="text-right">Amount</Th><Th className="text-right">Outstanding</Th>
              <Th>Due</Th><Th>Status</Th>{canEdit && <Th />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {sorted.map((inv) => {
              const overdue = inv.status !== 'paid'
                && inv.status !== 'cancelled'
                && new Date(inv.dueDate) < new Date();
              return (
                <tr key={inv.id} className="hover:bg-[#FAFAFA]">
                  <Td><span className="num font-semibold text-[#111827]">{inv.number}</span></Td>
                  <Td className="text-[#374151]">{inv.contact?.name ?? '—'}</Td>
                  <Td>
                    {/* The two directions produce opposite messages, so the row
                        says which one this bill would send. */}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      inv.payable ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#DBEAFE] text-[#1D4ED8]'
                    }`}>
                      {inv.payable ? 'We owe' : 'They owe'}
                    </span>
                  </Td>
                  <Td className="text-right num text-[#374151]">{formatMoney(inv.amount, inv.currency)}</Td>
                  <Td className="text-right num font-semibold text-[#111827]">{formatMoney(inv.balance, inv.currency)}</Td>
                  <Td className={overdue ? 'text-[#B91C1C] font-semibold' : 'text-[#6B7280]'}>
                    {new Date(inv.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </Td>
                  <Td><StatusPill status={inv.status} /></Td>
                  {canEdit && (
                    <Td className="text-right">
                      {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                        <button
                          onClick={() => updateInvoice(inv.id, { balance: 0 })}
                          className="text-xs font-semibold text-[#15803D] hover:underline"
                        >
                          Mark paid
                        </button>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const style = {
    open:      'bg-[#DBEAFE] text-[#1D4ED8]',
    partial:   'bg-[#FEF3C7] text-[#B45309]',
    paid:      'bg-[#DCFCE7] text-[#15803D]',
    cancelled: 'bg-[#F3F4F6] text-[#6B7280]',
  }[status] ?? 'bg-[#F3F4F6] text-[#6B7280]';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${style}`}>
      {status}
    </span>
  );
}

const Th = ({ children, className = '' }) => (
  <th className={`px-4 py-2.5 font-semibold ${className}`}>{children}</th>
);
const Td = ({ children, className = '' }) => (
  <td className={`px-4 py-3 ${className}`}>{children}</td>
);

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active ? 'bg-[#1E1B3A] text-white' : 'bg-white border border-[#E5E7EB] text-[#374151] hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ children }) {
  return (
    <div className="fd-card p-10 text-center">
      <FileText size={22} className="mx-auto text-[#D1D5DB] mb-2" />
      <p className="text-sm text-[#6B7280] max-w-md mx-auto">{children}</p>
    </div>
  );
}

function initials(name) {
  return (name ?? '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/**
 * Enough of the number to recognise it, not enough to copy out of a screenshot.
 * The full number is on the detail panel, where opening it is a deliberate act.
 */
function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `+${digits.slice(0, 2)} ••••${digits.slice(-4)}`;
}
