// Members' badges, "learning by doing" (docs/proposals/badges.md, 1.2). Each badge is computed from the DAO's own
// record, per person (a member whose key was replaced keeps what they earned), so any phone gets the same answer.
// Badges carry no votes, rank or say (protocol 3.3).
import type { DaoState } from './state';

export type BadgeId = 'wallet' | 'voice' | 'proposer' | 'builder';
export const BADGES: BadgeId[] = ['wallet', 'voice', 'proposer', 'builder'];

export interface Badge {
  id: BadgeId;
  /** When the record first shows it; absent: not earned yet. */
  at?: number;
  /** The proposal that earned it (Voice, Proposer, Builder). */
  proposal?: { id: string; number: number; title: string };
  /** Something done that will earn it once the record shows the rest (a vote not counted yet, a bounty claimed). */
  waiting?: boolean;
}

export function badgesOf(s: DaoState, person: string): Badge[] {
  const ofPerson = (key: string) => s.personOf(key) === person;
  const ref = (p: DaoState['proposals'][number]) => ({ id: p.event.id, number: p.number, title: p.content.title });

  // 1. Wallet: a standing payout address of theirs was in force (4.2). Once earned it stays.
  const wallet: Badge = { id: 'wallet' };
  for (const x of s.standings) {
    if (!x.address || !ofPerson(x.event.pubkey)) continue;
    if (s.standingAt(x.event.pubkey, x.event.created_at)?.event.id === x.event.id) { wallet.at = x.event.created_at; break; }
  }

  // 2. Voice: a vote of theirs counted in the count that settled a proposal (4.3, 4.4).
  const voice: Badge = { id: 'voice' };
  // 3. Proposer: a proposal of theirs taken into the numbering, whatever its outcome (4.1).
  const proposer: Badge = { id: 'proposer' };
  for (const p of [...s.proposals].sort((a, b) => a.number - b.number)) {
    if (!proposer.at && ofPerson(p.event.pubkey)) { proposer.at = p.event.created_at; proposer.proposal = ref(p); }
    const vote = p.votes.get(person);
    if (!vote) continue;
    const settled = p.tally && (p.status === 'passed' || p.status === 'rejected' || p.status === 'no_quorum');
    if (settled && p.tally!.content.counted.includes(vote.event.id)) {
      const at = Math.max(...p.tally!.events.map(e => e.created_at));
      if (!voice.at || at < voice.at) { voice.at = at; voice.proposal = ref(p); }
    } else if (p.status === 'open' || p.status === 'awaiting_tally') voice.waiting = true;
  }
  if (voice.at) voice.waiting = undefined;

  // 4. Builder: a bounty tranche paid to the address they claimed it with, in a paid round (4.6).
  const builder: Badge = { id: 'builder' };
  for (const p of s.proposals) {
    if (p.content.payload.bounty !== true) continue;
    const claims = (s.claims.get(p.event.id) ?? []).filter(c => c.person === person);
    if (!claims.length) continue;
    const mine = new Set(claims.map(c => c.address));
    const paid = (s.payments.get(p.event.id)?.tranches ?? []).filter(tr => tr.status === 'paid' && tr.address && mine.has(tr.address));
    let at: number | undefined;
    for (const tr of paid) {
      const r = s.rounds.find(r => r.event.id === tr.paidRound);
      const t = r?.receipt?.created_at ?? r?.event.created_at;
      if (t !== undefined && (at === undefined || t < at)) at = t;
    }
    if (at !== undefined && (!builder.at || at < builder.at)) { builder.at = at; builder.proposal = ref(p); }
    else if (at === undefined) builder.waiting = true;
  }
  if (builder.at) builder.waiting = undefined;

  return [wallet, voice, proposer, builder];
}

/** The first badge not earned yet, in order: what Home suggests next. */
export const nextBadge = (badges: Badge[]) => badges.find(b => !b.at);
