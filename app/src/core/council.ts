// Council changes (protocol 4.1.2, 6.1): one key out, one key in, or a new threshold. Keys cannot be removed
// from a multisig, so every change moves the whole treasury to a new descriptor, which every client derives
// from the current council and the proposal, and so can check before anything is signed.
import type { CouncilEntry, Network } from './config';
import { buildDescriptor, checkXpub, parseDescriptor, treasuryAddress } from './descriptor';

export const COUNCIL_REASONS = ['resignation', 'recall', 'lost_key', 'rotation', 'threshold'] as const;
export type CouncilReason = (typeof COUNCIL_REASONS)[number];

export interface CouncilChange {
  reason: CouncilReason;
  out_key: string | null;
  in_key: string | null;
  in_xpub: string | null;
  in_fingerprint: string | null;
  /** Where the incoming key lives (informational, as on council entries). */
  in_device?: 'seedsigner';
  threshold: number;
  new_descriptor: string;
}

const isKey = (k: unknown) => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);

/** Shape only; the council and roster checks need the DAO's state (councilChangeError). */
export function councilChangeSchemaError(p: Partial<CouncilChange>): string | undefined {
  if (!COUNCIL_REASONS.includes(p.reason as CouncilReason)) return 'reason';
  if (!(p.out_key === null || isKey(p.out_key)) || !(p.in_key === null || isKey(p.in_key))) return 'keys';
  if (p.in_key === null) {
    if (p.in_xpub !== null || p.in_fingerprint !== null) return 'in_key';
  } else if (typeof p.in_xpub !== 'string' || typeof p.in_fingerprint !== 'string' || !/^[0-9a-f]{8}$/.test(p.in_fingerprint)) return 'in_key';
  if (p.in_device !== undefined && p.in_device !== 'seedsigner') return 'in_device';
  if (p.out_key === null && p.in_key === null && p.reason !== 'threshold') return 'reason';
  if (!Number.isInteger(p.threshold) || (p.threshold as number) < 1) return 'threshold';
  if (typeof p.new_descriptor !== 'string') return 'new_descriptor';
  return undefined;
}

/**
 * The council after the change: the current one minus the outgoing key, plus the incoming one last.
 * The incoming member may be the outgoing one (the same person with a new treasury key, after a lost key).
 */
export function councilAfter(council: CouncilEntry[], c: CouncilChange, inLabel: string, personOf: (k: string) => string): CouncilEntry[] {
  const out = c.out_key ? council.filter(x => personOf(x.identityKey) !== personOf(c.out_key!)) : [...council];
  if (c.in_key) {
    out.push({ label: inLabel, identityKey: c.in_key, fingerprint: c.in_fingerprint!, xpub: c.in_xpub!, ...(c.in_device ? { device: c.in_device } : {}) });
  }
  return out;
}

/** The descriptor every client derives for the new council (protocol 4.1.2): what the migration must pay. */
export const descriptorFor = (council: CouncilEntry[], threshold: number, network: Network) =>
  buildDescriptor(threshold, council.map(x => ({ fingerprint: x.fingerprint, xpub: x.xpub })), network);

/**
 * Checks against the council in force and the roster (protocol 4.1.2). Returns the new council, or why not.
 */
export function councilChangeError(
  c: CouncilChange,
  council: CouncilEntry[],
  ctx: { network: Network; personOf: (k: string) => string; memberName: (k: string) => string | undefined },
): { error: string } | { council: CouncilEntry[] } {
  const { personOf } = ctx;
  const onCouncil = (k: string) => council.some(x => personOf(x.identityKey) === personOf(k));
  if (c.out_key && !onCouncil(c.out_key)) return { error: 'outgoing key is not on the council' };
  let inLabel = '';
  if (c.in_key) {
    const name = ctx.memberName(c.in_key);
    if (name === undefined) return { error: 'incoming key is not a member' };
    const same = !!c.out_key && personOf(c.out_key) === personOf(c.in_key);
    if (onCouncil(c.in_key) && !same) return { error: 'incoming member is already on the council' };
    try {
      checkXpub(c.in_xpub!, ctx.network);
    } catch {
      return { error: 'incoming xpub is not valid for this network' };
    }
    inLabel = name;
  }
  const next = councilAfter(council, c, inLabel, personOf);
  if (c.in_key) {
    const rest = next.slice(0, -1);
    if (rest.some(x => x.xpub === c.in_xpub || x.fingerprint === c.in_fingerprint)) return { error: 'incoming treasury key is already on the council' };
  }
  if (!next.length) return { error: 'the council would be empty' };
  if (c.threshold > next.length) return { error: 'threshold above the council size' };
  if (c.new_descriptor !== descriptorFor(next, c.threshold, ctx.network)) return { error: 'new_descriptor is not the one derived from the new council' };
  return { council: next };
}

/** Where a migration pays (6.1): the first receive address of the new descriptor. */
export const newTreasuryAddress = (descriptor: string, network: Network) => treasuryAddress(parseDescriptor(descriptor, network), network, 0, 0).address;

/**
 * Whether the keys continuing into the new council can still meet the old descriptor's threshold, so a sweep
 * round can move late arrivals (protocol 6.1). When not, the old treasury is unsweepable after the migration.
 */
export const sweepable = (council: CouncilEntry[], threshold: number, next: CouncilEntry[]) =>
  council.filter(x => next.some(y => y.xpub === x.xpub)).length >= threshold;
