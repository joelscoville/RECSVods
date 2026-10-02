/** Plain-language help for sending chapter changes through GitHub: a first-visit intro, an account set-up
 * guide and the step-by-step send instructions. The pictures are simplified drawings of GitHub's pages
 * (GitHub blocks automated screenshots), with the thing to click ringed. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isMac } from '../lib/editor-keys';
import Icon from './Icon';

const READY_KEY = 'recs-chapter-editor:github-ready';
export const SIGNUP_URL = 'https://github.com/signup';

export function readGitHubReady(): boolean {
  try { return localStorage.getItem(READY_KEY) === '1'; } catch { return false; }
}
export function writeGitHubReady(): void {
  try { localStorage.setItem(READY_KEY, '1'); } catch { /* private window: ask again next time */ }
}

/* ---------- One step at a time ---------- */

export interface GuideStep {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  picture?: ReactNode;
}
export function StepByStep({ steps, step, onStep, finish, label, onExit }: {
  steps: GuideStep[]; step: number; onStep: (step: number) => void; finish?: ReactNode; label: string; onExit?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } heading.current?.focus(); }, [step]);
  const current = steps[step], last = step === steps.length - 1;
  return <section className="gs" aria-label={label}>
    <div className="gs-progress">
      <span>Step {step + 1} of {steps.length}</span>
      <span className="gs-dots" aria-hidden="true">{steps.map((_, i) => <span key={i} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} />)}</span>
    </div>
    <h3 className="gs-title" ref={heading} tabIndex={-1}>{current.title}</h3>
    {current.body && <p className="gs-body">{current.body}</p>}
    {current.action && <div className="gs-action">{current.action}</div>}
    {current.picture}
    <div className="gs-nav">
      {step > 0 || onExit ? <button type="button" className="button button-secondary" onClick={() => step > 0 ? onStep(step - 1) : onExit!()}>Back</button> : <span />}
      {last ? finish : <button type="button" className="button" onClick={() => onStep(step + 1)}>Next<Icon name="chevron" /></button>}
    </div>
  </section>;
}

/* ---------- Drawings of GitHub ---------- */

function Browser({ url, children }: { url: string; children: ReactNode }) {
  return <figure className="gh-pic" aria-hidden="true">
    <div className="gh-chrome"><span className="gh-lights"><i /><i /><i /></span><span className="gh-url">{url}</span></div>
    <div className="gh-page">{children}</div>
  </figure>;
}
const Target = ({ children }: { children: ReactNode }) => <span className="gh-target">{children}</span>;
const Lines = ({ count, selected = false }: { count: number; selected?: boolean }) => <div className={`gh-lines${selected ? ' is-selected' : ''}`}>
  {Array.from({ length: count }, (_, i) => <span key={i}><b>{i + 1}</b><i style={{ width: `${[62, 44, 70, 38, 56, 66, 30][i % 7]}%` }} /></span>)}
</div>;
function RepoHeader({ repo }: { repo: string }) {
  const [owner, name] = repo.split('/');
  return <div className="gh-repo"><svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.71 1.71.75.75 0 0 1-1.07 1.05A2.5 2.5 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.71A2.5 2.5 0 0 1 4.5 9h8Z" /></svg>
    <span>{owner}</span> / <strong>{name}</strong></div>;
}

export type Picture = 'signup' | 'signup-fields' | 'signup-button' | 'code' | 'fork' | 'paste' | 'commit' | 'propose' | 'pull-request';
export function GitHubPicture({ scene, repo = 'owner/project', file = 'service.yaml' }: { scene: Picture; repo?: string; file?: string }) {
  const mod = isMac() ? '⌘' : 'Ctrl';
  switch (scene) {
    case 'signup': case 'signup-fields': case 'signup-button':
      return <Browser url="github.com/signup">
        <div className="gh-form">
          <p className="gh-h">Sign up for GitHub</p>
          {scene === 'signup-fields' ? <Target><Fields /></Target> : <Fields />}
          {scene === 'signup-button' ? <Target><span className="gh-btn gh-green gh-wide">Create account ›</span></Target> : <span className="gh-btn gh-green gh-wide">Create account ›</span>}
        </div>
      </Browser>;
    case 'code':
      return <div className="gh-pair" aria-hidden="true">
        <div className="gh-mail"><p className="gh-mail-from"><Icon name="send" /> From: GitHub</p><p>Your GitHub launch code</p><p className="gh-code">1234 5678</p></div>
        <span className="gh-arrow">→</span>
        <Browser url="github.com/account_verifications">
          <div className="gh-form"><p className="gh-h">Confirm your email address</p><Target><span className="gh-digits">{'12345678'.split('').map((d, i) => <i key={i}>{d}</i>)}</span></Target></div>
        </Browser>
      </div>;
    case 'fork':
      return <Browser url={`github.com/${repo}/edit/main/…/${file}`}>
        <RepoHeader repo={repo} />
        <div className="gh-center"><p>You need to fork this repository to propose changes.</p><Target><span className="gh-btn gh-green">Fork this repository</span></Target></div>
      </Browser>;
    case 'paste':
      return <Browser url={`github.com/${repo}/edit/main/…/${file}`}>
        <div className="gh-bar"><RepoHeader repo={repo} /><span className="gh-file">{file}</span><span className="gh-spacer" /><span className="gh-btn gh-green">Commit changes…</span></div>
        <div className="gh-editor"><Lines count={7} selected />
          <div className="gh-keys"><span className="ce-key">{mod}</span>+<span className="ce-key">A</span><span className="gh-then">then</span><span className="ce-key">{mod}</span>+<span className="ce-key">V</span></div></div>
      </Browser>;
    case 'commit':
      return <Browser url={`github.com/${repo}/edit/main/…/${file}`}>
        <div className="gh-bar"><RepoHeader repo={repo} /><span className="gh-file">{file}</span><span className="gh-spacer" /><span className="gh-btn">Cancel changes</span><Target><span className="gh-btn gh-green">Commit changes…</span></Target></div>
        <div className="gh-editor"><Lines count={5} /></div>
      </Browser>;
    case 'propose':
      return <Browser url={`github.com/${repo}/edit/main/…/${file}`}>
        <div className="gh-dialog"><p className="gh-h">Propose changes</p>
          <span className="gh-label">Commit message</span><span className="gh-input">Update {file}</span>
          <span className="gh-label">Extended description</span><span className="gh-input gh-tall">(optional)</span>
          <div className="gh-row"><span className="gh-btn">Cancel</span><Target><span className="gh-btn gh-green">Propose changes</span></Target></div></div>
      </Browser>;
    case 'pull-request':
      return <Browser url={`github.com/${repo}/compare/…`}>
        <p className="gh-h">Comparing changes</p>
        <p className="gh-ok">✓ Able to merge.</p>
        <div className="gh-row gh-row-start"><Target><span className="gh-btn gh-green">Create pull request</span></Target></div>
        <Lines count={3} />
      </Browser>;
  }
}
function Fields() {
  return <span className="gh-fields">
    <span className="gh-label">Email</span><span className="gh-input">you@example.com</span>
    <span className="gh-label">Password</span><span className="gh-input">••••••••••</span>
    <span className="gh-label">Username</span><span className="gh-input">your-name</span>
  </span>;
}

/* ---------- Setting up an account ---------- */

export function SetupGuide({ onDone, onExit, doneLabel = 'I have my account now' }: { onDone: () => void; onExit?: () => void; doneLabel?: string }) {
  const [step, setStep] = useState(0);
  const steps: GuideStep[] = [
    { title: 'Open GitHub’s sign-up page.', body: 'It opens in a new tab. Come back to this tab after each step.',
      action: <a className="button" href={SIGNUP_URL} target="_blank" rel="noopener noreferrer">Open GitHub sign-up<Icon name="external" /></a>,
      picture: <GitHubPicture scene="signup" /> },
    { title: 'Type your email, a password and a username.', body: 'Pick any username. People will see it next to your changes.',
      picture: <GitHubPicture scene="signup-fields" /> },
    { title: 'Click the green button.', body: 'GitHub may show a short puzzle to check you are a person. Follow what it says.',
      picture: <GitHubPicture scene="signup-button" /> },
    { title: 'Check your email and type in the code.', body: 'GitHub sends a code to your email. It can take a minute. Check your spam folder too.',
      picture: <GitHubPicture scene="code" /> },
    { title: 'Done! You have a GitHub account.', body: 'If GitHub asks more questions, you can skip them. Now come back to this tab.' },
  ];
  return <StepByStep label="Set up a GitHub account" steps={steps} step={step} onStep={setStep} onExit={onExit}
    finish={<button type="button" className="button" onClick={onDone}>{doneLabel}</button>} />;
}

/* ---------- First visit ---------- */

export function GitHubIntro({ title, subtitle, backHref, onReady }: { title: string; subtitle: string; backHref: string; onReady: () => void }) {
  const [guide, setGuide] = useState(false);
  const ready = () => { writeGitHubReady(); onReady(); };
  return <div className="ce-root gi">
    <header className="ce-bar"><a className="ce-back" href={backHref} aria-label="Back to the recording"><Icon name="back" /></a>
      <div className="ce-bar-title"><h1>{title}</h1><p>{subtitle}</p></div></header>
    <div className="gi-card">
      {guide ? <>
        <h2>Make a free GitHub account</h2>
        <SetupGuide onDone={ready} onExit={() => setGuide(false)} />
      </> : <>
        <h2>Before you start</h2>
        <ol className="gi-points">
          <li><Icon name="pencil" /><div><strong>You fix the chapters here.</strong><span>Watch the video and move, add or rename chapters.</span></div></li>
          <li><Icon name="send" /><div><strong>Then you send them through GitHub.</strong><span>GitHub is a free website that keeps this archive’s files. You need a free account there.</span></div></li>
          <li><Icon name="person" /><div><strong>A person checks your changes.</strong><span>Nothing on this site changes until they say yes.</span></div></li>
        </ol>
        <div className="gi-actions">
          <button type="button" className="button" onClick={ready}>I have a GitHub account</button>
          <button type="button" className="button button-secondary" onClick={() => setGuide(true)}>Help me make one</button>
        </div>
        <button type="button" className="text-link gi-skip" onClick={ready}>Just look around first</button>
      </>}
    </div>
  </div>;
}

/* ---------- Sending ---------- */

export function SendSteps({ repo, file, onCopy, onOpen, onDownload, onAccount, copied, finish }: {
  repo: string; file: string; onCopy: () => void; onOpen: () => void; onDownload: () => void; onAccount: () => void;
  copied: 'copied' | 'blocked' | undefined; finish: ReactNode;
}) {
  const [step, setStep] = useState(0);
  const mod = isMac() ? 'Cmd' : 'Ctrl';
  const copyAgain = <button type="button" className="text-link" onClick={onCopy}>Copy again</button>;
  const steps: GuideStep[] = [
    { title: 'Copy your changes.',
      action: <button type="button" className="button" onClick={onCopy}><Icon name={copied === 'copied' ? 'check' : 'copy'} />{copied === 'copied' ? 'Copied' : 'Copy my changes'}</button>,
      body: copied === 'blocked' ? <span role="alert">Your browser blocked copying. <button type="button" className="text-link" onClick={onDownload}>Download the file</button>, open it, and copy everything in it.</span> : undefined },
    { title: 'Open the file on GitHub.', body: <>It opens in a new tab. Sign in if GitHub asks. {copyAgain}</>,
      action: <button type="button" className="button" onClick={onOpen}>Open GitHub<Icon name="external" /></button> },
    { title: <>Does GitHub say “fork this repository”? Click the green button.</>, body: 'This makes your own copy of the archive. You only do this once. Didn’t see it? Click Next.',
      picture: <GitHubPicture scene="fork" repo={repo} file={file} /> },
    { title: <>Click inside the text. Press {mod}+A, then {mod}+V.</>, body: <>This swaps the old text for your changes. {copyAgain}</>,
      picture: <GitHubPicture scene="paste" repo={repo} file={file} /> },
    { title: 'Click Commit changes… (top right).', picture: <GitHubPicture scene="commit" repo={repo} file={file} /> },
    { title: 'Click Propose changes.', body: 'You can add a note for the person who checks it first.', picture: <GitHubPicture scene="propose" repo={repo} file={file} /> },
    { title: 'Click Create pull request. Then click it once more.', picture: <GitHubPicture scene="pull-request" repo={repo} file={file} /> },
    { title: 'Done. Thank you!', body: 'A person will look at your changes. GitHub emails you when they do.' },
  ];
  // Moving on after copying keeps the first step to one click.
  const onStep = (next: number) => setStep(next);
  useEffect(() => { if (copied === 'copied') setStep(value => value === 0 ? 1 : value); }, [copied]);
  return <>
    <StepByStep label="Send your changes" steps={steps} step={step} onStep={onStep} finish={finish} />
    {step < 2 && <p className="ce-muted ce-account-link">No GitHub account yet? <button type="button" className="text-link" onClick={onAccount}>Make one</button></p>}
  </>;
}
