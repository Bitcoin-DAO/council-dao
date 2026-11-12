// Payout rounds (protocol 6.1-6.3): prepare (council), check and sign, broadcast, receipt.
import { useEffect, useState } from 'preact/hooks';
import { mnemonicToSeedSync } from '@scure/bip39';
import { broadcastRound, chainApis, receiptDepth, refreshTreasury, signAndPublish, signingKey, useApp } from '../app';
import { fmtSats, t } from '../i18n';
import { KIND } from '../core/events';
import { explorerFor, feePolicyOf, pushPageOf, sourceLabel, suggestFee, txDepth, txSeenBy, txStatus, type Broadcast, type TxStatus } from '../core/chain';
import { parseDescriptor, treasuryAddress } from '../core/descriptor';
import type { Network } from '../core/config';
import { mergeSignatures } from '../core/hwkeys';
import { keptSignature } from '../lib/store';
import { newTreasuryAddress } from '../core/council';
import { SeedSignerSign } from './Hw';
import { buildRound, estimateVsize, finalizeRound, masterFromSeed, memberSignatures, signWithMnemonicKey, type BuiltRound } from '../core/round';
import { cadenceOf, roundLabel } from '../core/time';
import { proposalLabel, type Output, type RoundView } from '../core/state';
import { CouncilOnly, Address, Footer, Header, errText, go, askText } from './parts';
import { useNameOf } from './Proposals';


/** "Fee 278 sats is 6.1% of what the round pays · aims for the next block". */
function feeLine(fee: number, paid: number, policy: 'fast' | 'economical'): string {
  const share = paid > 0 ? `${((100 * fee) / paid).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : '—';
  return t('rd.feeShare', { fee: fmtSats(fee), share, aim: t(policy === 'fast' ? 'rd.aimFast' : 'rd.aimEconomical') });
}

/** Set by "Replace this round": the prepare page opens on a replacement of that round. */
let replacePreset: string | undefined;
export function startReplace(roundId: string) {
  replacePreset = roundId;
  go('/round/new');
}

export function PrepareRound() {
  const app = useApp();
  const s = app.dao!;
  const [replaceId] = useState(() => {
    const x = replacePreset;
    replacePreset = undefined;
    return x;
  });
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const cfg = s.founded!.config;
  const settings = s.settings[s.settings.length - 1].content;
  const max = settings.rules.maxFeeRateSatVb;
  const apis = chainApis();
  const policy = feePolicyOf(settings.rules);
  const [suggested, setSuggested] = useState<number>();
  const [rate, setRate] = useState('');
  const [built, setBuilt] = useState<BuiltRound>();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  // A round is built only from a live reading of the treasury's coins, never from the remembered one.
  const [opened] = useState(() => Date.now());
  useEffect(() => {
    void refreshTreasury();
    suggestFee(apis, policy).then(f => {
      setSuggested(f.rate);
      setRate(String(Math.min(f.rate, max)));
    }).catch(() => setRate('2'));
  }, []);

  if (!app.isCouncil || !app.secret) return <CouncilOnly />;

  const waiting = s.proposals.filter(p => s.payments.get(p.event.id)?.status === 'waiting');
  // Replacing an open round (protocol 6): its payouts and any approved since, on the same coins; the council
  // may leave one out (a declined or disputed payout goes back to waiting).
  const replacing = replaceId ? s.rounds.find(x => x.event.id === replaceId && x.status === 'open' && !x.replacedBy) : undefined;
  const pool = replacing
    ? [...replacing.content.proposals.map(id => s.proposals.find(p => p.event.id === id)!).filter(Boolean), ...waiting.filter(p => !replacing.content.proposals.includes(p.event.id))]
    : waiting;
  const candidates = pool.filter(p => !dropped.has(p.event.id));
  // A close or a council change moves the whole balance, alone in its round (6.1); a close comes first.
  const migration = candidates.find(p => p.content.type === 'change_council');
  const close = candidates.find(p => p.content.type === 'close');
  const sweep = close ?? migration;
  const sweepTo = close ? (close.content.payload.destination as string) : migration ? newTreasuryAddress(migration.content.payload.new_descriptor, cfg.network) : undefined;
  const list = sweep ? [sweep] : candidates.filter(p => p.content.type === 'payout');
  const outputs: Output[] = sweep ? [] : list.flatMap(p => p.content.payload.outputs as Output[]);
  const open = openRound(s);
  const r = Number(rate);
  const rateOk = Number.isFinite(r) && r >= 1 && r <= max;
  const aboveCap = suggested !== undefined && suggested > max;
  // A reading of the treasury in force: after a council change, an older reading is of the earlier descriptor.
  const live = !!app.treasury && !app.treasuryLoading && (app.treasuryAt ?? 0) >= opened && app.treasury.descriptor === settings.descriptor;
  // Known at once from the live reading: is there enough for the payouts and a fee? (TEST DAO, 9 Nov 2026)
  const shortBy = live && !sweep && rateOk ? missingFunds(app.treasury!.utxos.reduce((a, u) => a + u.value, 0), outputs, parseDescriptor(settings.descriptor, cfg.network), app.treasury!.utxos.length, r, cfg.network) : 0;

  const build = () => {
    setMsg(undefined);
    setBuilt(undefined);
    try {
      const tr = app.treasury!;
      setBuilt(buildRound({
        d: parseDescriptor(settings.descriptor, cfg.network), network: cfg.network, utxos: tr.utxos, outputs, feeRate: r,
        changeIndex: Math.max(0, tr.changeIndex), sweepTo, mustSpend: replacing?.inspection?.inputs,
      }));
    } catch (e) {
      const m = (e as Error).message;
      setMsg(m === 'insufficient' ? t('rd.insufficient') : m === 'replace-coins-gone' ? t('rd.replaceGone') : errText(e));
    }
  };

  const publish = async () => {
    if (!built) return;
    setMsg(undefined);
    setBusy(true);
    try {
      const { event } = await signAndPublish(KIND.round, {
        round: roundLabel(s.now, settings.rules.timezone, cadenceOf(settings.rules.payoutRound)), proposals: list.map(p => p.event.id), psbt: built.psbt, fee_rate_sat_vb: r, fee_sat: built.fee,
      });
      const tk = signingKey();
      if (tk) await signAndPublish(KIND.sign, { psbt: signWithMnemonicKey(built.psbt, masterFromSeed(mnemonicToSeedSync(tk.mnemonic), cfg.network)) }, [['e', event.id]]);
      go(`/round/${event.id}`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header />
      <main>
        <h1>{replacing ? t('rd.replaceTitle', { round: replacing.content.round }) : t('rd.prepare')}</h1>
        <p class="lead">{replacing ? t('rd.replaceText') : t('rd.prepareText')}</p>
        {replaceId && !replacing && <p class="warnbox">{t('rd.replaceNoLonger')}</p>}
        {!replacing && open && <a class="note" href={`#/round/${open.event.id}`}>{t('rd.openExists')} {t('cn.open')}</a>}
        {replacing && pool.length > 1 && (
          <div class="card">
            <h3>{t('rd.replaceChoose')}</h3>
            {pool.map(p => (
              <label class="check">
                <input type="checkbox" checked={!dropped.has(p.event.id)} onChange={e => {
                  const next = new Set(dropped);
                  if ((e.target as HTMLInputElement).checked) next.delete(p.event.id);
                  else next.add(p.event.id);
                  setDropped(next);
                  setBuilt(undefined);
                }} />
                <span>{proposalLabel(app.site!.name, p.number)} · {p.content.title}{replacing.content.proposals.includes(p.event.id) ? '' : ` · ${t('rd.replaceNew')}`}</span>
              </label>
            ))}
          </div>
        )}
        {!list.length ? <p class="small">{t('rd.none')}</p> : (
          <>
            <div class="card">
              <h3>{t('rd.payouts')}</h3>
              {list.map(p => (
                <div class="kv">
                  <a href={`#/p/${p.event.id}`}>{proposalLabel(app.site!.name, p.number)} · {p.content.title}</a>
                  <span class="mono">{p.content.type !== 'payout' ? '—' : fmtSats((p.content.payload.outputs as Output[]).reduce((a, o) => a + o.amount_sat, 0))}</span>
                </div>
              ))}
              {migration && sweep === migration && (
                <>
                  <p class="small">{t('rd.migrationText')}</p>
                  <Address value={sweepTo!} />
                </>
              )}
            </div>
            <label class="field">
              {t('rd.feeRate', { max })}
              <input type="text" inputMode="numeric" value={rate} onInput={e => (setRate((e.target as HTMLInputElement).value.replace(/[^\d.]/g, '')), setBuilt(undefined))} />
              {suggested !== undefined && <span class="small" style="font-weight:400">{t(policy === 'fast' ? 'rd.feeFast' : 'rd.feeEconomical', { rate: suggested })}</span>}
            </label>
            {aboveCap && <p class="warnbox">{t('rd.feeAboveCap', { max, rate: suggested! })}</p>}
            {shortBy > 0 && <p class="warnbox">{t('rd.shortBy', { missing: fmtSats(shortBy), balance: fmtSats(app.treasury!.utxos.reduce((a, u) => a + u.value, 0)) })}</p>}
            <button type="button" class="btn secondary" disabled={!rateOk || !live || shortBy > 0} onClick={build}>{t('rd.build')}</button>
            {!live && (app.treasuryLoading || !app.treasuryError) && <p class="small">{t('rd.readingCoins')}</p>}
            {!live && !app.treasuryLoading && app.treasuryError && (
              <p class="small">{t('rd.coinsError', { msg: app.treasuryError })} <button type="button" class="btn link" onClick={() => refreshTreasury()}>{t('retry')}</button></p>
            )}
          </>
        )}
        {built && (
          <div class="card">
            <h3>{t('rd.summary')}</h3>
            <div class="kv"><span>{t('rd.inputs')}</span><span class="mono">{built.inputs.length} · {fmtSats(built.inputs.reduce((a, u) => a + u.value, 0))}</span></div>
            <div class="kv"><span>{t('rd.total')}</span><span class="mono">{fmtSats(sweep ? built.inputs.reduce((a, u) => a + u.value, 0) - built.fee : outputs.reduce((a, o) => a + o.amount_sat, 0))}</span></div>
            {built.change && <div class="kv"><span>{t('rd.change')}</span><span class="mono">{fmtSats(built.change.value)}</span></div>}
            <div class="kv"><span>{t('rd.fee')}</span><span class="mono">{fmtSats(built.fee)} · {r} sat/vB</span></div>
            <p class="small">{feeLine(built.fee, sweep ? built.inputs.reduce((a, u) => a + u.value, 0) - built.fee : outputs.reduce((a, o) => a + o.amount_sat, 0), policy)}</p>
            <button type="button" class="btn primary" disabled={busy} onClick={publish}>{t('rd.publish')}</button>
          </div>
        )}
        {msg && <p class="warnbox">{msg}</p>}
      </main>
      <Footer />
    </>
  );
}

export function RoundDetail({ id }: { id: string }) {
  const app = useApp();
  const s = app.dao!;
  const cfg = s.founded!.config;
  const nameOf = useNameOf();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ext, setExt] = useState(false);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [st, setSt] = useState<(TxStatus & { disagree?: boolean }) | null>(); // undefined: not asked yet; null: no source knows it
  const [seen, setSeen] = useState<string[]>([]);
  const [sent, setSent] = useState<Broadcast>();
  const [risen, setRisen] = useState<number>();
  const onChain = st === undefined ? undefined : !!st;
  const sentVia = sent ? sourceLabel(sent.source, undefined, chainApis()) : undefined;
  const [checked, setChecked] = useState(false); // asked the sources since the last broadcast
  const r = s.rounds.find(x => x.event.id === id);
  const apis = chainApis();

  // Ask the sources whether they know the transaction; until the receipt, ask again every 20 seconds.
  useEffect(() => {
    if (!r?.inspection) return;
    const txid = r.inspection.txid;
    const check = () =>
      void txDepth(chainApis(), txid).then(x => {
        setSt(x ?? null);
        if (x && !r.receipt) void txSeenBy(chainApis(), txid).then(setSeen);
      });
    check();
    if (!r.ready || r.receipt) return;
    // Has the network's fee for the next block risen above the round's while signatures were collected?
    void suggestFee(chainApis(), 'fast').then(f => setRisen(f.next > r.content.fee_rate_sat_vb ? f.next : undefined)).catch(() => undefined);
    const timer = setInterval(check, 20_000); // members watch the confirmations grow
    return () => clearInterval(timer);
  }, [r?.inspection?.txid, r?.ready, r?.receipt?.id]);

  if (!r) return <><Header /><main><p class="lead">{t('pd.notFound')}</p></main><Footer /></>;
  const ins = r.inspection;
  const settings = s.settingsAt(r.event.created_at).content;
  const myPerson = app.me?.person;
  const myEntry = myPerson ? settings.council.find(c => s.personOf(c.identityKey) === myPerson) : undefined;
  const iSigned = !!myPerson && r.signatures.has(myPerson);
  // A signature scanned from the SeedSigner but not published yet (signed out, or the tab reloaded).
  const keptRaw = keptSignature.get(r.event.id);
  let kept: string | undefined;
  try {
    kept = keptRaw && myEntry && ins && memberSignatures(keptRaw, parseDescriptor(settings.descriptor, cfg.network), cfg.network, myEntry, ins).size ? keptRaw : undefined;
  } catch { /* not a signature for this round */ }
  if (keptRaw && iSigned) keptSignature.clear(r.event.id);
  const signers = [...r.signatures.keys()];
  const tk = app.identity?.treasury;
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
  const signTest = () => run(() => signAndPublish(KIND.sign, { psbt: signWithMnemonicKey(r.content.psbt, masterFromSeed(mnemonicToSeedSync(tk!.mnemonic), cfg.network)) }, [['e', r.event.id]]));
  const useExternal = () => run(async () => {
    // A SeedSigner sends back a trimmed PSBT: its signatures go back into the round's own PSBT.
    let psbt: string;
    try {
      psbt = mergeSignatures(r.content.psbt, pasted.trim());
    } catch {
      throw new Error(t('rd.badSigned'));
    }
    const sigs = memberSignatures(psbt, parseDescriptor(settings.descriptor, cfg.network), cfg.network, myEntry!, ins!);
    if (!sigs.size) throw new Error(t('rd.badSigned'));
    await signAndPublish(KIND.sign, { psbt }, [['e', r.event.id]]);
    setExt(false);
  });
  const decline = async () => {
    const reason = await askText(t('rd.declineReason'));
    if (reason) void run(() => signAndPublish(KIND.sign, { decline: reason }, [['e', r.event.id]]));
  };
  // The finished transaction, offered so anyone can push it by hand until it is seen on the network.
  let rawHex: string | undefined;
  if (r.ready) {
    try {
      rawHex = finalizeRound(r.signEvents.map(x => JSON.parse(x.content).psbt)).hex;
    } catch { /* shown as the round's errors */ }
  }
  const doBroadcast = () => run(async () => {
    const b = await broadcastRound(r);
    setSent(b);
    setChecked(false);
    setTimeout(() => void txStatus(chainApis(), b.txid).then(x => {
      setSt(x ?? null);
      setChecked(true);
      if (x) void txSeenBy(chainApis(), b.txid).then(setSeen);
    }), 5000);
  });
  const height = r.receipt ? (JSON.parse(r.receipt.content).block_height as number) : undefined;

  return (
    <>
      <Header />
      <main>
        <div class="row" style="justify-content:flex-start;gap:8px">
          <span class={r.status === 'paid' ? 'chip teal' : 'chip'}>{t(`rd.status.${r.status}` as 'rd.status.open')}</span>
        </div>
        <h1>{t('rd.title', { round: r.content.round })}</h1>
        {r.errors.length > 0 && <p class="warnbox">{t('rd.errors', { list: r.errors.join('; ') })}</p>}

        <section class="card">
          <h3>{t('rd.payouts')}</h3>
          {r.content.proposals.map(pid => {
            const p = s.proposals.find(x => x.event.id === pid);
            return <a href={`#/p/${pid}`}>{p ? `${proposalLabel(app.site!.name, p.number)} · ${p.content.title}` : pid.slice(0, 12)}</a>;
          })}
        </section>

        {ins && (
          <section class="card">
            <h3>{t('rd.outputs')}</h3>
            {r.status === 'open' && <p class="small">{t('rd.check')}</p>}
            {ins.outputs.map(o => (
              <div class="stack" style="gap:4px">
                {o.change !== undefined && <span class="chip teal" style="align-self:flex-start">{t('rd.change')}</span>}
                {r.isMigration && <span class="chip teal" style="align-self:flex-start">{t('rd.newTreasury')}</span>}
                <Address value={o.address} />
                <span class="mono">{fmtSats(o.value)} sats</span>
              </div>
            ))}
            <hr class="divider" />
            <div class="kv"><span>{t('rd.inputs')}</span><span class="mono">{ins.inputs.length} · {fmtSats(ins.inputs.reduce((a, x) => a + x.value, 0))}</span></div>
            <div class="kv"><span>{t('rd.fee')}</span><span class="mono">{fmtSats(ins.fee)} · {r.content.fee_rate_sat_vb} sat/vB</span></div>
            <p class="small">{feeLine(ins.fee, ins.outputs.filter(o => o.change === undefined).reduce((a, o) => a + o.value, 0), feePolicyOf(settings.rules))}</p>
          </section>
        )}

        <section class="card">
          <h3>{t('rd.signatures', { n: signers.length, m: r.threshold })}</h3>
          {signers.length > 0 && <p class="small">{t('rd.signedBy', { names: signers.map(p => nameOf(p)).join(', ') })}</p>}
          {r.declines.map(d => <p class="small">{t('rd.declinedBy', { name: nameOf(d.person), reason: d.reason })}</p>)}
          {r.status === 'open' && r.replacedBy && (
            <p class="warnbox">{t('rd.replaced')} <a href={`#/round/${r.replacedBy.event.id}`}>{t('rd.replacedLink', { round: r.replacedBy.content.round })}</a></p>
          )}
          {r.status === 'open' && !r.replacedBy && !r.ready && app.isCouncil && app.secret && (
            <details>
              <summary class="small">{t('rd.replaceAsk')}</summary>
              <p class="small">{t('rd.replaceExplain')}</p>
              <button type="button" class="btn secondary" onClick={() => startReplace(r.event.id)}>{t('rd.replace')}</button>
            </details>
          )}
          {r.status === 'open' && !r.replacedBy && !r.ready && myEntry && !iSigned && !app.secret && (
            <div class="stack">
              <p class="warnbox">{t(kept ? 'rd.keptSignedOut' : 'rd.signInFirst')}</p>
              <button type="button" class="btn primary" onClick={() => go('/join')}>{t('nav.signin')}</button>
            </div>
          )}
          {r.status === 'open' && !r.replacedBy && !r.ready && myEntry && !iSigned && app.secret && kept && (
            <div class="stack">
              <p class="note">{t('rd.kept')}</p>
              <button type="button" class="btn primary" disabled={busy} onClick={() => run(async () => {
                await signAndPublish(KIND.sign, { psbt: kept }, [['e', r.event.id]]);
                keptSignature.clear(r.event.id);
              })}>{t('rd.keptPublish')}</button>
            </div>
          )}
          {r.status === 'open' && !r.replacedBy && r.ready && myEntry && !iSigned && <p class="small">{t('rd.notNeeded')}</p>}
          {r.status === 'open' && !r.replacedBy && !(r.ready && !iSigned) && app.isCouncil && app.secret && myEntry && !(kept && !iSigned) && (
            iSigned ? <p class="ok">{t('rd.signed')}</p> : (
              <>
                {tk && !app.identity?.wordsChecked ? <p class="warn">{t('words.needed')} <a href="#/profile">{t('words.toProfile')}</a></p>
                  : tk ? <button type="button" class="btn primary" disabled={busy} onClick={signTest}>{t('rd.signTest')}</button>
                  : myEntry.device === 'seedsigner' ? (
                    <SeedSignerSign
                      psbt={r.content.psbt}
                      descriptor={settings.descriptor}
                      network={cfg.network}
                      fingerprint={myEntry.fingerprint}
                      check={psbt => memberSignatures(psbt, parseDescriptor(settings.descriptor, cfg.network), cfg.network, myEntry, ins!).size === ins!.inputs.length}
                      onSigned={async psbt => {
                        // Kept first: if publishing fails (signed out, tab reloaded), the signature is not lost.
                        keptSignature.set(r.event.id, psbt);
                        try {
                          await signAndPublish(KIND.sign, { psbt }, [['e', r.event.id]]);
                        } catch (e) {
                          if ((e as Error).message === 'not-signed-in') throw new Error('not-signed-in-kept');
                          throw e;
                        }
                        keptSignature.clear(r.event.id);
                      }}
                    />
                  )
                  : <p class="small">{t('rd.noKey')} <a href="#/profile">{t('tk.link')}</a></p>}
                <button type="button" class="btn link" style="align-self:flex-start" onClick={() => setExt(!ext)}>{t('rd.external')}</button>
                {ext && (
                  <div class="stack">
                    <button type="button" class="btn secondary" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(r.content.psbt);
                        setCopied(true);
                      } catch { /* ignore */ }
                    }}>{copied ? t('home.copied') : t('rd.copyPsbt')}</button>
                    <label class="field">{t('rd.pastePsbt')}<textarea value={pasted} onInput={e => setPasted((e.target as HTMLTextAreaElement).value)} /></label>
                    <button type="button" class="btn dark" disabled={!pasted.trim() || busy} onClick={useExternal}>{t('rd.useSigned')}</button>
                  </div>
                )}
                <button type="button" class="btn link" style="align-self:flex-start" onClick={decline}>{t('rd.decline')}</button>
              </>
            )
          )}
          {r.status === 'open' && !r.replacedBy && r.ready && (
            <>
              <p class="ok">{t('rd.ready')}</p>
              {risen !== undefined && !st?.confirmed && <p class="warnbox">{t('rd.feeRisen', { now: risen, round: r.content.fee_rate_sat_vb })}</p>}
              {sent && <BroadcastReport b={sent} />}
              {onChain ? (
                <>
                  <p class="small">{t('rd.broadcasted')}</p>
                  {seen.length > 0 && <p class="small">{t('rd.seenBy', { n: seen.length, m: apis.length, list: seen.map(x => sourceLabel(x, undefined, apis)).join(', ') })}</p>}
                  {/* A source may know the transaction without passing it to miners: let anyone send it again. */}
                  <p class="small">{t('rd.stuck')}</p>
                  <button type="button" class="btn secondary" disabled={busy} onClick={doBroadcast}>{t('rd.again')}</button>
                </>
              ) : (
                <>
                  {sentVia && <p class="small">{t(onChain === false && checked ? 'rd.notSeen' : 'rd.accepted', { source: sentVia })}</p>}
                  <button type="button" class="btn primary" disabled={busy} onClick={doBroadcast}>{t(sentVia ? 'rd.again' : 'rd.broadcast')}</button>
                </>
              )}
              {rawHex && (() => {
                const manual = (
                  <div class="stack">
                    <p class="small">{t('rd.manual')}</p>
                    <button type="button" class="btn secondary" onClick={() => navigator.clipboard.writeText(rawHex).catch(() => undefined)}>{t('rd.copyTx')}</button>
                    {broadcastPages(apis, app.site?.broadcastPages).map(u => <a href={u} target="_blank" rel="noopener">{u.replace(/^https?:\/\//, '')} ↗</a>)}
                  </div>
                );
                return onChain ? (
                  <details>
                    <summary>{t('rd.manualTitle')}</summary>
                    {manual}
                  </details>
                ) : (
                  manual
                );
              })()}
            </>
          )}
          {msg && <p class="warnbox">{msg}</p>}
        </section>

        {ins && (onChain || r.receipt) && (
          <section class="card">
            <div class="kv"><span>{t('rd.txid')}</span><a class="mono" href={`${explorerFor(apis)}/tx/${ins.txid}`} target="_blank" rel="noopener">{ins.txid.slice(0, 16)}…</a></div>
            {height ? (
              <p class="ok">{t('rd.receipt', { h: height })}</p>
            ) : st?.disagree ? (
              <p class="warn">{t('rd.sourcesDisagree')}</p>
            ) : st?.confirmed ? (
              // Anyone sees the confirmation from the chain; the receipt follows from a council phone once it is deep enough.
              <p class="small">
                {t('rd.confirmedDepth', { h: st.block_height ?? '?', n: Math.min(st.confirmations ?? 1, receiptDepth()), m: receiptDepth() })}{' '}
                {(st.confirmations ?? 0) >= receiptDepth() ? t('rd.receiptWaiting') : ''}
              </p>
            ) : (
              <p class="small">{t('rd.waitingConfirm')}</p>
            )}
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}

/** Short line about a passed payout's payment, for the proposal page. */
export function PaymentLine({ id }: { id: string }) {
  const app = useApp();
  const s = app.dao!;
  const pay = s.payments.get(id);
  if (!pay) return null;
  const date = pay.lapseAt ? new Intl.DateTimeFormat(app.lang === 'en' ? 'en-GB' : 'it-IT', { day: 'numeric', month: 'long' }).format(new Date(pay.lapseAt * 1000)) : '';
  const round = pay.round?.content.round ?? '';
  const isClose = s.proposals.find(p => p.event.id === id)?.content.type === 'close';
  const text = pay.status === 'paid' && isClose ? t('pay.closeDone') : t(`pay.${pay.status}` as 'pay.waiting', { date, round });
  return pay.round ? <a class={pay.status === 'paid' ? 'ok' : 'small'} href={`#/round/${pay.round.event.id}`}>{text}</a> : <p class={pay.status === 'lapsed' ? 'warn' : 'small'}>{text}</p>;
}

/** The round in hand: open, and not replaced by a later round on its coins. */
export function openRound(s: { rounds: RoundView[] }) {
  return s.rounds.find(r => r.status === 'open' && !r.replacedBy);
}

/** What each source said to a broadcast, and what a chain gateway reported for the services behind it. */
function BroadcastReport({ b }: { b: Broadcast }) {
  return (
    <div class="small stack" style="gap:2px">
      <span>{t('rd.acceptedBy', { list: b.accepted.map(x => sourceLabel(x, undefined, chainApis())).join(', ') })}</span>
      {b.behind.length > 0 && <span>{t('rd.behind', { list: b.behind.join(' · ') })}</span>}
      {b.refused.map(x => <span>{t('rd.refusedBy', { source: sourceLabel(x.source, undefined, chainApis()), reason: x.reason })}</span>)}
    </div>
  );
}

/** The pages offered for a broadcast by hand: the site's own list, else each chain source's page (once each). */
function broadcastPages(apis: string[], pages: string[] = []): string[] {
  const own = pages.filter(u => /^https:\/\//.test(u));
  return own.length ? own : [...new Set(apis.map(pushPageOf))];
}

/**
 * Sats missing for these payouts at this fee rate, spending every coin, with a change output (0: enough).
 * An estimate: the round's own build is the final word.
 */
export function missingFunds(balance: number, outputs: Output[], d: ReturnType<typeof parseDescriptor>, nCoins: number, rate: number, network: Network): number {
  const pay = outputs.reduce((a, o) => a + o.amount_sat, 0);
  const change = treasuryAddress(d, network, 1, 0).address;
  const fee = Math.ceil(estimateVsize(d, Math.max(1, nCoins), [...outputs.map(o => o.address), change], network) * rate);
  return Math.max(0, pay + fee - balance);
}
