import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { useApp } from '../context/AppContext.jsx';

/**
 * Record a bill.
 *
 * The `payable` toggle is the field that matters most and is easiest to get
 * wrong: it decides which of two approved WhatsApp templates a reminder uses,
 * and the two say opposite things. "We owe them" tells a vendor money is
 * coming; "they owe us" asks a customer to pay. So it is a labelled choice
 * with both sentences spelled out, not a checkbox called "payable".
 */
export default function InvoiceModal({ open, onClose, contactId }) {
  const { contacts, addInvoice } = useApp();

  const [form, setForm] = useState({
    number:    '',
    contactId: contactId ?? contacts[0]?.id ?? '',
    amount:    '',
    dueDate:   '',
    payable:   false,
    notes:     '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);

    const amount = Number(form.amount);
    if (!form.number.trim())        { setError('A reference number is required.'); return; }
    if (!form.contactId)            { setError('Choose the party this bill belongs to.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!form.dueDate)              { setError('A due date is required.'); return; }

    setSaving(true);
    try {
      await addInvoice({
        number:    form.number.trim(),
        contactId: form.contactId,
        amount,
        dueDate:   new Date(`${form.dueDate}T12:00:00`).toISOString(),
        payable:   form.payable,
        notes:     form.notes,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record an invoice">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-[#374151] mb-1">Reference <span className="text-[#DC2626]">*</span></span>
            <input className="fd-input" value={form.number} onChange={set('number')} placeholder="INV-102" autoFocus />
            <span className="block text-[11px] text-[#6B7280] mt-1">
              This is what somebody types on WhatsApp to pull up the real amount.
            </span>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-[#374151] mb-1">Party <span className="text-[#DC2626]">*</span></span>
            <select className="fd-input" value={form.contactId} onChange={set('contactId')}>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.companyName ? ` — ${c.companyName}` : ''}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-[#374151] mb-1">Amount (₹) <span className="text-[#DC2626]">*</span></span>
            <input className="fd-input num" value={form.amount} onChange={set('amount')} inputMode="decimal" placeholder="45000" />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-[#374151] mb-1">Due date <span className="text-[#DC2626]">*</span></span>
            <input className="fd-input" type="date" value={form.dueDate} onChange={set('dueDate')} />
          </label>
        </div>

        <fieldset>
          <legend className="block text-xs font-semibold text-[#374151] mb-1.5">Which way does the money go?</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Direction
              active={!form.payable}
              onClick={() => setForm((f) => ({ ...f, payable: false }))}
              title="They owe us"
              example="“Amount pending: ₹45,000. Kindly arrange the payment.”"
            />
            <Direction
              active={form.payable}
              onClick={() => setForm((f) => ({ ...f, payable: true }))}
              title="We owe them"
              example="“Amount: ₹45,000. Scheduled for 12 September.”"
            />
          </div>
        </fieldset>

        <label className="block">
          <span className="block text-xs font-semibold text-[#374151] mb-1">Notes</span>
          <textarea className="fd-input min-h-[64px]" value={form.notes} onChange={set('notes')} />
        </label>

        {error && (
          <p className="text-sm text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="fd-btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="fd-btn-primary">
            {saving ? 'Saving…' : 'Record invoice'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Direction({ active, onClick, title, example }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-xl border transition-colors ${
        active ? 'border-[#1E1B3A] bg-[#F5F3FF]' : 'border-[#E5E7EB] bg-white hover:bg-gray-50'
      }`}
    >
      <span className="block text-sm font-semibold text-[#111827]">{title}</span>
      <span className="block text-[11px] text-[#6B7280] mt-1 leading-snug">{example}</span>
    </button>
  );
}
