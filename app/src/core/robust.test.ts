// Review of 14 November 2026, block 1: no event may take the rebuild down (R-C1), and a rule change must carry a
// value the app can use (R-H2). Each case below crashed rebuild() for every member before v0.9.0.
import { describe, expect, it } from 'vitest';
import { buildGenesis, ruleValueError, type SiteConfig } from './config';
import { buildDescriptor } from './descriptor';
import { KIND, sign, template, type Event } from './events';
import { newSecret, pubkeyOf, treasuryKeyFromMnemonic } from './identity';
import { rebuild } from './state';
import { hashJson, parseJson, validTimeZone } from './util';

const MNEMONICS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
];
const site: SiteConfig = {
  configVersion: 1, name: 'T', description: 'x', languages: ['it'], network: 'testnet4',
  site: 'https://example.org/t', passkeyDomain: 'example.org', council: [], founders: [], threshold: 2, descriptor: '', relays: [], chainApi: [],
  rules: {
    votingPeriodDays: 7, quorum: '1/3', simpleMajority: ['payout', 'statement', 'addMember'],
    twoThirdsMajority: ['removeMember', 'changeRules', 'changeCouncil', 'close'], payoutRound: 'monthly',
    timezone: 'Europe/Rome', lapseAfterRounds: 2, maxFeeRateSatVb: 20, treasuryCapSats: 5_000_000,
    remoteVerification: {}, minimumAge: 18, charterSha256: 'ab'.repeat(32),
  },
};

function dao() {
  const c = MNEMONICS.map(() => newSecret());
  const tk = MNEMONICS.map(m => treasuryKeyFromMnemonic(m, 'testnet4'));
  const genesis = buildGenesis(site, {
    name: 'T', description: 'd',
    council: c.map((s, i) => ({ label: `@c${i}`, identityKey: pubkeyOf(s), fingerprint: tk[i].fingerprint, xpub: tk[i].xpub })),
    founders: [], threshold: 2, descriptor: buildDescriptor(2, tk, 'testnet4'), charterSha256: 'ab'.repeat(32),
  });
  const daoId = hashJson(genesis);
  const events: Event[] = [];
  /** content: an object, or a raw string sent as-is (malformed on purpose). */
  const ev = (kind: number, content: unknown, secret: string, at: number, tags: string[][] = []) => {
    const e = sign(template(kind, daoId, content, tags, at), secret);
    events.push(e);
    return e;
  };
  const g = ev(KIND.genesis, genesis, c[0], 1000);
  [0, 1].forEach(i => ev(KIND.endorse, { object: 'genesis', hash: daoId }, c[i], 1001 + i, [['e', g.id]]));
  const proposal = ev(KIND.proposal, { type: 'statement', title: 'T', summary: 'S', lang: 'it', payload: {} }, c[0], 2000);
  return { c, daoId, events, ev, proposal, state: (now = 2000 + 30 * 86400) => rebuild({ ...site, daoId }, events, undefined, now) };
}

describe('no event takes the rebuild down (R-C1)', () => {
  const outsider = newSecret();
  const cases: [string, (d: ReturnType<typeof dao>) => void][] = [
    ['a round whose proposals are not strings', d => d.ev(KIND.round, '{"proposals":[1],"psbt":"x"}', outsider, 3000)],
    ['a round with bad tranches', d => d.ev(KIND.round, '{"proposals":["' + 'a'.repeat(64) + '"],"psbt":"x","tranches":{"a":null}}', d.c[0], 3000)],
    ['a key-status notice with a number for its fingerprint', d => d.ev(KIND.keystatus, '{"fingerprint":5,"state":"lost"}', d.c[1], 3000)],
    ['a number JSON cannot hold (1e999) in a roster version', d => d.ev(KIND.roster, '{"version":2,"prev":1e999,"members":[]}', outsider, 3000)],
    ['1e999 in a settings version', d => d.ev(KIND.settings, '{"version":1e999}', outsider, 3000)],
    ['1e999 in a genesis', d => d.ev(KIND.genesis, '{"name":1e999}', outsider, 3000)],
    ['a tally with null among the excluded votes', d => d.ev(KIND.tally, JSON.stringify({ proposal: d.proposal.id, closed_at: 2000 + 7 * 86400, number: 1, counted: [], excluded: [null], result: { yes: 0, no: 0, abstain: 0, quorum_met: false, passed: false } }), d.c[0], 2000 + 8 * 86400, [['e', d.proposal.id]])],
    ['a tally with 1e999 in its result', d => d.ev(KIND.tally, `{"proposal":"${d.proposal.id}","closed_at":${2000 + 7 * 86400},"number":1,"counted":[],"excluded":[],"result":{"yes":1e999,"no":0,"abstain":0,"quorum_met":true,"passed":true}}`, d.c[0], 2000 + 8 * 86400, [['e', d.proposal.id]])],
    ['a discussion draft with 1e999 in its payload', d => d.ev(KIND.draft, '{"title":"x","summary":"y","payload":{"n":1e999}}', d.c[0], 3000)],
  ];
  for (const [name, add] of cases) {
    it(name, () => {
      const d = dao();
      add(d);
      const s = d.state();
      expect(s.founded).toBeTruthy();
      expect(s.proposals.length).toBe(1);
      // Stopped by its own check, not only caught by the safety net.
      expect(s.rejected.some(r => r.reason.startsWith('could not be read'))).toBe(false);
    });
  }
});

describe('parseJson and time zones', () => {
  it('refuses numbers JSON cannot round-trip', () => {
    expect(parseJson('{"a":1e999}')).toBeUndefined();
    expect(parseJson('{"a":-1e999}')).toBeUndefined();
    expect(parseJson('{"a":1.5}')).toEqual({ a: 1.5 });
  });
  it('knows real time zones only', () => {
    expect(validTimeZone('Europe/Rome')).toBe(true);
    expect(validTimeZone('Europe/Rom')).toBe(false);
    expect(validTimeZone(5)).toBe(false);
  });
});

describe('rule changes carry usable values (R-H2)', () => {
  const v = { timeZone: validTimeZone };
  it('refuses names that are not rules', () => {
    expect(ruleValueError('constructor', 1, v)).toBeTruthy();
    expect(ruleValueError('__proto__', {}, v)).toBeTruthy();
    expect(ruleValueError('madeUp', 1, v)).toBeTruthy();
  });
  it('refuses values the app cannot use', () => {
    expect(ruleValueError('timezone', 'Europe/Rom', v)).toBeTruthy();
    expect(ruleValueError('votingPeriodDays', 0, v)).toBeTruthy();
    expect(ruleValueError('votingPeriodDays', '7', v)).toBeTruthy();
    expect(ruleValueError('quorum', '4/3', v)).toBeTruthy();
    expect(ruleValueError('payoutRound', 'daily', v)).toBeTruthy();
    expect(ruleValueError('lapseAfterRounds', 1.5, v)).toBeTruthy();
    expect(ruleValueError('maxFeeRateSatVb', -1, v)).toBeTruthy();
    expect(ruleValueError('charterSha256', 'xyz', v)).toBeTruthy();
  });
  it('accepts the values in use', () => {
    for (const [k, x] of Object.entries({ ...site.rules, feePolicy: 'economical', fundingModel: 'mutual', charterLanguage: 'it', maxTranches: 4, maxScheduleDays: 90, payoutRound: 'weekly', votingPeriodDays: 0.006944 })) {
      expect(ruleValueError(k, x, v)).toBeUndefined();
    }
  });
  it('a proposal setting a bad time zone is rejected, and the DAO keeps working', () => {
    const d = dao();
    d.ev(KIND.proposal, { type: 'change_rules', title: 'TZ', summary: 'S', lang: 'it', payload: { changes: [{ path: 'rules.timezone', from: 'Europe/Rome', to: 'Europe/Rom' }] } }, d.c[0], 2500);
    d.ev(KIND.proposal, { type: 'change_rules', title: 'C', summary: 'S', lang: 'it', payload: { changes: [{ path: 'rules.constructor', from: 1, to: 2 }] } }, d.c[0], 2600);
    const s = d.state();
    expect(s.proposals.length).toBe(1);
    expect(s.rejected.some(r => /change value|change/.test(r.reason))).toBe(true);
  });
});
