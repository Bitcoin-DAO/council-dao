// DAO history (spec "DAO history"): the changes that shape what the DAO is, newest first, each derived from
// signed, endorsed records the app already rebuilds. Opened from the footer.
// Listing entries (address moved, software upgraded, listed) wait for dao.listing, which is not read yet.
import type { ComponentChildren } from 'preact';
import { chainApis, useApp } from '../app';
import { fmtDate, t } from '../i18n';
import { explorerFor } from '../core/chain';
import { stageOf, type CouncilEntry } from '../core/config';
import { proposalLabel, type DaoState, type ProposalView, type SettingsContent } from '../core/state';
import { Footer, Header } from './parts';
import { ruleLabel, ruleValue, useNameOf } from './Proposals';

interface Entry {
  at: number;
  title: string;
  flagged?: boolean;
  body: ComponentChildren;
  proposals: ProposalView[];
}

export function History() {
  const app = useApp();
  const s = app.dao;
  const nameOf = useNameOf();
  if (!s?.founded) {
    return (
      <>
        <Header />
        <main><p class="lead">{t('hist.none')}</p></main>
        <Footer />
      </>
    );
  }
  const dao = app.site!.name;
  const cfg = s.founded.config;
  const stage = stageOf(cfg);
  const explorer = explorerFor(chainApis());
  const tx = (txid: string) => <a class="mono small" href={`${explorer}/tx/${txid}`} target="_blank" rel="noopener">{txid.slice(0, 12)}…</a>;
  const entries = historyOf(s, nameOf, tx);
  const label = (p: ProposalView) => `${proposalLabel(dao, p.number)} · ${p.content.title}`;

  return (
    <>
      <Header />
      <main>
        <h1>{t('hist.title', { dao })}</h1>
        {stage !== 'mainnet' && <p class="warnbox">{t(stage === 'practice' ? 'hist.practice' : 'hist.testnet')}</p>}
        <p class="small">{t('hist.intro')}</p>
        {entries.map(e => (
          <section class={e.flagged ? 'card warn' : 'card'}>
            <div class="row" style="align-items:baseline">
              <h3 style="margin:0">{e.title}</h3>
              <span class="small">{fmtDate(e.at)}</span>
            </div>
            {e.body}
            {e.proposals.map(p => <a class="small" href={`#/p/${p.event.id}`}>{label(p)}</a>)}
            <span class="small">{t('hist.counts', { members: s.rosterAt(e.at).content.members.length, council: s.settingsAt(e.at).content.council.length })}</span>
          </section>
        ))}
      </main>
      <Footer />
    </>
  );
}

const fp = (c: CouncilEntry) => `${c.label} (${c.fingerprint})`;

/** The entries, newest first. */
function historyOf(s: DaoState, nameOf: (k: string) => string, tx: (txid: string) => ComponentChildren): Entry[] {
  const g = s.founded!;
  const cfg = g.config;
  const out: Entry[] = [];
  const at0 = g.effectiveAt ?? g.event.created_at;
  out.push({
    at: at0,
    title: t('hist.founded'),
    proposals: [],
    body: (
      <div class="stack" style="gap:4px">
        <span class="small">{t('hist.council', { list: cfg.council.map(fp).join(', '), m: cfg.threshold, n: cfg.council.length })}</span>
        {(cfg.founders ?? []).length > 0 && <span class="small">{t('hist.founders', { list: (cfg.founders ?? []).map(f => f.name).join(', ') })}</span>}
        {modelKnown(cfg.rules.fundingModel) && <span class="small">{t('hist.model', { model: modelName(cfg.rules.fundingModel) })}</span>}
        <span class="small">{t('hist.stage', { stage: t(`stage.${stageOf(cfg)}` as 'stage.mainnet') })}</span>
      </div>
    ),
  });

  for (let i = 1; i < s.settings.length; i++) {
    const v = s.settings[i];
    const prev = s.settings[i - 1].content;
    const c = v.content;
    const basis = c.basis ?? [];
    const props = basis.map(id => s.proposals.find(p => p.event.id === id)).filter((p): p is ProposalView => !!p);
    const roundOf = (p: ProposalView) => s.rounds.find(r => r.receipt && r.content.proposals.includes(p.event.id));
    const at = v.effectiveAt;

    if (c.closed && !prev.closed) {
      const p = props.find(x => x.content.type === 'close');
      const r = p && roundOf(p);
      out.push({
        at, title: t('hist.closed'), proposals: p ? [p] : [],
        body: (
          <div class="stack" style="gap:4px">
            {p && <span class="small mono" style="overflow-wrap:anywhere">→ {p.content.payload.destination}</span>}
            {r?.inspection && <span class="small">{t('hist.tx')} {tx(r.inspection.txid)}</span>}
          </div>
        ),
      });
      continue;
    }

    if (c.descriptor !== prev.descriptor || c.threshold !== prev.threshold) {
      const p = props.find(x => x.content.type === 'change_council');
      const r = p && roundOf(p);
      const left = prev.council.filter(x => !c.council.some(y => y.xpub === x.xpub));
      const joined = c.council.filter(x => !prev.council.some(y => y.xpub === x.xpub));
      const pl = p?.content.payload;
      const sameKey = pl && pl.in_key && pl.out_key && s.personOf(pl.in_key) === s.personOf(pl.out_key);
      out.push({
        at, title: t('hist.councilChanged'), proposals: p ? [p] : [],
        body: (
          <div class="stack" style="gap:4px">
            {pl && <span class="small">{t('cc.reason')}: {t(`cc.r.${pl.reason}` as 'cc.r.lost_key')}</span>}
            {sameKey ? (
              <span class="small">{t('hist.newKey', { name: nameOf(pl!.in_key), from: left.map(x => x.fingerprint).join(', '), to: joined.map(x => x.fingerprint).join(', ') })}</span>
            ) : (
              <>
                {left.length > 0 && <span class="small">{t('hist.left', { list: left.map(fp).join(', ') })}</span>}
                {joined.length > 0 && <span class="small">{t('hist.joined', { list: joined.map(fp).join(', ') })}</span>}
              </>
            )}
            <span class="small">{t('hist.threshold', { from: `${prev.threshold}/${prev.council.length}`, to: `${c.threshold}/${c.council.length}` })}</span>
            {r?.inspection && <span class="small">{t('hist.migration')} {tx(r.inspection.txid)}</span>}
          </div>
        ),
      });
    }

    const changed = Object.keys({ ...prev.rules, ...c.rules }).filter(k => JSON.stringify((prev.rules as any)[k]) !== JSON.stringify((c.rules as any)[k]));
    const p = props.find(x => x.content.type === 'change_rules');
    if (changed.includes('fundingModel')) {
      out.push({
        at, title: t('hist.modelChanged'), proposals: p ? [p] : [],
        body: <span class="small">{t('hist.fromTo', { from: modelName(prev.rules.fundingModel), to: modelName(c.rules.fundingModel) })}</span>,
      });
    }
    const rest = changed.filter(k => k !== 'fundingModel' && k !== 'charterLanguage');
    if (rest.length) {
      out.push({
        at, title: t('hist.rulesChanged'), proposals: p ? [p] : [],
        body: (
          <div class="stack" style="gap:4px">
            {rest.map(k => k === 'charterSha256' ? (
              <span class="small">{t('hist.charter', { hash: c.rules.charterSha256.slice(0, 16), lang: c.rules.charterLanguage ?? 'en' })}</span>
            ) : (
              <span class="small">{ruleLabel(k)}: {t('hist.fromTo', { from: ruleValue(k, (prev.rules as any)[k]), to: ruleValue(k, (c.rules as any)[k]) })}</span>
            ))}
          </div>
        ),
      });
    }
  }

  // A disputed version stays flagged at the top until the council resolves it.
  if (s.settingsDisputed || s.rosterDisputed) {
    out.push({ at: s.now, title: t('hist.disputed'), flagged: true, proposals: [], body: <span class="small">{t(s.settingsDisputed ? 'hist.disputedSettings' : 'hist.disputedRoster')}</span> });
  }
  return out.sort((a, b) => b.at - a.at);
}

const MODELS = ['grant', 'production', 'mutual', 'revolving'];
/** A site file may still hold the template's placeholder, or a model this version does not know. */
const modelKnown = (m: unknown) => typeof m === 'string' && MODELS.includes(m);
const modelName = (m: SettingsContent['rules']['fundingModel']) => (modelKnown(m) ? t(`fm.${m}` as 'fm.grant') : m ? String(m) : '—');
