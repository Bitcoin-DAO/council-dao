// Members' badges, "learning by doing" (docs/proposals/badges.md 1.2): an onboarding path of four tasks done for
// real. Shown only to the member themselves (Profile, Home), never beside names on the Members page. On Home it sits
// below the donation card, for information: the Wallet card at the top is the one thing flagged.
import { useApp } from '../app';
import { badgesOf, BADGES, type Badge } from '../core/badges';
import type { DaoState } from '../core/state';
import { fmtDate, t } from '../i18n';
import { ShareToGroup, go, pageLink } from './parts';


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
      {earned > 0 && !s.closed && (
        <ShareToGroup text={t('badges.shareText', { dao: app.site!.name, name: app.me!.name, names: badges.filter(b => b.at).map(b => t(`badges.${b.id}` as any)).join(', '), link: pageLink('/') })} />
      )}
    </div>
  );
}

/**
 * Home: information only. The four badges and the next step, worked out afresh at every load, until all four are
 * earned. No buttons: the Wallet card at the top is the one thing to act on, and Profile has the details and Share.
 */
export function BadgesHome() {
  const app = useApp();
  const x = useBadges();
  if (!x || !app.secret || x.s.closed) return null;
  const { badges } = x;
  const earned = badges.filter(b => b.at).length;
  if (earned === BADGES.length) return null;
  const next = badges.find(b => !b.at)!;
  return (
    <section class="card" id="badges-home">
      <h2>{t('badges.title')} <span class="small">{t('badges.count', { k: earned, n: BADGES.length })}</span></h2>
      <ul class="badges inline">
        {badges.map(b => <li class={b.at ? 'badge earned' : 'badge'} key={b.id}>{t(`badges.${b.id}` as any)}</li>)}
      </ul>
      <p class="small">
        <b>{t('badges.next', { name: t(`badges.${next.id}` as any) })}</b>{' · '}
        {t(`badges.${next.id}${next.waiting ? 'Waiting' : 'Task'}` as any)}
      </p>
      <p class="small"><a href="#/profile">{t('badges.profileLink')}</a></p>
    </section>
  );
}
