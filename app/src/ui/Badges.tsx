// Members' badges, "learning by doing" (docs/proposals/badges.md 1.2): an onboarding path of four tasks done for
// real. Shown only to the member themselves (Profile, Home), never beside names on the Members page.
import { useState } from 'preact/hooks';
import { useApp } from '../app';
import { badgesOf, BADGES, type Badge, type BadgeId } from '../core/badges';
import type { DaoState } from '../core/state';
import { fmtDate, t } from '../i18n';
import { ShareToGroup, go, pageLink } from './parts';

const seenKey = (daoId: string, person: string) => `btc-dao:badges-seen:${daoId}:${person}`;
const readSeen = (k: string): BadgeId[] => {
  try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; }
};
const writeSeen = (k: string, ids: BadgeId[]) => {
  try { localStorage.setItem(k, JSON.stringify(ids)); } catch { /* private window: the note shows again, no harm */ }
};
const hiddenKey = (daoId: string, person: string) => `btc-dao:badge-next-hidden:${daoId}:${person}`;

function useBadges(): { s: DaoState; person: string; badges: Badge[] } | undefined {
  const app = useApp();
  const s = app.dao;
  if (!s?.founded || !app.me) return;
  return { s, person: app.me.person, badges: badgesOf(s, app.me.person) };
}

const ref = (b: Badge) => (b.proposal ? `#${b.proposal.number} «${b.proposal.title}»` : '');

/** Profile: the four badges, each with how to earn it or what earned it. */
export function BadgesCard() {
  const app = useApp();
  const x = useBadges();
  if (!x) return null;
  const { s, badges } = x;
  const earned = badges.filter(b => b.at).length;
  const standingNow = !!s.standingAt(app.me!.key, s.now);
  return (
    <div class="card" id="badges">
      <h3>{t('badges.title')} <span class="small">{t('badges.count', { k: earned, n: BADGES.length })}</span></h3>
      <p class="small">{t('badges.text')}</p>
      <ul class="badges">
        {badges.map(b => (
          <li class={b.at ? 'badge earned' : 'badge'} key={b.id}>
            <b>{t(`badges.${b.id}` as any)}</b>
            {b.at ? (
              <span class="small">{t(`badges.${b.id}Done` as any, { ref: ref(b), date: fmtDate(b.at) })}</span>
            ) : b.waiting ? (
              <span class="small">{t(`badges.${b.id}Waiting` as any)}</span>
            ) : (
              <span class="small">{t(`badges.${b.id}Task` as any)}</span>
            )}
            {b.id === 'wallet' && b.at && !standingNow && <span class="small warn">{t('badges.walletLapsed')}</span>}
            {!b.at && !b.waiting && b.id !== 'wallet' && !s.closed && app.secret && (
              <button type="button" class="btn link" onClick={() => go(b.id === 'proposer' ? '/new' : '/proposals')}>{t(`badges.${b.id}Go` as any)}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Home: a note the first time this phone sees a badge earned, with a Share button for the group; then the next
 * badge to work on, when there is something to do for it now. The Wallet badge's own card is the flagged one above.
 */
export function BadgesHome() {
  const app = useApp();
  const x = useBadges();
  const [, redraw] = useState(0);
  if (!x || !app.secret || x.s.closed) return null;
  const { s, person, badges } = x;
  const daoId = s.founded!.daoId;
  const kSeen = seenKey(daoId, person);
  const seen = readSeen(kSeen);
  const fresh = badges.filter(b => b.at && !seen.includes(b.id));
  if (fresh.length) {
    const names = fresh.map(b => t(`badges.${b.id}` as any)).join(', ');
    const dismiss = () => { writeSeen(kSeen, [...seen, ...fresh.map(b => b.id)]); redraw(n => n + 1); };
    return (
      <section class="card flag" id="badge-earned">
        <h2><span class="sq" aria-hidden="true" />{t(fresh.length > 1 ? 'badges.earnedMany' : 'badges.earned', { names })}</h2>
        <p class="small">{t('badges.earnedText', { k: badges.filter(b => b.at).length, n: BADGES.length })}</p>
        <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">
          <ShareToGroup text={t('badges.shareText', { dao: app.site!.name, name: app.me!.name, names, link: pageLink('/') })} />
          <button type="button" class="btn link" onClick={dismiss}>{t('badges.ok')}</button>
        </div>
      </section>
    );
  }
  // The Wallet card on Home already asks for badge 1.
  if (!badges[0].at) return null;
  const openVote = s.proposals.find(p => p.status === 'open' && p.eligible.has(person) && !p.votes.has(person));
  const openBounty = s.proposals.find(p => p.status === 'passed' && p.content.payload.bounty === true
    && !['paid', 'lapsed'].includes(s.payments.get(p.event.id)?.status ?? '')
    && !(s.claims.get(p.event.id) ?? []).some(c => c.person === person));
  const doable = (b: Badge) => !b.at && !b.waiting && (b.id === 'voice' ? !!openVote : b.id === 'builder' ? !!openBounty : b.id === 'proposer');
  const next = badges.find(doable);
  const kHidden = hiddenKey(daoId, person);
  let hidden: string | null = null;
  try { hidden = localStorage.getItem(kHidden); } catch { /* shown */ }
  if (!next || hidden === next.id) return null;
  const hide = () => { try { localStorage.setItem(kHidden, next.id); } catch { /* */ } redraw(n => n + 1); };
  const target = next.id === 'voice' ? `/p/${openVote!.event.id}` : next.id === 'proposer' ? '/new' : `/p/${openBounty!.event.id}`;
  return (
    <section class="card" id="badge-next">
      <h3><span class="sq" aria-hidden="true" />{t('badges.next', { name: t(`badges.${next.id}` as any) })}</h3>
      <p class="small">{t(`badges.${next.id}Next` as any, { title: next.id === 'voice' ? openVote!.content.title : next.id === 'builder' ? openBounty!.content.title : '' })}</p>
      <div class="row" style="justify-content:flex-start;gap:8px">
        <button type="button" class="btn primary" onClick={() => go(target)}>{t(`badges.${next.id}Go` as any)}</button>
        <button type="button" class="btn link" onClick={hide}>{t('badges.notNow')}</button>
      </div>
      <span class="small">{t('badges.seeAll')} <a href="#/profile">{t('badges.profileLink')}</a></span>
    </section>
  );
}
