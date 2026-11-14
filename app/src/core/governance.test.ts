// Protocol sections 3.3, 3.4, 4 and 5: proposals, votes, tallies, rosters, settings and membership.
import { describe, expect, it } from 'vitest';
import { p2wpkh, TEST_NETWORK, Transaction } from '@scure/btc-signer';
import { base64 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hexToBytes } from '@noble/hashes/utils';
import { buildGenesis, type SiteConfig } from './config';
import { buildDescriptor, parseDescriptor, treasuryAddress } from './descriptor';
import { KIND, sign, template, type Event } from './events';
import { newSecret, pubkeyOf, treasuryKeyFromMnemonic } from './identity';
import { shortCode } from './shortcode';
import { nextRoster, nextSettings, rebuild, TALLY_SETTLE, type DaoState, type ProposalContent, type TallyContent } from './state';
import { hashJson, parseJson } from './util';
import { roundDatesAfter } from './time';

const MNEMONICS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
  'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic',
];
const DAY = 86400;
const ADDR = p2wpkh(secp256k1.getPublicKey(hexToBytes('11'.repeat(32)), true), TEST_NETWORK).address!;

const site: SiteConfig = {
  configVersion: 1, name: 'UNO', description: 'x', languages: ['it'], network: 'testnet4',
  site: 'https://bitcoin-dao.github.io/uno-testnet', passkeyDomain: 'bitcoin-dao.github.io',
  council: [], founders: [], threshold: 3, descriptor: '', relays: [], chainApi: [],
  rules: {
    votingPeriodDays: 7, quorum: '1/3', simpleMajority: ['payout', 'statement', 'addMember'],
    twoThirdsMajority: ['removeMember', 'changeRules', 'changeCouncil', 'close'], payoutRound: 'monthly',
    timezone: 'Europe/Rome', lapseAfterRounds: 2, maxFeeRateSatVb: 20, treasuryCapSats: 5_000_000,
    remoteVerification: {}, minimumAge: 18, charterSha256: 'ab'.repeat(32),
  },
};

/** A founded DAO: 5 council (c0..c4), 4 founders (f0..f3). 9 members, quorum 3. */
function dao(rules: Partial<SiteConfig['rules']> = {}) {
  const c = MNEMONICS.map(() => newSecret());
  const f = [0, 1, 2, 3].map(() => newSecret());
  const tk = MNEMONICS.map(m => treasuryKeyFromMnemonic(m, 'testnet4'));
  const descriptor = buildDescriptor(3, tk, 'testnet4');
  const genesis = buildGenesis({ ...site, rules: { ...site.rules, ...rules } }, {
    name: 'UNO', description: 'd',
    council: c.map((s, i) => ({ label: `@c${i}`, identityKey: pubkeyOf(s), fingerprint: tk[i].fingerprint, xpub: tk[i].xpub })),
    founders: f.map((s, i) => ({ name: `@f${i}`, identityKey: pubkeyOf(s), verified: 'in_person' as const })),
    threshold: 3, descriptor, charterSha256: 'ab'.repeat(32),
  });
  const daoId = hashJson(genesis);
  const events: Event[] = [];
  const ev = (kind: number, content: unknown, secret: string, at: number, tags: string[][] = []) => {
    const e = sign(template(kind, daoId, content, tags, at), secret);
    events.push(e);
    return e;
  };
  const g = ev(KIND.genesis, genesis, c[0], 1000);
  [0, 1, 2].forEach(i => ev(KIND.endorse, { object: 'genesis', hash: daoId }, c[i], 1001 + i, [['e', g.id]]));
  const T = 2000; // after founding
  const state = (now: number) => rebuild(site, events, undefined, now);
  const propose = (secret: string, content: Partial<ProposalContent> & { type: ProposalContent['type'] }, at: number) =>
    ev(KIND.proposal, { title: 'T', summary: 'S', lang: 'it', payload: {}, ...content }, secret, at);
  const vote = (secret: string, p: Event, choice: string, at: number) => ev(KIND.vote, { choice }, secret, at, [['e', p.id]]);
  const tally = (secret: string, s: DaoState, p: Event, at: number, override?: Partial<TallyContent>) => {
    const view = s.proposals.find(x => x.event.id === p.id)!;
    return ev(KIND.tally, { ...view.recount, ...override }, secret, at, [['e', p.id]]);
  };
  const endorse = (secret: string, target: Event, object: string, at: number) =>
    ev(KIND.endorse, { object, hash: hashJson(parseJson(target.content)) }, secret, at, [['e', target.id]]);
  const treasury0 = treasuryAddress(parseDescriptor(descriptor, 'testnet4'), 'testnet4', 0, 0).address;
  return { c, f, daoId, events, ev, state, propose, vote, tally, endorse, T, treasury0 };
}

const view = (s: DaoState, p: Event) => s.proposals.find(x => x.event.id === p.id)!;

describe('proposals and votes (4.1, 4.3)', () => {
  it('counts the latest vote per member, excludes late and non-member votes, and passes once tallied', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement', title: 'Carta fondativa' }, d.T);
    d.vote(d.f[0], p, 'no', d.T + 10);
    d.vote(d.f[0], p, 'yes', d.T + 20); // changed
    d.vote(d.f[1], p, 'yes', d.T + 30);
    d.vote(d.c[1], p, 'abstain', d.T + 40);
    d.vote(newSecret(), p, 'yes', d.T + 50); // not a member
    d.vote(d.f[2], p, 'no', d.T + 7 * DAY + 1); // late
    let s = d.state(d.T + DAY);
    let v = view(s, p);
    expect(v.number).toBe(1);
    expect(v.status).toBe('open');
    expect(v.counts).toEqual({ yes: 2, no: 0, abstain: 1 });
    expect(v.eligible.size).toBe(9);
    expect(v.quorumNeeded).toBe(3);
    s = d.state(d.T + 8 * DAY);
    v = view(s, p);
    expect(v.status).toBe('awaiting_tally');
    expect(v.recount.excluded.map(x => x.reason).sort()).toEqual(['late', 'not_eligible', 'superseded']);
    d.tally(d.c[2], s, p, d.T + 8 * DAY);
    v = view(d.state(d.T + 8 * DAY + 1), p);
    expect(v.status).toBe('passed');
    expect(v.tallyMismatch).toBe(false);
  });

  it('fails quorum, and needs two-thirds where the rules say so', () => {
    const d = dao();
    const p1 = d.propose(d.f[0], { type: 'statement' }, d.T);
    d.vote(d.f[0], p1, 'yes', d.T + 1);
    d.vote(d.f[1], p1, 'yes', d.T + 1);
    const p2 = d.propose(d.c[0], { type: 'remove_member', payload: { member_key: pubkeyOf(d.f[3]), reason: 'x' } }, d.T + 5);
    for (const [i, ch] of [[0, 'yes'], [1, 'yes'], [2, 'no']] as const) d.vote(d.f[i], p2, ch, d.T + 10);
    const s = d.state(d.T + 8 * DAY);
    d.tally(d.c[0], s, p1, d.T + 8 * DAY);
    d.tally(d.c[0], s, p2, d.T + 8 * DAY);
    const s2 = d.state(d.T + 8 * DAY + 1);
    expect(view(s2, p1).status).toBe('no_quorum');
    expect(view(s2, p2).twoThirds).toBe(true);
    expect(view(s2, p2).status).toBe('passed'); // 2 of 3 is two-thirds
    d.vote(d.f[3], p2, 'no', d.T + 11);
    expect(view(d.state(d.T + 8 * DAY + 1), p2).recount.result.passed).toBe(false);
  });

  it('rejects tallies from outside the council; the fuller count wins a conflict, within the settle window', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    for (const i of [0, 1]) d.vote(d.f[i], p, 'yes', d.T + 1);
    const C = d.T + 8 * DAY; // after the close
    // A council phone that had seen only one of the two votes:
    const s1 = d.state(C);
    const one = view(s1, p);
    d.tally(d.f[0], s1, p, C); // not council
    expect(view(d.state(C + 1), p).status).toBe('awaiting_tally');
    const partial = d.ev(KIND.tally, { ...one.recount, counted: [one.recount.counted[0]], result: { ...one.recount.result, yes: 1 } }, d.c[0], C + 1, [['e', p.id]]);
    void partial;
    const a = view(d.state(C + 2), p);
    expect(a.disputed).toBe(false);
    expect(a.tally!.content.result.yes).toBe(1);
    expect(a.fuller).toBe(true); // this phone sees both votes: it publishes the fuller count
    d.tally(d.c[1], d.state(C + 2), p, C + 3);
    const b = view(d.state(C + 4), p);
    expect(b.disputed).toBe(false);
    expect(b.tally!.content.result.yes).toBe(2);
    expect(b.fuller).toBe(false);
    d.tally(d.c[2], d.state(C + 4), p, C + 5); // identical: one tally
    expect(view(d.state(C + 6), p).disputed).toBe(false);
  });

  it('a count whose result does not follow from its votes is rejected; a count after the settle window changes nothing', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 1);
    const C = d.T + 8 * DAY;
    const s = d.state(C);
    d.tally(d.c[0], s, p, C);
    d.tally(d.c[3], s, p, C + 3, { result: { yes: 0, no: 3, abstain: 0, quorum_met: true, passed: false } });
    // v0.9.0 (review R-C2): a count whose result does not follow from its votes is rejected, not a dispute.
    const st = d.state(C + 4);
    expect(view(st, p).status).toBe('passed');
    expect(st.rejected.some(r => r.reason === 'tally: does not match the votes it lists')).toBe(true);
    const e = dao();
    const q = e.propose(e.f[0], { type: 'statement' }, e.T);
    for (const i of [0, 1]) e.vote(e.f[i], q, 'yes', e.T + 1);
    const s0 = e.state(C);
    const r = view(s0, q).recount;
    e.ev(KIND.tally, { ...r, counted: [r.counted[0]], result: { ...r.result, yes: 1 } }, e.c[0], C, [['e', q.id]]);
    e.tally(e.c[1], s0, q, C + TALLY_SETTLE + 1); // too late to settle anything
    const late = view(e.state(C + TALLY_SETTLE + 2), q);
    expect(late.tally!.content.result.yes).toBe(1);
    expect(late.fuller).toBe(false);
  });

  it('rejects a proposal backdated before the last tallied one, so numbers never change', () => {
    const d = dao();
    const p1 = d.propose(d.f[0], { type: 'statement' }, d.T + 100);
    const s = d.state(d.T + 8 * DAY);
    d.tally(d.c[0], s, p1, d.T + 8 * DAY);
    const back = d.propose(d.f[1], { type: 'statement' }, d.T + 50);
    const s2 = d.state(d.T + 8 * DAY + 1);
    expect(view(s2, p1).number).toBe(1);
    expect(s2.proposals.some(x => x.event.id === back.id)).toBe(false);
    expect(s2.rejected.some(r => r.event.id === back.id)).toBe(true);
  });

  it('validates payouts: network, dust, the treasury itself; confirmations from any key', () => {
    const d = dao();
    const bad = [
      d.propose(d.f[0], { type: 'payout', payload: { recipient: 'X', outputs: [{ address: 'bc1qnotours', amount_sat: 1000 }] } }, d.T),
      d.propose(d.f[0], { type: 'payout', payload: { recipient: 'X', outputs: [{ address: ADDR, amount_sat: 300 }] } }, d.T + 1),
      d.propose(d.f[0], { type: 'payout', payload: { recipient: 'X', outputs: [{ address: d.treasury0, amount_sat: 1000 }] } }, d.T + 2),
    ];
    const ok = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: ADDR, amount_sat: 120000 }] } }, d.T + 3);
    let s = d.state(d.T + 10);
    expect(s.proposals.map(x => x.event.id)).toEqual([ok.id]);
    expect(bad.every(b => s.rejected.some(r => r.event.id === b.id))).toBe(true);
    expect(view(s, ok).confirmed).toBe(false);
    d.ev(KIND.confirm, { address: 'tb1qsomethingelse' }, newSecret(), d.T + 11, [['e', ok.id]]);
    d.ev(KIND.confirm, { address: ADDR }, newSecret(), d.T + 12, [['e', ok.id]]);
    s = d.state(d.T + 20);
    expect(view(s, ok).confirmed).toBe(true);
  });
});

describe('membership (3.3, 5.1-5.3)', () => {
  function addMember(d: ReturnType<typeof dao>, at: number, mode: 'in_person' | 'remote' = 'in_person') {
    const cand = newSecret();
    const key = pubkeyOf(cand);
    const v1 = d.ev(KIND.verify, { candidate_key: key, mode, short_code: shortCode(key) }, d.c[0], at, [['p', key]]);
    const verify = [v1.id];
    if (mode === 'remote') verify.push(d.ev(KIND.verify, { candidate_key: key, mode, short_code: shortCode(key) }, d.c[1], at + 1, [['p', key]]).id);
    const p = d.propose(d.f[0], { type: 'add_member', payload: { candidate_key: key, name: '@nina', verify } }, at + 10);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', at + 20);
    d.tally(d.c[0], d.state(at + 8 * DAY), p, at + 8 * DAY);
    return { cand, key, p };
  }
  function publishRoster(d: ReturnType<typeof dao>, at: number, edit?: (r: any) => void) {
    const s = d.state(at);
    const r = nextRoster(s, '2026-11-20')!;
    edit?.(r);
    const e = d.ev(KIND.roster, r, d.c[0], at);
    for (const i of [0, 1, 2]) d.endorse(d.c[i], e, 'roster', at + 1 + i);
    return e;
  }

  it('adds a verified candidate after a passed vote and a new roster version', () => {
    const d = dao();
    const { key } = addMember(d, d.T);
    let s = d.state(d.T + 8 * DAY + 1);
    expect(s.pendingRoster.length).toBe(1);
    expect(s.members.some(m => m.key === key)).toBe(false);
    publishRoster(d, d.T + 8 * DAY + 10);
    s = d.state(d.T + 9 * DAY);
    expect(s.rosters.length).toBe(2);
    expect(s.members.find(m => m.key === key)?.name).toBe('@nina');
    expect(s.pendingRoster).toEqual([]);
  });

  it('refuses an add_member without a valid verification, and a roster adding someone without basis', () => {
    const d = dao();
    const key = pubkeyOf(newSecret());
    const fake = d.ev(KIND.verify, { candidate_key: key, mode: 'in_person', short_code: shortCode(key) }, d.f[0], d.T, [['p', key]]);
    const p = d.propose(d.f[0], { type: 'add_member', payload: { candidate_key: key, name: '@x', verify: [fake.id] } }, d.T + 1);
    let s = d.state(d.T + 2);
    expect(s.proposals.some(x => x.event.id === p.id)).toBe(false);
    addMember(d, d.T + 10);
    const intruder = pubkeyOf(newSecret());
    publishRoster(d, d.T + 8 * DAY + 100, r => r.members.push({ key: intruder, name: '@intruder', since: '2026-11-20', verified: 'in_person', council: false }));
    s = d.state(d.T + 9 * DAY);
    expect(s.rosters.length).toBe(1);
    expect(s.rosterCandidates[0].error).toBe('members do not follow from the basis');
  });

  it('remote joins need two council verifications', () => {
    const d = dao();
    const key = pubkeyOf(newSecret());
    const v = d.ev(KIND.verify, { candidate_key: key, mode: 'remote', short_code: shortCode(key) }, d.c[0], d.T, [['p', key]]);
    const p = d.propose(d.f[0], { type: 'add_member', payload: { candidate_key: key, name: '@r', verify: [v.id] } }, d.T + 1);
    expect(d.state(d.T + 2).proposals.some(x => x.event.id === p.id)).toBe(false);
    const { key: k2 } = addMember(d, d.T + 10, 'remote');
    publishRoster(d, d.T + 8 * DAY + 100);
    expect(d.state(d.T + 9 * DAY).members.find(m => m.key === k2)?.verified).toBe('remote');
  });

  it('a member who leaves loses their vote on open proposals and is dropped from the next roster', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    d.vote(d.f[3], p, 'yes', d.T + 1);
    d.ev(KIND.leave, {}, d.f[3], d.T + 2);
    d.ev(KIND.leave, {}, d.c[4], d.T + 3); // council cannot leave this way
    let s = d.state(d.T + 3 * DAY);
    expect(view(s, p).counts.yes).toBe(0);
    expect(view(s, p).eligible.size).toBe(8);
    expect(s.pendingRoster.length).toBe(1);
    publishRoster(d, d.T + 3 * DAY);
    s = d.state(d.T + 4 * DAY);
    expect(s.members.length).toBe(8);
    expect(s.members.some(m => m.key === pubkeyOf(d.c[4]))).toBe(true);
  });

  it('replaces a key: the person keeps their vote, the old key stops counting, the roster follows', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    d.vote(d.f[1], p, 'yes', d.T + 1);
    const nu = newSecret();
    const nk = pubkeyOf(nu);
    const rk = d.ev(KIND.rekey, { old_key: pubkeyOf(d.f[1]), new_key: nk, mode: 'in_person', short_code: shortCode(nk) }, d.c[0], d.T + 10, [['p', pubkeyOf(d.f[1])], ['p', nk]]);
    for (const i of [0, 1]) d.endorse(d.c[i], rk, 'rekey', d.T + 11);
    let s = d.state(d.T + 20);
    expect(s.rekeys[0].effectiveAt).toBeUndefined();
    d.endorse(d.c[2], rk, 'rekey', d.T + 30);
    s = d.state(d.T + 40);
    expect(s.rekeys[0].effectiveAt).toBe(d.T + 30);
    expect(view(s, p).counts.yes).toBe(1); // inherited
    d.vote(d.f[1], p, 'no', d.T + 50); // old key, after the replacement: ignored
    d.vote(nu, p, 'abstain', d.T + 60); // new key changes the vote
    s = d.state(d.T + 70);
    expect(view(s, p).counts).toEqual({ yes: 0, no: 0, abstain: 1 });
    expect(s.pendingRoster).toEqual([rk.id]);
    publishRoster(d, d.T + 100);
    s = d.state(d.T + 200);
    expect(s.members.find(m => m.name === '@f1')?.key).toBe(nk);
    expect(s.personOf(nk)).toBe(pubkeyOf(d.f[1]));
  });

  it('a remote key replacement also needs a second council member\'s verification', () => {
    const d = dao();
    const nk = pubkeyOf(newSecret());
    const rk = d.ev(KIND.rekey, { old_key: pubkeyOf(d.f[0]), new_key: nk, mode: 'remote', short_code: shortCode(nk) }, d.c[0], d.T, []);
    for (const i of [0, 1, 2]) d.endorse(d.c[i], rk, 'rekey', d.T + 1);
    expect(d.state(d.T + 5).rekeys[0].needsSecondVerify).toBe(true);
    d.ev(KIND.verify, { candidate_key: nk, mode: 'remote', short_code: shortCode(nk) }, d.c[3], d.T + 6, [['p', nk]]);
    expect(d.state(d.T + 7).rekeys[0].effectiveAt).toBe(d.T + 6);
  });
});

describe('settings (3.4)', () => {
  it('a passed rules change becomes settings version 2, and later proposals use it', () => {
    const d = dao();
    const p = d.propose(d.c[0], { type: 'change_rules', payload: { changes: [{ path: 'rules.votingPeriodDays', from: 7, to: 3 }] } }, d.T);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 1);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), p, d.T + 8 * DAY);
    let s = d.state(d.T + 8 * DAY + 1);
    expect(s.pendingSettings).toEqual([p.id]);
    const next = nextSettings(s)!;
    const e = d.ev(KIND.settings, next, d.c[0], d.T + 8 * DAY + 2);
    for (const i of [0, 1, 2]) d.endorse(d.c[i], e, 'settings', d.T + 8 * DAY + 3);
    const q = d.propose(d.f[0], { type: 'statement' }, d.T + 9 * DAY);
    s = d.state(d.T + 9 * DAY + 1);
    expect(s.settings.length).toBe(2);
    expect(s.rules?.votingPeriodDays).toBe(3);
    expect(view(s, q).closeAt).toBe(d.T + 12 * DAY);
    expect(view(s, p).closeAt).toBe(d.T + 7 * DAY); // earlier proposals keep their rules
  });

  it('refuses settings that change more than the basis says', () => {
    const d = dao();
    const p = d.propose(d.c[0], { type: 'change_rules', payload: { changes: [{ path: 'rules.votingPeriodDays', from: 7, to: 3 }] } }, d.T);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 1);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), p, d.T + 8 * DAY);
    const next = nextSettings(d.state(d.T + 8 * DAY + 1))!;
    next.rules.treasuryCapSats = 999_999_999;
    const e = d.ev(KIND.settings, next, d.c[0], d.T + 8 * DAY + 2);
    for (const i of [0, 1, 2]) d.endorse(d.c[i], e, 'settings', d.T + 8 * DAY + 3);
    const s = d.state(d.T + 9 * DAY);
    expect(s.settings.length).toBe(1);
    expect(s.settingsCandidates[0].error).toBe('settings do not follow from the basis');
  });
});

// ---------- payout rounds (6.1-6.3) and closing ----------
import { mnemonicToSeedSync } from '@scure/bip39';
import { buildRound, finalizeRound, masterFromSeed, signWithMnemonicKey, type Utxo } from './round';
import { nextRoundOutputs } from './next';

describe('payout rounds (6.1-6.3)', () => {
  const masters = MNEMONICS.map(m => masterFromSeed(mnemonicToSeedSync(m), 'testnet4'));
  const RECIPIENT = p2wpkh(secp256k1.getPublicKey(hexToBytes('22'.repeat(32)), true), TEST_NETWORK).address!;

  function passedPayout(d: ReturnType<typeof dao>, at: number, amount = 120_000, confirm = true) {
    const p = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: RECIPIENT, amount_sat: amount }] } }, at);
    if (confirm) d.ev(KIND.confirm, { address: RECIPIENT }, newSecret(), at + 1, [['e', p.id]]);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', at + 2);
    d.tally(d.c[0], d.state(at + 8 * DAY), p, at + 8 * DAY);
    return p;
  }
  function coins(d: ReturnType<typeof dao>): Utxo[] {
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    return [0, 1].map(i => ({ txid: String(i + 1).repeat(64), vout: 0, value: 300_000, address: treasuryAddress(desc, 'testnet4', 0, i).address, branch: 0 as const, index: i }));
  }
  function round(d: ReturnType<typeof dao>, ids: string[], outputs: { address: string; amount_sat: number }[], at: number, utxos = coins(d), opts: { feeRate?: number; sweepTo?: string } = {}) {
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    const r = buildRound({ d: desc, network: 'testnet4', utxos, outputs, feeRate: opts.feeRate ?? 2, changeIndex: 0, sweepTo: opts.sweepTo });
    const e = d.ev(KIND.round, { round: '2026-12', proposals: ids, psbt: r.psbt, fee_rate_sat_vb: opts.feeRate ?? 2, fee_sat: r.fee }, d.c[0], at);
    return { e, r };
  }

  // ---------- paid on delivery (4.6) ----------
  const addrOf = (i: number) => p2wpkh(secp256k1.getPublicKey(hexToBytes(String(i).padStart(2, '0').repeat(32)), true), TEST_NETWORK).address!;
  function trancheRound(d: ReturnType<typeof dao>, id: string, n: number, address: string, amount: number, at: number, utxos = coins(d)) {
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    const r = buildRound({ d: desc, network: 'testnet4', utxos, outputs: [{ address, amount_sat: amount }], feeRate: 2, changeIndex: 0 });
    const e = d.ev(KIND.round, { round: '2026-12', proposals: [id], tranches: { [id]: n }, psbt: r.psbt, fee_rate_sat_vb: 2, fee_sat: r.fee }, d.c[0], at);
    return { e, r };
  }
  function pay(d: ReturnType<typeof dao>, e: { id: string }, r: { psbt: string }, at: number, height = 101) {
    for (const i of [0, 1, 2]) d.ev(KIND.sign, { psbt: signWithMnemonicKey(r.psbt, masters[i]) }, d.c[i], at, [['e', e.id]]);
    const fin = finalizeRound(r.psbt, [0, 1, 2].map(i => signWithMnemonicKey(r.psbt, masters[i])));
    d.ev(KIND.receipt, { txid: fin.txid, block_height: height }, d.c[0], at + 1, [['e', e.id]]);
    return fin;
  }

  it('staged payout (4.6): the schedule, a report before each tranche, the next tranche only, lapse stops the rest', () => {
    const d = dao();
    const schedule = [{ amount_sat: 100_000, due_days: 14 }, { amount_sat: 200_000, due_days: 45 }];
    const bad1 = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: RECIPIENT, amount_sat: 250_000 }], schedule } }, d.T);
    const bad2 = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: RECIPIENT, amount_sat: 5 * 600 }], schedule: [1, 2, 3, 4, 5].map(k => ({ amount_sat: 600, due_days: k })) } }, d.T);
    const bad3 = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: RECIPIENT, amount_sat: 1000 }], schedule: [{ amount_sat: 1000, due_days: 91 }] } }, d.T);
    const p = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: RECIPIENT, amount_sat: 300_000 }], schedule } }, d.T + 1);
    let s = d.state(d.T + 2);
    const why = (e: { id: string }) => s.rejected.find(x => x.event.id === e.id)?.reason;
    expect(why(bad1)).toBe('proposal: schedule total');
    expect(why(bad2)).toBe('proposal: more than 4 tranches');
    expect(why(bad3)).toBe('proposal: schedule longer than 90 days');
    d.ev(KIND.confirm, { address: RECIPIENT }, newSecret(), d.T + 2, [['e', p.id]]);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 2);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), p, d.T + 8 * DAY);
    const t = d.T + 8 * DAY + 10;
    s = d.state(t);
    expect(s.payments.get(p.id)?.status).toBe('awaiting_report');
    expect(s.committed).toBe(300_000);
    const early = trancheRound(d, p.id, 1, RECIPIENT, 100_000, t);
    s = d.state(t + 1);
    expect(s.rounds.find(r => r.event.id === early.e.id)!.errors).toContain(`proposal ${s.proposals.find(x => x.event.id === p.id)!.number}: tranche 1 has no report`);
    const stranger = d.ev(KIND.report, { tranche: 1, text: 'fatto' }, d.f[1], t + 2, [['e', p.id]]);
    d.ev(KIND.report, { tranche: 1, text: 'Stampati i primi 200 volantini.' }, d.f[0], t + 3, [['e', p.id]]);
    s = d.state(t + 4);
    expect(s.rejected.find(x => x.event.id === stranger.id)?.reason).toBe('report: not the proposer, the paid member or a claimant');
    expect(s.payments.get(p.id)?.status).toBe('waiting');
    expect(s.payments.get(p.id)?.tranches?.[0].status).toBe('reported');
    const wrongN = trancheRound(d, p.id, 2, RECIPIENT, 200_000, t + 5);
    const r1 = trancheRound(d, p.id, 1, RECIPIENT, 100_000, t + 6, coins(d).slice(1));
    s = d.state(t + 7);
    expect(s.rounds.find(r => r.event.id === wrongN.e.id)!.errors.join()).toContain('tranche 2 is not the next to pay');
    expect(s.rounds.find(r => r.event.id === r1.e.id)!.errors).toEqual([]);
    pay(d, r1.e, r1.r, t + 8);
    s = d.state(t + 10);
    const pm = s.payments.get(p.id)!;
    expect(pm.tranches?.[0].status).toBe('paid');
    expect(pm.tranche).toBe(2);
    expect(pm.status).toBe('awaiting_report');
    expect(s.committed).toBe(200_000);
    // No report for tranche 2 by the first round date after day 45: it lapses, and with it the schedule.
    s = d.state(d.T + 8 * DAY + 90 * DAY);
    expect(s.payments.get(p.id)?.status).toBe('lapsed');
    expect(s.payments.get(p.id)?.tranches?.[1].status).toBe('lapsed');
    expect(s.committed).toBe(0);
  });

  it('bounty (4.6): members claim, report, and the council round chooses whom to pay', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'payout', payload: { recipient: '', outputs: [], bounty: true, schedule: [{ amount_sat: 50_000, due_days: 30 }] } }, d.T);
    const bad = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'x', outputs: [], bounty: true, schedule: [{ amount_sat: 50_000, due_days: 30 }] } }, d.T);
    const early = d.ev(KIND.claim, { address: addrOf(31) }, d.f[1], d.T + 1, [['e', p.id]]);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 2);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), p, d.T + 8 * DAY);
    const t = d.T + 8 * DAY + 10;
    d.ev(KIND.claim, { address: addrOf(31) }, d.f[1], t, [['e', p.id]]);
    d.ev(KIND.claim, { address: addrOf(32) }, d.f[2], t, [['e', p.id]]);
    const outsider = d.ev(KIND.claim, { address: addrOf(33) }, newSecret(), t, [['e', p.id]]);
    const noClaim = d.ev(KIND.report, { tranche: 1, text: 'fatto io' }, d.f[3], t + 1, [['e', p.id]]);
    d.ev(KIND.report, { tranche: 1, text: 'Sito tradotto in inglese.' }, d.f[1], t + 1, [['e', p.id]]);
    d.ev(KIND.report, { tranche: 1, text: 'Traduzione completa, con glossario.' }, d.f[2], t + 1, [['e', p.id]]);
    let s = d.state(t + 2);
    const why = (e: { id: string }) => s.rejected.find(x => x.event.id === e.id)?.reason;
    expect(why(bad)).toBe('proposal: bounty');
    expect(why(early)).toBe('claim: before the tally');
    expect(why(outsider)).toBe('claim: signer is not a member');
    expect(why(noClaim)).toBe('report: not the proposer, the paid member or a claimant');
    expect(s.claims.get(p.id)?.length).toBe(2);
    expect(s.payments.get(p.id)?.status).toBe('waiting'); // no recipient confirmation: the claim is the address
    const toStranger = trancheRound(d, p.id, 1, addrOf(33), 50_000, t + 3);
    const r = trancheRound(d, p.id, 1, addrOf(32), 50_000, t + 4, coins(d).slice(1));
    s = d.state(t + 5);
    expect(s.rounds.find(x => x.event.id === toStranger.e.id)!.errors.join()).toContain('the bounty does not pay a claimant who reported');
    expect(s.rounds.find(x => x.event.id === r.e.id)!.errors).toEqual([]);
    pay(d, r.e, r.r, t + 6);
    s = d.state(t + 8);
    expect(s.payments.get(p.id)?.status).toBe('paid');
    expect(s.payments.get(p.id)?.tranches?.[0].address).toBe(addrOf(32));
    expect(s.committed).toBe(0);
  });

  it('signs a round with 3 council keys, finalises it and is paid on receipt', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const t = d.T + 8 * DAY + 10;
    let s = d.state(t);
    expect(s.payments.get(p.id)?.status).toBe('waiting');
    const { e, r } = round(d, [p.id], [{ address: RECIPIENT, amount_sat: 120_000 }], t);
    s = d.state(t + 1);
    expect(s.rounds[0].errors).toEqual([]);
    expect(s.rounds[0].status).toBe('open');
    expect(s.payments.get(p.id)?.status).toBe('in_round');
    const signed: string[] = [];
    for (const i of [0, 3]) {
      signed.push(signWithMnemonicKey(r.psbt, masters[i]));
      d.ev(KIND.sign, { psbt: signed[signed.length - 1] }, d.c[i], t + 2, [['e', e.id]]);
    }
    // a council member signing with someone else's key does not count
    d.ev(KIND.sign, { psbt: signWithMnemonicKey(r.psbt, masters[4]) }, d.c[1], t + 3, [['e', e.id]]);
    s = d.state(t + 4);
    expect(s.rounds[0].signatures.size).toBe(2);
    expect(s.rounds[0].ready).toBe(false);
    signed.push(signWithMnemonicKey(r.psbt, masters[4]));
    d.ev(KIND.sign, { psbt: signed[2] }, d.c[4], t + 5, [['e', e.id]]);
    s = d.state(t + 6);
    expect(s.rounds[0].ready).toBe(true);
    const fin = finalizeRound(r.psbt, signed);
    expect(fin.txid).toBe(s.rounds[0].inspection!.txid);
    d.ev(KIND.receipt, { txid: 'ff'.repeat(32), block_height: 100 }, d.c[0], t + 7, [['e', e.id]]); // wrong txid: ignored
    expect(d.state(t + 8).rounds[0].status).toBe('open');
    d.ev(KIND.receipt, { txid: fin.txid, block_height: 100 }, d.c[0], t + 9, [['e', e.id]]);
    s = d.state(t + 10);
    expect(s.rounds[0].status).toBe('paid');
    expect(s.payments.get(p.id)?.status).toBe('paid');
  });

  it('refuses rounds that pay the wrong outputs, unconfirmed payouts, high fees or a second open round', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const q = passedPayout(d, d.T + 5, 50_000, false);
    const t = d.T + 8 * DAY + 10;
    round(d, [p.id], [{ address: RECIPIENT, amount_sat: 130_000 }], t);
    round(d, [q.id], [{ address: RECIPIENT, amount_sat: 50_000 }], t + 1);
    round(d, [p.id], [{ address: RECIPIENT, amount_sat: 120_000 }], t + 2, coins(d), { feeRate: 25 });
    const good = round(d, [p.id], [{ address: RECIPIENT, amount_sat: 120_000 }], t + 3, coins(d).slice(0, 1));
    const other = round(d, [p.id], [{ address: RECIPIENT, amount_sat: 120_000 }], t + 4, coins(d).slice(1));
    const replacement = round(d, [p.id], [{ address: RECIPIENT, amount_sat: 120_000 }], t + 5, coins(d).slice(0, 1), { feeRate: 4 });
    const s = d.state(t + 6);
    const errs = (i: number) => s.rounds[i].errors.join('; ');
    expect(errs(0)).toContain('outputs are not exactly the payouts');
    expect(errs(1)).toContain('not confirmed by its recipient');
    expect(errs(2)).toContain('fee rate above the cap');
    expect(s.rounds.find(r => r.event.id === other.e.id)?.errors).toContain('another round is open');
    // v0.9.0 (review M-F2): two rounds paying the same payout from different coins could both confirm, so neither
    // is signed; nor is a replacement sharing a coin with only one of them. A round spending both coins settles it.
    expect(s.rounds.find(r => r.event.id === good.e.id)?.errors).toContain('another round pays the same payout from other coins');
    expect(s.rounds.find(r => r.event.id === replacement.e.id)?.status).toBe('invalid');
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    const rb = buildRound({ d: desc, network: 'testnet4', utxos: coins(d), outputs: [{ address: RECIPIENT, amount_sat: 120_000 }], feeRate: 3, changeIndex: 0, mustSpend: coins(d).map(u => ({ txid: u.txid, vout: u.vout })) });
    const both = { e: d.ev(KIND.round, { round: '2026-12', proposals: [p.id], psbt: rb.psbt, fee_rate_sat_vb: 3, fee_sat: rb.fee }, d.c[0], t + 6) };
    expect(d.state(t + 7).rounds.find(r => r.event.id === both.e.id)?.status).toBe('open');
  });

  it('replaces an open round (6): the new round carries a later payout on the same coins; the old one is replaced, then void', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const t = d.T + 8 * DAY + 10;
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    const first = round(d, [p.id], [{ address: RECIPIENT, amount_sat: 120_000 }], t, coins(d).slice(0, 1));
    d.ev(KIND.sign, { decline: 'wrong month' }, d.c[1], t + 1, [['e', first.e.id]]);
    const q = passedPayout(d, t + 2, 40_000);
    const t2 = t + 9 * DAY;
    let s = d.state(t2);
    expect(s.payments.get(q.id)?.status).toBe('waiting');
    // the replacement must spend the open round's coin, and may add coins
    const r2 = buildRound({ d: desc, network: 'testnet4', utxos: coins(d), outputs: [{ address: RECIPIENT, amount_sat: 120_000 }, { address: RECIPIENT, amount_sat: 40_000 }], feeRate: 2, changeIndex: 0, mustSpend: [{ txid: coins(d)[0].txid, vout: 0 }] });
    expect(r2.inputs.some(u => u.txid === coins(d)[0].txid)).toBe(true);
    expect(() => buildRound({ d: desc, network: 'testnet4', utxos: coins(d).slice(1), outputs: [{ address: RECIPIENT, amount_sat: 1000 }], feeRate: 2, changeIndex: 0, mustSpend: [{ txid: coins(d)[0].txid, vout: 0 }] })).toThrow('replace-coins-gone');
    const e2 = d.ev(KIND.round, { round: '2026-12', proposals: [p.id, q.id], psbt: r2.psbt, fee_rate_sat_vb: 2, fee_sat: r2.fee }, d.c[0], t2 + 1);
    s = d.state(t2 + 2);
    const old = s.rounds.find(r => r.event.id === first.e.id)!;
    const neu = s.rounds.find(r => r.event.id === e2.id)!;
    expect(neu.errors).toEqual([]);
    expect(old.replacedBy?.event.id).toBe(e2.id);
    expect(neu.replacedBy).toBeUndefined();
    expect(s.payments.get(p.id)?.round?.event.id).toBe(e2.id);
    expect(s.payments.get(q.id)?.status).toBe('in_round');
    // a payout left out of the replacement goes back to waiting
    const r3 = buildRound({ d: desc, network: 'testnet4', utxos: coins(d), outputs: [{ address: RECIPIENT, amount_sat: 40_000 }], feeRate: 3, changeIndex: 0, mustSpend: [{ txid: coins(d)[0].txid, vout: 0 }] });
    const e3 = d.ev(KIND.round, { round: '2026-12', proposals: [q.id], psbt: r3.psbt, fee_rate_sat_vb: 3, fee_sat: r3.fee }, d.c[0], t2 + 3);
    s = d.state(t2 + 4);
    expect(s.payments.get(p.id)?.status).toBe('waiting');
    // the replacement is signed and confirmed: the earlier rounds on its coin are void
    const signed = [0, 3, 4].map(i => signWithMnemonicKey(r3.psbt, masters[i]));
    [0, 3, 4].forEach((i, k) => d.ev(KIND.sign, { psbt: signed[k] }, d.c[i], t2 + 5, [['e', e3.id]]));
    const fin = finalizeRound(r3.psbt, signed);
    d.ev(KIND.receipt, { txid: fin.txid, block_height: 200 }, d.c[0], t2 + 6, [['e', e3.id]]);
    s = d.state(t2 + 7);
    expect(s.rounds.find(r => r.event.id === e3.id)?.status).toBe('paid');
    expect(s.rounds.find(r => r.event.id === first.e.id)?.status).toBe('void');
    expect(s.rounds.find(r => r.event.id === e2.id)?.status).toBe('void');
    expect(s.payments.get(q.id)?.status).toBe('paid');
    // the next round is not blocked by the replaced ones (COUNCIL DAO, 12 November 2026)
    const r4 = buildRound({ d: desc, network: 'testnet4', utxos: coins(d).slice(1), outputs: [{ address: RECIPIENT, amount_sat: 120_000 }], feeRate: 2, changeIndex: 1 });
    const e4 = d.ev(KIND.round, { round: '2026-12', proposals: [p.id], psbt: r4.psbt, fee_rate_sat_vb: 2, fee_sat: r4.fee }, d.c[0], t2 + 8);
    s = d.state(t2 + 9);
    expect(s.rounds.find(r => r.event.id === e4.id)?.errors).toEqual([]);
    expect(s.rounds.find(r => r.event.id === e4.id)?.status).toBe('open');
  });

  it('a payout lapses after the second round date without being paid', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    expect(d.state(d.T + 9 * DAY).payments.get(p.id)?.status).toBe('waiting');
    expect(d.state(d.T + 75 * DAY).payments.get(p.id)?.status).toBe('lapsed');
  });

  it('closing: a passed close pays everything to the destination, then the settings close the DAO', () => {
    const d = dao();
    const c = d.propose(d.c[0], { type: 'close', payload: { destination: RECIPIENT } }, d.T);
    d.ev(KIND.confirm, { address: RECIPIENT }, newSecret(), d.T + 1, [['e', c.id]]);
    for (const i of [0, 1, 2]) d.vote(d.f[i], c, 'yes', d.T + 2);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), c, d.T + 8 * DAY);
    const t = d.T + 8 * DAY + 10;
    const { e, r } = round(d, [c.id], [], t, coins(d), { sweepTo: RECIPIENT });
    let s = d.state(t + 1);
    expect(s.rounds[0].errors).toEqual([]);
    expect(s.rounds[0].isClose).toBe(true);
    const signed = [0, 1, 2].map(i => signWithMnemonicKey(r.psbt, masters[i]));
    const fin = finalizeRound(r.psbt, signed);
    d.ev(KIND.receipt, { txid: fin.txid, block_height: 101 }, d.c[0], t + 2, [['e', e.id]]);
    s = d.state(t + 3);
    expect(s.pendingSettings).toEqual([c.id]);
    const next = nextSettings(s)!;
    expect(next.closed).toBe(true);
    const se = d.ev(KIND.settings, next, d.c[0], t + 4);
    for (const i of [0, 1, 2]) d.endorse(d.c[i], se, 'settings', t + 5);
    const late = d.propose(d.f[0], { type: 'statement' }, t + 10);
    s = d.state(t + 11);
    expect(s.closed).toBe(true);
    expect(s.rejected.some(x => x.event.id === late.id && x.reason === 'proposal: the DAO is closed')).toBe(true);
  });

  it('council change (4.1.2, 6.1): a lost key replaced by the same member\'s new key, the treasury migrated, the new council in force', async () => {
    const { councilAfter, descriptorFor } = await import('./council');
    const d = dao();
    let s = d.state(d.T);
    const cur = s.settings[0].content.council;
    const newKey = treasuryKeyFromMnemonic('process wrestle rigid evoke cash ancient adjust minor size meat puzzle glue', 'testnet4');
    const base = { reason: 'lost_key' as const, out_key: pubkeyOf(d.c[4]), in_key: pubkeyOf(d.c[4]), in_xpub: newKey.xpub, in_fingerprint: newKey.fingerprint, in_device: 'seedsigner' as const, threshold: 3 };
    const next4 = councilAfter(cur, { ...base, new_descriptor: '' }, '@c4', s.personOf);
    const payload = { ...base, new_descriptor: descriptorFor(next4, 3, 'testnet4') };
    // Refused: a descriptor not derived from the new council, an outsider coming in, a threshold too high.
    const bad1 = d.propose(d.f[0], { type: 'change_council', payload: { ...payload, new_descriptor: cur.length ? s.settings[0].content.descriptor : '' } }, d.T);
    const outsider = newSecret();
    const bad2 = d.propose(d.f[0], { type: 'change_council', payload: { ...payload, in_key: pubkeyOf(outsider) } }, d.T);
    const bad3 = d.propose(d.f[0], { type: 'change_council', payload: { ...payload, threshold: 6 } }, d.T);
    const p = d.propose(d.f[0], { type: 'change_council', payload }, d.T + 1);
    s = d.state(d.T + 2);
    const why = (e: { id: string }) => s.rejected.find(x => x.event.id === e.id)?.reason;
    expect(why(bad1)).toBe('proposal: new_descriptor is not the one derived from the new council');
    expect(why(bad2)).toBe('proposal: incoming key is not a member');
    expect(why(bad3)).toBe('proposal: threshold above the council size');
    expect(s.proposals.some(x => x.event.id === p.id)).toBe(true);

    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 2);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), p, d.T + 8 * DAY);
    const t = d.T + 8 * DAY + 10;
    s = d.state(t);
    expect(s.payments.get(p.id)?.status).toBe('waiting'); // no recipient confirmation needed: the destination is derived
    const dest = treasuryAddress(parseDescriptor(payload.new_descriptor, 'testnet4'), 'testnet4', 0, 0).address;
    const wrong = round(d, [p.id], [], t, coins(d), { sweepTo: RECIPIENT });
    s = d.state(t + 1);
    expect(s.rounds.find(r => r.event.id === wrong.e.id)!.errors).toContain('a migration round has one output, to the new treasury');
    const { e, r } = round(d, [p.id], [], t + 2, coins(d), { sweepTo: dest });
    s = d.state(t + 3);
    const mr = s.rounds.find(x => x.event.id === e.id)!;
    expect(mr.errors).toEqual([]);
    expect(mr.isMigration).toBe(true);
    const fin = finalizeRound(r.psbt, [0, 1, 2].map(i => signWithMnemonicKey(r.psbt, masters[i]))); // the old council signs
    const rc = d.ev(KIND.receipt, { txid: fin.txid, block_height: 101 }, d.c[0], t + 4, [['e', e.id]]);
    s = d.state(t + 5);
    expect(s.pendingSettings).toEqual([p.id]);
    const next = nextSettings(s)!;
    expect(next.basis).toEqual([p.id, rc.id]);
    expect(next.descriptor).toBe(payload.new_descriptor);
    expect(next.council.map(x => x.fingerprint)).toEqual([...cur.slice(0, 4).map(x => x.fingerprint), newKey.fingerprint]);
    expect(next.council[4]).toMatchObject({ label: '@c4', device: 'seedsigner' });
    const se = d.ev(KIND.settings, next, d.c[0], t + 6);
    for (const i of [0, 1, 2]) d.endorse(d.c[i], se, 'settings', t + 7);
    s = d.state(t + 8);
    expect(s.settings.length).toBe(2);
    expect(s.settings[1].content.descriptor).toBe(payload.new_descriptor);
    expect(s.pendingSettings).toEqual([]);
    // The new treasury is the DAO's own: nobody can propose paying to it.
    const self = d.propose(d.f[1], { type: 'payout', payload: { recipient: 'x', outputs: [{ address: dest, amount_sat: 10_000 }] } }, t + 9);
    expect(d.state(t + 10).rejected.find(x => x.event.id === self.id)?.reason).toBe('proposal: pays the treasury');

    // A late payment to the old treasury is swept to the new one (6.1), signed by continuing council keys.
    const oldDesc = s.settings[0].content.descriptor;
    const oldD = parseDescriptor(oldDesc, 'testnet4');
    const late = [{ txid: '9'.repeat(64), vout: 0, value: 50_000, address: treasuryAddress(oldD, 'testnet4', 0, 7).address, branch: 0 as const, index: 7 }];
    const sweepRound = (to: string, at: number, sweep = oldDesc) => {
      const r = buildRound({ d: oldD, network: 'testnet4', utxos: late, outputs: [], feeRate: 2, changeIndex: 0, sweepTo: to });
      return { r, e: d.ev(KIND.round, { round: '2026-12', proposals: [], sweep, psbt: r.psbt, fee_rate_sat_vb: 2, fee_sat: r.fee }, d.c[0], at) };
    };
    const newD = parseDescriptor(payload.new_descriptor, 'testnet4');
    const sw = sweepRound(treasuryAddress(newD, 'testnet4', 0, 1).address, t + 11);
    const swBad = sweepRound(RECIPIENT, t + 11);
    const swCur = sweepRound(treasuryAddress(newD, 'testnet4', 0, 1).address, t + 11, payload.new_descriptor);
    for (const i of [0, 1, 2]) d.ev(KIND.sign, { psbt: signWithMnemonicKey(sw.r.psbt, masters[i]) }, d.c[i], t + 12, [['e', sw.e.id]]);
    s = d.state(t + 13);
    const sv = s.rounds.find(x => x.event.id === sw.e.id)!;
    expect(sv.errors).toEqual([]);
    expect(sv.isSweep).toBe(true);
    expect(sv.threshold).toBe(oldD.threshold);
    expect(sv.ready).toBe(true);
    expect(s.rounds.find(x => x.event.id === swBad.e.id)!.errors).toContain('a sweep round has one output, to the treasury');
    expect(s.rounds.find(x => x.event.id === swCur.e.id)!.errors).toContain('a sweep empties an earlier treasury');
    // A sweep does not block a payout round, nor the other way round.
    const q = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: RECIPIENT, amount_sat: 10_000 }] } }, t + 14);
    d.ev(KIND.confirm, { address: RECIPIENT }, newSecret(), t + 15, [['e', q.id]]);
    for (const i of [0, 1, 2]) d.vote(d.f[i], q, 'yes', t + 15);
    d.tally(d.c[0], d.state(t + 9 * DAY), q, t + 9 * DAY);
    const newCoin = [{ txid: fin.txid, vout: 0, value: 590_000, address: dest, branch: 0 as const, index: 0 }];
    const pr = buildRound({ d: newD, network: 'testnet4', utxos: newCoin, outputs: [{ address: RECIPIENT, amount_sat: 10_000 }], feeRate: 2, changeIndex: 0 });
    const pe = d.ev(KIND.round, { round: '2026-12', proposals: [q.id], psbt: pr.psbt, fee_rate_sat_vb: 2, fee_sat: pr.fee }, d.c[0], t + 9 * DAY + 1);
    expect(d.state(t + 9 * DAY + 2).rounds.find(x => x.event.id === pe.id)!.errors).toEqual([]);
  });

  // Review of 14 November 2026, block 3: a payout is paid once, whoever publishes rounds and however they are dated.
  function coins3(d: ReturnType<typeof dao>): Utxo[] {
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    return [0, 1, 2].map(i => ({ txid: String(i + 1).repeat(64), vout: 0, value: 300_000, address: treasuryAddress(desc, 'testnet4', 0, i).address, branch: 0 as const, index: i }));
  }
  function roundOn(d: ReturnType<typeof dao>, ids: string[], amounts: number[], at: number, coinsUsed: Utxo[], who = d.c[0], fee = 2) {
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    const r = buildRound({ d: desc, network: 'testnet4', utxos: coinsUsed, outputs: amounts.map(a => ({ address: RECIPIENT, amount_sat: a })), feeRate: fee, changeIndex: 0, mustSpend: coinsUsed.map(u => ({ txid: u.txid, vout: u.vout })) });
    const e = d.ev(KIND.round, { round: '2026-12', proposals: ids, psbt: r.psbt, fee_rate_sat_vb: fee, fee_sat: r.fee }, who, at);
    return { e, r };
  }

  it('funds checks count only the next tranche of a staged payout (review U-1, U-2)', () => {
    const d = dao();
    const schedule = [{ amount_sat: 100_000, due_days: 14 }, { amount_sat: 200_000, due_days: 45 }];
    const p = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Tipografia', outputs: [{ address: RECIPIENT, amount_sat: 300_000 }], schedule } }, d.T + 1);
    d.ev(KIND.confirm, { address: RECIPIENT }, newSecret(), d.T + 2, [['e', p.id]]);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 2);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), p, d.T + 8 * DAY);
    d.ev(KIND.report, { tranche: 1, text: 'Fatto.' }, d.f[0], d.T + 8 * DAY + 5, [['e', p.id]]);
    const s = d.state(d.T + 8 * DAY + 10);
    const view = s.proposals.find(x => x.event.id === p.id)!;
    expect(nextRoundOutputs(s, view)).toEqual([{ address: RECIPIENT, amount_sat: 100_000 }]); // not 300,000
  });

  it('the same proposal listed twice in one round is refused (review M-F1)', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const t = d.T + 8 * DAY + 10;
    const { e } = roundOn(d, [p.id, p.id], [120_000, 120_000], t, coins3(d).slice(0, 1));
    const v = d.state(t + 1).rounds.find(r => r.event.id === e.id)!;
    expect(v.status).toBe('invalid');
    expect(v.errors).toContain('a proposal is listed twice');
  });

  it('a third round sharing a coin with the replacement only is refused; the first round can then never be paid twice (review M-F2)', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const t = d.T + 8 * DAY + 10;
    const cs = coins3(d);
    roundOn(d, [p.id], [120_000], t, [cs[0]]);
    roundOn(d, [p.id], [120_000], t + 1, [cs[0], cs[1]], d.c[0], 3);
    const third = roundOn(d, [p.id], [120_000], t + 2, [cs[1], cs[2]], d.c[0], 4);
    const v = d.state(t + 3).rounds.find(r => r.event.id === third.e.id)!;
    expect(v.status).toBe('invalid');
    expect(v.errors).toContain('another round is open');
  });

  it('a round dated before a paid one cannot pay the same payout again (review M-F3)', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const t = d.T + 8 * DAY + 10;
    const cs = coins3(d);
    const a = roundOn(d, [p.id], [120_000], t, [cs[0]]);
    pay(d, a.e, a.r, t + 1);
    expect(d.state(t + 3).payments.get(p.id)?.status).toBe('paid');
    const back = roundOn(d, [p.id], [120_000], t - 1, [cs[1]], d.c[4]); // published days later, dated before
    const s = d.state(t + 5 * DAY);
    expect(s.rounds.find(r => r.event.id === a.e.id)?.status).toBe('paid');
    expect(s.rounds.find(r => r.event.id === back.e.id)?.status).toBe('invalid');
    expect(s.payments.get(p.id)?.status).toBe('paid');
  });

  it('a round dated before the count of its payout is refused', () => {
    const d = dao();
    const p = passedPayout(d, d.T); // counted at T + 8 days
    const { e } = roundOn(d, [p.id], [120_000], d.T + 8 * DAY - 5, coins3(d).slice(0, 1));
    const v = d.state(d.T + 9 * DAY).rounds.find(r => r.event.id === e.id)!;
    expect(v.errors.join()).toContain('dated before its count');
  });

  it('the same transaction published as two rounds (different claimed amounts) is signed by nobody (review M-F4)', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const t = d.T + 8 * DAY + 10;
    const a = roundOn(d, [p.id], [120_000], t, coins3(d).slice(0, 2));
    // The same unsigned transaction, with input 0's amount understated.
    const lie = Transaction.fromPSBT(base64.decode(a.r.psbt));
    lie.updateInput(0, { witnessUtxo: { script: lie.getInput(0).witnessUtxo!.script, amount: 1n } }, true);
    const b = d.ev(KIND.round, { round: '2026-12', proposals: [p.id], psbt: base64.encode(lie.toPSBT(0)), fee_rate_sat_vb: 2, fee_sat: a.r.fee }, d.c[0], t + 1);
    const s = d.state(t + 2);
    for (const id of [a.e.id, b.id]) expect(s.rounds.find(r => r.event.id === id)!.status).toBe('invalid');
  });

  it('a junk signature cannot block a round; a round published already signed is refused (review M-F6)', () => {
    const d = dao();
    const p = passedPayout(d, d.T);
    const t = d.T + 8 * DAY + 10;
    const a = roundOn(d, [p.id], [120_000], t, coins3(d).slice(0, 1));
    const honest = [0, 1, 2].map(i => signWithMnemonicKey(a.r.psbt, masters[i]));
    // A copy carrying @c0's key with a garbage signature, published by @c3 alongside the honest ones.
    const [pk] = Transaction.fromPSBT(base64.decode(honest[0])).getInput(0).partialSig![0];
    const junk = Transaction.fromPSBT(base64.decode(a.r.psbt));
    junk.updateInput(0, { partialSig: [[pk, new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x01])]] }, true);
    const fin = finalizeRound(a.r.psbt, [base64.encode(junk.toPSBT(0)), ...honest]);
    expect(fin.txid).toBe(d.state(t + 1).rounds.find(r => r.event.id === a.e.id)!.inspection!.txid);
    const signedRound = d.ev(KIND.round, { round: '2026-12', proposals: [p.id], psbt: honest[0], fee_rate_sat_vb: 2, fee_sat: a.r.fee }, d.c[0], t + 2);
    expect(d.state(t + 3).rounds.find(r => r.event.id === signedRound.id)!.errors.join()).toContain('already carries a signature');
  });
});

describe('weekly rounds and standing payout addresses (4.2, 6.1)', () => {
  const masters = MNEMONICS.map(m => masterFromSeed(mnemonicToSeedSync(m), 'testnet4'));
  const X = p2wpkh(secp256k1.getPublicKey(hexToBytes('33'.repeat(32)), true), TEST_NETWORK).address!;
  const Y = p2wpkh(secp256k1.getPublicKey(hexToBytes('44'.repeat(32)), true), TEST_NETWORK).address!;

  /** A passed payout of X, optionally naming the member it pays; no per-proposal confirmation. */
  function payout(d: ReturnType<typeof dao>, at: number, member?: string, address = X) {
    const p = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'Quota settimanale', outputs: [{ address, amount_sat: 41_200, ...(member ? { member } : {}) }] } }, at);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', at + 2);
    d.tally(d.c[0], d.state(at + 8 * DAY), p, at + 8 * DAY);
    return p;
  }
  const standing = (d: ReturnType<typeof dao>, secret: string, address: string | undefined, at: number) =>
    d.ev(KIND.confirm, address ? { address, standing: true } : { standing: false }, secret, at);
  function roundFor(d: ReturnType<typeof dao>, p: Event, at: number) {
    const desc = parseDescriptor(d.state(d.T).settings[0].content.descriptor, 'testnet4');
    const utxos: Utxo[] = [{ txid: '1'.repeat(64), vout: 0, value: 300_000, address: treasuryAddress(desc, 'testnet4', 0, 0).address, branch: 0, index: 0 }];
    const r = buildRound({ d: desc, network: 'testnet4', utxos, outputs: [{ address: X, amount_sat: 41_200 }], feeRate: 2, changeIndex: 0 });
    return d.ev(KIND.round, { round: '1970-W02', proposals: [p.id], psbt: r.psbt, fee_rate_sat_vb: 2, fee_sat: r.fee }, d.c[0], at);
  }
  const after = (d: ReturnType<typeof dao>) => d.T + 8 * DAY + 100;

  it('P-W04: a weekly payout lapses at the second Monday after its tally', () => {
    const d = dao({ payoutRound: 'weekly' });
    const p = payout(d, d.T, undefined);
    d.ev(KIND.confirm, { address: X }, newSecret(), d.T + 1, [['e', p.id]]);
    const tallied = d.T + 8 * DAY;
    const [, second] = roundDatesAfter(tallied, 'Europe/Rome', 2, 'weekly');
    const pay = d.state(tallied + 1).payments.get(p.id)!;
    expect(pay.lapseAt).toBe(second);
    expect(second - tallied).toBeLessThanOrEqual(14 * DAY);
    expect(d.state(second - 1).payments.get(p.id)?.status).toBe('waiting');
    expect(d.state(second).payments.get(p.id)?.status).toBe('lapsed');
  });

  it('C-S01, C-S02, C-S03: a standing address confirms only an output naming its member', () => {
    const d = dao();
    standing(d, d.f[1], X, d.T - 10);
    const named = payout(d, d.T, pubkeyOf(d.f[1]));
    const unnamed = payout(d, d.T + 1);
    const wrong = payout(d, d.T + 2, pubkeyOf(d.f[2]));
    const s = d.state(after(d));
    expect(view(s, named).confirmed).toBe(true);
    expect(view(s, named).byStanding.has(X)).toBe(true);
    expect(s.payments.get(named.id)?.status).toBe('waiting');
    expect(view(s, unnamed).confirmed).toBe(false);
    expect(view(s, wrong).confirmed).toBe(false);
  });

  it('C-S04, C-S05: standing confirmations from non-members or of treasury addresses are rejected', () => {
    const d = dao();
    const outsider = standing(d, newSecret(), X, d.T);
    const treasury = standing(d, d.f[1], d.treasury0, d.T + 1);
    const s = d.state(d.T + 2);
    expect(s.rejected.find(r => r.event.id === outsider.id)?.reason).toContain('not a member');
    expect(s.rejected.find(r => r.event.id === treasury.id)?.reason).toContain('treasury');
    expect(s.standingAt(pubkeyOf(d.f[1]), d.T + 2)).toBeUndefined();
  });

  it('C-S06, C-S07, C-S09: replacing or withdrawing a standing address stops unpaid payouts to the old one', () => {
    const d = dao();
    const f1 = pubkeyOf(d.f[1]);
    standing(d, d.f[1], X, d.T - 10);
    const p = payout(d, d.T, f1);
    standing(d, d.f[1], Y, d.T + 8 * DAY + 50);
    let s = d.state(after(d));
    expect(view(s, p).confirmed).toBe(false);
    expect(view(s, p).standingMoved).toEqual([X]);
    expect(s.payments.get(p.id)?.status).toBe('unconfirmed');
    // a per-proposal confirmation of the old address still pays it
    d.ev(KIND.confirm, { address: X }, d.f[1], after(d) + 1, [['e', p.id]]);
    expect(view(d.state(after(d) + 2), p).confirmed).toBe(true);
    // withdrawing leaves no standing address
    standing(d, d.f[1], undefined, after(d) + 3);
    s = d.state(after(d) + 4);
    expect(s.standingAt(f1, s.now)).toBeUndefined();
    // same created_at: the higher id counts
    const a = standing(d, d.f[1], X, after(d) + 10);
    const b = standing(d, d.f[1], Y, after(d) + 10);
    const winner = a.id > b.id ? X : Y;
    expect(d.state(after(d) + 11).standingAt(f1, after(d) + 11)?.address).toBe(winner);
  });

  it('C-S08: leaving ends a standing address', () => {
    const d = dao();
    const f1 = pubkeyOf(d.f[1]);
    standing(d, d.f[1], X, d.T);
    expect(d.state(d.T + 1).standingAt(f1, d.T + 1)?.address).toBe(X);
    d.ev(KIND.leave, {}, d.f[1], d.T + 2);
    expect(d.state(d.T + 3).standingAt(f1, d.T + 3)).toBeUndefined();
  });

  it('C-S10: the standing address is checked when the round is published', () => {
    const d = dao();
    const f1 = pubkeyOf(d.f[1]);
    standing(d, d.f[1], X, d.T - 10);
    const p = payout(d, d.T, f1);
    const t = after(d);
    const ok = roundFor(d, p, t);
    let s = d.state(t + 1);
    expect(s.rounds.find(r => r.event.id === ok.id)?.errors).toEqual([]);
    // the round is signed at threshold before the withdrawal: it stays valid
    for (const i of [0, 1, 2]) d.ev(KIND.sign, { psbt: signWithMnemonicKey(parseJson<any>(ok.content).psbt, masters[i]) }, d.c[i], t + 2, [['e', ok.id]]);
    standing(d, d.f[1], undefined, t + 3);
    const late = roundFor(d, p, t + 4);
    s = d.state(t + 5);
    expect(s.rounds.find(r => r.event.id === ok.id)?.status).toBe('open');
    expect(s.rounds.find(r => r.event.id === late.id)?.errors.join('; ')).toContain('not confirmed by its recipient');
  });
});

describe('treasury key status (5.5)', () => {
  it('lists a council key its holder reported lost, until the holder reports it found', () => {
    const d = dao();
    const fp = treasuryKeyFromMnemonic(MNEMONICS[2], 'testnet4').fingerprint.toLowerCase();
    d.ev(KIND.keystatus, { fingerprint: fp, state: 'lost' }, d.c[2], d.T);
    let s = d.state(d.T + 10);
    expect(s.lostKeys).toEqual([{ person: s.personOf(pubkeyOf(d.c[2])), fingerprint: fp, at: d.T }]);
    d.ev(KIND.keystatus, { fingerprint: fp, state: 'found' }, d.c[2], d.T + 20);
    s = d.state(d.T + 30);
    expect(s.lostKeys).toEqual([]);
  });

  it('ignores notices about someone else\'s key, from non-council members, or malformed', () => {
    const d = dao();
    const fp2 = treasuryKeyFromMnemonic(MNEMONICS[2], 'testnet4').fingerprint.toLowerCase();
    d.ev(KIND.keystatus, { fingerprint: fp2, state: 'lost' }, d.c[1], d.T); // c1 about c2's key
    d.ev(KIND.keystatus, { fingerprint: fp2, state: 'lost' }, d.f[0], d.T); // a founder, not council
    d.ev(KIND.keystatus, { fingerprint: fp2, state: 'gone' }, d.c[2], d.T); // unknown state
    const s = d.state(d.T + 10);
    expect(s.lostKeys).toEqual([]);
    expect(s.rejected.filter(r => r.reason.startsWith('keystatus')).length).toBe(3);
  });
});

describe('discussion (4.5)', () => {
  const v = (n: number, extra: Record<string, unknown> = {}) => ({ version: n, title: `Volantini v${n}`, ...extra });

  it('keeps versions from the author only, in order, and posts from members only', () => {
    const d = dao();
    const v1 = d.ev(KIND.draft, v(1), d.f[0], d.T);
    d.ev(KIND.draft, v(2, { summary: '500 volantini' }), d.f[0], d.T + 10, [['e', v1.id]]);
    d.ev(KIND.draft, v(3), d.f[1], d.T + 20, [['e', v1.id]]); // not the author
    d.ev(KIND.draft, v(5), d.f[0], d.T + 30, [['e', v1.id]]); // out of order
    d.ev(KIND.post, { text: 'Meglio A5' }, d.c[1], d.T + 40, [['e', v1.id]]);
    d.ev(KIND.post, { text: 'spam' }, newSecret(), d.T + 50, [['e', v1.id]]); // not a member
    d.ev(KIND.post, { text: '' }, d.f[2], d.T + 60, [['e', v1.id]]); // empty
    const s = d.state(d.T + 100);
    const th = s.discussion.byId.get(v1.id)!;
    expect(th.versions.map(x => x.n)).toEqual([1, 2]);
    expect(th.title).toBe('Volantini v2');
    expect(th.posts.map(p => parseJson<any>(p.content).text)).toEqual(['Meglio A5']);
    expect(th.status).toBe('open');
    expect(th.lastActivity).toBe(d.T + 40);
  });

  it('a submission freezes the versions; the thread carries on through the vote', () => {
    const d = dao();
    const v1 = d.ev(KIND.draft, v(1, { type: 'statement', summary: 'S' }), d.f[0], d.T);
    const p = d.propose(d.f[0], { type: 'statement', title: 'Volantini v1', summary: 'S', draft: { id: v1.id, version: 1 } }, d.T + 10);
    d.ev(KIND.draft, v(2), d.f[0], d.T + 20, [['e', v1.id]]); // after submission: frozen
    d.ev(KIND.post, { text: 'Voto sì' }, d.f[1], d.T + 30, [['e', p.id]]); // to the proposal: lands in the draft's thread
    const s = d.state(d.T + 100);
    const th = s.discussion.byId.get(v1.id)!;
    expect(th.status).toBe('submitted');
    expect(th.submitted).toEqual({ version: 1, matches: true });
    expect(th.versions.length).toBe(1);
    expect(th.posts.length).toBe(1);
    expect(s.discussion.ofProposal.get(p.id)).toBe(th);
    expect(s.discussion.byId.has(p.id)).toBe(false);
    expect(s.rejected.some(r => r.reason === 'draft: frozen, the proposal is open')).toBe(true);
  });

  it('says when a proposal differs from the version it names; others cannot submit or withdraw a draft', () => {
    const d = dao();
    const v1 = d.ev(KIND.draft, v(1, { type: 'statement', summary: 'S' }), d.f[0], d.T);
    const other = d.propose(d.f[1], { type: 'statement', title: 'Volantini v1', summary: 'S', draft: { id: v1.id, version: 1 } }, d.T + 5);
    d.ev(KIND.withdraw, {}, d.f[1], d.T + 6, [['e', v1.id]]); // not the author
    let s = d.state(d.T + 10);
    expect(s.discussion.byId.get(v1.id)!.status).toBe('open');
    expect(s.discussion.ofProposal.get(other.id)!.id).toBe(other.id); // its own thread
    const p = d.propose(d.f[0], { type: 'statement', title: 'Changed', summary: 'S', draft: { id: v1.id, version: 1 } }, d.T + 20);
    s = d.state(d.T + 30);
    expect(s.discussion.ofProposal.get(p.id)!.submitted).toEqual({ version: 1, matches: false });
  });

  it('withdrawn drafts stay visible, closed to new versions', () => {
    const d = dao();
    const v1 = d.ev(KIND.draft, v(1), d.f[0], d.T);
    d.ev(KIND.post, { text: 'prima' }, d.f[1], d.T + 5, [['e', v1.id]]);
    d.ev(KIND.withdraw, {}, d.f[0], d.T + 10, [['e', v1.id]]);
    d.ev(KIND.draft, v(2), d.f[0], d.T + 20, [['e', v1.id]]);
    d.ev(KIND.post, { text: 'dopo' }, d.f[1], d.T + 30, [['e', v1.id]]);
    const s = d.state(d.T + 40);
    const th = s.discussion.byId.get(v1.id)!;
    expect(th.status).toBe('withdrawn');
    expect(th.versions.length).toBe(1);
    expect(th.posts.map(p => parseJson<any>(p.content).text)).toEqual(['prima']); // closed to new posts
  });
});

// Review of 14 November 2026, block 2: counts must be checkable (4.4), decided means decided (4.4), junk counts do
// not reject open proposals (4.1), and leaving cannot reach back (5.3).
describe('vote counts can be checked (review block 2)', () => {
  const C = (d: ReturnType<typeof dao>) => d.T + 8 * DAY;
  it('a count listing a vote that does not exist is rejected', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'no', d.T + 1);
    const s = d.state(C(d));
    const real = view(s, p).recount;
    const fake = 'ab'.repeat(32);
    // Three real "no" votes plus a made-up id, claimed as a pass: it would have "seen" more than any honest count.
    d.tally(d.c[0], s, p, C(d), { counted: [...real.counted, fake].sort(), result: { yes: 4, no: 0, abstain: 0, quorum_met: true, passed: true } });
    let v = view(d.state(C(d) + 1), p);
    expect(v.status).toBe('awaiting_tally'); // waits: the made-up vote never arrives
    d.tally(d.c[1], s, p, C(d) + 2);
    v = view(d.state(C(d) + 3), p);
    expect(v.status).toBe('rejected');
    expect(v.tally!.content.result.no).toBe(3);
  });

  it('a count listing a vote not yet received counts once the vote arrives', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    for (const i of [0, 1]) d.vote(d.f[i], p, 'yes', d.T + 1);
    const late = d.vote(d.f[2], p, 'yes', d.T + 2);
    d.events.splice(d.events.indexOf(late), 1); // this phone has not received it yet
    const full = view(rebuild(site, [...d.events, late], undefined, C(d)), p).recount;
    d.ev(KIND.tally, full, d.c[0], C(d), [['e', p.id]]);
    expect(view(d.state(C(d) + 1), p).status).toBe('awaiting_tally');
    d.events.push(late);
    const v = view(d.state(C(d) + 1), p);
    expect(v.status).toBe('passed');
    expect(v.tally!.content.counted.length).toBe(3);
  });

  it('decided means decided: once a round paying it has a receipt, a later count changes nothing', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 1);
    const before = d.vote(d.f[3], p, 'no', d.T + 2);
    d.events.splice(d.events.indexOf(before), 1);
    d.tally(d.c[0], d.state(C(d)), p, C(d)); // 3 yes, without the "no"
    const round = d.ev(KIND.round, { round: 'x', proposals: [p.id], psbt: 'x', fee_rate_sat_vb: 1, fee_sat: 1 }, d.c[0], C(d) + 2);
    d.ev(KIND.receipt, { txid: '00'.repeat(32), block_height: 1 }, d.c[0], C(d) + 3, [['e', round.id]]);
    d.events.push(before);
    expect(view(d.state(C(d) + 4), p).fuller).toBe(false); // nobody is asked to publish a fuller count now
    d.tally(d.c[1], d.state(C(d) + 4), p, C(d) + 5); // fuller, but after the receipt
    const v = view(d.state(C(d) + 6), p);
    expect(v.tally!.content.counted.length).toBe(3);
    expect(v.disputed).toBe(false);
  });

  it('a junk count on a newer proposal does not reject an older open one', () => {
    const d = dao({ votingPeriodDays: 7 });
    const older = d.propose(d.f[0], { type: 'statement', title: 'Older' }, d.T);
    const newer = d.propose(d.f[1], { type: 'statement', title: 'Newer' }, d.T + 10);
    // A council member's count on the newer proposal, made up, while the older one is still open.
    d.ev(KIND.tally, { proposal: newer.id, closed_at: d.T + 10 + 7 * DAY, roster_version: 1, settings_version: 1, number: 2, counted: [], excluded: [], result: { yes: 9, no: 0, abstain: 0, quorum_met: true, passed: true } }, d.c[0], d.T + 20, [['e', newer.id]]);
    const s = d.state(d.T + DAY);
    expect(s.proposals.map(p => p.content.title)).toEqual(['Older', 'Newer']);
  });

  it('a leave dated back before the member\'s own decided proposal is not accepted', () => {
    const d = dao();
    const p = d.propose(d.f[3], { type: 'statement', title: 'Mine' }, d.T);
    const q = d.propose(d.f[0], { type: 'statement', title: 'Next' }, d.T + 10);
    for (const x of [p, q]) for (const i of [0, 1, 2]) d.vote(d.f[i], x, 'yes', d.T + 20);
    const s = d.state(C(d));
    d.tally(d.c[0], s, p, C(d));
    d.tally(d.c[0], s, q, C(d));
    d.ev(KIND.leave, {}, d.f[3], d.T - 100); // published now, dated before "Mine"
    const after = d.state(C(d) + 10);
    expect(view(after, p).status).toBe('passed');
    expect(view(after, q).number).toBe(2);
    expect(view(after, q).status).toBe('passed');
  });

  it('an honest leave before a close excludes the member\'s vote, and the count agrees', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'statement' }, d.T);
    for (const i of [0, 1, 2, 3]) d.vote(d.f[i], p, 'yes', d.T + 1);
    d.ev(KIND.leave, {}, d.f[3], d.T + DAY);
    const s = d.state(C(d));
    expect(view(s, p).recount.excluded.map(x => x.reason)).toEqual(['not_eligible']);
    d.tally(d.c[0], s, p, C(d));
    const v = view(d.state(C(d) + 1), p);
    expect(v.status).toBe('passed');
    expect(v.counts.yes).toBe(3);
  });
});

// Review of 14 November 2026, block 6.
describe('identity and record checks (review block 6)', () => {
  it('the member list keeps growing past 50 versions (review R-H3)', () => {
    const d = dao();
    const first = d.state(d.T).rosters[0];
    let prev = { content: first.content as unknown, hash: first.hash };
    for (let v = 2; v <= 61; v++) {
      const content = { version: v, prev: prev.hash, basis: [], members: (first.content as { members: unknown[] }).members };
      const e = d.ev(KIND.roster, content, d.c[0], d.T + v * 10);
      for (const i of [0, 1, 2]) d.endorse(d.c[i], e, 'roster', d.T + v * 10 + 1);
      prev = { content, hash: hashJson(content) };
    }
    expect(d.state(d.T + 1000).rosters.length).toBe(61);
  });

  it('a report link must be a web address (review I-5)', () => {
    const d = dao();
    const p = d.propose(d.f[0], { type: 'payout', payload: { recipient: 'R', outputs: [{ address: ADDR, amount_sat: 10_000 }], report: 'requested' } }, d.T);
    for (const i of [0, 1, 2]) d.vote(d.f[i], p, 'yes', d.T + 1);
    d.tally(d.c[0], d.state(d.T + 8 * DAY), p, d.T + 8 * DAY);
    const bad = d.ev(KIND.report, { tranche: 1, text: 'fatto', link: 'javascript:alert(1)' }, d.f[0], d.T + 8 * DAY + 5, [['e', p.id]]);
    const good = d.ev(KIND.report, { tranche: 1, text: 'fatto', link: 'https://example.org/x' }, d.f[0], d.T + 8 * DAY + 6, [['e', p.id]]);
    const s = d.state(d.T + 9 * DAY);
    expect(s.rejected.find(r => r.event.id === bad.id)?.reason).toBe('report: malformed');
    expect(s.rejected.some(r => r.event.id === good.id)).toBe(false);
  });

  it('a junk passkey backup under another member\'s tag does not hide the real one (review I-3)', () => {
    const d = dao();
    d.ev(KIND.keywrap, { nonce: 'aa', ct: 'real' }, d.f[0], d.T + 1, [['c', 'tag0']]);
    d.ev(KIND.keywrap, { nonce: 'bb', ct: 'junk' }, d.f[1], d.T + 2, [['c', 'tag0']]); // a later one by someone else
    d.ev(KIND.keywrap, { nonce: 'cc', ct: 'future' }, d.f[1], d.T + 10 * DAY, [['c', 'tag0']]); // dated far ahead
    const list = d.state(d.T + 3).keywraps.get('tag0')!;
    expect(list.map(k => k.ct)).toEqual(['junk', 'real']); // both kept, newest first; sign-in tries each
  });
});
