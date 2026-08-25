import { describe, it, expect } from 'vitest';
import {
  extractAmount,
  extractDocRef,
  maskNonTaskDigits,
  formatAmount,
} from '../../src/services/moneyParser';

describe('extractAmount', () => {
  it.each([
    ['₹45,000',                          45_000],
    ['₹45000',                           45_000],
    ['Rs. 45,000',                       45_000],
    ['Rs 45000',                         45_000],
    ['INR 1,20,000',                     120_000],
    ['45,000 rupees',                    45_000],
    ['45000/-',                          45_000],
    ['pay 45 hazaar to them',            45_000],
    ['45 हज़ार का भुगतान',                 45_000],
    ['2 lakh pending',                   200_000],
    ['2 लाख बकाया है',                     200_000],
    ['45k due',                          45_000],
    ['1.5 crore',                        15_000_000],
    ['send a reminder for 45,000',       45_000],
    ['₹1,299.50 outstanding',            1_299.5],
  ])('reads %j as %s', (text, value) => {
    expect(extractAmount(text)?.value).toBe(value);
  });

  it.each([
    'task 1058 done',
    'need 2 more days',
    'काम 2 घंटे में हो जाएगा',
    '',
  ])('finds no amount in %j', (text) => {
    expect(extractAmount(text)).toBeNull();
  });

  it('keeps the text as written for reading back', () => {
    expect(extractAmount('remind them about ₹45,000 please')?.raw).toBe('₹45,000');
  });
});

describe('extractDocRef', () => {
  it.each([
    ['clear INV-102',                    'INV-102'],
    ['inv 102 is pending',               'INV-102'],
    ['against invoice INV-2231',         'INV-2231'],
    ['order SO-1187 placed',             'SO-1187'],
    ['PO-7781 raised',                   'PO-7781'],
    ['invoice number 102',               'INV-102'],
    ['bill no 4471',                     'BILL-4471'],
    ["बिल नंबर 102",                       "BILL-102"],
  ])('reads %j as %s', (text, ref) => {
    expect(extractDocRef(text)).toBe(ref);
  });

  it.each(['task 1058 done', 'nothing here', ''])('finds no ref in %j', (text) => {
    expect(extractDocRef(text)).toBeNull();
  });
});

describe('maskNonTaskDigits', () => {
  it('blanks amount digits but keeps the length', () => {
    const input = 'remind them about ₹45,000';
    const out = maskNonTaskDigits(input);
    expect(out).toHaveLength(input.length);
    expect(out).not.toMatch(/\d/);
  });

  it('blanks a bare number sitting in money context', () => {
    expect(maskNonTaskDigits('about 45000 due Friday')).not.toMatch(/45000/);
    expect(maskNonTaskDigits('payment of 45000')).not.toMatch(/45000/);
  });

  it('leaves an ordinary sentence alone', () => {
    const input = 'task 1058 shuru kar diya';
    expect(maskNonTaskDigits(input)).toBe(input);
  });
});

describe('formatAmount', () => {
  it.each([
    [45_000,     '₹45,000'],
    [120_000,    '₹1,20,000'],
    [10_000_000, '₹1,00,00,000'],
    [1_299.5,    '₹1,299.50'],
    [500,        '₹500'],
  ])('formats %s as %s with Indian grouping', (value, expected) => {
    expect(formatAmount(value)).toBe(expected);
  });

  it('names a non-rupee currency instead of guessing a symbol', () => {
    expect(formatAmount(45_000, 'USD')).toBe('USD 45,000');
  });
});
