import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { useApp } from '../context/AppContext.jsx';
import { CONTACT_TYPES } from '../data/mockData.js';

/**
 * Add or edit an external party.
 *
 * The phone number is the load-bearing field: it is how an inbound reply is
 * matched back to this party, and the backend refuses a number that already
 * belongs to a colleague or another contact. That refusal comes back as a
 * plain sentence, which is shown verbatim rather than being restated here —
 * the same rule enforced in two places is how the two end up disagreeing.
 */
export default function ContactModal({ open, onClose, contact }) {
  const { addContact, updateContact, users, role, activeUser } = useApp();
  const editing = Boolean(contact);

  const [form, setForm] = useState(() => ({
    name:              contact?.name ?? '',
    companyName:       contact?.companyName ?? '',
    phone:             contact?.phone ?? '',
    type:              contact?.type ?? 'customer',
    email:             contact?.email ?? '',
    address:           contact?.address ?? '',
    notes:             contact?.notes ?? '',
    externalRef:       contact?.externalRef ?? '',
    preferredLanguage: contact?.preferredLanguage ?? 'en',
    ownerId:           contact?.ownerId ?? activeUser?.id ?? '',
    aliasText:         (contact?.aliases ?? []).join(', '),
  }));

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) { setError('A name is required.'); return; }
    if (!form.phone.replace(/\D/g, '')) { setError('A WhatsApp number is required.'); return; }

    const payload = {
      name:        form.name.trim(),
      companyName: form.companyName.trim() || null,
      phone:       form.phone.trim(),
      type:        form.type,
      email:       form.email.trim() || null,
      address:     form.address.trim() || null,
      notes:       form.notes,
      externalRef: form.externalRef.trim() || null,
      preferredLanguage: form.preferredLanguage,
      // Aliases are how "Ramesh Traders", "रमेश ट्रेडर्स" and "RT" all resolve to
      // one row when somebody types a name on WhatsApp.
      aliases:     form.aliasText.split(',').map((a) => a.trim()).filter(Boolean),
      ...(role === 'Admin' && form.ownerId ? { ownerId: form.ownerId } : {}),
    };

    setSaving(true);
    try {
      if (editing) await updateContact(contact.id, payload);
      else         await addContact(payload);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit party' : 'Add external party'}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" required>
            <input className="fd-input" value={form.name} onChange={set('name')} placeholder="Ramesh Traders" autoFocus />
          </Field>
          <Field label="Company">
            <input className="fd-input" value={form.companyName} onChange={set('companyName')} placeholder="Ramesh Traders Pvt Ltd" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="WhatsApp number" required hint="With country code, e.g. 91 98765 43210">
            <input className="fd-input" value={form.phone} onChange={set('phone')} placeholder="919876543210" inputMode="tel" />
          </Field>
          <Field label="Type">
            <select className="fd-input" value={form.type} onChange={set('type')}>
              {CONTACT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Message language" hint="Picks which approved template they receive">
            <select className="fd-input" value={form.preferredLanguage} onChange={set('preferredLanguage')}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
            </select>
          </Field>
          <Field label="Owner" hint="Who here is responsible for this relationship">
            <select
              className="fd-input"
              value={form.ownerId}
              onChange={set('ownerId')}
              disabled={role !== 'Admin'}
            >
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Also known as" hint="Comma separated. Other names, short forms, or the Hindi spelling — all of them will match on WhatsApp.">
          <input className="fd-input" value={form.aliasText} onChange={set('aliasText')} placeholder="रमेश ट्रेडर्स, RT" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email">
            <input className="fd-input" value={form.email} onChange={set('email')} type="email" />
          </Field>
          <Field label="Account / GST reference">
            <input className="fd-input" value={form.externalRef} onChange={set('externalRef')} />
          </Field>
        </div>

        <Field label="Address">
          <input className="fd-input" value={form.address} onChange={set('address')} placeholder="Jaipur, Rajasthan" />
        </Field>

        <Field label="Notes">
          <textarea className="fd-input min-h-[72px]" value={form.notes} onChange={set('notes')} />
        </Field>

        {error && (
          <p className="text-sm text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="fd-btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="fd-btn-primary">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add party'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#374151] mb-1">
        {label}{required && <span className="text-[#DC2626]"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-[#6B7280] mt-1">{hint}</span>}
    </label>
  );
}
