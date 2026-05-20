import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { UserPlus } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

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

  const [name,      setName]      = useState('');
  const [phone,     setPhone]     = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [role,      setRole]      = useState('Employee');
  const [reportsTo, setReportsTo] = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);

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

  // Phone: allow digits, spaces, hyphens, leading +
  const phoneOk = /^\+?[0-9\s\-]{7,15}$/.test(phone.trim());

  const canSubmit = !loading && name.trim() && phone.trim() && email.trim() && password.length >= 8
    && (role === 'Admin' || reportsTo);

  const reset = () => {
    setName(''); setPhone(''); setEmail(''); setPassword('');
    setRole('Employee'); setReportsTo(''); setError(''); setLoading(false);
  };

  const handleRoleChange = (val) => {
    setRole(val);
    setReportsTo(''); // clear previous selection — may no longer be valid
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim())                        return setError('Full name is required.');
    if (!phone.trim())                       return setError('WhatsApp number is required.');
    if (!phoneOk)                            return setError('Enter a valid phone number including country code, e.g. +91 98765 43210.');
    if (!email.trim())                       return setError('Email is required.');
    if (password.length < 8)                 return setError('Password must be at least 8 characters.');
    if (role !== 'Admin' && !reportsTo)      return setError('Please select who this person reports to.');

    setLoading(true);
    try {
      await addUser({
        name:         name.trim(),
        phone:        phone.trim(),
        email:        email.trim().toLowerCase(),
        password,
        role,
        reportingToId: reportsTo || null,
        avatar:       initials || name.trim()[0]?.toUpperCase() || '?',
        color:        autoColor,
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
          <button
            className="fd-btn-primary"
            onClick={submit}
            disabled={!canSubmit}
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

        {/* Full Name */}
        <div>
          <label className="label">Full Name</label>
          <input
            className="fd-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rahul Verma"
            autoFocus
          />
        </div>

        {/* WhatsApp Number — highlighted as the critical field */}
        <div>
          <label className="label flex items-center gap-2">
            WhatsApp Number
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#D1FAE5] text-[#065F46] uppercase tracking-wide">
              Required for alerts
            </span>
          </label>
          <input
            className="fd-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            type="tel"
          />
          <p className="text-[11px] text-[#9CA3AF] mt-1 leading-relaxed">
            Include country code (e.g. +91 for India).
            All task assignments, reminders, and escalation alerts are sent to this number.
          </p>
        </div>

        {/* Email + Password */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Email</label>
            <input
              className="fd-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              type="email"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="fd-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              type="password"
            />
          </div>
        </div>

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
                <label className="label">Reports To</label>
                <select
                  className="fd-input"
                  value={reportsTo}
                  onChange={(e) => setReportsTo(e.target.value)}
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
