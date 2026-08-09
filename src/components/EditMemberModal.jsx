import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { Save, Trash2, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { phoneError } from '../lib/phone.js';

/** Marks a field the form won't save without. */
const Req = () => <span className="text-[#EF4444] ml-0.5" title="Required">*</span>;

/** Red outline on the field that failed validation. */
const inputCls = (invalid) =>
  `fd-input${invalid ? ' border-[#EF4444] ring-1 ring-[#EF4444]' : ''}`;

const AVATAR_COLORS = [
  'from-fuchsia-500 to-purple-600', 'from-rose-500 to-orange-500',
  'from-sky-500 to-indigo-500',     'from-emerald-500 to-teal-500',
  'from-amber-500 to-rose-500',     'from-pink-500 to-fuchsia-500',
  'from-blue-500 to-cyan-500',      'from-violet-500 to-indigo-500',
  'from-lime-500 to-emerald-500',   'from-rose-400 to-pink-500',
  'from-cyan-500 to-blue-600',      'from-orange-400 to-amber-500',
];

const ROLE_STYLE = {
  Admin:    { bg: 'bg-[#EDE9FE]', text: 'text-[#6D28D9]' },
  Manager:  { bg: 'bg-[#DBEAFE]', text: 'text-[#1D4ED8]' },
  Employee: { bg: 'bg-[#F3F4F6]', text: 'text-[#374151]' },
};

export default function EditMemberModal({ user, onClose }) {
  const { users, updateUser, deleteUser } = useApp();
  const open = !!user;

  // Form state — populated from user prop whenever it changes
  const [name,              setName]              = useState('');
  const [phone,             setPhone]             = useState('');
  const [email,             setEmail]             = useState('');
  const [password,          setPassword]          = useState(''); // blank = no change
  const [role,              setRole]              = useState('Employee');
  const [reportsTo,         setReportsTo]         = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [error,             setError]             = useState('');
  const [invalidField,      setInvalidField]      = useState(null);
  const [loading,           setLoading]           = useState(false);
  const [confirmDelete,     setConfirmDelete]     = useState(false);
  const [deleting,          setDeleting]          = useState(false);

  // Focused when validation fails, so the cursor lands on the problem instead
  // of leaving the person to hunt for it.
  const refs = {
    name:      useRef(null),
    phone:     useRef(null),
    email:     useRef(null),
    password:  useRef(null),
    reportsTo: useRef(null),
  };

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? '');
    setPhone(user.phone ?? '');
    setEmail(user.email ?? '');
    setPassword('');
    setRole(user.role ?? 'Employee');
    setReportsTo(user.reportingTo ?? user.reportingToId ?? '');
    setPreferredLanguage(user.preferredLanguage ?? 'en');
    setError('');
    setInvalidField(null);
    setConfirmDelete(false);
  }, [user]);

  const eligibleManagers = users.filter((u) => {
    if (u.id === user?.id) return false; // can't report to yourself
    if (role === 'Employee') return u.role === 'Manager' || u.role === 'Admin';
    if (role === 'Manager')  return u.role === 'Admin';
    return false;
  });

  const initials  = name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const avatarColor = user?.color || AVATAR_COLORS[0];
  const rs = ROLE_STYLE[role] || ROLE_STYLE.Employee;

  // Optional here, unlike Add: an existing member may legitimately have no
  // number yet, and clearing one should not be blocked. A number that IS
  // present still has to be usable.
  const phoneProblem = phoneError(phone, { required: false });

  const handleRoleChange = (val) => { setRole(val); setReportsTo(''); };

  /** Flag the offending field, say why, and put the cursor there. */
  const fail = (field, message) => {
    setInvalidField(field);
    setError(message);
    refs[field]?.current?.focus();
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setInvalidField(null);

    // Every check below used to ALSO gate `disabled` on the Save button, so a
    // missing field produced a button that did nothing at all — no message, no
    // indication which field was wrong. The button now always accepts the
    // click and answers the question.
    if (!name.trim())                    return fail('name',      'Full name is required.');
    if (!email.trim())                   return fail('email',     'Email is required — this is how they sign in.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return fail('email', 'That email address doesn\'t look right.');
    if (phoneProblem)                    return fail('phone',     phoneProblem);
    if (password && password.length < 8)  return fail('password',  'New password must be at least 8 characters.');
    if (role !== 'Admin' && !reportsTo)  return fail('reportsTo', 'Please select who this person reports to.');

    setLoading(true);
    try {
      const patch = {
        name:              name.trim(),
        email:             email.trim().toLowerCase(),
        phone:             phone.trim() || null,
        role,
        reportingToId:     reportsTo || null,
        preferredLanguage,
      };
      if (password) patch.password = password;
      await updateUser(user.id, patch);
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to save changes.');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteUser(user.id);
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to delete member.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit member"
      subtitle={`${user?.id} · changes take effect immediately`}
      maxWidth="max-w-lg"
      footer={
        <>
          {/* Delete section — left side */}
          <div className="flex-1">
            {!confirmDelete ? (
              <button
                className="fd-btn-secondary text-[#EF4444] border-red-200 hover:bg-red-50 hover:border-red-300"
                onClick={() => setConfirmDelete(true)}
                disabled={loading || deleting}
              >
                <Trash2 className="h-4 w-4" /> Remove Member
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-[#B91C1C]">
                  Remove {user?.name}? If they have task history they'll be
                  deactivated rather than deleted, so the audit trail survives.
                </span>
                <button
                  className="fd-btn-primary bg-[#EF4444] hover:bg-[#DC2626] text-xs"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Removing…' : 'Yes, remove'}
                </button>
                <button
                  className="fd-btn-secondary text-xs"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Save / Cancel — right side */}
          <button className="fd-btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          {/* Only disabled while the request is in flight. A missing field is
              answered with a message, not with a dead button. */}
          <button
            className="fd-btn-primary"
            onClick={save}
            disabled={loading || deleting}
          >
            <Save className="h-4 w-4" />
            {loading ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4">
        {/* Live avatar preview */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
          <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white font-bold text-sm shrink-0`}>
            {initials || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#111827] truncate">{name.trim() || user?.name}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${rs.bg} ${rs.text}`}>
              {role}
            </span>
            {/* Somebody who has left. They keep their task history — that's why
                they still exist — but they can't sign in or be given work. */}
            {user?.deactivatedAt && (
              <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F3F4F6] text-[#6B7280]">
                Inactive
              </span>
            )}
          </div>
          <p className="ml-auto text-[11px] text-[#9CA3AF] font-mono">{user?.id}</p>
        </div>

        <p className="text-[11px] text-[#9CA3AF]">
          Fields marked <Req /> are required.
        </p>

        {/* Full Name */}
        <div>
          <label className="label">Full Name<Req /></label>
          <input
            ref={refs.name}
            className={inputCls(invalidField === 'name')}
            value={name}
            onChange={e => { setName(e.target.value); setInvalidField(null); }}
            placeholder="e.g. Rahul Verma"
          />
        </div>

        {/* WhatsApp Number — full width, so the country-code note has room */}
        <div>
          <label className="label flex items-center gap-2">
            <span>WhatsApp Number</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#D1FAE5] text-[#065F46] uppercase tracking-wide">
              Required for alerts
            </span>
          </label>
          <input
            ref={refs.phone}
            className={inputCls(invalidField === 'phone')}
            value={phone}
            onChange={e => { setPhone(e.target.value); setInvalidField(null); }}
            placeholder="+91 98765 43210"
            type="tel"
          />
          {/* Warn while they type. A number missing its country code is
              accepted by WhatsApp and then silently fails to deliver, so this
              is the only cheap moment to catch it. */}
          {phone.trim() && phoneProblem ? (
            <p className="text-[11px] text-[#B45309] mt-1 leading-relaxed">{phoneProblem}</p>
          ) : (
            <p className="text-[11px] text-[#9CA3AF] mt-1 leading-relaxed">
              Must include the country code (e.g. +91 for India).
              All task assignments, reminders, and escalation alerts go to this number.
            </p>
          )}
        </div>

        {/* Notification Language */}
        <div>
          <label className="label flex items-center gap-2">
            Notification Language
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#EDE9FE] text-[#6D28D9] uppercase tracking-wide">
              WhatsApp
            </span>
          </label>
          <select
            className="fd-input"
            value={preferredLanguage}
            onChange={e => setPreferredLanguage(e.target.value)}
          >
            {/* Only languages with approved WhatsApp templates belong here.
                Marathi was offered without any `*_mr` template existing, so
                picking it quietly sent English anyway. */}
            <option value="en">🇬🇧 English</option>
            <option value="hi">🇮🇳 हिंदी — Hindi</option>
          </select>
        </div>

        {/* Email + Password */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Email<Req /></label>
            <input
              ref={refs.email}
              className={inputCls(invalidField === 'email')}
              value={email}
              onChange={e => { setEmail(e.target.value); setInvalidField(null); }}
              placeholder="name@company.com"
              type="email"
            />
          </div>
          <div>
            <label className="label">New Password</label>
            <input
              ref={refs.password}
              className={inputCls(invalidField === 'password')}
              value={password}
              onChange={e => { setPassword(e.target.value); setInvalidField(null); }}
              placeholder="Leave blank to keep current"
              type="password"
            />
          </div>
        </div>

        {/* Hierarchy */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF] mb-2">Hierarchy</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Role</label>
              <select className="fd-input" value={role} onChange={e => handleRoleChange(e.target.value)}>
                <option value="Employee">Employee</option>
                <option value="Manager">Manager</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
            {role !== 'Admin' ? (
              <div>
                <label className="label">Reports To<Req /></label>
                <select
                  ref={refs.reportsTo}
                  className={inputCls(invalidField === 'reportsTo')}
                  value={reportsTo}
                  onChange={e => { setReportsTo(e.target.value); setInvalidField(null); }}
                >
                  <option value="">Select…</option>
                  {eligibleManagers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
                  ))}
                </select>
                {eligibleManagers.length === 0 && (
                  <p className="text-[11px] text-[#EF4444] mt-1">
                    No {role === 'Employee' ? 'managers' : 'admins'} found. Add one first.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-end pb-1">
                <p className="text-xs text-[#9CA3AF]">Admins have full access and don't report to anyone.</p>
              </div>
            )}
          </div>

          {/* Hierarchy hint */}
          {reportsTo && (() => {
            const mgr = users.find(u => u.id === reportsTo);
            return mgr ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
                <span>{name.trim() || 'This person'}</span>
                <span className="text-[#D1D5DB]">→ reports to →</span>
                <span className="font-semibold text-[#374151]">{mgr.name}</span>
                <span className="text-[#D1D5DB]">({mgr.role})</span>
              </div>
            ) : null;
          })()}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100">
            <AlertTriangle className="h-4 w-4 text-[#EF4444] mt-0.5 shrink-0" />
            <p className="text-xs font-medium text-[#B91C1C]">{error}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
