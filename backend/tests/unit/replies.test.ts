import { describe, expect, it } from 'vitest';
import { action, fragment, langOf, t } from '../../src/services/replies';

describe('langOf', () => {
  it.each([['hi', 'hi'], ['en', 'en'], ['mr', 'en'], [null, 'en'], [undefined, 'en']])(
    '%j resolves to %s',
    (input, expected) => expect(langOf(input as string | null)).toBe(expected),
  );
});

describe('t', () => {
  it('renders both languages', () => {
    expect(t('en', 'cancelled')).toBe('Cancelled — nothing was sent.');
    expect(t('hi', 'cancelled')).toBe('रद्द कर दिया — कुछ नहीं भेजा गया।');
  });

  it('interpolates', () => {
    expect(t('en', 'askAmount', { name: 'Ramesh Traders' }))
      .toBe('How much is outstanding from Ramesh Traders?');
    expect(t('hi', 'askAmount', { name: 'रमेश ट्रेडर्स' }))
      .toBe('रमेश ट्रेडर्स से कितनी राशि बकाया है?');
  });

  // A placeholder with no value is left visible on purpose. "undefined" in a
  // message asking somebody for money reads as a system fault; an obviously
  // unreplaced token fails a test instead of reaching a person.
  it('leaves an unsupplied placeholder alone', () => {
    expect(t('en', 'askAmount')).toContain('{name}');
  });

  it('has every key in both tables', () => {
    // A missing key would fall back to English silently, so this asserts the
    // Hindi table is actually complete rather than partly filled.
    const keys = ['confirmPrompt', 'cancelled', 'contactNotFound', 'taskCreated',
      'reminderSent', 'noticeSent', 'sendFailed', 'contactSaved', 'optedOut'] as const;
    for (const k of keys) {
      expect(t('hi', k)).not.toBe(t('en', k));
    }
  });
});

describe('fragment', () => {
  // English puts the preposition before the noun, Hindi puts a postposition
  // after it. This is the whole reason contact fragments are assembled rather
  // than interpolated as bare names.
  it('places the word on the correct side', () => {
    expect(fragment('en', 'Urja Vart', 'to')).toBe(' to Urja Vart');
    expect(fragment('hi', 'उर्जा वर्त', 'to', 'को')).toBe(' उर्जा वर्त को');
    expect(fragment('hi', 'रमेश', 'from', 'से')).toBe(' रमेश से');
  });

  it('collapses to nothing when there is no name', () => {
    expect(fragment('en', null, 'to')).toBe('');
    expect(fragment('hi', '', 'to')).toBe('');
  });
});

describe('action', () => {
  it('reads back a payment reminder in English', () => {
    expect(action('en', 'sendPaymentReminder', {
      contact: ' to Ramesh Traders', phone: ' (+91 ••••4455)',
      amount: '₹45,000', words: '', reference: 'Invoice INV-2231', date: '5 September 2026',
    })).toBe('send a payment reminder to Ramesh Traders (+91 ••••4455) for ₹45,000 against Invoice INV-2231, due 5 September 2026');
  });

  it('reads back a payment reminder in Hindi', () => {
    const out = action('hi', 'sendPaymentReminder', {
      contact: ' रमेश ट्रेडर्स को', phone: '',
      amount: '₹45,000', words: '', reference: 'INV-2231', date: '5 सितंबर 2026',
    });
    expect(out).toContain('रमेश ट्रेडर्स को');
    expect(out).toContain('₹45,000');
    expect(out).not.toContain('{');
  });

  // An optional slot left empty must not leave a dangling separator behind it.
  it('does not leave a dangling comma or double space', () => {
    const out = action('en', 'createSalesTask', { assignee: 'Vedant', contact: '', date: 'Friday' });
    expect(out).toBe('create a task for Vedant: raise a sale, due Friday');
    expect(out).not.toMatch(/\s{2,}/);
    expect(out).not.toMatch(/\s,/);
  });
});
