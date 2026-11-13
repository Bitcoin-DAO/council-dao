// New proposal (protocol 4.1). New members go through the sponsor flow instead.
import { useRef, useState } from 'preact/hooks';
import { signAndPublish, useApp } from '../app';
import { fmtSats, t } from '../i18n';
import { KIND } from '../core/events';
import { DUST, proposalSchemaError, validAddress, type Output, type ProposalContent, type ProposalType } from '../core/state';
import type { DraftContent } from '../core/discussion';
import { maxScheduleDays, maxTranches, scheduleRulesError, scheduleShapeError, type Tranche } from '../core/delivery';
import { COUNCIL_REASONS, sweepable, councilAfter, councilChangeError, descriptorFor, type CouncilChange, type CouncilReason } from '../core/council';
import { parseDescriptor, treasuryAddress } from '../core/descriptor';
import { readKeyExport } from '../core/hwkeys';
import { UrScanModal } from './Hw';
import { cadenceOf } from '../core/time';
import { Address, Footer, Header, errText, go } from './parts';
import { EDITABLE_RULES, periodText, ruleLabel, ruleValue, typeLabel } from './Proposals';
import { PRACTICE_VOTE_DAYS } from '../core/config';
import { feePolicyOf } from '../core/chain';

const TYPES: ProposalType[] = ['payout', 'statement', 'remove_member', 'change_rules', 'change_council', 'close'];

/** councilChangeError's reasons, in the reader's language. */
const CC_WHY: Record<string, string> = {
  'outgoing key is not on the council': 'cc.e.out',
  'incoming key is not a member': 'cc.e.notMember',
  'incoming member is already on the council': 'cc.e.onCouncil',
  'incoming xpub is not valid for this network': 'cc.e.xpub',
  'incoming treasury key is already on the council': 'cc.e.dup',
  'the council would be empty': 'cc.e.empty',
  'threshold above the council size': 'cc.e.threshold',
  'new_descriptor is not the one derived from the new council': 'cc.e.nothing',
};
const ccWhy = (e: string) => (CC_WHY[e] ? t(CC_WHY[e] as 'cc.e.out') : e);

/** Set by "start a council change" (a reported lost key): the form opens on it, prefilled. */
let councilPreset: { reason: CouncilReason; out: string; in: string } | undefined;
export function startCouncilChange(preset: { reason: CouncilReason; out: string; in: string }) {
  councilPreset = preset;
  go('/new');
}

/** The form's fields from a draft version (protocol 4.5.1), so a new version starts from the latest one. */
function fieldsOf(c?: DraftContent) {
  const p = c?.payload ?? {};
  const out = (p.outputs as Output[] | undefined)?.[0];
  const change = (p.changes as { path: string; to: unknown }[] | undefined)?.[0];
  return {
    type: (c?.type ?? 'payout') as ProposalType,
    title: c?.title ?? '',
    summary: c?.summary ?? '',
    recipient: (p.recipient as string) ?? '',
    address: (c?.type === 'close' ? (p.destination as string) : out?.address) ?? '',
    amount: out?.amount_sat ? String(out.amount_sat) : '',
    forMember: out?.member ?? '',
    member: (p.member_key as string) ?? '',
    reason: (p.reason as string) ?? '',
    rule: (change?.path?.replace(/^rules\./, '') ?? 'votingPeriodDays') as (typeof EDITABLE_RULES)[number],
    bounty: p.bounty === true,
    tranches: ((p.schedule as Tranche[] | undefined) ?? []).map(x => ({ amount: String(x.amount_sat), days: String(x.due_days) })),
    report: p.report === 'requested',
    value: change?.to !== undefined && change?.to !== null ? String(change.to) : '',
  };
}

/** New proposal, or with `draftId` a new version of a discussion draft (same fields, nothing required but the title). */
export function NewProposal({ draftId }: { draftId?: string } = {}) {
  const app = useApp();
  const s = app.dao!;
  const network = app.site!.network;
  const thread = draftId ? s.discussion.byId.get(draftId) : undefined;
  const latest = thread?.versions[thread.versions.length - 1];
  const [init] = useState(() => fieldsOf(latest?.content));
  const [preset] = useState(() => {
    const x = councilPreset;
    councilPreset = undefined;
    return x;
  });
  const [type, setType] = useState<ProposalType>(preset ? 'change_council' : init.type);
  // Council change (protocol 4.1.2)
  const cur = s.settings[s.settings.length - 1].content;
  const [ccReason, setCcReason] = useState<CouncilReason>(preset?.reason ?? 'lost_key');
  const [ccOut, setCcOut] = useState(preset?.out ?? '');
  const [ccIn, setCcIn] = useState(preset?.in ?? '');
  const [ccKey, setCcKey] = useState<{ fingerprint: string; xpub: string; device?: 'seedsigner' }>();
  const [ccThreshold, setCcThreshold] = useState<number>(cur.threshold);
  const [ccScan, setCcScan] = useState(false);
  const returnTo = s.founded!.config.testnetTreasury ?? app.site!.testnetTreasury;
  const returnOk = !!returnTo && validAddress(returnTo.address, network);
  const [title, setTitle] = useState(init.title);
  const [summary, setSummary] = useState(init.summary);
  const [link, setLink] = useState('');
  const [recipient, setRecipient] = useState(init.recipient);
  const [address, setAddress] = useState(init.address);
  const [amount, setAmount] = useState(init.amount);
  const [iAm, setIAm] = useState(false);
  const [member, setMember] = useState(init.member);
  const [forMember, setForMember] = useState(init.forMember);
  const [reason, setReason] = useState(init.reason);
  const [rule, setRule] = useState<(typeof EDITABLE_RULES)[number]>(init.rule);
  const [value, setValue] = useState(init.value);
  // 4.6: a bounty (its own choice in the list; a payout with an open recipient), tranches, a report request.
  const [bounty, setBounty] = useState(init.bounty);
  const [tranches, setTranches] = useState<{ amount: string; days: string }[]>(init.tranches.length ? init.tranches : []);
  const [reportReq, setReportReq] = useState(init.report);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  // One proposal per form: a second tap, or a retry after the address confirmation failed, never publishes it again.
  const sending = useRef(false);
  const published = useRef<string | undefined>(undefined);

  if (s.closed) {
    return (
      <>
        <Header />
        <main><p class="lead">{t('closed.text')}</p></main>
        <Footer />
      </>
    );
  }
  if (draftId && (!thread || thread.kind !== 'draft' || thread.status !== 'open' || thread.author !== app.me?.person)) {
    return (
      <>
        <Header />
        <main><p class="lead">{t('ds.notYours')}</p></main>
        <Footer />
      </>
    );
  }
  if (!app.me || !app.secret) {
    return (
      <>
        <Header />
        <main>
          <p class="lead">{t('np.signIn')}</p>
          <button type="button" class="btn primary" onClick={() => go('/join')}>{t('nav.signin')}</button>
        </main>
      </>
    );
  }

  const addr = address.trim();
  const addrError = addr && (!validAddress(addr, network) ? t('np.addressBad', { network }) : s.isTreasuryAddress(addr) ? t('np.addressTreasury') : undefined);
  const staged = type === 'payout' && (bounty || tranches.length > 0);
  const schedule: Tranche[] = tranches.map(x => ({ amount_sat: Number(x.amount), due_days: Number(x.days) }));
  const scheduleTotal = schedule.reduce((a, x) => a + (Number.isFinite(x.amount_sat) ? x.amount_sat : 0), 0);
  const amt = staged ? scheduleTotal : Number(amount);
  const amtError = amount && !(Number.isInteger(amt) && amt > DUST) ? t('np.amountBad', { dust: DUST }) : undefined;
  const stored = s.rules?.[rule];
  // A rule missing from older settings shows its default; the change records what is actually stored.
  const current = rule === 'feePolicy' ? feePolicyOf(s.rules ?? {}) : stored;
  const parsedValue = (() => {
    if (rule === 'payoutRound') return value === 'weekly' || value === 'monthly' ? value : undefined;
    if (rule === 'feePolicy') return value === 'fast' || value === 'economical' ? value : undefined;
    if (rule === 'quorum') return /^\d+\/\d+$/.test(value.trim()) ? value.trim() : undefined;
    const n = Number(value);
    return value.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  let payload: Record<string, unknown> = {};
  if (type === 'payout') {
    payload = bounty
      ? { recipient: '', outputs: [], bounty: true, schedule }
      : { recipient: recipient.trim(), outputs: [{ address: addr, amount_sat: amt, ...(forMember ? { member: forMember } : {}) }], ...(staged ? { schedule } : reportReq ? { report: 'requested' } : {}) };
  }
  const limitTranches = maxTranches(s.rules ?? ({} as never));
  const limitDays = maxScheduleDays(s.rules ?? ({} as never));
  const scheduleErr = staged ? (schedule.length === 0 ? t('np.trancheNone') : scheduleShapeError(schedule) ? t('np.trancheBad', { dust: DUST }) : scheduleRulesError(schedule, s.rules ?? ({} as never)) ? t('np.trancheLimits', { n: limitTranches, d: limitDays }) : undefined) : undefined;
  // Approving a schedule reserves no coins: warn when the promises would exceed what the treasury holds (4.6.5).
  const overCommitted = staged && app.treasury && s.committed + scheduleTotal > app.treasury.balance;
  if (type === 'remove_member') payload = { member_key: member, reason: reason.trim() };
  if (type === 'change_rules') payload = { changes: [{ path: `rules.${rule}`, from: stored ?? null, to: parsedValue }] };
  if (type === 'close') payload = { destination: addr };
  let cc: ReturnType<typeof councilChangeError> | undefined;
  if (type === 'change_council') {
    const change: CouncilChange = {
      reason: ccReason, out_key: ccOut || null, in_key: ccIn || null,
      in_xpub: ccIn ? ccKey?.xpub ?? '' : null, in_fingerprint: ccIn ? ccKey?.fingerprint ?? '' : null,
      ...(ccIn && ccKey?.device ? { in_device: ccKey.device } : {}),
      threshold: ccThreshold, new_descriptor: '',
    };
    const named = s.members.find(m => m.person === s.personOf(ccIn))?.name ?? '';
    const next = councilAfter(cur.council, change, named, s.personOf);
    try {
      change.new_descriptor = descriptorFor(next, Math.min(ccThreshold, Math.max(1, next.length)), network);
    } catch {
      /* incomplete: the incoming key is not scanned yet */
    }
    payload = change as unknown as Record<string, unknown>;
    cc = ccIn && !ccKey ? { error: t('cc.needKey') } : councilChangeError(change, cur.council, {
      network, personOf: s.personOf, memberName: k => s.members.find(m => m.person === s.personOf(k))?.name,
    });
  }
  const content: ProposalContent = {
    type, title: title.trim(), summary: summary.trim(), lang: app.lang, payload,
    ...(link.trim() ? { link: { url: link.trim() } } : {}),
  };
  const schemaErr = proposalSchemaError(content, network);
  // Say what still stops publishing, instead of a silently disabled button.
  const FIELD: Record<string, Parameters<typeof t>[0]> = {
    title: 'np.titleField', summary: 'np.summary', recipient: 'np.recipient', address: type === 'close' ? 'np.destination' : 'np.address',
    amount: 'np.amount', link: 'np.link', member_key: 'np.member', reason: type === 'change_council' ? 'cc.reasonFit' : 'np.reason', destination: 'np.destination',
    in_key: 'cc.inKey', keys: 'cc.in',
  };
  const missing = schemaErr
    ? (FIELD[schemaErr] ? t(FIELD[schemaErr]) : schemaErr)
    : type === 'change_rules' && parsedValue === undefined ? t('np.newValue') : undefined;
  const ok = !schemaErr && !scheduleErr && !addrError && !amtError && !(cc && 'error' in cc) && !(type === 'change_rules' && (parsedValue === undefined || parsedValue === current || (rule === 'payoutRound' && parsedValue === cadenceOf(current))));

  // A draft version may be partial: only the title is required, and wrong values are still flagged.
  const draftOk = !!title.trim() && !addrError && !amtError;
  const nextVersion = (thread?.versions.length ?? 0) + 1;

  const publish = async () => {
    if (sending.current) return;
    sending.current = true;
    setMsg(undefined);
    setBusy(true);
    try {
      if (draftId) {
        const draft: DraftContent = { version: nextVersion, title: title.trim(), summary: summary.trim(), type, payload, lang: app.lang };
        await signAndPublish(KIND.draft, draft, [['e', draftId]]);
        go(`/d/${draftId}`);
        return;
      }
      const id = published.current ?? (published.current = (await signAndPublish(KIND.proposal, content)).event.id);
      if (iAm && !bounty && !(type === 'payout' && payee && payeeStanding?.address === addr) && (type === 'payout' || type === 'close')) {
        try {
          await signAndPublish(KIND.confirm, { address: addr }, [['e', id]]);
        } catch {
          // The proposal is out: confirm the address from its page instead of publishing the proposal again.
        }
      }
      go(`/p/${id}`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const removable = s.members.filter(m => !m.council && m.key !== app.me!.key);
  const payee = s.members.find(m => m.key === forMember);
  const payeeStanding = payee ? s.standingAt(payee.key, s.now) : undefined;
  const chooseMember = (key: string) => {
    setForMember(key);
    const st = key ? s.standingAt(key, s.now) : undefined;
    const m = s.members.find(x => x.key === key);
    if (st) setAddress(st.address);
    if (m && !recipient.trim()) setRecipient(m.name);
  };

  return (
    <>
      <Header />
      <main>
        <h1>{draftId ? t('ds.newVersion', { n: nextVersion }) : t('np.title')}</h1>
        {draftId && <p class="small">{t('ds.versionHint')}</p>}
        <label class="field">
          {t('np.type')}
          <select value={type === 'payout' && bounty ? 'bounty' : type} onChange={e => {
            const raw = (e.target as HTMLSelectElement).value;
            const v = (raw === 'bounty' ? 'payout' : raw) as ProposalType;
            setBounty(raw === 'bounty');
            if (raw === 'bounty' && !tranches.length) setTranches([{ amount: '', days: '30' }]);
            if (raw === 'payout' && bounty) setTranches([]);
            setType(v);
            if (v === 'close' && returnOk && !address.trim()) setAddress(returnTo!.address);
          }} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
            {TYPES.flatMap(x => (x === 'payout' ? [<option value="payout">{typeLabel('payout')}</option>, <option value="bounty">{t('np.bounty')}</option>] : [<option value={x}>{typeLabel(x)}</option>]))}
          </select>
        </label>
        <p class="small">{t('np.sponsorHint')} <a href="#/members">{t('members.title')} →</a></p>
        <label class="field">{t('np.titleField')}<input type="text" maxLength={80} value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} /></label>
        <label class="field">
          {t('np.summary')}
          <textarea maxLength={500} value={summary} style="font-family:inherit;font-size:16px" onInput={e => setSummary((e.target as HTMLTextAreaElement).value)} />
          <span class="small" style="font-weight:400">{t('np.summaryHint')} {summary.length}/500</span>
        </label>
        {!draftId && <label class="field">{t('np.link')}<input type="text" inputMode="url" placeholder="https://" value={link} onInput={e => setLink((e.target as HTMLInputElement).value)} /></label>}

        {type === 'payout' && bounty && (
          <div class="card">
            <p class="small">{t('np.bountyText')}</p>
            <TrancheEditor tranches={tranches} setTranches={setTranches} max={limitTranches} maxDays={limitDays} practice={(s.rules?.votingPeriodDays ?? 7) < 1} />
            {scheduleErr && <p class="error">{scheduleErr}</p>}
            {overCommitted && <p class="warnbox">{t('np.overCommitted', { committed: fmtSats(s.committed), balance: fmtSats(app.treasury!.balance) })}</p>}
          </div>
        )}

        {type === 'payout' && !bounty && (
          <div class="card">
            <label class="field">
              {t('np.forMember')}
              <select value={forMember} onChange={e => chooseMember((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                <option value="">—</option>
                {s.members.map(m => <option value={m.key}>{m.name}</option>)}
              </select>
            </label>
            <label class="field">{t('np.recipient')}<input type="text" maxLength={80} value={recipient} onInput={e => setRecipient((e.target as HTMLInputElement).value)} /></label>
            <label class="field">{t('np.address')}<input type="text" class="mono" autoComplete="off" spellcheck={false} value={address} onInput={e => setAddress((e.target as HTMLInputElement).value)} /></label>
            {addrError && <p class="error">{addrError}</p>}
            {payee && addr && !addrError && (
              payeeStanding?.address === addr ? <p class="ok">{t('np.standingUsed', { name: payee.name })}</p>
                : <p class="small">{t(payeeStanding ? 'np.standingOther' : 'np.noStanding', { name: payee.name })}</p>
            )}
            <label class="check"><input type="checkbox" checked={staged} onChange={e => {
              const on = (e.target as HTMLInputElement).checked;
              setTranches(on ? [{ amount: amount, days: '30' }] : []);
              // On a phone the tranche fields open below the screen's edge: bring them into view.
              if (on) setTimeout(() => document.getElementById('tranches')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
            }} />{t('np.staged')}</label>
            {staged ? (
              <>
                <TrancheEditor tranches={tranches} setTranches={setTranches} max={limitTranches} maxDays={limitDays} practice={(s.rules?.votingPeriodDays ?? 7) < 1} />
                {scheduleTotal > 0 && <span class="small">{t('np.trancheTotal', { sats: fmtSats(scheduleTotal) })}</span>}
                {scheduleErr && <p class="error">{scheduleErr}</p>}
                {overCommitted && <p class="warnbox">{t('np.overCommitted', { committed: fmtSats(s.committed), balance: fmtSats(app.treasury!.balance) })}</p>}
              </>
            ) : (
              <>
                <label class="field">{t('np.amount')}<input type="text" inputMode="numeric" value={amount} onInput={e => setAmount((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))} /></label>
                {amount && !amtError && <span class="small">{fmtSats(amt)} sats</span>}
                {amtError && <p class="error">{amtError}</p>}
                <label class="check"><input type="checkbox" checked={reportReq} onChange={e => setReportReq((e.target as HTMLInputElement).checked)} />{t('np.reportRequested')}</label>
              </>
            )}
            {!draftId && !(payee && payeeStanding?.address === addr) && (
              <>
                <label class="check"><input type="checkbox" checked={iAm} onChange={e => setIAm((e.target as HTMLInputElement).checked)} />{t('np.iAmRecipient')}</label>
                {!iAm && <p class="small">{t('np.recipientLater')}</p>}
              </>
            )}
          </div>
        )}

        {type === 'remove_member' && (
          <div class="card">
            <label class="field">
              {t('np.member')}
              <select value={member} onChange={e => setMember((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                <option value="">—</option>
                {removable.map(m => <option value={m.key}>{m.name}</option>)}
              </select>
            </label>
            <label class="field">{t('np.reason')}<input type="text" value={reason} onInput={e => setReason((e.target as HTMLInputElement).value)} /></label>
            {s.members.some(m => m.council && m.key !== app.me!.key) && <p class="small">{t('np.councilNotRemovable')}</p>}
          </div>
        )}

        {type === 'change_rules' && (
          <div class="card">
            <label class="field">
              {t('np.rule')}
              <select value={rule} onChange={e => (setRule((e.target as HTMLSelectElement).value as typeof rule), setValue(''))} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                {EDITABLE_RULES.map(r => <option value={r}>{ruleLabel(r)}</option>)}
              </select>
            </label>
            <span class="small">{t('np.current', { v: ruleValue(rule, current) })}</span>
            {rule === 'votingPeriodDays' ? (
              // Vote length as members think of it: practice minutes or whole days.
              <label class="field">
                {t('np.newValue')}
                <select value={value} onChange={e => setValue((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                  <option value="">—</option>
                  {[PRACTICE_VOTE_DAYS, 1, 3, 7].map(d => <option value={String(d)}>{periodText(d)}</option>)}
                </select>
              </label>
            ) : rule === 'feePolicy' ? (
              <label class="field">
                {t('np.newValue')}
                <select value={value} onChange={e => setValue((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                  <option value="">—</option>
                  <option value="fast">{t('fee.fast')}</option>
                  <option value="economical">{t('fee.economical')}</option>
                </select>
              </label>
            ) : rule === 'payoutRound' ? (
              <label class="field">
                {t('np.newValue')}
                <select value={value} onChange={e => setValue((e.target as HTMLSelectElement).value)} style="min-height:48px;border:1px solid var(--field);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;background:#fff">
                  <option value="">—</option>
                  <option value="monthly">{t('setup.monthly')}</option>
                  <option value="weekly">{t('setup.weekly')}</option>
                </select>
              </label>
            ) : (
              <label class="field">{t('np.newValue')}<input type="text" value={value} onInput={e => setValue((e.target as HTMLInputElement).value)} /></label>
            )}
          </div>
        )}

        {type === 'change_council' && (
          <div class="card">
            <p class="small">{t('cc.intro')}</p>
            <label class="field">
              {t('cc.reason')}
              <select value={ccReason} onChange={e => {
                const r = (e.target as HTMLSelectElement).value as CouncilReason;
                setCcReason(r);
                if (r === 'expansion') setCcOut(''); // a new seat: nobody leaves
              }}>
                {COUNCIL_REASONS.map(r => <option value={r}>{t(`cc.r.${r}` as 'cc.r.lost_key')}</option>)}
              </select>
            </label>
            <label class="field">
              {t('cc.out')}
              <select value={ccOut} disabled={ccReason === 'expansion'} onChange={e => setCcOut((e.target as HTMLSelectElement).value)}>
                <option value="">{t('cc.none')}</option>
                {cur.council.map(c => <option value={c.identityKey}>{c.label} · {c.fingerprint}</option>)}
              </select>
            </label>
            <label class="field">
              {t('cc.in')}
              <select value={ccIn} onChange={e => (setCcIn((e.target as HTMLSelectElement).value), setCcKey(undefined))}>
                <option value="">{t('cc.none')}</option>
                {s.members.filter(m => !m.council || (ccOut && m.person === s.personOf(ccOut))).map(m => (
                  <option value={m.key}>{m.name}{m.council ? ` · ${t('cc.newKey')}` : ''}</option>
                ))}
              </select>
            </label>
            {ccIn && (
              <>
                <p class="small">{t('cc.keyText')}</p>
                {ccKey && <div class="kv"><span>{t('cc.inKey')}</span><span class="mono ok">{ccKey.fingerprint} ✓</span></div>}
                <button type="button" class={ccKey ? 'btn link' : 'btn secondary'} onClick={() => setCcScan(true)}>{ccKey ? t('fs.deviceRescan') : t('cc.scan')}</button>
              </>
            )}
            <div class="row" style="align-items:center">
              <span>{t('cc.threshold')}</span>
              <span class="row" style="gap:8px;align-items:center">
                <button type="button" class="btn secondary" style="width:44px" disabled={ccThreshold <= 1} onClick={() => setCcThreshold(ccThreshold - 1)}>−</button>
                <strong>{t('setup.of', { m: ccThreshold, n: cc && 'council' in cc ? cc.council.length : '?' })}</strong>
                <button type="button" class="btn secondary" style="width:44px" onClick={() => setCcThreshold(ccThreshold + 1)}>+</button>
              </span>
            </div>
            {cc && 'council' in cc && (
              <div class="stack" style="gap:4px">
                <span class="small">{t('cc.newCouncil')}</span>
                {cc.council.map(c => <span class="small mono">{c.label} · {c.fingerprint}</span>)}
                <span class="small">{t('cc.newTreasury')}</span>
                <Address value={treasuryAddress(parseDescriptor(payload.new_descriptor as string, network), network, 0, 0).address} />
                <p class="note">{t('cc.migration')}</p>
                {!sweepable(cur.council, cur.threshold, cc.council) && <p class="warnbox">{t(ccReason === 'lost_key' || ccReason === 'recall' ? 'cc.unsweepableLost' : 'cc.unsweepable')}</p>}
              </div>
            )}
            {cc && 'error' in cc && <p class="error">{t('cc.notYet', { why: ccWhy(cc.error) })}</p>}
          </div>
        )}

        {type === 'close' && (
          <div class="card">
            <p class="warn">{t('np.closeWarn')}</p>
            {returnOk && <p class="note">{t('np.returnNote', { name: returnTo!.name })}</p>}
            <label class="field">{t('np.destination')}<input type="text" class="mono" autoComplete="off" spellcheck={false} value={address} onInput={e => setAddress((e.target as HTMLInputElement).value)} /></label>
            {addrError && <p class="error">{addrError}</p>}
            {!draftId && <label class="check"><input type="checkbox" checked={iAm} onChange={e => setIAm((e.target as HTMLInputElement).checked)} />{t('np.iAmRecipient')}</label>}
          </div>
        )}

        {ccScan && <UrScanModal title={t('cc.scan')} plainOk onCancel={() => setCcScan(false)} onResult={v => {
          setCcScan(false);
          try {
            const k = readKeyExport('text' in v ? v.text : v, network);
            setCcKey({ fingerprint: k.fingerprint, xpub: k.xpub, device: 'seedsigner' }); // as at founding: the key a SeedSigner exports, scanned or typed
          } catch (e) {
            setMsg(errText(e));
          }
        }} />}
        {draftId ? (
          <>
            <button type="button" class="btn primary" disabled={!draftOk || busy} onClick={publish}>{t('ds.publishVersion', { n: nextVersion })}</button>
            {missing && <p class="small">{t('ds.stillMissing', { what: missing })}</p>}
          </>
        ) : (
          <>
            <button type="button" class="btn primary" disabled={!ok || busy} onClick={publish}>{t('np.publish')}</button>
            {!ok && missing && <p class="small">{t('np.missing', { what: missing })}</p>}
          </>
        )}
        {msg && <p class="warnbox">{msg}</p>}
      </main>
      <Footer />
    </>
  );
}

/** The schedule of a staged payout or a bounty (4.6.1): amounts in sats, due dates in days after approval. */
function TrancheEditor(props: { tranches: { amount: string; days: string }[]; setTranches: (x: { amount: string; days: string }[]) => void; max: number; maxDays: number; practice: boolean }) {
  const { tranches, setTranches } = props;
  const set = (k: number, f: 'amount' | 'days', v: string) => setTranches(tranches.map((x, i) => (i === k ? { ...x, [f]: v.replace(/[^\d]/g, '') } : x)));
  return (
    <div id="tranches" class="stack" style="gap:8px">
      <span class="small">{t('np.trancheHint', { n: props.max, d: props.maxDays })}{props.practice ? ` ${t('np.tranchePractice')}` : ''}</span>
      {tranches.map((x, k) => (
        <div class="row" style="gap:8px;align-items:flex-end">
          <label class="field" style="flex:2;min-width:0">{t('np.trancheAmount', { n: k + 1 })}<input type="text" style="width:100%;min-width:0" inputMode="numeric" value={x.amount} onInput={e => set(k, 'amount', (e.target as HTMLInputElement).value)} /></label>
          <label class="field" style="flex:1;min-width:0">{t('np.trancheDays')}<input type="text" style="width:100%;min-width:0" inputMode="numeric" value={x.days} onInput={e => set(k, 'days', (e.target as HTMLInputElement).value)} /></label>
          {tranches.length > 1 && <button type="button" class="btn link" style="flex:none;width:44px" aria-label={t('np.trancheRemove')} onClick={() => setTranches(tranches.filter((_, i) => i !== k))}>✕</button>}
        </div>
      ))}
      {tranches.length < props.max && (
        <button type="button" class="btn link" style="align-self:flex-start" onClick={() => setTranches([...tranches, { amount: '', days: String(Math.min(props.maxDays, (Number(tranches[tranches.length - 1]?.days) || 0) + 30)) }])}>{t('np.trancheAdd')}</button>
      )}
    </div>
  );
}
