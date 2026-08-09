import React, { useState, useRef } from 'react';
import Modal from './Modal.jsx';
import { UserPlus } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { phoneError } from '../lib/phone.js';

/** Marks a field the form won't submit without. */
const Req = () => <span className="text-[#EF4444] ml-0.5" title="Required">*</span>;

/** Red outline on the field that failed validation. */
const inputCls = (invalid) =>
  `fd-input${invalid ? ' border-[#EF4444] ring-1 ring-[#EF4444]' : ''}`;

const AVATAR_COLORS = [
  'from-fuchsia-500 to-purple-600',
  'from-rose-500 to-orange-500',
  'from-sky-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-rose-500',
  'from-pink-500 to-fuchsia-500',
  'from-blue-500 to-cyan-500',
  'from-violet-500 to-indigo-500',
  'from-lime-500 to-emerald-500',
  'from-rose-400 to-pink-500',
  'from-cyan-500 to-blue-600',
  'from-orange-400 to-amber-500',
];

const ROLE_STYLE = {
  Admin:    { bg: 'bg-[#EDE9FE]', text: 'text-[#6D28D9]' },
  Manager:  { bg: 'bg-[#DBEAFE]', text: 'text-[#1D4ED8]' },
  Employee: { bg: 'bg-[#F3F4F6]', text: 'text-[#374151]' },
};

export default function AddMemberModal({ open, onClose }) {
  const { users, addUser } = useApp();

  const [name,              setName]              = useState('');
  const [phone,             setPhone]             = useState('');
  const [email,             setEmail]             = useState('');
  const [password,          setPassword]          = useState('');
  const [role,              setRole]              = useState('Employee');
  const [reportsTo,         setReportsTo]         = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [error,             setError]             = useState('');
  const [invalidField,      setInvalidField]      = useState(null);
  const [loading,           setLoading]           = useState(false);

  // Focused when validation fails, so the cursor lands on the problem instead
  // of leaving the person to hunt for it.
  const refs = {
    name:      useRef(null),
    phone:     useRef(null),
    email:     useRef(null),
    password:  useRef(null),
    reportsTo: useRef(null),
  };

  // Who can this person report to?
  const eligibleManagers = users.filter((u) => {
    if (role === 'Employee') return u.role === 'Manager' || u.role === 'Admin';
    if (role === 'Manager')  return u.role === 'Admin';
    return false;
  });

  // Live avatar preview
  const initials  = name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
  const autoColor = AVATAR_COLORS[users.length % AVATAR_COLORS.length];
  const rs        = ROLE_STYLE[role];

  // Shared with EditMemberModal so the two can't drift. The old local regex
  // here accepted a bare "9619608095", which Meta takes and then fails to
  // deliver — see src/lib/phone.js.
  const phoneProblem = phoneError(phone);

  const reset = () => {
    setName(''); setPhone(''); setEmail(''); setPassword('');
    setRole('Employee'); setReportsTo(''); setPreferredLanguage('en');
    setError(''); setInvalidField(null); setLoading(false);
  };

  const handleRoleChange = (val) => {
    setRole(val);
    setReportsTo(''); // clear previous selection — may no longer be valid
  };

  /** Flag the offending field, say why, and put the cursor there. */
  const fail = (field, message) => {
    setInvalidField(field);
    setError(message);
    refs[field]?.current?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setInvalidField(null);

    // The button is deliberately never disabled for missing input. Disabling it
    // meant clicking did nothing at all — no message, no hint as to which field
    // was the problem. Better to accept the click and answer the question.
    if (!name.trim())     return fail('name',     'Full name is required.');
    if (phoneProblem)     return fail('phone',    phoneProblem);
    if (!email.trim())    return fail('email',    'Email is required — this is how they sign in.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return fail('email', 'That email address doesn\'t look right.');
    if (!password)        return fail('password', 'Password is required — this is how they sign in.');
    if (password.length < 8) return fail('password', 'Password must be at least 8 characters.');
    if (role !== 'Admin' && !reportsTo) return fail('reportsTo', 'Please select who this person reports to.');

    setLoading(true);
    try {
      await addUser({
        name:              name.trim(),
        phone:             phone.trim(),
        email:             email.trim().toLowerCase(),
        password,
        role,
        reportingToId:     reportsTo || null,
        preferredLanguage,
        avatar:            initials || name.trim()[0]?.toUpperCase() || '?',
        color:             autoColor,
      });
      reset();
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to add member. Please try again.');
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add team member"
      subtitle="They'll receive task notifications and updates via WhatsApp."
      maxWidth="max-w-lg"
      footer={
        <>
          <button
            className="fd-btn-secondary"
            onClick={() => { reset(); onClose(); }}
            disabled={loading}
          >
            Cancel
          </button>
          {/* Only disabled while the request is in flight. A missing field is
              answered with a message, not with a dead button. */}
          <button
            className="fd-btn-primary"
            onClick={submit}
            disabled={loading}
          >
            <UserPlus className="h-4 w-4" />
            {loading ? 'Adding…' : 'Add Member'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">

        {/* Live avatar preview — appears once name is typed */}
        {initials && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
            <div
              className={`w-10 h-10 rounded-full bg-gradient-to-br ${autoColor} flex items-center justify-center text-white font-bold text-sm shrink-0 select-none`}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#111827] truncate">{name.trim()}</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${rs.bg} ${rs.text}`}>
                {role}
              </span>
            </div>
          </div>
        )}

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
            onChange={(e) => { setName(e.target.value); setInvalidField(null); }}
            placeholder="e.g. Rahul Verma"
            autoFocus
          />
        </div>

        {/* WhatsApp Number — highlighted as the critical field */}
        <div>
          <label className="label flex items-center gap-2">
            <span>WhatsApp Number<Req /></span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#D1FAE5] text-[#065F46] uppercase tracking-wide">
              Required for alerts
            </span>
          </label>
          <input
            ref={refs.phone}
            className={inputCls(invalidField === 'phone')}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setInvalidField(null); }}
            placeholder="+91 98765 43210"
            type="tel"
          />
          {/* Warn while they type, not only on submit. A number missing its
              country code is accepted by WhatsApp and then silently fails to
              deliver, so catching it here is the only cheap moment. */}
          {phone.trim() && phoneProblem ? (
            <p className="text-[11px] text-[#B45309] mt-1 leading-relaxed">{phoneProblem}</p>
          ) : (
            <p className="text-[11px] text-[#9CA3AF] mt-1 leading-relaxed">
              Must include the country code (e.g. +91 for India).
              All task assignments, reminders, and escalation alerts go to this number.
            </p>
          )}
        </div>

        {/* Notification Language — optional, defaults to English */}
        <div>
          <label className="label flex items-center gap-2">
            Notification Language
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#EDE9FE] text-[#6D28D9] uppercase tracking-wide">
              WhatsApp alerts
            </span>
          </label>
          <select
            className="fd-input"
            value={preferredLanguage}
            onChange={(e) => setPreferredLanguage(e.target.value)}
          >
            {/* Only languages with approved WhatsApp templates belong here.
                Marathi was offered without any `*_mr` template existing, so
                picking it quietly sent English anyway. */}
            <option value="en">🇬🇧 English</option>
            <option value="hi">🇮🇳 हिंदी — Hindi</option>
          </select>
          <p className="text-[11px] text-[#9CA3AF] mt-1">
            Assignments, deadline reminders, and escalations will be sent in this language.
          </p>
        </div>

        {/* Email + Password */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Email<Req /></label>
            <input
              ref={refs.email}
              className={inputCls(invalidField === 'email')}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setInvalidField(null); }}
              placeholder="name@company.com"
              type="email"
            />
          </div>
          <div>
            <label className="label">Password<Req /></label>
            <input
              ref={refs.password}
              className={inputCls(invalidField === 'password')}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setInvalidField(null); }}
              placeholder="Min. 8 characters"
              type="password"
            />
          </div>
        </div>
        <p className="text-[11px] text-[#9CA3AF] -mt-2">
          Email and password are how this person signs in to FlowDesk.
        </p>

        {/* Role + Reports To — hierarchy section */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF] mb-2">
            Hierarchy
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Role</label>
              <select
                className="fd-input"
                value={role}
                onChange={(e) => handleRoleChange(e.target.value)}
              >
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
                  onChange={(e) => { setReportsTo(e.target.value); setInvalidField(null); }}
                >
                  <option value="">Select…</option>
                  {eligibleManagers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.role}
                    </option>
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
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Admins have full access and don't report to anyone.
                </p>
              </div>
            )}
          </div>

          {/* Visual hierarchy hint */}
          {reportsTo && (() => {
            const manager = users.find((u) => u.id === reportsTo);
            return manager ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
                <span>{name.trim() || 'This person'}</span>
                <span className="text-[#D1D5DB]">→ reports to →</span>
                <span className="font-semibold text-[#374151]">{manager.name}</span>
                <span className="text-[#D1D5DB]">({manager.role})</span>
              </div>
            ) : null;
          })()}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100">
            <span className="text-[#EF4444] mt-0.5 shrink-0">⚠</span>
            <p className="text-xs font-medium text-[#B91C1C]">{error}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
