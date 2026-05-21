import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { findUser, isOverdue, directReports } from '../data/mockData.js';
import Avatar from '../components/Avatar.jsx';
import { MessageCircle, Send, CheckCheck, Clock, AlertCircle, Image, Paperclip, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { isLoggedIn, getSavedUser } from '../lib/auth.js';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Check if a task's activity has an inbound WhatsApp message within the last 24h
function sessionStatus(activities = []) {
  const lastInbound = [...activities]
    .reverse()
    .find((a) => a.type === 'whatsapp');
  if (!lastInbound) return { open: false, minutesAgo: null };
  const ms = Date.now() - new Date(lastInbound.at).getTime();
  return { open: ms < SESSION_WINDOW_MS, minutesAgo: Math.round(ms / 60000) };
}

function timeStr(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function ChatBubble({ entry, isOutbound }) {
  const u = findUser(entry.by);
  const isSessionNote = entry.text?.startsWith('[Session expired');

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} items-end gap-2`}>
      {!isOutbound && <Avatar user={u} size="sm" />}
      <div className={`max-w-[72%] ${isOutbound ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {entry.mediaUrl && (
          <a href={entry.mediaUrl} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={entry.mediaUrl}
              alt="attachment"
              className="max-h-44 rounded-xl border border-[#E5E7EB] object-cover hover:opacity-90 transition-opacity cursor-zoom-in"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </a>
        )}
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed
            ${isOutbound
              ? 'bg-[#1E1B3A] text-white rounded-br-md'
              : isSessionNote
                ? 'bg-amber-50 text-amber-800 border border-amber-200 rounded-bl-md text-xs italic'
                : 'bg-white text-[#374151] border border-[#E5E7EB] rounded-bl-md'
            }`}
        >
          {entry.text}
          <div className={`mt-0.5 text-[10px] flex items-center gap-1 ${isOutbound ? 'text-white/50 justify-end' : 'text-[#9CA3AF]'}`}>
            {timeStr(entry.at)}
            {isOutbound && <CheckCheck className="h-3 w-3" />}
          </div>
        </div>
      </div>
      {isOutbound && <Avatar user={u} size="sm" />}
    </div>
  );
}

export default function WhatsAppHub() {
  const { tasks, activeUser } = useApp();
  const usingApi = isLoggedIn();

  const [activeId, setActiveId] = useState(tasks[0]?.id ?? null);
  const [message,  setMessage]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [warning,  setWarning]  = useState('');
  const bottomRef = useRef(null);

  const active  = tasks.find((t) => t.id === activeId);
  const partner = active ? findUser(active.assignedTo) : null;

  // ── Access guard ──────────────────────────────────────────────────────────
  // Managers can only send WhatsApp messages to their own direct reports.
  // If the task's assignee reports to someone else, lock the send bar.
  const loggedInUser = getSavedUser(); // { id, role, name, ... } from JWT session
  const canSendMessage = useMemo(() => {
    if (!active || !partner) return false;
    if (!loggedInUser) return true; // demo mode — no restriction
    if (loggedInUser.role === 'Admin') return true;
    if (loggedInUser.role === 'Manager') {
      // partner.reportingToId must equal the logged-in manager's id
      return partner.reportingToId === loggedInUser.id;
    }
    return false; // Employees never send from this view
  }, [active, partner, loggedInUser]);

  // Build the chat thread from real task activities
  const thread = (active?.activity ?? []).filter(
    (a) => a.type === 'whatsapp' || a.type === 'outbound'
  );

  const session = sessionStatus(active?.activity ?? []);

  // Auto-scroll to bottom when thread changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.length, activeId]);

  const send = useCallback(async () => {
    if (!message.trim() || !activeId || sending) return;
    setSending(true);
    setWarning('');

    if (!usingApi) {
      // Demo mode — just clear
      setMessage('');
      setSending(false);
      return;
    }

    try {
      const res = await api.post('/api/whatsapp/send', {
        taskId:  activeId,
        message: message.trim(),
      });
      setMessage('');
      if (res?.mode === 'template_fallback' && res?.warning) {
        setWarning(res.warning);
      }
    } catch (err) {
      setWarning(err.message ?? 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [message, activeId, sending, usingApi]);

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">WhatsApp Hub</p>
        <h2 className="text-xl font-bold text-[#111827] mt-0.5">Live conversations</h2>
        <p className="text-sm text-[#6B7280] mt-0.5">
          Every task gets its own thread. Replies sync to status, comments, and escalations.
        </p>
      </div>

      <div className="fd-card overflow-hidden grid grid-cols-1 md:grid-cols-3" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>

        {/* ── Left: task list ───────────────────────────────────────────── */}
        <aside className="border-r border-[#E5E7EB] overflow-y-auto thin-scrollbar">
          <ul className="divide-y divide-[#F3F4F6]">
            {tasks.map((t) => {
              const u        = findUser(t.assignedTo);
              const overdue  = isOverdue(t);
              const isAct    = t.id === activeId;
              const lastWA   = [...(t.activity ?? [])].reverse().find(a => a.type === 'whatsapp' || a.type === 'outbound');
              const preview  = lastWA?.mediaUrl
                ? '📎 Attachment'
                : lastWA?.text?.slice(0, 42) ?? 'No messages yet';
              const sess     = sessionStatus(t.activity ?? []);

              return (
                <li key={t.id}>
                  <button
                    onClick={() => { setActiveId(t.id); setWarning(''); }}
                    className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors
                      ${isAct ? 'bg-[#F5F3FF]' : 'hover:bg-[#F9FAFB]'}`}
                  >
                    <div className="relative shrink-0">
                      <Avatar user={u} size="md" />
                      {/* Session window indicator dot */}
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white
                        ${sess.open ? 'bg-[#22C55E]' : 'bg-[#9CA3AF]'}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="font-semibold text-[#111827] text-sm truncate">{u?.name}</p>
                        <span className="num text-[10px] text-[#9CA3AF] shrink-0">{t.id}</span>
                      </div>
                      <p className="text-xs text-[#9CA3AF] truncate mt-0.5">{preview}</p>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        {overdue && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#B91C1C]">overdue</span>
                        )}
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#EFF6FF] text-[#1D4ED8]">{t.status}</span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ── Right: chat pane ──────────────────────────────────────────── */}
        <section className="md:col-span-2 flex flex-col bg-[#FAFAFA]">
          {active ? (
            <>
              {/* Chat header */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#E5E7EB] bg-white shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar user={partner} size="md" />
                  <div className="min-w-0">
                    <p className="font-semibold text-[#111827] text-sm">{partner?.name}</p>
                    <p className="text-xs text-[#9CA3AF] flex items-center gap-1">
                      <MessageCircle className="h-3 w-3 text-[#22C55E]" />
                      {active.id} · {active.title}
                    </p>
                  </div>
                </div>

                {/* Session window badge */}
                <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                  ${session.open
                    ? 'bg-[#DCFCE7] text-[#166534]'
                    : 'bg-[#F3F4F6] text-[#6B7280]'}`}>
                  {session.open ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                      Session open · {session.minutesAgo < 60
                        ? `${session.minutesAgo}m ago`
                        : `${Math.round(session.minutesAgo / 60)}h ago`}
                    </>
                  ) : (
                    <>
                      <Clock className="h-3 w-3" />
                      Session expired
                    </>
                  )}
                </div>
              </div>

              {/* Session explanation banner — only when expired */}
              {!session.open && (
                <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-800 shrink-0">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    <strong>{partner?.name?.split(' ')[0]} hasn't replied in over 24h.</strong>
                    {' '}Sending a message will first send them a WhatsApp template to restart the conversation.
                    Once they reply, you can send free personalised messages.
                  </p>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto thin-scrollbar p-4 space-y-3">
                {thread.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-[#9CA3AF]">
                    <MessageCircle className="h-8 w-8 opacity-30" />
                    <p className="text-sm">No WhatsApp messages yet for this task</p>
                    <p className="text-xs">Messages from the employee will appear here in real time</p>
                  </div>
                ) : (
                  thread.map((entry, i) => (
                    <ChatBubble
                      key={i}
                      entry={entry}
                      isOutbound={entry.type === 'outbound'}
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* Warning banner */}
              {warning && (
                <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2 shrink-0">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {warning}
                </div>
              )}

              {/* Input bar — locked for Managers who don't manage this assignee */}
              {canSendMessage ? (
                <div className="p-3 border-t border-[#E5E7EB] bg-white flex items-end gap-2 shrink-0">
                  <textarea
                    rows={1}
                    className="fd-input flex-1 resize-none min-h-[40px] max-h-24 overflow-y-auto"
                    placeholder={
                      session.open
                        ? `Message ${partner?.name?.split(' ')[0]} on WhatsApp…`
                        : `Session expired — message will reopen conversation…`
                    }
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={onKey}
                  />
                  <button
                    onClick={send}
                    disabled={!message.trim() || sending}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#22C55E] text-white
                               text-sm font-semibold hover:bg-[#16A34A] transition-colors shrink-0
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="h-4 w-4" />
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              ) : (
                <div className="p-3 border-t border-[#E5E7EB] bg-[#F9FAFB] flex items-center gap-2.5 shrink-0">
                  <Lock className="h-4 w-4 text-[#9CA3AF] shrink-0" />
                  <p className="text-xs text-[#6B7280]">
                    <span className="font-semibold text-[#374151]">{partner?.name?.split(' ')[0]}</span>
                    {' '}doesn't report to you — only their direct manager can send WhatsApp messages on this thread.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[#9CA3AF]">
              Select a task thread to see the conversation.
            </div>
          )}
        </section>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-[#9CA3AF]">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#22C55E]" /> Session open (free text available)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#9CA3AF]" /> Session expired (template will reopen)</span>
      </div>
    </div>
  );
}
