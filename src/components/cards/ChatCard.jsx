import React, { useState } from 'react';
import Avatar from '../Avatar.jsx';
import { findUser } from '../../data/mockData.js';
import { Play, Pause } from 'lucide-react';

// Fake waveform bars
function Waveform() {
  const bars = [3,5,8,12,7,10,14,9,6,11,8,13,7,5,9,12,8,6,10,7,4,8,11,6,9,5,12,8];
  return (
    <div className="flex items-center gap-[2px] h-5">
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-[#FB923C] opacity-70"
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
}

export default function ChatCard({ onSeeAll }) {
  const sender = findUser('U102'); // Sneha
  const me     = findUser('U001'); // Aarav
  const [playing, setPlaying] = useState(false);

  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#111827]">Chat</h2>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>

      <div className="space-y-4">
        {/* Outgoing text message */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9CA3AF]">{me?.name?.split(' ')[0]} Mehta</span>
            <Avatar user={me} size="sm" />
          </div>
          <div className="rounded-2xl rounded-tr-sm bg-[#1E1B3A] px-3.5 py-2.5 text-sm text-white max-w-[85%]">
            Hello, can you check the latest work?
          </div>
          <span className="num text-[10px] text-[#9CA3AF]">12:20</span>
        </div>

        {/* Incoming voice message */}
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-2">
            <Avatar user={sender} size="sm" />
            <span className="text-xs text-[#9CA3AF]">{sender?.name?.split(' ')[0]}</span>
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-[#FFF3EC] border border-[#FDE8D0] px-3.5 py-2.5 max-w-[90%] flex items-center gap-2.5">
            <button
              onClick={() => setPlaying((v) => !v)}
              className="w-8 h-8 rounded-full bg-[#FB923C] flex items-center justify-center text-white shrink-0 hover:bg-[#EA8020] transition-colors"
            >
              {playing ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
            </button>
            <Waveform />
            <span className="num text-[11px] text-[#9CA3AF] shrink-0">00:41</span>
          </div>
          <span className="num text-[10px] text-[#9CA3AF]">12:20</span>
        </div>
      </div>
    </div>
  );
}
