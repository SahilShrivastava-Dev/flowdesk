import React from 'react';

const SIZE = {
  sm:  'h-7 w-7 text-[11px]',
  md:  'h-9 w-9 text-xs',
  lg:  'h-11 w-11 text-sm',
  xl:  'h-14 w-14 text-base',
};

export default function Avatar({ user, size = 'md', ring = false }) {
  if (!user) return null;
  const dim = SIZE[size] ?? SIZE.md;
  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full font-semibold text-white bg-gradient-to-br ${user.color} ${dim} ${ring ? 'ring-2 ring-white' : ''} shrink-0`}
      title={`${user.name} • ${user.role}`}
    >
      {user.avatar}
    </div>
  );
}

export function AvatarStack({ userList, max = 3 }) {
  const shown = userList.slice(0, max);
  const extra = userList.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size="sm" ring />
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-[#F3F4F6] text-[#6B7280] text-[11px] font-semibold ring-2 ring-white shrink-0">
          +{extra}
        </span>
      )}
    </div>
  );
}
