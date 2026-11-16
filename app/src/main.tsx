import { Component, render, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import './styles.css';
import { init, useApp } from './app';
import { t } from './i18n';
import { Home } from './ui/Home';
import { Join } from './ui/Join';
import { Founder } from './ui/Founder';
import { Setup } from './ui/Setup';
import { Restore } from './ui/Restore';
import { Profile } from './ui/Profile';
import { Members } from './ui/Members';
import { Rules } from './ui/Rules';
import { Header } from './ui/parts';
import { ProposalDetail, Proposals } from './ui/Proposals';
import { NewProposal } from './ui/NewProposal';
import { History } from './ui/History';
import { Confirm } from './ui/Confirm';
import { Candidate } from './ui/Candidate';
import { Sponsor } from './ui/Sponsor';
import { Council } from './ui/Council';
import { PrepareRound, RoundDetail, SweepRound } from './ui/Round';
import { DiscussionList, NewIdea, ThreadView } from './ui/Discussion';
import { QrTest } from './ui/Hw';

const routes: Record<string, () => preact.JSX.Element> = {
  '/': Home,
  '/join': Join,
  '/founder': Founder,
  '/setup': Setup,
  '/restore': Restore,
  '/profile': Profile,
  '/members': Members,
  '/rules': Rules,
  '/history': History,
  '/proposals': Proposals,
  '/new': NewProposal,
  '/sponsor': Sponsor,
  '/sweep': SweepRound,
  '/council': Council,
  '/round/new': PrepareRound,
  '/discussion': DiscussionList,
  '/discussion/new': NewIdea,
  '/qrtest': QrTest,
  '/candidate': () => <Candidate role="candidate" />,
  '/lost': () => <Candidate role="rekey" />,
};

const currentPath = () => location.hash.replace(/^#/, '') || '/';

/** Pages that make sense before the DAO is founded; any other link opened then shows how to join (review U-8). */
const BEFORE_FOUNDING = new Set(['/', '/join', '/founder', '/setup', '/restore', '/qrtest', '/history']);

/** A page that still throws shows a message and a way back, never a blank screen. */
class Guard extends Component<{ children: ComponentChildren; path: string }, { failed?: string }> {
  state: { failed?: string } = {};
  componentDidCatch(e: unknown) {
    this.setState({ failed: String((e as Error)?.message ?? e) });
  }
  componentDidUpdate(prev: { path: string }) {
    if (prev.path !== this.props.path && this.state.failed) this.setState({ failed: undefined });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div class="app">
        <Header />
        <main>
          <p class="warnbox">{t('error.page', { msg: this.state.failed })}</p>
          <button type="button" class="btn secondary" onClick={() => { this.setState({ failed: undefined }); location.hash = '#/'; }}>{t('error.toHome')}</button>
        </main>
      </div>
    );
  }
}

function App() {
  const app = useApp();
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    document.documentElement.lang = app.lang;
  }, [app.lang]);
  useEffect(() => {
    if (app.site) document.title = app.site.name;
  }, [app.site?.name]);

  if (app.loadError) {
    return (
      <div class="app">
        <Header />
        <main>
          <p class="warnbox">{t('error.load', { msg: app.loadError })}</p>
          <button type="button" class="btn secondary" onClick={() => location.reload()}>{t('retry')}</button>
        </main>
      </div>
    );
  }
  if (app.loading || !app.site) {
    return (
      <div class="app">
        <Header />
        <main><p class="small" aria-busy="true">{t('loading')}</p></main>
      </div>
    );
  }
  // Before the founding, only the founding pages; any other link shows how to join (review U-8).
  if (!app.daoId && !BEFORE_FOUNDING.has(path)) return <Guard path={path}><div class="app"><Join /></div></Guard>;
  const param = path.match(/^\/(p|confirm|round)\/([0-9a-f]{64})$/);
  if (param) {
    const [, kind, id] = param;
    return <Guard path={path}><div class="app">{kind === 'p' ? <ProposalDetail id={id} /> : kind === 'confirm' ? <Confirm id={id} /> : <RoundDetail id={id} />}</div></Guard>;
  }
  const thread = path.match(/^\/d\/([0-9a-f]{64})(\/version)?$/);
  if (thread) return <Guard path={path}><div class="app">{thread[2] ? <NewProposal draftId={thread[1]} /> : <ThreadView id={thread[1]} />}</div></Guard>;
  const Screen = routes[path] ?? Home;
  return <Guard path={path}><div class="app"><Screen /></div></Guard>;
}

render(<App />, document.getElementById('root')!);
void init();
