import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import CommandLogView from './CommandLogView.jsx';
import { findUser } from '../data/mockData.js';
import Avatar from '../components/Avatar.jsx';
import TaskAttributionMenu from '../components/TaskAttributionMenu.jsx';
import {
  MessageCircle, Send, Check, CheckCheck, Clock, AlertCircle, Lock, Mic, AlertTriangle, ChevronUp,
} from 'lucide-react';
import { isLoggedIn, getSavedUser } from '../lib/auth.js';
import {
  DIRECTION, KIND, DELIVERY, DELIVERY_LABEL, ATTRIBUTION_LABEL,
  groupByDay, previewFor, shortAge, showsTaskChip,
} from '../lib/conversations.js';

function timeStr(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * WhatsApp's tick states, same semantics people already know:
 *   clock        — still leaving us
 *   one tick     — Meta accepted it
 *   two grey     — reached their phone
 *   two BLUE     — they opened it
 *
 * Blue only ever means read. Anything less stays grey, so an unread message is
 * never mistaken for a read one.
 */
function DeliveryTicks({ status, error }) {
  const title = error ? `${DELIVERY_LABEL.failed} — ${error}` : DELIVERY_LABEL[status] ?? '';

  if (status === DELIVERY.PENDING) {
    return <Clock className="h-3 w-3 opacity-70" title={DELIVERY_LABEL.pending} />;
  }
  if (status === DELIVERY.SENT) {
    return <Check className="h-3 w-3" title={title} />;
  }
  if (status === DELIVERY.DELIVERED) {
    return <CheckCheck className="h-3 w-3" title={title} />;
  }
  if (status === DELIVERY.READ) {
    return <CheckCheck className="h-3 w-3 text-[#53BDEB]" title={title} />;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// One message
//
// Because a thread now spans every task this person is working on, each
// inbound bubble carries the task it was linked to — otherwise "done" three
// messages apart would be indistinguishable.
// ─────────────────────────────────────────────────────────────────────────────

function ChatBubble({ msg, tasks, canEdit, onOpenTask, onReattribute }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isOutbound = msg.direction === DIRECTION.OUTBOUND;
  const isVoice    = msg.kind === KIND.VOICE;
  const isSystem   = msg.kind === KIND.SYSTEM;
  const failed     = msg.deliveryStatus === 'failed';
  const pending    = msg.deliveryStatus === 'pending';
  const sender     = findUser(msg.senderId);
  const task       = tasks.find((t) => t.id === msg.taskId);

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} items-end gap-2`}>
      {!isOutbound && <Avatar user={sender} size="sm" />}
      <div className={`max-w-[72%] ${isOutbound ? 'items-end' : 'items-start'} flex flex-col gap-1 relative`}>

        {/* Task chip — shown only where someone actually named the task, or
            where the message carries evidence. See showsTaskChip(). */}
        {!isSystem && (
          showsTaskChip(msg) ? (
            <button
              onClick={() => onOpenTask?.(msg.taskId)}
              title={ATTRIBUTION_LABEL[msg.attributedBy] ?? ''}
              className="self-start inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
                         bg-[#EEF2FF] text-[#4338CA] text-[10px] font-semibold
                         hover:bg-[#E0E7FF] transition-colors max-w-full"
            >
              <span className="num">{msg.taskId}</span>
              {task && <span className="truncate opacity-70">· {task.title}</span>}
            </button>
          ) : msg.needsAttribution ? (
            <button
              onClick={() => canEdit && setMenuOpen((o) => !o)}
              disabled={!canEdit}
              className="self-start inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
                         bg-[#FEF3C7] text-[#92400E] text-[10px] font-semibold
                         hover:bg-[#FDE68A] transition-colors disabled:cursor-default"
            >
              <AlertTriangle className="h-3 w-3" />
              Not linked — pick a task
            </button>
          ) : null
        )}

        {menuOpen && (
          <TaskAttributionMenu
            tasks={tasks}
            currentTaskId={msg.taskId}
            onPick={(taskId) => { setMenuOpen(false); onReattribute(msg, taskId); }}
            onClose={() => setMenuOpen(false)}
          />
        )}

        {isVoice ? (
          <div className="bg-white border border-[#BAE6FD] rounded-2xl rounded-bl-md px-3.5 py-2.5 shadow-sm min-w-[220px]">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-[#0369A1] shrink-0" />
              {msg.mediaUrl ? (
                <audio src={msg.mediaUrl} controls className="h-8 flex-1 rounded-lg" style={{ accentColor: '#0369A1' }} />
              ) : (
                <span className="text-xs text-[#9CA3AF] italic">Audio unavailable</span>
              )}
            </div>
            {msg.transcription ? (
              <p className="mt-2 text-[11px] text-[#6B7280] italic leading-relaxed border-t border-[#E0F2FE] pt-1.5">
                "{msg.transcription}"
              </p>
            ) : (
              <p className="mt-1.5 text-[10px] text-[#C4B5FD] italic">Transcription unavailable</p>
            )}
            <div className="mt-1 text-[10px] text-[#9CA3AF]">{timeStr(msg.createdAt)}</div>
          </div>
        ) : (
          <>
            {msg.mediaUrl && (
              <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={msg.mediaUrl}
                  alt="attachment"
                  className="max-h-44 rounded-xl border border-[#E5E7EB] object-cover hover:opacity-90 transition-opacity cursor-zoom-in"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </a>
            )}
            <div
              className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed
                ${isOutbound
                  ? failed
                    ? 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA] rounded-br-md'
                    : 'bg-[#1E1B3A] text-white rounded-br-md'
                  : isSystem
                    ? 'bg-amber-50 text-amber-800 border border-amber-200 rounded-bl-md text-xs italic'
                    : 'bg-white text-[#374151] border border-[#E5E7EB] rounded-bl-md'
                } ${pending ? 'opacity-60' : ''}`}
            >
              {msg.text}
              <div className={`mt-0.5 text-[10px] flex items-center gap-1
                ${isOutbound && !failed ? 'text-white/50 justify-end' : 'text-[#9CA3AF]'}`}>
                {timeStr(msg.createdAt)}
                {isOutbound && !failed && (
                  <DeliveryTicks status={msg.deliveryStatus} error={msg.deliveryError} />
                )}
              </div>
            </div>
            {failed && (
              <p className="text-[10px] text-[#B91C1C] flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Not delivered{msg.deliveryError ? ` — ${msg.deliveryError}` : ''}
              </p>
            )}
          </>
        )}
      </div>
      {isOutbound && <Avatar user={sender} size="sm" />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function WhatsAppHub({ focusUserId, onOpenTask }) {
  const {
    conversations, convLoading, threads, activeConvUserId, setActiveConvUserId,
    loadMoreMessages, sendWhatsApp, reattributeMessage, setTaskStatus, role,
  } = useApp();

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState('');
  // Which half of the Hub is showing. Admin-only; everyone else has one tab.
  const [hubTab, setHubTab] = useState('threads');
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const lastMsgId = useRef(null);

  // Select a conversation: the one a notification pointed at, else the newest.
  useEffect(() => {
    if (activeConvUserId) return;
    const next = focusUserId ?? conversations[0]?.userId;
    if (next) setActiveConvUserId(next);
  }, [focusUserId, conversations, activeConvUserId, setActiveConvUserId]);

  const active   = conversations.find((c) => c.userId === activeConvUserId) ?? null;
  const thread   = threads[activeConvUserId] ?? null;
  const messages = thread?.messages ?? [];
  const tasks    = thread?.tasks ?? [];
  const partner  = findUser(activeConvUserId);
  const session  = thread?.session ?? active?.session ?? { open: false, minutesAgo: null };

  // Managers may only message their own direct reports.
  const loggedInUser = getSavedUser();
  const canSendMessage = useMemo(() => {
    if (!active) return false;
    if (!isLoggedIn() || !loggedInUser) return true;      // demo mode
    if (loggedInUser.role === 'Admin') return true;
    if (loggedInUser.role === 'Manager') return active.reportingToId === loggedInUser.id;
    return false;                                        // Employees never send here
  }, [active, loggedInUser]);

  // Jump to the newest message when the conversation changes or one arrives —
  // but never while older history is being prepended, or "load earlier" would
  // yank the reader back to the bottom every time.
  useEffect(() => {
    const newest = messages[messages.length - 1]?.id ?? null;
    if (newest !== lastMsgId.current) {
      lastMsgId.current = newest;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeConvUserId]);

  const loadEarlier = useCallback(async () => {
    const el = scrollRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    await loadMoreMessages(activeConvUserId);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;   // hold position
    });
  }, [activeConvUserId, loadMoreMessages]);

  const send = useCallback(async () => {
    const text = message.trim();
    if (!text || sending || !activeConvUserId) return;
    setSending(true);
    setWarning('');
    setMessage('');
    try {
      const res = await sendWhatsApp(activeConvUserId, text);
      if (res?.mode === 'template_fallback' && res.warning) setWarning(res.warning);
    } catch (err) {
      setWarning(err.message ?? 'Message could not be sent');
    } finally {
      setSending(false);
    }
  }, [message, sending, activeConvUserId, sendWhatsApp]);

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleReattribute = useCallback(async (msg, taskId) => {
    try {
      const res = await reattributeMessage(activeConvUserId, msg.id, taskId);
      if (res?.revertHint) {
        const { taskId: oldId, currentStatus } = res.revertHint;
        // The old task's status came from this message. Offer to undo it
        // rather than silently reverting — the status audit trail is the
        // manager's, not ours to rewrite.
        const undo = window.confirm(
          `${oldId} is still marked ${currentStatus} because of this message. ` +
          `Set it back to Pending?`,
        );
        if (undo) setTaskStatus(oldId, 'Pending');
      }
    } catch (err) {
      setWarning(err.message ?? 'Could not move that message');
    }
  }, [activeConvUserId, reattributeMessage, setTaskStatus]);

  const dayGroups = useMemo(() => groupByDay(messages), [messages]);
  const firstName = partner?.name?.split(' ')[0] ?? active?.name?.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100dvh - 140px)', minHeight: '420px' }}>
      <div className="shrink-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">WhatsApp Hub</p>
        <h2 className="text-xl font-bold text-[#111827] mt-0.5">Live conversations</h2>
        <p className="text-sm text-[#6B7280] mt-0.5">
          One conversation per person — the same thread they see on WhatsApp. Each message shows the task it updated.
        </p>

        {/* The command log lives here rather than in its own top-level page:
            it answers a question about WhatsApp, and a separate dashboard for
            one table would be a second place to look for the same thing. */}
        {role === 'Admin' && (
          <div className="flex items-center gap-1 border-b border-[#E5E7EB] mt-3">
            {[
              { id: 'threads',  label: 'Conversations' },
              { id: 'commands', label: 'Commands' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setHubTab(t.id)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  hubTab === t.id
                    ? 'border-[#1E1B3A] text-[#111827]'
                    : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {hubTab === 'commands' ? (
        <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
          <CommandLogView />
        </div>
      ) : (
      <>

      <div className="fd-card overflow-hidden grid grid-cols-1 md:grid-cols-3 flex-1 min-h-0">

        {/* ── Left: people ──────────────────────────────────────────────── */}
        <aside className="border-r border-[#E5E7EB] overflow-y-auto thin-scrollbar">
          {convLoading && conversations.length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">Loading conversations…</p>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">No conversations yet.</p>
          ) : (
            <ul className="divide-y divide-[#F3F4F6]">
              {conversations.map((c) => {
                const isAct = c.userId === activeConvUserId;
                return (
                  <li key={c.userId}>
                    <button
                      onClick={() => { setActiveConvUserId(c.userId); setWarning(''); }}
                      className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors
                        ${isAct ? 'bg-[#F5F3FF]' : 'hover:bg-[#F9FAFB]'}`}
                    >
                      <div className="relative shrink-0">
                        <Avatar user={findUser(c.userId) ?? c} size="md" />
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white
                          ${c.session?.open ? 'bg-[#22C55E]' : 'bg-[#9CA3AF]'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="font-semibold text-[#111827] text-sm truncate">{c.name}</p>
                          <span className="text-[10px] text-[#9CA3AF] shrink-0">
                            {shortAge(c.lastMessage?.createdAt)}
                          </span>
                        </div>
                        {/* An outside party is labelled on every row. The two
                            kinds of thread support different actions, and
                            finding that out by clicking is the wrong order. */}
                        {c.party === 'contact' && (
                          <p className="text-[10px] font-semibold text-[#B45309] uppercase tracking-wide mt-0.5">
                            {c.role}{c.companyName ? ` · ${c.companyName}` : ''}
                          </p>
                        )}
                        <p className="text-xs text-[#9CA3AF] truncate mt-0.5">
                          {c.lastMessage?.preview ?? 'No messages yet'}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {c.optedOut && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEE2E2] text-[#B91C1C]">
                              Opted out
                            </span>
                          )}
                          {c.needsAttributionCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E] inline-flex items-center gap-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {c.needsAttributionCount} needs task
                            </span>
                          )}
                          {c.overdueCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#B91C1C]">
                              {c.overdueCount} overdue
                            </span>
                          )}
                          {(c.party !== 'contact' || c.openTaskCount > 0) && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#EFF6FF] text-[#1D4ED8]">
                              {c.openTaskCount} open
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Right: conversation ───────────────────────────────────────── */}
        <section className="md:col-span-2 flex flex-col min-h-0 bg-[#FAFAFA]">
          {active ? (
            <>
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#E5E7EB] bg-white shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar user={partner ?? active} size="md" />
                  <div className="min-w-0">
                    <p className="font-semibold text-[#111827] text-sm">{active.name}</p>
                    <p className="text-xs text-[#9CA3AF] flex items-center gap-1">
                      <MessageCircle className="h-3 w-3 text-[#22C55E]" />
                      {active.role} · {active.openTaskCount} open task{active.openTaskCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                  ${session.open ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F3F4F6] text-[#6B7280]'}`}>
                  {session.open ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                      Session open · {session.minutesAgo < 60
                        ? `${session.minutesAgo}m ago`
                        : `${Math.round(session.minutesAgo / 60)}h ago`}
                    </>
                  ) : (
                    <><Clock className="h-3 w-3" /> Session expired</>
                  )}
                </div>
              </div>

              {!session.open && (
                <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-800 shrink-0">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    <strong>{firstName} hasn't replied in over 24h.</strong>
                    {' '}Sending a message will first send them a WhatsApp template to restart the conversation.
                    Once they reply, you can send free personalised messages.
                  </p>
                </div>
              )}

              {active.needsAttributionCount > 0 && (
                <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] flex items-start gap-2 text-xs text-[#92400E] shrink-0">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    <strong>
                      {active.needsAttributionCount} message{active.needsAttributionCount === 1 ? '' : 's'} couldn't be linked to a task.
                    </strong>
                    {' '}{firstName} reported something without saying which task, so nothing was changed.
                    Pick the task on the highlighted message below.
                  </p>
                </div>
              )}

              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-4 space-y-3">
                {thread?.hasMore && (
                  <button
                    onClick={loadEarlier}
                    className="mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                               bg-white border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB] transition-colors"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                    Load earlier messages
                  </button>
                )}

                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-[#9CA3AF]">
                    <MessageCircle className="h-8 w-8 opacity-30" />
                    <p className="text-sm">No messages with {firstName} yet</p>
                    <p className="text-xs">Their WhatsApp replies will appear here in real time</p>
                  </div>
                ) : (
                  dayGroups.map((group) => (
                    <div key={group.key} className="space-y-3">
                      <div className="flex items-center justify-center">
                        <span className="px-2.5 py-0.5 rounded-full bg-[#F3F4F6] text-[10px] font-semibold text-[#6B7280]">
                          {group.label}
                        </span>
                      </div>
                      {group.items.map((msg) => (
                        <ChatBubble
                          key={msg.id}
                          msg={msg}
                          tasks={tasks}
                          canEdit={canSendMessage}
                          onOpenTask={onOpenTask}
                          onReattribute={handleReattribute}
                        />
                      ))}
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {warning && (
                <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2 shrink-0">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {warning}
                </div>
              )}

              {canSendMessage ? (
                <div className="p-3 border-t border-[#E5E7EB] bg-white flex items-end gap-2 shrink-0">
                  <textarea
                    rows={1}
                    className="fd-input flex-1 resize-none min-h-[40px] max-h-24 overflow-y-auto"
                    placeholder={
                      session.open
                        ? `Message ${firstName} on WhatsApp…`
                        : 'Session expired — message will reopen conversation…'
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
                    <span className="font-semibold text-[#374151]">{firstName}</span>
                    {' '}doesn't report to you — only their direct manager can send WhatsApp messages.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[#9CA3AF]">
              Select a person to see the conversation.
            </div>
          )}
        </section>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-[#9CA3AF]">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#22C55E]" /> Session open (free text available)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#9CA3AF]" /> Session expired (template will reopen)</span>
        <span className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 text-[#92400E]" /> Needs a task before it can change anything</span>
      </div>
      </>
      )}
    </div>
  );
}
