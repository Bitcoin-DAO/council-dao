// Paid on delivery (protocol 4.6) on the proposal page: the schedule with each tranche's status, bounty claims,
// and the report form for whoever may report (the proposer, the member being paid, or a bounty's claimant).
import { useState } from 'preact/hooks';
import { signAndPublish, useApp } from '../app';
import { fmtDate, fmtSats, t } from '../i18n';
import { KIND } from '../core/events';
import { REPORT_MAX, type Tranche } from '../core/delivery';
import { validAddress, type Output, type ProposalView } from '../core/state';
import { errText } from './parts';
import { useNameOf } from './Proposals';

export function Delivery({ p }: { p: ProposalView }) {
  const app = useApp();
  const s = app.dao!;
  const nameOf = useNameOf();
  const pl = p.content.payload;
  const schedule = pl.schedule as Tranche[] | undefined;
  const isBounty = pl.bounty === true;
  const requested = pl.report === 'requested';
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [claimAddr, setClaimAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  if (p.content.type !== 'payout' || (!schedule && !requested)) return null;
  const pay = s.payments.get(p.event.id);
  const reports = s.reports.get(p.event.id) ?? [];
  const claims = s.claims.get(p.event.id) ?? [];
  const me = app.me?.person;
  const passed = p.status === 'passed';
  const open = passed && pay && pay.status !== 'paid' && pay.status !== 'lapsed';
  const myClaim = claims.find(c => c.person === me);
  const chosen = isBounty ? pay?.tranches?.[0]?.status === 'paid' ? claims.find(c => c.address === pay.tranches![0].address)?.person : undefined : undefined;
  const mayReport = !!me && !!app.secret && (
    me === s.personOf(p.event.pubkey)
    || (pl.outputs as Output[]).some(o => o.member && s.personOf(o.member) === me)
    || (isBounty && !!myClaim && (!chosen || chosen === me)));
  const tranche = pay?.tranche ?? 1;
  const run = async (f: () => Promise<unknown>) => {
    setMsg(undefined);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const report = () => run(async () => {
    await signAndPublish(KIND.report, { tranche: schedule ? tranche : 1, text: text.trim(), ...(link.trim() ? { link: link.trim() } : {}) }, [['e', p.event.id]]);
    setText('');
    setLink('');
  });
  const claim = () => run(async () => {
    await signAndPublish(KIND.claim, { address: claimAddr.trim() }, [['e', p.event.id]]);
    setClaimAddr('');
  });
  const addrOk = validAddress(claimAddr.trim(), app.site!.network) && !s.isTreasuryAddress(claimAddr.trim());
  const statusText = (st: string) => t(`dl.st.${st}` as 'dl.st.paid');

  return (
    <section class="card">
      <h3>{schedule ? t('dl.schedule') : t('dl.reportTitle')}</h3>
      {schedule && (pay?.tranches ?? schedule.map((x, k) => ({ n: k + 1, amount_sat: x.amount_sat, status: 'upcoming' as const, dueAt: undefined, report: undefined }))).map(v => (
        <div class="stack" style="gap:2px">
          <div class="row" style="align-items:baseline">
            <strong>{t('dl.tranche', { n: v.n, sats: fmtSats(v.amount_sat) })}</strong>
            <span class={v.status === 'paid' ? 'chip teal' : v.status === 'lapsed' ? 'chip warn' : 'chip'}>{statusText(v.status)}</span>
          </div>
          <span class="small">
            {v.dueAt ? t('dl.due', { date: fmtDate(v.dueAt) }) : t('dl.dueDays', { d: schedule[v.n - 1].due_days })}
            {v.report && <> · <a href={`#/p/${p.event.id}`} onClick={e => (e.preventDefault(), document.getElementById(`report-${v.report!.event.id}`)?.scrollIntoView())}>{t('dl.reportBy', { name: nameOf(v.report.event.pubkey) })}</a></>}
          </span>
        </div>
      ))}
      {!schedule && <p class="small">{t('dl.requested')}</p>}

      {reports.map(r => (
        <div id={`report-${r.event.id}`} class="card tint" style="gap:4px">
          <span class="small">{t('dl.reportHead', { n: r.tranche, name: nameOf(r.event.pubkey), date: fmtDate(r.event.created_at) })}</span>
          <p style="white-space:pre-wrap;margin:0">{r.text}</p>
          {r.link && <a href={r.link} target="_blank" rel="noopener noreferrer">{t('pd.link')} ↗</a>}
        </div>
      ))}

      {isBounty && passed && (
        <div class="stack" style="gap:6px">
          <span class="small">{claims.length ? t('dl.claims', { names: claims.map(c => nameOf(c.event.pubkey)).join(', ') }) : t('dl.noClaims')}</span>
          {open && !chosen && me && app.secret && (
            <>
              <span class="small">{myClaim ? t('dl.claimedYou') : t('dl.claimText')}</span>
              <label class="field">{t('dl.claimAddress')}<input type="text" class="mono" autoComplete="off" spellcheck={false} value={claimAddr} onInput={e => setClaimAddr((e.target as HTMLInputElement).value)} /></label>
              <button type="button" class="btn secondary" disabled={busy || !addrOk} onClick={claim}>{myClaim ? t('dl.claimAgain') : t('dl.claim')}</button>
            </>
          )}
        </div>
      )}

      {mayReport && (open || (requested && passed)) && (
        <div class="stack" style="gap:6px">
          <label class="field">
            {schedule ? t('dl.reportFor', { n: tranche }) : t('dl.reportOne')}
            <textarea maxLength={REPORT_MAX} value={text} style="font-family:inherit;font-size:16px" onInput={e => setText((e.target as HTMLTextAreaElement).value)} />
          </label>
          <label class="field">{t('np.link')}<input type="text" inputMode="url" placeholder="https://" value={link} onInput={e => setLink((e.target as HTMLInputElement).value)} /></label>
          <button type="button" class="btn primary" disabled={busy || !text.trim()} onClick={report}>{t('dl.publish')}</button>
          {schedule && <p class="small">{t('dl.reportNote')}</p>}
        </div>
      )}
      {msg && <p class="warnbox">{msg}</p>}
    </section>
  );
}
