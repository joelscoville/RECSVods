/** Developer tools only: reads the recording files from the public GitHub repository in the browser, so
 * recordings the build leaves out (drafts) can still be checked. Nothing here is built into the site;
 * switched off, it makes no requests. */
import { SOURCE_BRANCH, githubRawUrl } from './recording-editor';
import { correctionConfig, validateRepositoryUrl } from './corrections';
import { RecordingSchema, SeriesListSchema, TopicListSchema, type Recording, type Series, type Topic } from './recording-schema';
import { parseFile } from './parse-file';
import { displayRecordings, type DisplayRecording } from './display';
import { refreshDevBadge } from './performance-mode';

export interface LoadedRecording { path: string; recording?: Recording & { recordingId: string }; problems: string[] }
export interface LoadedArchive { recordings: LoadedRecording[]; topics: Topic[]; series: Series[] }
const RECORDING_FILE = /^services\/(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.yaml$/;
/** Shows drafts on the home page, in this browser only (set on /dev). */
export const UNAPPROVED_KEY = 'recs-dev:unapproved';

export function repositoryUrl(): string | undefined {
  const config = correctionConfig();
  return config.repositoryUrl ? validateRepositoryUrl(config.repositoryUrl) : undefined;
}
export function showUnapproved(): boolean {
  try { return localStorage.getItem(UNAPPROVED_KEY) === '1'; } catch { return false; }
}
export function setShowUnapproved(on: boolean): void {
  try { if (on) localStorage.setItem(UNAPPROVED_KEY, '1'); else localStorage.removeItem(UNAPPROVED_KEY); } catch { /* not saved */ }
  refreshDevBadge();
}

export async function loadArchiveFromGitHub(repository: string, signal?: AbortSignal): Promise<LoadedArchive> {
  const [owner, name] = repository.replace('https://github.com/', '').split('/');
  const response = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees/${SOURCE_BRANCH}?recursive=1`, { signal, headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 403 || response.status === 429) throw new Error('GitHub’s hourly limit for this network is used up. Try again later.');
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  const tree = await response.json() as { tree: { path: string; type: string }[] };
  const text = async (path: string) => {
    const file = await fetch(githubRawUrl(repository, SOURCE_BRANCH, path), { signal, cache: 'no-store' });
    if (!file.ok) throw new Error(`GitHub answered ${file.status} for ${path}`);
    return file.text();
  };
  const [topics, series] = await Promise.all([
    text('taxonomy/topics.yaml').then(value => parseFile(TopicListSchema, value, 'taxonomy/topics.yaml')).catch(() => []),
    text('taxonomy/series.yaml').then(value => parseFile(SeriesListSchema, value, 'taxonomy/series.yaml')).catch(() => []),
  ]);
  const paths = tree.tree.filter(item => item.type === 'blob' && RECORDING_FILE.test(item.path)).map(item => item.path);
  const recordings = await Promise.all(paths.map(async (path): Promise<LoadedRecording> => {
    try {
      const recording = parseFile(RecordingSchema, await text(path), path);
      return { path, recording: { ...recording, recordingId: RECORDING_FILE.exec(path)![1] }, problems: [] };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { path, problems: [error instanceof Error ? error.message : String(error)] };
    }
  }));
  recordings.sort((a, b) => b.path.localeCompare(a.path));
  return { recordings, topics, series };
}

/** The drafts, shaped like the site's own data (as a preview build would). */
export function unapprovedDisplay(archive: LoadedArchive): DisplayRecording[] {
  const drafts = archive.recordings.flatMap(item => item.recording && item.recording.status !== 'published' ? [item.recording] : []);
  return displayRecordings(drafts, archive.topics, archive.series);
}

/** One fetch per page view, shared by everything on the page. */
let cache: Promise<LoadedArchive> | undefined;
export function loadArchiveOnce(repository: string): Promise<LoadedArchive> {
  cache ??= loadArchiveFromGitHub(repository).catch(error => { cache = undefined; throw error; });
  return cache;
}
