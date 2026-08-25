import { describe, expect, it } from 'vitest';
import { interpretContactReply } from '../../src/services/contactReplyService';

// The button labels below are the EXACT strings submitted to Meta. Meta returns
// the label for a template quick reply — there is no separate payload — so a
// label edited in WhatsApp Manager without being edited here turns every tap of
// that button into `unknown`, silently. These tests are that contract.

describe('quick-reply buttons', () => {
  describe('sample_dispatch', () => {
    it.each([
      ['Received',          'received'],
      ['मिल गया',            'received'],
      ['Not received yet',  'not_received'],
      ['अभी नहीं मिला',       'not_received'],
    ])('%j means %s', (label, meaning) => {
      expect(interpretContactReply(label)).toBe(meaning);
    });
  });

  describe('payment_due_reminder', () => {
    it.each([
      ['Payment done',   'paid'],
      ['भुगतान हो गया',    'paid'],
      ['Need more time', 'needs_time'],
      ['और समय चाहिए',     'needs_time'],
      ['Invoice Query',  'query'],
      ['इनवॉइस संबंधी प्रश्न', 'query'],
    ])('%j means %s', (label, meaning) => {
      expect(interpretContactReply(label)).toBe(meaning);
    });
  });

  describe('payment_advice_vendor', () => {
    it.each([
      ['Details Correct', 'details_ok'],
      ['विवरण सही है',      'details_ok'],
      ['Need to update',  'details_change'],
      ['अपडेट करना है',     'details_change'],
    ])('%j means %s', (label, meaning) => {
      expect(interpretContactReply(label)).toBe(meaning);
    });
  });

  describe('stock_check_request', () => {
    it.each([
      ['In stock',      'in_stock'],
      ['स्टॉक में है',     'in_stock'],
      ['Out of stock',  'out_of_stock'],
      ['स्टॉक में नहीं',    'out_of_stock'],
      ['Will confirm',  'will_confirm'],
      ['बाद में बताऊंगा',  'will_confirm'],
    ])('%j means %s', (label, meaning) => {
      expect(interpretContactReply(label)).toBe(meaning);
    });
  });

  describe('sales_order_placed', () => {
    it.each([
      ['Confirmed',  'confirmed'],
      ['पुष्टि करें',   'confirmed'],
      ['Query',      'query'],
      ['प्रश्न है',     'query'],
    ])('%j means %s', (label, meaning) => {
      expect(interpretContactReply(label)).toBe(meaning);
    });
  });

  it('is not fooled by the case WhatsApp renders a label in', () => {
    expect(interpretContactReply('PAYMENT DONE')).toBe('paid');
    expect(interpretContactReply('payment done')).toBe('paid');
  });
});

describe('opt-out', () => {
  it.each([
    'STOP', 'stop', 'Stop.', 'unsubscribe', 'remove me',
    'band karo', 'बंद करो', 'बंद', 'मत भेजो',
  ])('%j is an opt-out', (text) => {
    expect(interpretContactReply(text)).toBe('opt_out');
  });

  // Matched on the whole message, never as a substring. Reading this as an
  // opt-out would silence a customer who asked for the opposite.
  it.each([
    "please don't stop sending the samples",
    'stop by our office tomorrow',
    'non-stop production this week',
  ])('%j is NOT an opt-out', (text) => {
    expect(interpretContactReply(text)).not.toBe('opt_out');
  });

  it.each(['START', 'subscribe', 'shuru karo', 'शुरू करो'])('%j is an opt-in', (text) => {
    expect(interpretContactReply(text)).toBe('opt_in');
  });
});

describe('free text', () => {
  // Deliberately NOT interpreted. Reading a payment commitment out of prose is
  // a project of its own, and guessing wrong about money is worse than saying
  // "they replied" and forwarding it verbatim.
  it.each([
    "we'll pay on Tuesday",
    'paise agle hafte bhej denge',
    'कल तक भेज देंगे',
    'who is this?',
    '',
    '   ',
  ])('%j is left uninterpreted', (text) => {
    expect(interpretContactReply(text)).toBe('unknown');
  });
});
