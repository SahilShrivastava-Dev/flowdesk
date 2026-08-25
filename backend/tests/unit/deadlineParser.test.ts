import { describe, expect, it } from 'vitest';
import { parseDeadline } from '../../src/services/deadlineParser';

// Wednesday 5 August 2026, 10:00 local. A midweek anchor so "Friday" and
// "Monday" fall on opposite sides of the weekend.
const NOW = new Date(2026, 7, 5, 10, 0, 0);

/** "2026-08-07 18:00" — local, so the assertions don't depend on the TZ. */
function stamp(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

describe('relative days', () => {
  it.each([
    ['today',                '2026-08-05 18:00'],
    ['tomorrow',             '2026-08-06 18:00'],
    ['by tomorrow',          '2026-08-06 18:00'],
    ['day after tomorrow',   '2026-08-07 18:00'],
    ['in 3 days',            '2026-08-08 18:00'],
    ['in 2 weeks',           '2026-08-19 18:00'],
    ['next week',            '2026-08-12 18:00'],
    ['end of week',          '2026-08-07 18:00'],
    ['end of month',         '2026-08-31 18:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });
});

describe('weekday names', () => {
  it.each([
    ['friday',       '2026-08-07 18:00'],
    ['Friday',       '2026-08-07 18:00'],
    ['fri',          '2026-08-07 18:00'],
    ['by Friday',    '2026-08-07 18:00'],
    ['monday',       '2026-08-10 18:00'],
    ['next Monday',  '2026-08-10 18:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });

  it('always moves forward, never to today', () => {
    // NOW is a Wednesday. "Wednesday" has to mean next week's, not this
    // morning — a deadline in the past escalates the instant it is set.
    expect(stamp(parseDeadline('wednesday', NOW))).toBe('2026-08-12 18:00');
  });
});

describe('explicit dates', () => {
  it.each([
    ['15/08',        '2026-08-15 18:00'],
    ['15-08',        '2026-08-15 18:00'],
    ['15/08/2026',   '2026-08-15 18:00'],
    ['15-08-26',     '2026-08-15 18:00'],
    ['2026-08-15',   '2026-08-15 18:00'],
    ['15 Aug',       '2026-08-15 18:00'],
    ['Aug 15',       '2026-08-15 18:00'],
    ['15 August',    '2026-08-15 18:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });

  it('rolls a bare date that has already passed into next year', () => {
    expect(stamp(parseDeadline('15/01', NOW))).toBe('2027-01-15 18:00');
  });

  it('takes an explicit year at its word', () => {
    expect(stamp(parseDeadline('15/01/2026', NOW))).toBe('2026-01-15 18:00');
  });
});

describe('times of day', () => {
  it.each([
    ['tomorrow 5pm',        '2026-08-06 17:00'],
    ['tomorrow at 9am',     '2026-08-06 09:00'],
    ['friday 17:30',        '2026-08-07 17:30'],
    ['tomorrow 12am',       '2026-08-06 00:00'],
    ['tomorrow 12pm',       '2026-08-06 12:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });
});

describe('refusing to guess', () => {
  it.each([
    '', '   ', 'sometime', 'when you can', 'asap', 'soon',
    'whenever it suits you', 'next sprint',
  ])('%j is not a date', (text) => {
    expect(parseDeadline(text, NOW)).toBeNull();
  });

  it('rejects a day that does not exist', () => {
    // new Date(2026, 1, 31) silently becomes 3 March. Returning that would be
    // a deadline a month away from anything the sender said.
    expect(parseDeadline('31/02', NOW)).toBeNull();
    expect(parseDeadline('32/01', NOW)).toBeNull();
  });
});

// Hindi, in both scripts. Devanagari reaches these branches by being
// transliterated on the way in, so each pair below must land identically.
describe('Hindi deadlines', () => {
  it.each([
    ['aaj',                  '2026-08-05 18:00'],
    ['आज',                    '2026-08-05 18:00'],
    ['kal',                  '2026-08-06 18:00'],
    ['कल',                    '2026-08-06 18:00'],
    ['kal tak',              '2026-08-06 18:00'],
    ['कल तक',                  '2026-08-06 18:00'],
    ['parso',                '2026-08-07 18:00'],
    ['परसों',                  '2026-08-07 18:00'],
    ['2 din me',             '2026-08-07 18:00'],
    ['2 दिन में',               '2026-08-07 18:00'],
    ['agle hafte',           '2026-08-12 18:00'],
    ['अगले हफ्ते',              '2026-08-12 18:00'],
    ['अगले हफ्ते तक',           '2026-08-12 18:00'],
    ['2 hafte me',           '2026-08-19 18:00'],
    ['is mahine',            '2026-08-31 18:00'],
    ['इस महीने',               '2026-08-31 18:00'],
    ['महीने के अंत तक',          '2026-08-31 18:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });

  it.each([
    ['shukravar',            '2026-08-07 18:00'],
    ['शुक्रवार',               '2026-08-07 18:00'],
    ['shukravar tak',        '2026-08-07 18:00'],
    ['शुक्रवार तक',             '2026-08-07 18:00'],
    ['somvar',               '2026-08-10 18:00'],
    ['सोमवार',                 '2026-08-10 18:00'],
    ['mangalvar',            '2026-08-11 18:00'],
    ['मंगलवार',                '2026-08-11 18:00'],
    ['budhvar',              '2026-08-12 18:00'],   // today is Wednesday → next one
    ['बुधवार',                 '2026-08-12 18:00'],
    ['guruvar',              '2026-08-06 18:00'],
    ['गुरुवार',                '2026-08-06 18:00'],
    ['shanivar',             '2026-08-08 18:00'],
    ['शनिवार',                 '2026-08-08 18:00'],
    ['ravivar',              '2026-08-09 18:00'],
    ['रविवार',                 '2026-08-09 18:00'],
  ])('weekday %j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });

  it.each([
    ['5 janvari',            '2027-01-05 18:00'],   // already past → next year
    ['5 जनवरी',               '2027-01-05 18:00'],
    ['20 agast',             '2026-08-20 18:00'],
    ['20 अगस्त',              '2026-08-20 18:00'],
    ['12 sitambar',          '2026-09-12 18:00'],
    ['12 सितंबर',              '2026-09-12 18:00'],
  ])('month name %j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });

  it('still refuses a Hindi phrase that is not a date', () => {
    expect(parseDeadline('जल्दी', NOW)).toBeNull();
    expect(parseDeadline('bahut zaroori', NOW)).toBeNull();
  });
});
