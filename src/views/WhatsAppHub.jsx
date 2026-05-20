import React, { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { findUser, isOverdue } from '../data/mockData.js';
import Avatar from '../components/Avatar.jsx';
import { MessageCircle, Send, CheckCheck } from 'lucide-react';

const SAMPLE_THREAD = [
  { from: 'them', text: 'TSK-1044 — gateway is throwing 502 on bulk fetch. Looking now.', time: '09:14' },
  { from: 'me',   text: 'Thanks Karan. Try the failover endpoint, ping me if you need access.', time: '09:16' },
  { from: 'them', text: 'On it. ETA 30 mins.', time: '09:17' },
  { from: 'them', text: 'Done. Settlement queue is draining.', time: '09:51' },
];

export default function WhatsAppHub() {
  const { tasks }   = useApp();
  const [activeId, setActiveId] = useState(tasks[0]?.id);
  const [message, setMessage]   = useState('');
  const active  = tasks.find((t) => t.id === activeId);
  const partner = active ? findUser(active.assignedTo) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">WhatsApp Hub</p>
        <h2 className="text-xl font-bold text-[#111827] mt-0.5">Live conversations</h2>
        <p className="text-sm text-[#6B7280] mt-0.5">
          Every task gets its own thread. Replies sync to status, comments, and escalations.
        </p>
      </div>

      {/* Two-panel layout */}
      <div className="fd-card overflow-hidden grid grid-cols-1 md:grid-cols-3" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>

        {/* ── Left panel: conversation list ─── */}
        <aside className="border-r border-[#E5E7EB] overflow-y-auto thin-scrollbar">
          <ul className="divide-y divide-[#F3F4F6]">
            {tasks.map((t) => {
              const u       = findUser(t.assignedTo);
              const overdue = isOverdue(t);
              const isAct   = t.id === activeId;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setActiveId(t.id)}
                    className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors
                      ${isAct ? 'bg-[#F5F3FF]' : 'hover:bg-[#F9FAFB]'}`}
                  >
                    <Avatar user={u} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-[#111827] text-sm truncate">{u?.name}</p>
                        <span className="num text-[10px] text-[#9CA3AF] shrink-0">{t.id}</span>
                      </div>
                      <p className="text-xs text-[#6B7280] truncate mt-0.5">{t.title}</p>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        {overdue && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#B91C1C]">
                            overdue
                          </span>
                        )}
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#EFF6FF] text-[#1D4ED8]">
                          {t.status}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ── Right panel: chat area ─────────── */}
        <section className="md:col-span-2 flex flex-col bg-[#FAFAFA]">
          {active ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E5E7EB] bg-white">
                <Avatar user={partner} size="md" />
                <div className="min-w-0">
                  <p className="font-semibold text-[#111827] text-sm">{partner?.name}</p>
                  <p className="text-xs text-[#9CA3AF] flex items-center gap-1">
                    <MessageCircle className="h-3 w-3 text-[#22C55E]" />
                    Thread for {active.id} · {active.title}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto thin-scrollbar p-4 space-y-3">
                {SAMPLE_THREAD.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                        m.from === 'me'
                          ? 'bg-[#1E1B3A] text-white rounded-br-md'
                          : 'bg-white text-[#374151] rounded-bl-md border border-[#E5E7EB]'
                      }`}
                    >
                      {m.text}
                      <div
                        className={`mt-1 num text-[10px] flex items-center gap-1 ${
                          m.from === 'me' ? 'text-white/60 justify-end' : 'text-[#9CA3AF]'
                        }`}
                      >
                        {m.time}
                        {m.from === 'me' && <CheckCheck className="h-3 w-3" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input bar */}
              <div className="p-3 border-t border-[#E5E7EB] bg-white flex items-center gap-2">
                <input
                  className="fd-input flex-1"
                  placeholder={`Message ${partner?.name?.split(' ')[0]} on WhatsApp…`}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setMessage('')}
                />
                <button
                  onClick={() => setMessage('')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#22C55E] text-white text-sm font-semibold hover:bg-[#16A34A] transition-colors shrink-0"
                >
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[#9CA3AF]">
              Select a thread to see the conversation.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
