import { describe, it, expect } from 'vitest';
import {
  CONTACT_TYPES, TASK_KINDS, contactTypeStyle, taskKindLabel, formatMoney,
  initialContacts, initialInvoices,
} from '../data/mockData.js';

// The demo build runs entirely on mockData — a view that reads from the API
// without a mock counterpart renders an empty page to anybody evaluating the
// product. These assert the shapes the new views actually destructure.

describe('formatMoney', () => {
  it.each([
    [45000,     '₹45,000'],
    [120000,    '₹1,20,000'],   // Indian grouping, not 120,000
    [10000000,  '₹1,00,00,000'],
    [1299.5,    '₹1,299.50'],
    [500,       '₹500'],
    [0,         '₹0'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatMoney(value)).toBe(expected);
  });

  it('names a non-rupee currency rather than guessing a symbol', () => {
    expect(formatMoney(45000, 'USD')).toBe('USD 45,000');
  });

  it('survives a missing value instead of rendering NaN', () => {
    expect(formatMoney(undefined)).toBe('₹0');
    expect(formatMoney(null)).toBe('₹0');
  });

  // The backend sends Decimal columns as JSON strings. Rendering those without
  // coercion gives "₹NaN" on every invoice row.
  it('accepts the string a Decimal column serialises to', () => {
    expect(formatMoney('45000')).toBe('₹45,000');
  });
});

describe('contactTypeStyle', () => {
  it('returns a style for every declared type', () => {
    for (const t of CONTACT_TYPES) {
      const style = contactTypeStyle(t.id);
      expect(style.label).toBe(t.label);
      expect(style.bg).toMatch(/^bg-/);
      expect(style.text).toMatch(/^text-/);
    }
  });

  it('falls back rather than returning undefined for an unknown type', () => {
    expect(contactTypeStyle('nonsense').label).toBe('Other');
    expect(contactTypeStyle(undefined).label).toBe('Other');
  });
});

describe('taskKindLabel', () => {
  it('labels every kind', () => {
    for (const k of TASK_KINDS) expect(taskKindLabel(k.id)).toBe(k.label);
  });

  // Every task created before this feature has no `kind` at all.
  it('treats a missing kind as internal', () => {
    expect(taskKindLabel(undefined)).toBe('Internal');
    expect(taskKindLabel(null)).toBe('Internal');
  });
});

describe('demo fixtures', () => {
  it('gives every contact the fields the directory renders', () => {
    for (const c of initialContacts) {
      expect(c).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        phone: expect.any(String),
        type: expect.any(String),
        ownerId: expect.any(String),
      });
      expect(Array.isArray(c.aliases)).toBe(true);
      expect(typeof c.outstandingBalance).toBe('number');
      expect(CONTACT_TYPES.some((t) => t.id === c.type)).toBe(true);
    }
  });

  it('includes the two similar names the ambiguity flow needs', () => {
    const rameshes = initialContacts.filter((c) => c.name.toLowerCase().includes('ramesh'));
    expect(rameshes.length).toBeGreaterThanOrEqual(2);
  });

  it('includes an opted-out party, so that state is visible in the demo', () => {
    expect(initialContacts.some((c) => c.optOutAt)).toBe(true);
  });

  it('includes a bill in each direction', () => {
    expect(initialInvoices.some((i) => i.payable)).toBe(true);
    expect(initialInvoices.some((i) => !i.payable)).toBe(true);
  });

  it('points every invoice at a real contact', () => {
    const ids = new Set(initialContacts.map((c) => c.id));
    for (const inv of initialInvoices) {
      expect(ids.has(inv.contactId)).toBe(true);
      expect(Number(inv.balance)).toBeLessThanOrEqual(Number(inv.amount));
    }
  });

  // The directory shows a per-contact outstanding total; if it disagreed with
  // the invoice list the demo would contradict itself on screen.
  it('keeps each contact outstanding total in step with its invoices', () => {
    for (const c of initialContacts) {
      const open = initialInvoices.filter(
        (i) => i.contactId === c.id && (i.status === 'open' || i.status === 'partial'),
      );
      const sum = open.reduce((n, i) => n + Number(i.balance), 0);
      expect(c.outstandingBalance).toBe(sum);
      expect(c.openInvoiceCount).toBe(open.length);
    }
  });
});
