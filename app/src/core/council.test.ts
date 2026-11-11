import { describe, expect, it } from 'vitest';
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
