// Paid on delivery (protocol 4.6): staged payouts and bounties. A payout may carry a schedule of tranches, each
// paid only after a member reports its delivery; a bounty's recipient is a member who claims it.
import type { Rules } from './config';
import type { Event } from './events';

export interface Tranche {
  amount_sat: number;
  /** Whole days after approval (the proposal's first valid tally). */
  due_days: number;
}

export const MAX_TRANCHES_DEFAULT = 4;
export const MAX_SCHEDULE_DAYS_DEFAULT = 90;
export const REPORT_MAX = 2000;
const DUST = 546;

export const maxTranches = (r: Rules) => (Number.isInteger(r.maxTranches) && (r.maxTranches as number) > 0 ? (r.maxTranches as number) : MAX_TRANCHES_DEFAULT);
export const maxScheduleDays = (r: Rules) => (Number.isFinite(r.maxScheduleDays) && (r.maxScheduleDays as number) > 0 ? (r.maxScheduleDays as number) : MAX_SCHEDULE_DAYS_DEFAULT);

/** Seconds in a schedule day: a real day, or, in practice mode (votes under a day), the voting period / 7. */
export const scheduleDay = (r: Rules) => Math.round(86400 * (r.votingPeriodDays < 1 ? r.votingPeriodDays / 7 : 1));

/** Shape of a schedule (rules-independent); undefined when valid. */
export function scheduleShapeError(s: unknown): string | undefined {
  if (!Array.isArray(s) || s.length < 1 || s.length > 10) return 'schedule';
  let last = 0;
  for (const t of s as Tranche[]) {
    if (!t || !Number.isInteger(t.amount_sat) || t.amount_sat <= DUST) return 'schedule amount';
    if (!Number.isInteger(t.due_days) || t.due_days < 1 || t.due_days <= last) return 'schedule due_days';
    last = t.due_days;
  }
  return undefined;
}

/** The schedule against the rules in force when it was proposed. */
export function scheduleRulesError(s: Tranche[], r: Rules): string | undefined {
  if (s.length > maxTranches(r)) return `more than ${maxTranches(r)} tranches`;
  if (s[s.length - 1].due_days > maxScheduleDays(r)) return `schedule longer than ${maxScheduleDays(r)} days`;
  return undefined;
}

export interface ReportView {
  event: Event;
  person: string;
  tranche: number;
  text: string;
  link?: string;
}

export interface ClaimView {
  event: Event;
  person: string;
  address: string;
}

export type TrancheStatus = 'upcoming' | 'awaiting_report' | 'reported' | 'in_round' | 'paid' | 'lapsed';

export interface TrancheView {
  n: number;
  amount_sat: number;
  dueAt?: number; // after approval
  status: TrancheStatus;
  report?: ReportView;
  /** The address a round pays for this tranche (a bounty: the chosen claimant's, once known). */
  address?: string;
  paidRound?: string;
  lapseAt?: number;
}
