import { openRound } from './Round';
import { useEffect, useState } from 'preact/hooks';
import { chainApis, manualRetryIn, refreshTreasury, useApp } from '../app';
import { fmtDate, fmtSats, t } from '../i18n';
import { Address, Footer, Header, Qr, go } from './parts';
import { Join } from './Join';
import { ProposalCard } from './Proposals';
import { councilTodo } from './Council';
import { cadenceOf, roundDatesAfter } from '../core/time';
import { proposalLabel, type RoundView } from '../core/state';
import { parseDescriptor, treasuryAddress } from '../core/descriptor';
import { sameWallet } from '../core/descriptor';
import { explorerFor, type Movement, type TreasuryView } from '../core/chain';

export function Home() {
  const app = useApp();
  if (!app.daoId) return <Join />;
  const cfg = app.dao!.founded!.config;
  const current = app.dao!.settings[app.dao!.settings.length - 1].content;
  const tr = inForce(app.treasury, current.descriptor);
  const n = current.council.length;
  const m = current.threshold;
  const cap = current.rules.treasuryCapSats;
  const atCap = tr ? tr.balance >= cap : false;
  const explorer = explorerFor(chainApis());
  const open = app.dao!.proposals.filter(p => p.status === 'open').reverse();
  const round = openRound(app.dao!);
  const waiting = app.dao!.proposals.filter(p => app.dao!.payments.get(p.event.id)?.status === 'waiting' && p.content.type === 'payout');
  const waitingSats = waiting.reduce((s, p) => s + (p.content.payload.outputs as { amount_sat: number }[]).reduce((a, o) => a + o.amount_sat, 0), 0);
  const nextRoundDate = new Intl.DateTimeFormat(app.lang === 'en' ? 'en-GB' : 'it-IT', { day: 'numeric', month: 'long', timeZone: current.rules.timezone })
    .format(new Date(roundDatesAfter(app.dao!.now, current.rules.timezone, 1, cadenceOf(current.rules.payoutRound))[0] * 1000));
  const moves = movementsOf(tr);
  const paidRounds = new Map(app.dao!.rounds.filter(r => r.status === 'paid' && r.inspection).map(r => [r.inspection!.txid, r]));
  return (
    <>
      <Header />
      <main>
        <section class="card">
          <span class="small" style="font-size:15px">{t('home.balance')}</span>
          {tr ? (
            <>
              <div class="balance">{fmtSats(tr.balance)} <small>sats</small></div>
              {tr.unconfirmed !== 0 && <span class="small">{t('home.unconfirmed', { amount: fmtSats(tr.unconfirmed) })}</span>}
              {cfg.network !== 'mainnet' && <span class="small">{t('home.testValue')}</span>}
              <span class="small">
                {app.treasuryAt && t('home.readAt', { time: fmtTime(app.treasuryAt, app.lang) })}
                {app.treasuryAt && tr?.source && ` · ${t('home.via', { source: tr.source })}`}
                {app.treasuryLoading ? ` · ${t('home.updating')}` : app.treasuryError ? ` · ${t('home.notUpdated')}` : ''}
              </span>
              {app.treasuryError && !app.treasuryLoading && (
                <RetryButton cls="btn link" />
              )}
            </>
          ) : app.treasuryError && !app.treasuryLoading ? (
            <>
              <p class="error">{t('home.chainError', { msg: app.treasuryError })}</p>
              <RetryButton cls="btn secondary" />
            </>
          ) : (
            <div class="balance" aria-busy="true">…</div>
          )}
          <hr class="divider" />
          <div class="row">
            <div class="stack" style="gap:2px">
              <strong>{t('home.signatures', { m, n })}</strong>
              <span class="small">{t('home.councilKeys', { n })}{app.dao!.lostKeys.length > 0 && ` · ${t('home.keysLost', { k: app.dao!.lostKeys.length })}`}</span>
            </div>
            <div class="dots" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i class={i < m ? 'on' : ''} />)}</div>
          </div>
        </section>

        {tr?.others?.map(o => <OtherTreasury o={o} explorer={explorer} />)}

        {!app.dao!.closed && !tr && <Donate address={firstAddress(current.descriptor, cfg.network)} />}

        {!app.dao!.closed && tr && (atCap ? (
          <section class="card">
            <h2>{t('home.donate')}</h2>
            <p class="warn">{tr.balance > cap ? t('home.overCap', { cap: fmtSats(cap) }) : t('home.capReached', { cap: fmtSats(cap) })}</p>
          </section>
        ) : (
          // During a council change, donations go to the new treasury: the old one is being emptied (COUNCIL DAO, 11 Nov 2026).
          <Donate address={nextTreasury(tr)?.donationAddress ?? tr.donationAddress} first={tr.balance === 0 && tr.movements.length === 0 && !nextTreasury(tr)} testnet={cfg.testnetTreasury?.name} />
        ))}

        {app.isCouncil && app.me && councilTodo(app.dao!, app.me.person) > 0 && (
          <a class="card tint" style="text-decoration:none;color:var(--teal-ink)" href="#/council">
            <strong>{t('home.councilTodo', { n: councilTodo(app.dao!, app.me.person) })}</strong>
          </a>
        )}

        {!app.dao!.closed && (round ? (
          <a class="card tint" style="text-decoration:none;color:var(--teal-ink);gap:4px" href={`#/round/${round.event.id}`}>
            <span class="small">{t('home.nextRound')}</span>
            <div class="row"><strong style="font-size:18px">{t('home.roundOpen', { round: round.content.round, n: round.signatures.size, m: round.threshold })}</strong><span>{t('home.see')}</span></div>
          </a>
        ) : (
          <div class="card tint" style="gap:4px;color:var(--teal-ink)">
            <span class="small">{t('home.nextRound')}</span>
            <strong style="font-size:22px">{nextRoundDate}</strong>
            <span class="small">{t('home.nextRoundText', { n: waiting.length, sats: fmtSats(waitingSats) })}</span>
            {waiting.length > 0 && <span class="small">{t('home.roundEarly')}</span>}
          </div>
        ))}

        {app.dao!.closed ? (
          <a href="#/proposals" style="font-weight:600;text-decoration:none">{t('home.allProposals')}</a>
        ) : (
          <div class="row">
            <h2>{t('home.open')}</h2>
            <a href="#/proposals" style="font-weight:600;text-decoration:none">{t('home.all')}</a>
          </div>
        )}
        {!app.dao!.closed && (open.length === 0 ? <p class="small">{t('home.noOpen')}</p> : open.map(p => <ProposalCard p={p} />))}
        {!app.dao!.closed && app.me && app.secret && <button type="button" class="btn secondary" onClick={() => go('/new')}>{t('props.new')}</button>}

        {tr && (
          <section class="card">
            <h2>{t('home.movements')}</h2>
            {moves.length === 0 ? (
              <p class="small">{t('home.noMovements')}</p>
            ) : (
              <div class="list">
                {moves.map(mv => (
                  <div class="row" style="align-items:flex-start">
                    <div class="stack" style="gap:2px">
                      <strong>{mv.moved ? t('home.moved') : mv.net >= 0 ? t('home.in') : paidRounds.has(mv.txid) ? roundTitle(paidRounds.get(mv.txid)!) : t('home.out')}{mv.earlier && !mv.moved ? ` · ${t('home.earlierShort')}` : ''}</strong>
                      <span class="small">
                        {mv.time ? fmtDate(mv.time, false) : t('home.pending')}
                        {mv.net < 0 ? ` · ${t('home.feeIncl')}` : ''} ·{' '}
                        <a href={`${explorer}/tx/${mv.txid}`} target="_blank" rel="noopener">tx</a>
                      </span>
                    </div>
                    <span class={mv.net >= 0 ? 'amount-in' : 'amount-out'}>{mv.net >= 0 ? '+' : '−'}{fmtSats(Math.abs(mv.net))}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section class="card">
          <h2>{t('home.verify')}</h2>
          <p class="small">{t('home.verifyText', { m })}</p>
          <details>
            <summary class="small" style="cursor:pointer">{t('home.descriptor')}</summary>
            <p class="mono" style="font-size:12px;overflow-wrap:anywhere;margin-top:8px">{current.descriptor}</p>
          </details>
          <a href="#/rules" onClick={e => (e.preventDefault(), go('/rules'))}>{t('nav.rules')} →</a>
        </section>
      </main>
      <Footer />
    </>
  );
}

/**
 * A reading taken before the latest settings version, seen from the descriptor now in force: the treasury it
 * called "next" is the treasury, and the one it read as the treasury is an earlier one (until the next read).
 */
function inForce(tr: TreasuryView | undefined, descriptor: string): TreasuryView | undefined {
  if (!tr?.descriptor || sameWallet(tr.descriptor, descriptor)) return tr;
  const o = tr.others?.find(x => sameWallet(x.descriptor, descriptor) && x.view);
  if (!o) return tr;
  const { others: _o, ...was } = tr;
  return {
    ...o.view!, descriptor, source: tr.source,
    others: [{ descriptor: tr.descriptor, role: 'earlier', view: was }, ...(tr.others ?? []).filter(x => x !== o)],
  };
}

/**
 * The treasury's movements across council changes: the one in force and the earlier ones, newest first. A
 * migration shows once (the move costs only its fee), not as an out of one treasury and an in of the next.
 */
function movementsOf(tr: TreasuryView | undefined): (Movement & { moved?: boolean; earlier?: boolean })[] {
  if (!tr) return [];
  const all = new Map<string, Movement & { moved?: boolean; earlier?: boolean }>();
  const add = (m: Movement, earlier: boolean) => {
    const had = all.get(m.txid);
    if (had) all.set(m.txid, { ...had, net: had.net + m.net, moved: true, earlier: false });
    else all.set(m.txid, { ...m, earlier });
  };
  for (const m of tr.movements) add(m, false);
  for (const o of tr.others ?? []) for (const m of o.view?.movements ?? []) add(m, o.role === 'earlier');
  return [...all.values()].sort((a, b) => (b.time ?? Infinity) - (a.time ?? Infinity));
}

/** An earlier treasury (late arrivals) or the incoming one while the council change is under way. */
function OtherTreasury({ o, explorer }: { o: NonNullable<TreasuryView['others']>[number]; explorer: string }) {
  const network = useApp().site!.network;
  const v = o.view;
  if (o.role === 'earlier' && v && v.balance === 0) return null; // nothing left behind: nothing to say
  return (
    <section class="card">
      <span class="small" style="font-size:15px">{o.role === 'next' ? t('home.nextTreasury') : t('home.earlierTreasury')}</span>
      {v ? <div class="balance" style="font-size:28px">{fmtSats(v.balance)} <small>sats</small></div> : <p class="small">{t('home.chainError', { msg: o.error ?? '' })}</p>}
      <p class="small">{o.role === 'next' ? t('home.nextTreasuryText') : t('home.earlierTreasuryText')}</p>
      {v && <a class="small" href={`${explorer}/address/${firstAddress(o.descriptor, network)}`} target="_blank" rel="noopener">{t('home.onExplorer')}</a>}
    </section>
  );
}

function roundTitle(r: RoundView) {
  const app = useApp();
  const nums = r.content.proposals.map(id => app.dao!.proposals.find(p => p.event.id === id)).filter(Boolean).map(p => proposalLabel(app.site!.name, p!.number));
  return `${t('home.roundLabel', { round: r.content.round })} · ${nums.join(', ')}`;
}

function fmtTime(ms: number, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'it-IT', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(ms));
}

/** The treasury's first receive address, worked out on the phone: funds sent to any treasury address are found later. */
/** The incoming treasury while a council change is under way, once it has been read. */
const nextTreasury = (tr: TreasuryView) => tr.others?.find(o => o.role === 'next' && o.view)?.view;

function firstAddress(descriptor: string, network: Parameters<typeof parseDescriptor>[1]): string {
  return treasuryAddress(parseDescriptor(descriptor, network), network, 0, 0).address;
}

function Donate({ address, first, testnet }: { address: string; first?: boolean; testnet?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <section class="card">
      <h2>{first ? t('home.fundTitle') : t('home.donate')}</h2>
      {first && <p class="small">{t('home.fundText')}</p>}
      {first && testnet && <p class="note">{t('home.fundTestnet', { name: testnet })}</p>}
      <div class="qr-wrap"><Qr text={`bitcoin:${address}`} size={200} label={address} /></div>
      <Address value={address} />
      <button type="button" class="btn dark" onClick={copy}>{copied ? t('home.copied') : t('home.copy')}</button>
      <p class="small">{t('home.donateNote')}</p>
    </section>
  );
}

/** "Try again" for the treasury reading, paused for a few seconds after the last attempt. */
function RetryButton({ cls }: { cls: string }) {
  const [, tick] = useState(0);
  const wait = manualRetryIn();
  useEffect(() => {
    if (!wait) return;
    const id = setTimeout(() => tick(n => n + 1), 1000);
    return () => clearTimeout(id);
  });
  return (
    <button type="button" class={cls} disabled={wait > 0} onClick={() => refreshTreasury()}>
      {wait > 0 ? t('retryIn', { s: Math.ceil(wait / 1000) }) : t('retry')}
    </button>
  );
}
