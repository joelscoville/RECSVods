import { useEffect, useMemo, useState } from 'react';
import {
  describeChanges,
  githubEditUrl,
  githubRawUrl,
  initialState,
  isFileMarker,
  recordingFilePath,
  SOURCE_BRANCH,
  toRecording,
  type EditorIssue,
  type EditorRecording,
  type EditorState,
} from '../lib/recording-editor';
import {
  applyChanges,
  ChangeConflictError,
  type AppliedChanges,
} from '../lib/apply-changes';
import { correctionConfig, validateRepositoryUrl } from '../lib/corrections';
import { diffHunks } from '../lib/line-diff';
import EditorDialog from './EditorDialog';
import { SendSteps, SetupGuide } from './GitHubGuide';
import Icon from './Icon';

interface SubmissionProps {
  base: EditorRecording;
  state: EditorState;
  issues: EditorIssue[];
  nameOf: (id?: string) => string;
  onClose: () => void;
  onGoTo: (id: string) => void;
  onDetails: () => void;
  onClear: () => void;
  onIncludeMarkers: (include: boolean) => void;
  backHref: string;
}

type PreparedFile =
  | { status: 'loading' }
  | { status: 'ready'; applied: AppliedChanges; original: string }
  | { status: 'conflict'; problems: string[] }
  | { status: 'error'; message: string };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), {
    href: url,
    download: name,
  }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetch current source → check conflicts → prepare the file → hand it to GitHub. */
export default function EditorSubmissionDialog({
  base,
  state,
  issues,
  nameOf,
  onClose,
  onGoTo,
  onDetails,
  onClear,
  onIncludeMarkers,
  backHref,
}: SubmissionProps) {
  // Local markers are sent only when their inclusion was explicitly selected.
  const mine = state.markers.filter((marker) => !isFileMarker(marker));
  const unsent = mine.filter((marker) => !marker.include).length;
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  const edited = useMemo(() => {
    if (errors.length) {
      return undefined;
    }
    return toRecording(base, state).source;
  }, [errors.length, base, state]);
  const lines = useMemo(() => describeChanges(base, state), [base, state]);

  const config = correctionConfig();
  const repository = config.repositoryUrl
    ? validateRepositoryUrl(config.repositoryUrl)
    : undefined;
  const filePath = recordingFilePath(base.id);
  const fileName = filePath.split('/').at(-1)!;
  const [build, setBuild] = useState<PreparedFile>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<'copied' | 'blocked'>();

  useEffect(() => {
    // A checked draft can be submitted even when its content did not change.
    if (!edited || !repository) {
      return;
    }

    const request = new AbortController();
    setBuild({ status: 'loading' });

    async function prepareSubmission() {
      const response = await fetch(
        githubRawUrl(repository!, SOURCE_BRANCH, filePath),
        {
          cache: 'no-store',
          signal: request.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`GitHub answered ${response.status} for ${filePath}.`);
      }

      const original = await response.text();
      const applied = applyChanges({
        text: original,
        base: base.recording,
        edited: edited!,
        filename: filePath,
      });
      if (!request.signal.aborted) {
        setBuild({ status: 'ready', applied, original });
      }
    }

    function reportFailure(error: unknown) {
      if (request.signal.aborted) {
        return;
      }
      if (error instanceof ChangeConflictError) {
        setBuild({ status: 'conflict', problems: error.problems });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setBuild({ status: 'error', message });
      }
    }

    void prepareSubmission().catch(reportFailure);
    return () => request.abort();
  }, [edited, repository, filePath, base, attempt]);

  const [account, setAccount] = useState(false);
  async function copyFile(text: string) {
    const copied = await copyText(text);
    setStep(copied ? 'copied' : 'blocked');
  }
  const repo = repository?.replace('https://github.com/', '') ?? '';
  const unchanged =
    build.status === 'ready' && build.original === build.applied.text;

  return (
    <EditorDialog
      title={account ? 'Make a free GitHub account' : 'Send your changes'}
      onClose={onClose}
    >
      {mine.length > 0 && !account && (
        <label className="ce-send-markers">
          <input
            type="checkbox"
            checked={unsent === 0}
            onChange={(event) => onIncludeMarkers(event.target.checked)}
          />
          <span>
            Send my {mine.length === 1 ? 'marker' : `${mine.length} markers`}{' '}
            too
            <span className="ce-muted">
              {' '}
              ·{' '}
              {unsent === 0
                ? 'included'
                : unsent === mine.length
                  ? 'not included yet'
                  : `${unsent} not included yet`}
            </span>
          </span>
        </label>
      )}
      {errors.length > 0 ? (
        <>
          <p>A few things need fixing first:</p>
          <ul className="ce-issues">
            {errors.map((issue) => (
              <li key={`${issue.itemId}-${issue.message}`} className="is-error">
                {issue.itemId ? (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => onGoTo(issue.itemId!)}
                  >
                    {nameOf(issue.itemId)}
                  </button>
                ) : /^Marker/.test(issue.message) ? (
                  'Marker'
                ) : (
                  <button
                    type="button"
                    className="text-link"
                    onClick={onDetails}
                  >
                    Details
                  </button>
                )}
                : {issue.message}
              </li>
            ))}
          </ul>
        </>
      ) : account ? (
        <SetupGuide
          onDone={() => setAccount(false)}
          onExit={() => setAccount(false)}
          doneLabel="Back to sending"
        />
      ) : unchanged ? (
        <p>
          You haven’t changed anything yet, and this recording is already on the
          website.
        </p>
      ) : (
        <>
          {build.status === 'ready' && build.applied.published && (
            <p className="ce-publish-note">
              <Icon name="check" />
              Sending this also marks the recording as checked: it goes on the
              website when the pull request is merged.
            </p>
          )}
          <details className="ce-more">
            <summary>
              See what you changed (
              {lines.length +
                (build.status === 'ready' && build.applied.published ? 1 : 0)}
              )
            </summary>
            <ul className="ce-change-list">
              {build.status === 'ready' && build.applied.published && (
                <li>Marked as checked, ready for the website</li>
              )}
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {warnings.length > 0 && (
              <>
                <p className="ce-muted">Worth a second look (optional):</p>
                <ul className="ce-issues">
                  {warnings.map((issue) => (
                    <li
                      key={`${issue.itemId}-${issue.message}`}
                      className="is-warning"
                    >
                      {issue.itemId && (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => onGoTo(issue.itemId!)}
                        >
                          {nameOf(issue.itemId)}
                        </button>
                      )}
                      : {issue.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {build.status === 'ready' && (
              <>
                <p className="ce-muted">
                  The exact change to <code>{filePath}</code>:
                </p>
                <FileDiff before={build.original} after={build.applied.text} />
              </>
            )}
          </details>
          {!repository ? (
            <p>
              This copy of the site is not connected to a GitHub repository.
            </p>
          ) : build.status === 'loading' ? (
            <p role="status" className="ce-muted">
              Getting ready…
            </p>
          ) : build.status === 'conflict' ? (
            <div className="ce-issues">
              <p className="is-error">
                Someone changed this recording on GitHub in the same places you
                did:
              </p>
              <ul className="ce-change-list">
                {build.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              <p>
                Your edits are still in this editor. Download a draft before
                comparing with the latest version; no changes have been sent.
              </p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Check again
              </button>
            </div>
          ) : build.status === 'error' ? (
            <div className="ce-issues">
              <p className="is-error">
                Could not get the latest recording file from GitHub. Your edits
                are still in this editor.
              </p>
              <details>
                <summary>Technical details</summary>
                <p>{build.message}</p>
              </details>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <SendSteps
                repo={repo}
                file={fileName}
                copied={step}
                onCopy={() => copyFile(build.applied.text)}
                onOpen={() =>
                  window.open(
                    githubEditUrl(repository, SOURCE_BRANCH, filePath),
                    '_blank',
                    'noopener',
                  )
                }
                onDownload={() =>
                  saveFile(fileName, build.applied.text, 'text/yaml')
                }
                onAccount={() => setAccount(true)}
                finish={
                  <div className="action-row">
                    <a className="button" href={backHref}>
                      Back to the recording
                    </a>
                  </div>
                }
              />
            </>
          )}
        </>
      )}
      <div className="ce-local-reset">
        <div className="action-row">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Back to editing
          </button>
          <button
            type="button"
            className="ce-link"
            onClick={() =>
              saveFile(
                `${base.id}-draft.json`,
                JSON.stringify({ recordingId: base.id, state }, null, 2),
                'application/json',
              )
            }
          >
            Download draft
          </button>
        </div>
        <details>
          <summary>Discard local draft</summary>
          <p>
            This removes your edits from this browser. It does not change the
            archive. You can Undo while the editor remains open.
          </p>
          <button
            type="button"
            className="ce-link"
            onClick={onClear}
            disabled={
              JSON.stringify(state) === JSON.stringify(initialState(base))
            }
          >
            Clear my changes here
          </button>
        </details>
      </div>
    </EditorDialog>
  );
}

function FileDiff({ before, after }: { before: string; after: string }) {
  const hunks = useMemo(() => diffHunks(before, after), [before, after]);
  return (
    <div className="ce-diff">
      {hunks.map((hunk, i) => (
        <pre key={i}>
          {hunk.lines.map((line, j) => (
            <span key={j} className={`ce-diff-${line.kind}`}>
              <span className="ce-diff-no">{line.after ?? line.before}</span>
              {line.kind === 'added'
                ? '+ '
                : line.kind === 'removed'
                  ? '− '
                  : '  '}
              {line.text}
              {'\n'}
            </span>
          ))}
        </pre>
      ))}
    </div>
  );
}
