/**
 * The signed offset formatter.
 *
 * Its whole job is the sign. The plan view prints one number per label, and
 * "412 ly" above a name says nothing about which side of the galactic plane the
 * place is on — the reader has to be able to tell Hightower's neighbourhood
 * from its mirror image without clicking anything.
 */

import { describe, expect, it } from 'vitest';

import { formatOffset, pc } from './units';

describe('formatOffset', () => {
  it('marks north explicitly', () => {
    expect(formatOffset(pc(100), 'ly')).toBe('+326.2 ly');
    expect(formatOffset(pc(100), 'pc')).toBe('+100.0 pc');
  });

  it('keeps the minus that is already there', () => {
    expect(formatOffset(pc(-100), 'pc')).toBe('-100.0 pc');
  });

  it('leaves zero unsigned, because the plane has no side', () => {
    expect(formatOffset(pc(0), 'ly')).toBe('0 ly');
  });

  it('never prints a bare number', () => {
    for (const value of [0, 0.004, -3.2, 5000, -12345]) {
      expect(formatOffset(pc(value), 'ly')).toMatch(/ ly$/);
    }
  });
});
