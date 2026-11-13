// Discussion (protocol 4.5): drafts and proposals by last activity, one thread each.
import { useEffect, useState } from 'preact/hooks';
import { signAndPublish, useApp } from '../app';
import { fmtDateTime, fmtSats, t } from '../i18n';
import { KIND } from '../core/events';
import { POST_MAX, timeline, type DraftContent, type DraftVersion, type Thread } from '../core/discussion';
import { proposalLabel, proposalSchemaError, type DaoState, type Output, type ProposalContent } from '../core/state';
import type { ReportView } from '../core/delivery';
import { nowSec } from '../core/util';
import { Footer, Header, askConfirm, errText, go } from './parts';
import { statusText, typeLabel, useNameOf } from './Proposals';

/** "New since your last visit": when this phone last opened each thread (no server, no notifications). */
const seenKey = (daoId: string, id: string) => `seen:${daoId}:${id}`;
export function lastSeen(daoId: string, id: string): number {
  try {
    return Number(localStorage.getItem(seenKey(daoId, id)) ?? 0);
  } catch {
    return 0;
  }
}
function markSeen(daoId: string, id: string) {
  try {
    localStorage.setItem(seenKey(daoId, id), String(nowSec()));
  } catch {
    /* private mode: nothing remembered */
  }
}

/** Entries others added since this phone last opened the thread. */
export function newCount(th: Thread, daoId: string, myPerson: string | undefined, personOf: (k: string) => string): number {
  const since = lastSeen(daoId, th.id);
  const entries = [...th.versions.map(v => v.event), ...th.posts, ...(th.proposal && th.kind === 'proposal' ? [th.proposal.event] : [])];
  return entries.filter(e => e.created_at > since && personOf(e.pubkey) !== myPerson).length;
}

function chip(th: Thread, now: number): string {
  if (th.status === 'withdrawn') return t('ds.withdrawn');
  if (th.proposal) return statusText(th.proposal, now);
  if (th.versions.length === 1 && !th.versions[0].content.type) return t('ds.idea');
  return t('ds.draftV', { n: th.versions.length });
}

export function DiscussionList() {
  const app = useApp();
  const s = app.dao!;
  const daoId = app.daoId!;
  const nameOf = useNameOf();
  const me = app.me?.person;
  // 4.6: reports are read here: a chip on the thread, and a filter that lists only threads with reports.
  const [only, setOnly] = useState(false);
  const reportsOf = (th: (typeof s.discussion.threads)[number]) => (th.proposal ? s.reports.get(th.proposal.event.id) ?? [] : []);
  const lastReport = (th: (typeof s.discussion.threads)[number]) => Math.max(0, ...reportsOf(th).map(r => r.event.created_at));
  const shown = only ? s.discussion.threads.filter(th => reportsOf(th).length).sort((a, b) => lastReport(b) - lastReport(a)) : s.discussion.threads;
  return (
    <>
      <Header />
      <main>
        <h1>{t('ds.title')}</h1>
        <p class="small">{t('ds.intro')}</p>
        {app.me && app.secret && !s.closed && <button type="button" class="btn primary" onClick={() => go('/discussion/new')}>{t('ds.newIdea')}</button>}
        <div class="row" style="justify-content:flex-start;gap:8px">
          <button type="button" class={only ? 'btn link' : 'chip teal'} onClick={() => setOnly(false)}>{t('ds.all')}</button>
          <button type="button" class={only ? 'chip teal' : 'btn link'} onClick={() => setOnly(true)}>{t('ds.reports')}</button>
        </div>
        {shown.length === 0 ? <p class="small">{only ? t('ds.noReports') : t('ds.none')}</p> : (
          <div class="stack" style="gap:10px">
            {shown.map(th => {
              const fresh = newCount(th, daoId, me, s.personOf);
              return (
                <a class="card" style="text-decoration:none;color:inherit;gap:6px" href={`#/d/${th.id}`}>
                  <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">
                    {th.proposal && <span class="mono small">{proposalLabel(app.site!.name, th.proposal.number)}</span>}
                    <span class={th.status === 'open' ? 'chip teal' : 'chip'}>{chip(th, s.now)}</span>
                    {fresh > 0 && <span class="chip new">{t('ds.new', { n: fresh })}</span>}
                    {reportChip(th, s)}
                  </div>
                  <strong style="font-size:17px">{th.title}</strong>
                  <span class="small">{t('ds.meta', { name: nameOf(s.keyOf(th.author)), posts: th.posts.length, date: fmtDateTime(th.lastActivity) })}</span>
                </a>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

export function NewIdea() {
  const app = useApp();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
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
  const publish = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const c: DraftContent = { version: 1, title: title.trim(), summary: summary.trim(), lang: app.lang };
      const { event } = await signAndPublish(KIND.draft, c);
      go(`/d/${event.id}`);
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
        <h1>{t('ds.newIdea')}</h1>
        <p class="small">{t('ds.ideaHint')}</p>
        <label class="field">{t('np.titleField')}<input type="text" maxLength={80} value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} /></label>
        <label class="field">
          {t('ds.ideaText')}
          <textarea maxLength={500} value={summary} style="font-family:inherit;font-size:16px" onInput={e => setSummary((e.target as HTMLTextAreaElement).value)} />
        </label>
        <button type="button" class="btn primary" disabled={!title.trim() || busy} onClick={publish}>{t('ds.openThread')}</button>
        {msg && <p class="warnbox">{msg}</p>}
      </main>
      <Footer />
    </>
  );
}

/** A version's proposal fields, as the proposal would carry them. */
function asProposal(v: DraftVersion, draftId: string): ProposalContent {
  return {
    type: v.content.type!, title: v.content.title, summary: v.content.summary ?? '', lang: v.content.lang ?? 'it',
    payload: v.content.payload ?? {}, draft: { id: draftId, version: v.n },
  };
}

function VersionCard({ v, th, pinned }: { v: DraftVersion; th: Thread; pinned?: boolean }) {
  const app = useApp();
  const s = app.dao!;
  const nameOf = useNameOf();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const c = v.content;
  const isAuthor = app.me?.person === th.author && !!app.secret;
  const latest = th.versions[th.versions.length - 1] === v;
  const complete = !!c.type && !proposalSchemaError(asProposal(v, th.id), app.site!.network);
  const submit = async () => {
    if (!(await askConfirm(t('ds.submitConfirm', { n: v.n }), t('ds.submit')))) return;
    setBusy(true);
    setMsg(undefined);
    try {
      const { event } = await signAndPublish(KIND.proposal, asProposal(v, th.id));
      go(`/p/${event.id}`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const outs = (c.payload?.outputs as Output[] | undefined) ?? [];
  return (
    <section class={pinned ? 'card version pinned' : 'card version'}>
      <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">
        <span class="chip teal">v{v.n}</span>
        {c.type && <span class="chip">{typeLabel(c.type)}</span>}
        {pinned && <span class="small">{t('ds.current')}</span>}
      </div>
      <strong style="font-size:17px">{c.title}</strong>
      {c.summary && <p style="white-space:pre-wrap;margin:0">{c.summary}</p>}
      {c.type === 'payout' && outs.map(o => (
        <span class="small mono" style="overflow-wrap:anywhere">{fmtSats(Number(o.amount_sat) || 0)} sats → {o.address || '—'}</span>
      ))}
      {c.type === 'close' && c.payload?.destination && <span class="small mono" style="overflow-wrap:anywhere">→ {c.payload.destination}</span>}
      <span class="small">{t('ds.by', { name: nameOf(v.event.pubkey), date: fmtDateTime(v.event.created_at) })}</span>
      {isAuthor && th.status === 'open' && (
        complete ? <button type="button" class={latest ? 'btn primary' : 'btn secondary'} disabled={busy} onClick={submit}>{t('ds.submitThis', { n: v.n })}</button>
          : latest && <p class="small">{t('ds.notComplete')}</p>
      )}
      {msg && <p class="warnbox">{msg}</p>}
    </section>
  );
}

export function ThreadView({ id }: { id: string }) {
  const app = useApp();
  const s = app.dao!;
  const nameOf = useNameOf();
  const th = s.discussion.byId.get(id) ?? s.discussion.ofProposal.get(id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [shared, setShared] = useState(false);
  useEffect(() => {
    if (th) markSeen(app.daoId!, th.id);
  }, [th?.id, th?.lastActivity]);

  if (!th) {
    return (
      <>
        <Header />
        <main><p class="lead">{t('ds.notFound')}</p></main>
        <Footer />
      </>
    );
  }
  const isMember = !!app.me && !!app.secret && s.members.some(m => m.person === app.me!.person);
  const isAuthor = app.me?.person === th.author && !!app.secret;
  const latest = th.versions[th.versions.length - 1];
  const post = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      await signAndPublish(KIND.post, { text: text.trim() }, [['e', th.id]]);
      setText('');
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    if (!(await askConfirm(t('ds.withdrawConfirm'), t('ds.withdraw'), true))) return;
    try {
      await signAndPublish(KIND.withdraw, {}, [['e', th.id]]);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const link = `${app.site!.site.replace(/\/$/, '')}/#/d/${th.id}`;
  const share = async () => {
    const msgText = t('ds.shareText', { dao: app.site!.name, title: th.title, link });
    try {
      if (navigator.share) await navigator.share({ text: msgText });
      else {
        await navigator.clipboard.writeText(msgText);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <>
      <Header />
      <main>
        <a href="#/discussion" class="small" style="text-decoration:none">← {t('ds.title')}</a>
        <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">
          {th.proposal && <span class="mono small">{proposalLabel(app.site!.name, th.proposal.number)}</span>}
          <span class="chip">{chip(th, s.now)}</span>
        </div>
        <h1>{th.title}</h1>
        <p class="small">{t('ds.startedBy', { name: nameOf(s.keyOf(th.author)), date: fmtDateTime(th.created) })}</p>

        {th.proposal && (
          <a class="card tint" style="text-decoration:none;color:var(--teal-ink);gap:4px" href={`#/p/${th.proposal.event.id}`}>
            <span class="small">{th.submitted ? t('ds.submittedAs', { n: th.submitted.version }) : t('ds.proposalThread')}</span>
            <strong>{proposalLabel(app.site!.name, th.proposal.number)} · {statusText(th.proposal, s.now)} →</strong>
          </a>
        )}
        {th.submitted && !th.submitted.matches && <p class="warnbox">{t('ds.differs', { n: th.submitted.version })}</p>}
        {th.status === 'withdrawn' && <p class="note">{t('ds.withdrawnNote', { date: fmtDateTime(th.withdrawn!.created_at) })}</p>}

        {latest && <VersionCard v={latest} th={th} pinned />}

        {isAuthor && th.status === 'open' && (
          <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-start">
            <button type="button" class="btn secondary" onClick={() => go(`/d/${th.id}/version`)}>{t('ds.newVersion', { n: th.versions.length + 1 })}</button>
            <button type="button" class="btn link" onClick={withdraw}>{t('ds.withdraw')}</button>
          </div>
        )}
        <button type="button" class="btn secondary" onClick={share}>{shared ? t('home.copied') : t('ds.share')}</button>

        <h2>{t('ds.timeline')}</h2>
        {withReports(th, s).length === 0 && <p class="small">{t('ds.empty')}</p>}
        <div class="stack" style="gap:10px">
          {withReports(th, s).map(x => x.kind === 'report' ? (
            <div class="card tint" style="gap:4px">
              <span class="small"><strong>{t('ds.reportCard', { n: x.r.tranche })}</strong> · {nameOf(x.r.event.pubkey)} · {fmtDateTime(x.r.event.created_at)}{paidReport(x.r, th, s) ? ` · ${t('dl.st.paid')}` : ''}</span>
              <p style="white-space:pre-wrap;margin:0;overflow-wrap:anywhere">{linkify(x.r.text)}</p>
              {x.r.link && <a href={x.r.link} target="_blank" rel="noopener noreferrer">{t('pd.link')} ↗</a>}
            </div>
          ) : x.kind === 'version' ? (
            x.v === latest ? <p class="small">{t('ds.versionAt', { n: x.v.n, date: fmtDateTime(x.v.event.created_at) })} ↑</p> : <VersionCard v={x.v} th={th} />
          ) : (
            <div class="post">
              <span class="small"><strong>{nameOf(x.event.pubkey)}</strong> · {fmtDateTime(x.event.created_at)}</span>
              <p style="white-space:pre-wrap;margin:4px 0 0;overflow-wrap:anywhere">{linkify(JSON.parse(x.event.content).text)}</p>
            </div>
          ))}
        </div>

        {th.status === 'withdrawn' ? <p class="small">{t('ds.closedToPosts')}</p> : isMember && !s.closed ? (
          <div class="stack">
            <label class="field">
              {t('ds.reply')}
              <textarea maxLength={POST_MAX} value={text} style="font-family:inherit;font-size:16px" onInput={e => setText((e.target as HTMLTextAreaElement).value)} />
            </label>
            <button type="button" class="btn primary" disabled={!text.trim() || busy} onClick={post}>{t('ds.post')}</button>
          </div>
        ) : !s.closed && <p class="small">{t('ds.membersOnly')}</p>}
        {msg && <p class="warnbox">{msg}</p>}
      </main>
      <Footer />
    </>
  );
}

/** Plain text with web links made clickable; nothing else is interpreted. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((p, i) => (i % 2 === 1 ? <a href={p} target="_blank" rel="noopener noreferrer nofollow">{p}</a> : p));
}

type ThreadT = Thread;

/** The thread's entries with the proposal's delivery reports (4.6.3) among them, in time order. */
function withReports(th: ThreadT, s: DaoState) {
  const reports = th.proposal ? s.reports.get(th.proposal.event.id) ?? [] : [];
  const items = [
    ...timeline(th).map(x => ({ ...x, at: x.kind === 'version' ? x.v.event.created_at : x.event.created_at })),
    ...reports.map(r => ({ kind: 'report' as const, r, at: r.event.created_at })),
  ];
  return items.sort((a, b) => a.at - b.at);
}

/** Whether a round paid the tranche this report is for, after it. */
function paidReport(r: ReportView, th: ThreadT, s: DaoState) {
  const v = th.proposal ? s.payments.get(th.proposal.event.id)?.tranches?.[r.tranche - 1] : undefined;
  return v?.status === 'paid';
}

/** "Report 2 of 3", or "Report" on a payout with a requested report. */
function reportChip(th: ThreadT, s: DaoState) {
  const reports = th.proposal ? s.reports.get(th.proposal.event.id) ?? [] : [];
  if (!reports.length) return null;
  const of = (th.proposal!.content.payload.schedule as unknown[] | undefined)?.length;
  const n = Math.max(...reports.map(r => r.tranche));
  return <span class="chip teal">{of ? t('ds.reportChip', { n, of }) : t('ds.reportOne')}</span>;
}
