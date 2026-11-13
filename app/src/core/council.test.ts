import { describe, expect, it } from 'vitest';
import { nowSec, offsetFromDate, setClockOffset } from './util';
import { councilChangeSchemaError, type CouncilChange } from './council';

const K1 = 'a'.repeat(64);
const K2 = 'b'.repeat(64);
const base: CouncilChange = { reason: 'expansion', out_key: null, in_key: K1, in_xpub: 'tpub…', in_fingerprint: '6b7fa6f3', threshold: 3, new_descriptor: '' };

describe('council change reasons (4.1.2)', () => {
  it('expansion: someone joins, nobody leaves', () => {
    expect(councilChangeSchemaError(base)).toBeUndefined();
    expect(councilChangeSchemaError({ ...base, out_key: K2 })).toBe('reason');
    expect(councilChangeSchemaError({ ...base, in_key: null, in_xpub: null, in_fingerprint: null })).toBe('reason');
  });
  it('threshold only: nobody joins or leaves', () => {
    expect(councilChangeSchemaError({ ...base, reason: 'threshold', in_key: null, in_xpub: null, in_fingerprint: null })).toBeUndefined();
    expect(councilChangeSchemaError({ ...base, reason: 'rotation', in_key: null, in_xpub: null, in_fingerprint: null })).toBe('reason');
  });
  it('a new seat may still give another reason that fits', () => {
    expect(councilChangeSchemaError({ ...base, reason: 'rotation' })).toBeUndefined();
  });
});

import { buildDescriptor, walletOf, sameWallet } from './descriptor';

describe('the same wallet in another order (COUNCIL DAO, 12 Nov 2026)', () => {
  const A = { fingerprint: 'd3bdd580', xpub: 'tpubDFKVE4hAcCsmYyXX8mURCAE3smjoLhyqGH5CtJjgyhBBQR9VopPxmK24XsjmbG4XTvHoQo73WBRnC2aLuG5mbUPemuyvUBJUEeDMM5nyG8e' };
  const B = { fingerprint: '49c2d730', xpub: 'tpubDFUxuLmA93bTzumuAt8nqakLsDcNXk5ZB2mwZv1SxwX7u6THfmvdqBRrrBdkmCeLfQPcs8Rx3kEYsAZFYvQjSeJ6V1Q6dMn7Z7TzJHswBXU' };
  const C = { fingerprint: 'ec03225a', xpub: 'tpubDFCfvs2SLPX7J8JKkpaRQ6XKH2EksYsLNPAsucb9KDunGYemVrAm8VL4kNJ5Gm6icC3mBUinvirVXF5ZMatoCHuqmpAYKcmKUTLT7pMyXxE' };
  it('compares keys and threshold, not their order', () => {
    const founding = buildDescriptor(2, [C, B, A], 'testnet4');
    const afterRecall = buildDescriptor(2, [B, A, C], 'testnet4');
    expect(founding).not.toBe(afterRecall);
    expect(sameWallet(founding, afterRecall)).toBe(true);
    expect(sameWallet(founding, buildDescriptor(3, [C, B, A], 'testnet4'))).toBe(false);
    expect(sameWallet(founding, buildDescriptor(2, [A, B], 'testnet4'))).toBe(false);
    expect(walletOf(founding).startsWith('2:')).toBe(true);
  });
});

describe("the app's time", () => {
  it('reads the offset from a Date header against the midpoint of the request', () => {
    const server = Date.parse('Fri, 13 Nov 2026 17:00:00 GMT');
    // The phone is 4 minutes slow; the request took 400 ms.
    const sent = server - 240_000 - 200;
    expect(offsetFromDate('Fri, 13 Nov 2026 17:00:00 GMT', sent, sent + 400)).toBe(240_000 + 500);
    expect(offsetFromDate(null, 0, 0)).toBeUndefined();
    expect(offsetFromDate('not a date', 0, 0)).toBeUndefined();
  });
  it('dates by the corrected time', () => {
    const before = nowSec();
    setClockOffset(300_000);
    expect(nowSec() - before).toBeGreaterThanOrEqual(299);
    setClockOffset(0);
  });
});
