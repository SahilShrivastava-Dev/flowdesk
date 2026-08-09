import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  SESSION_WINDOW_MS, showsTaskChip, sessionStatus, previewFor, groupByDay,
} from './conversations.js';

afterEach(() => vi.useRealTimers());

describe('showsTaskChip', () => {
  const msg = (over = {}) => ({
    taskId: 'TSK-1055', attributedBy: 'recent_context', kind: 'text',
    mediaUrl: null, ...over,
  });

  it.each(['explicit_ref', 'reply_context', 'list_reply', 'manual'])(
    'shows the chip when a human said which task (%s)',
    (attributedBy) => expect(showsTaskChip(msg({ attributedBy }))).toBe(true),
  );

  it.each(['recent_context', 'single_open_task'])(
    'hides the chip when the link was only inferred (%s)',
    (attributedBy) => expect(showsTaskChip(msg({ attributedBy }))).toBe(false),
  );

  it('hides the chip on a plain "Ok" that inherited the previous task', () => {
    // The reported complaint: chatter shouldn't be labelled with a task the
    // person never mentioned.
    expect(showsTaskChip(msg({ attributedBy: 'recent_context' }))).toBe(false);
  });

  it('still labels evidence, even when the link was inferred', () => {
    // A photo or voice note IS about a task — that's the whole point of
    // sending it — so it stays labelled.
    expect(showsTaskChip(msg({ kind: 'voice' }))).toBe(true);
    expect(showsTaskChip(msg({ mediaUrl: 'https://cdn/x.jpg' }))).toBe(true);
  });

  it('shows nothing when there is no task at all', () => {
    expect(showsTaskChip(msg({ taskId: null, attributedBy: 'explicit_ref' }))).toBe(false);
    expect(showsTaskChip(null)).toBe(false);
  });
});

describe('sessionStatus', () => {
  it('is closed with no inbound message', () => {
    expect(sessionStatus(null)).toEqual({ open: false, minutesAgo: null });
  });

  it('is open just inside 24h and closed just outside', () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-28T12:00:00Z');
    vi.setSystemTime(now);

    const justInside  = new Date(now.getTime() - SESSION_WINDOW_MS + 1000);
    const justOutside = new Date(now.getTime() - SESSION_WINDOW_MS - 1000);

    expect(sessionStatus(justInside).open).toBe(true);
    expect(sessionStatus(justOutside).open).toBe(false);
  });
});

describe('previewFor', () => {
  // These must match backend conversationService.previewFor, or the list
  // preview disagrees with what the API computed for the same message.
  it.each([
    [{ kind: 'voice', transcription: 'task 1060 done' }, '🎙️ "task 1060 done"'],
    [{ kind: 'voice', transcription: null },             '🎙️ Voice note'],
    [{ kind: 'text',  text: 'hello there' },             'hello there'],
    [{ kind: 'image', text: '', mediaUrl: 'https://x' }, '📎 Attachment'],
    [null,                                                'No messages yet'],
  ])('renders %j', (msg, expected) => {
    expect(previewFor(msg)).toBe(expected);
  });
});

describe('groupByDay', () => {
  it('splits messages across a date boundary', () => {
    // Built in local time on purpose: grouping is what the reader sees, so it
    // must follow their calendar, not UTC. A UTC-midnight fixture would pass
    // or fail depending on the machine's timezone.
    const day1 = new Date(2026, 6, 27, 18, 0).toISOString();
    const day2a = new Date(2026, 6, 28, 9, 0).toISOString();
    const day2b = new Date(2026, 6, 28, 14, 0).toISOString();

    const groups = groupByDay([
      { id: '1', createdAt: day1 },
      { id: '2', createdAt: day2a },
      { id: '3', createdAt: day2b },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[1].items).toHaveLength(2);
  });

  it('returns nothing for an empty thread', () => {
    expect(groupByDay([])).toEqual([]);
  });
});
