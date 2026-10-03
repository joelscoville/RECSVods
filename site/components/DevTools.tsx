/** The hidden /dev page: switches and checks for people working on the site. It is unlisted, not private:
 * it only shows what this browser holds and what is already public in the GitHub repository. Add a
 * section by writing a component and listing it in SECTIONS. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  measuredPerformanceMode, PERFORMANCE_EVENT, PERFORMANCE_KEY, readPerformanceOverride, writePerformanceOverride,
  type PerformanceMode, type PerformanceOverride,
} from '../lib/performance-mode';
import { usePerformanceMode } from '../lib/use-performance-mode';
import { semanticAssetsCached, semanticCacheName, SEMANTIC_INSTALL_BYTES } from '../lib/semantic-assets';
import { correctionConfig, validateRepositoryUrl } from '../lib/corrections';
import { githubEditUrl, SOURCE_BRANCH } from '../lib/recording-editor';
import { loadArchiveFromGitHub, setShowUnapproved, showUnapproved, type LoadedArchive, type LoadedRecording } from '../lib/github-archive';
import { displayRecordings } from '../lib/display';
import { youtubeAt } from './YouTubePlayer';
import { formatTimecode } from '../lib/timecode';
import { formatDate, serviceUrl } from '../lib/urls';

interface Props { base: string; mode: 'production' | 'preview'; dev: boolean }

const SECTIONS: { id: string; title: string; render: (props: Props) => ReactNode }[] = [
  { id: 'switches', title: 'Switches', render: () => <Switches /> },
  { id: 'browser', title: 'This browser', render: props => <BrowserStatus {...props} /> },
  { id: 'unapproved', title: 'Waiting for approval', render: props => <Unapproved {...props} /> },
  { id: 'storage', title: 'Saved in this browser', render: () => <SavedData /> },
  { id: 'build', title: 'This build', render: props => <BuildInfo {...props} /> },
];

export default function DevTools(props: Props) {
  return <div className="dev">
    <header className="dev-head">
      <h1>Developer tools</h1>
      <p>Hidden page for checking the site. Switches only affect this browser.</p>
      <nav aria-label="Sections"><ul>{SECTIONS.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ul></nav>
    </header>
    {SECTIONS.map(section => <section key={section.id} id={section.id} className="dev-section" aria-labelledby={`${section.id}-title`}>
      <h2 id={`${section.id}-title`}>{section.title}</h2>
      {section.render(props)}
    </section>)}
  </div>;
}

/* ---------- Switches ---------- */

function Choice<T extends string>({ label, hint, value, options, onChange }: {
  label: string; hint: string; value: T; options: [T, string][]; onChange: (value: T) => void;
}) {
  return <fieldset className="dev-choice">
    <legend>{label}</legend>
    <div className="dev-segmented">{options.map(([option, text]) => <label key={option} className={value === option ? 'is-on' : ''}>
      <input type="radio" name={label} value={option} checked={value === option} onChange={() => onChange(option)} />{text}</label>)}</div>
    <p className="dev-hint">{hint}</p>
  </fieldset>;
}

function Switches() {
  const [override, setOverride] = useState<PerformanceOverride>({});
  const [unapproved, setUnapproved] = useState(false);
  useEffect(() => { setOverride(readPerformanceOverride()); setUnapproved(showUnapproved()); }, []);
  const change = (next: PerformanceOverride) => { writePerformanceOverride(next); setOverride(readPerformanceOverride()); };
  return <>
    <Choice label="Recordings waiting for approval" hint="On adds an “Unapproved” category to the home page, loaded live from GitHub. They open in a dev-only player; nothing is published."
      value={unapproved ? 'on' : 'off'} options={[['off', 'Hidden'], ['on', 'On the home page']]}
      onChange={value => { setShowUnapproved(value === 'on'); setUnapproved(value === 'on'); }} />
    <Choice label="Search model download" hint="Block acts like Data Saver. Allow skips the connection check (a download that is too slow still stops)."
      value={override.data ?? 'auto'} options={[['auto', 'Automatic'], ['normal', 'Allow'], ['save-data', 'Block']]}
      onChange={value => change({ ...override, data: value === 'auto' ? undefined : value })} />
    <Choice label="Device speed" hint="Slow turns meaning-based search off, as on a slow phone."
      value={override.compute ?? 'auto'} options={[['auto', 'Automatic'], ['normal', 'Fast'], ['low-compute', 'Slow']]}
      onChange={value => change({ ...override, compute: value === 'auto' ? undefined : value })} />
    <p className="dev-hint">Other pages pick these up when they load. While any switch is on, a “Dev settings on” badge shows on every page.</p>
    <button type="button" className="button button-secondary" disabled={!override.data && !override.compute && !unapproved}
      onClick={() => { setShowUnapproved(false); setUnapproved(false); change({}); }}>Turn every switch off</button>
  </>;
}

/* ---------- This browser ---------- */

type Connection = { saveData?: boolean; effectiveType?: string; rtt?: number; downlink?: number };
const describeMode = (mode: PerformanceMode) => `${mode.data === 'save-data' ? 'Saving data' : mode.data === 'normal' ? 'Normal data' : 'Data not checked yet'} · ${
  mode.compute === 'low-compute' ? 'slow device' : mode.compute === 'normal' ? 'fast device' : 'device not checked yet'}`;
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function BrowserStatus({ base }: Props) {
  const mode = usePerformanceMode();
  const [measured, setMeasured] = useState<PerformanceMode>();
  const [worker, setWorker] = useState<string>('Checking…');
  const [storage, setStorage] = useState<string>('Checking…');
  const [cached, setCached] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const connection = (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: Connection }).connection);

  const refresh = useCallback(async () => {
    setMeasured(measuredPerformanceMode());
    setCached(await semanticAssetsCached(base).catch(() => false));
    const registration = await navigator.serviceWorker?.getRegistration(base).catch(() => undefined);
    setWorker(!navigator.serviceWorker ? 'Not supported' : registration ? `Installed${navigator.serviceWorker.controller ? ', controlling this page' : ''}` : 'Not installed');
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
    setStorage(estimate?.usage !== undefined ? `${megabytes(estimate.usage)} used` : 'Unknown');
  }, [base]);
  useEffect(() => {
    void refresh();
    const again = () => { void refresh(); };
    window.addEventListener(PERFORMANCE_EVENT, again); window.addEventListener('recs-semantic-cache-change', again);
    return () => { window.removeEventListener(PERFORMANCE_EVENT, again); window.removeEventListener('recs-semantic-cache-change', again); };
  }, [refresh]);

  const forget = () => { try { sessionStorage.removeItem(PERFORMANCE_KEY); } catch { /* nothing stored */ } void refresh(); };
  const removeModel = async () => {
    setBusy(true);
    try {
      await caches.delete(semanticCacheName(base));
      const registration = await navigator.serviceWorker?.getRegistration(base);
      await registration?.unregister();
      document.documentElement.dataset.semanticCached = 'false';
      window.dispatchEvent(new Event('recs-semantic-cache-change'));
    } finally { setBusy(false); void refresh(); }
  };

  return <>
    <dl className="dev-facts">
      <dt>Data Saver</dt><dd>{connection ? connection.saveData ? 'On' : 'Off' : 'Browser does not say'}</dd>
      <dt>Network</dt><dd>{connection?.effectiveType ? `${connection.effectiveType} · ${connection.rtt ?? '?'} ms round trip · ${connection.downlink ?? '?'} Mbps` : 'Browser does not say'}</dd>
      <dt>Measured</dt><dd>{measured ? describeMode(measured) : '…'}</dd>
      <dt>In use</dt><dd>{describeMode(mode)}{mode.data !== measured?.data || mode.compute !== measured?.compute ? ' (switched)' : ''}</dd>
      <dt>Search model</dt><dd>{cached === undefined ? '…' : cached ? `Downloaded (${megabytes(SEMANTIC_INSTALL_BYTES)})` : 'Not downloaded'}</dd>
      <dt>Service worker</dt><dd>{worker}</dd>
      <dt>Site storage</dt><dd>{storage}</dd>
    </dl>
    <div className="action-row">
      <button type="button" className="button button-secondary" onClick={forget}>Measure again next page</button>
      <button type="button" className="button button-secondary" disabled={busy || !cached} onClick={() => { void removeModel(); }}>Delete the downloaded model</button>
    </div>
  </>;
}

/* ---------- Waiting for approval ---------- */

type Listing = { status: 'idle' | 'loading' } | { status: 'error'; message: string } | { status: 'ready'; archive: LoadedArchive };

function Unapproved({ base, mode }: Props) {
  const config = correctionConfig();
  const repository = config.repositoryUrl ? validateRepositoryUrl(config.repositoryUrl) : undefined;
  const [listing, setListing] = useState<Listing>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!repository) return;
    const abort = new AbortController();
    setListing({ status: 'loading' });
    loadArchiveFromGitHub(repository, abort.signal)
      .then(archive => setListing({ status: 'ready', archive }))
      .catch(error => { if (!abort.signal.aborted) setListing({ status: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => abort.abort();
  }, [repository, attempt]);

  if (!repository) return <p>This build has no GitHub repository set, so there is nothing to load.</p>;
  const shown = listing.status === 'ready' ? listing.archive.recordings.filter(item => all || item.recording?.status !== 'published') : [];
  return <>
    <p className="dev-hint">Loaded live from <a href={repository}>{repository.replace('https://github.com/', '')}</a> ({SOURCE_BRANCH}). {mode === 'production' ? 'This build leaves drafts out; nothing here is published.' : 'This preview build includes them.'}</p>
    <div className="dev-toolbar">
      <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} /> Show published too</label>
      <button type="button" className="button button-secondary" onClick={() => setAttempt(value => value + 1)} disabled={listing.status === 'loading'}>Reload</button>
    </div>
    {listing.status === 'loading' && <p role="status">Loading from GitHub…</p>}
    {listing.status === 'error' && <p className="dev-error" role="alert">{listing.message}</p>}
    {listing.status === 'ready' && <p role="status">{shown.length} recording{shown.length === 1 ? '' : 's'}{all ? '' : ' waiting for approval'}.</p>}
    <ul className="dev-services">{listing.status === 'ready' && shown.map(item => <li key={item.path}><RecordingCard item={item} archive={listing.archive} base={base} mode={mode} repository={repository} /></li>)}</ul>
  </>;
}

function RecordingCard({ item, archive, base, mode, repository }: { item: LoadedRecording; archive: LoadedArchive; base: string; mode: Props['mode']; repository: string }) {
  const { recording, problems } = item;
  const file = <a href={`${repository}/blob/${SOURCE_BRANCH}/${item.path}`}>File on GitHub</a>;
  if (!recording) return <article className="dev-card"><h3>{item.path}</h3><p className="dev-error">{problems.join('; ')}</p>{file}</article>;
  const display = displayRecordings([recording], archive.topics, archive.series)[0];
  const draft = recording.status !== 'published';
  return <article className="dev-card">
    <div className="dev-card-head">
      <h3>{display.title}</h3>
      <span className="dev-chip">{draft ? 'Draft' : 'Published'}</span>
      {(recording.markers?.length ?? 0) > 0 && <span className="dev-chip">{recording.markers!.length} marker{recording.markers!.length === 1 ? '' : 's'}</span>}
    </div>
    <p className="dev-hint">{formatDate(display.date)} · {formatTimecode(display.length)} · {display.uploads.map((upload, i) =>
      <a key={upload.id} href={youtubeAt(display.uploads, upload.start)}>YouTube{display.uploads.length > 1 ? ` part ${i + 1}` : ''}</a>)
      .reduce<ReactNode[]>((list, link, i) => i ? [...list, ', ', link] : [link], [])}</p>
    <details><summary>Chapters</summary>
      <ol className="dev-chapters">{display.entries.map(entry => <li key={entry.id} className={entry.parentId ? 'is-sub' : ''}>
        <a href={youtubeAt(display.uploads, entry.start)}>{formatTimecode(entry.start)}</a>
        <span>{entry.title}</span>
      </li>)}</ol>
    </details>
    <div className="dev-links">
      {draft && <a className="dev-primary-link" href={`${base}dev/edit/?id=${encodeURIComponent(display.id)}`}>Check it in the editor</a>}
      {file}<a href={githubEditUrl(repository, SOURCE_BRANCH, item.path)}>Edit on GitHub</a>
      {mode === 'preview' && <><a href={serviceUrl(base, display.id)}>Open here</a><a href={`${base}edit/${display.id}/`}>Chapter editor</a></>}</div>
  </article>;
}

/* ---------- Saved in this browser ---------- */

function describeKey(key: string): string {
  if (key.startsWith('recs-recording-editor:v2:')) return `Editor draft (${key.slice('recs-recording-editor:v2:'.length)})`;
  if (key.startsWith('recs-chapter-editor:v1:')) return `Old editor draft, no longer opened (${key.slice('recs-chapter-editor:v1:'.length)})`;
  return ({
    'recs-chapter-editor:github-ready': 'Editor: GitHub intro answered',
    'recs-chapter-editor:layout:v1': 'Editor window layout',
    'recs-dev:performance': 'Switches on this page',
    'recs-performance:v1': 'Speed measurement (this tab)',
    'recs-replay:resume:v2': 'Resume point',
    'recs-replay:resume:v1': 'Old resume point, no longer used',
    'recs-replay:search-history:v1': 'Search history',
  } as Record<string, string>)[key] ?? key;
}
function SavedData() {
  const [items, setItems] = useState<{ store: 'local' | 'session'; key: string; bytes: number }[]>([]);
  const read = useCallback(() => {
    const list: typeof items = [];
    for (const [store, storage] of [['local', localStorage], ['session', sessionStorage]] as const) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key?.startsWith('recs-')) list.push({ store, key, bytes: (storage.getItem(key) ?? '').length });
        }
      } catch { /* Storage blocked. */ }
    }
    setItems(list.sort((a, b) => a.key.localeCompare(b.key)));
  }, []);
  useEffect(read, [read]);
  const remove = (store: 'local' | 'session', key: string) => {
    try { (store === 'local' ? localStorage : sessionStorage).removeItem(key); } catch { /* Storage blocked. */ }
    if (key === 'recs-dev:performance') writePerformanceOverride({});
    read();
  };
  if (!items.length) return <p>Nothing saved.</p>;
  return <table className="dev-table"><tbody>{items.map(item => <tr key={`${item.store}:${item.key}`}>
    <th scope="row">{describeKey(item.key)}</th>
    <td className="dev-hint">{item.bytes.toLocaleString()} characters</td>
    <td><button type="button" className="text-link" onClick={() => remove(item.store, item.key)}>Remove</button></td>
  </tr>)}</tbody></table>;
}

/* ---------- This build ---------- */

function BuildInfo({ base, mode, dev }: Props) {
  const config = correctionConfig();
  return <dl className="dev-facts">
    <dt>Build</dt><dd>{dev ? 'Dev server' : mode === 'production' ? 'Production (approved recordings only)' : 'Preview (includes recordings waiting for approval)'}</dd>
    <dt>Base path</dt><dd><code>{base}</code></dd>
    <dt>Repository</dt><dd>{config.repositoryUrl ?? 'Not set'}</dd>
    <dt>Source</dt><dd>{config.sourceRef ?? 'Not set'}</dd>
  </dl>;
}
