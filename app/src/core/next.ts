// What the next payout round pays for a passed proposal (review U-1, U-2): used for the funds checks on the Council
// and Home pages, which must count only a staged payout's next tranche and a bounty's tranche.
import type { DaoState, Output, ProposalView } from './state';

/**
 * What a passed proposal pays in the next round (review U-1, U-2): a payout in tranches only its next tranche, a
 * bounty its tranche to a claimant (the first claim stands in for the estimate), anything else its outputs.
 */
export function nextRoundOutputs(s: DaoState, p: ProposalView): Output[] {
  const pl = p.content.payload;
  if (!Array.isArray(pl.schedule)) return (pl.outputs as Output[]) ?? [];
  const n = s.payments.get(p.event.id)?.tranche;
  const t = n ? (pl.schedule as { amount_sat: number }[])[n - 1] : undefined;
  if (!t) return [];
  const address = pl.bounty === true ? s.claims.get(p.event.id)?.[0]?.address : (pl.outputs as Output[])[0]?.address;
  return address ? [{ address, amount_sat: t.amount_sat }] : [];
}

