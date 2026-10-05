import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  describeChanges,
  edges,
  items,
  lengthOf,
  outline,
  roundTime,
  validateEditor,
  type EditorItem,
  type EditorRecording,
  type EditorState,
} from '../lib/recording-editor';
import { locate, recordingTime } from '../lib/recording-schema';
import {
  matchShortcut,
  shortcutHint,
  type EditorAction,
} from '../lib/editor-keys';
import {
  clampView,
  fitView,
  revealTime,
  zoomView,
  type TimelineView,
} from '../lib/timeline-view';
import { formatDate, serviceUrl } from '../lib/urls';
import { useEditorSession } from './use-editor-session';
import { useEditorPlayback } from './use-editor-playback';
import { useEditorSelection } from './use-editor-selection';
import { useBoundaryDrag } from './use-boundary-drag';
import { createEditorCommands } from './editor-commands';
import { createEditorMenus } from './editor-menus';
import { useEditorMarkers } from './use-editor-markers';
import EditorOutlinePanel from './EditorOutlinePanel';
import EditorSectionPanel from './EditorSectionPanel';
import EditorRecordingDetails from './EditorRecordingDetails';
import EditorToolbar from './EditorToolbar';
import EditorVideoPanel from './EditorVideoPanel';
import EditorHelpDialog from './EditorHelpDialog';
import EditorDialog from './EditorDialog';
import EditorSubmissionDialog from './EditorSubmissionDialog';
import EditorTimeline, { type TimelineContext } from './EditorTimeline';
import { ContextMenu, type MenuRequest } from './editor-controls';
import EditorDock from './EditorDock';
import Icon from './Icon';
import {
  MIN_TIMELINE,
  MIN_TOP,
  Splitter,
  useEditorLayout,
  WINDOW_TITLES,
  WINDOWS,
  type EditorWindow,
} from './editor-layout';
import { MarkersWindow, TranscriptWindow } from './EditorWindows';
import { SetupGuide } from './GitHubGuide';

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Composes document/session owners, view state, commands and presentation panels.
 * Panel markup lives with its panel; recording edits live in editor-commands. */
export default function ChapterEditor({
  base,
  siteBase,
  backHref,
}: {
  base: EditorRecording;
  siteBase: string;
  backHref?: string;
}) {
  const back = backHref ?? serviceUrl(siteBase, base.id);
  const { recording } = base;
  const length = useMemo(() => lengthOf(base), [base]);
  const root = useRef<HTMLDivElement>(null);
  const {
    original,
    history,
    state,
    dispatch,
    apply,
    restored,
    resetDraft,
    hydrated,
  } = useEditorSession(base);
  const playback = useEditorPlayback(base, root);
  const { time, playing, togglePlay } = playback;
  const [linked, setLinked] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [view, setView] = useState<TimelineView>(() => fitView(length));
  const [preview, setPreview] = useState<EditorState>();
  const [notice, setNotice] = useState<string>();
  const [dialog, setDialog] = useState<
    'help' | 'finish' | 'account' | undefined
  >();
  const [focusTitle, setFocusTitle] = useState(0);
  const [mobileTools, setMobileTools] = useState(false);
  const [menu, setMenu] = useState<MenuRequest>();
  const [focusDetails, setFocusDetails] = useState(0);
  const {
    layout,
    toggle: setWindow,
    activate: activatePanel,
    move: movePanel,
    resize: resizePanel,
    setTop,
    reset: resetLayout,
  } = useEditorLayout();
  const main = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({
    width: 1200,
    height: 420,
    timeline: 300,
  });
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const pointInput = useRef<HTMLTextAreaElement>(null);
  const windowsButton = useRef<HTMLButtonElement>(null);
  const focusedRequest = useRef(0);
  const userViewAt = useRef(0);

  const shown = preview ?? state;
  const rows = useMemo(() => outline(shown, length), [shown, length]);
  const selection = useEditorSelection({
    original,
    rows,
    length,
    hydrated,
    root,
  });
  const {
    selectedId,
    setSelectedId,
    selected,
    selectedSection,
    expanded,
    toggleExpanded,
    revealParents,
    activeBoundary,
    setActiveBoundary,
    mobileList,
    setMobileList,
    setSelectionRequest,
    list,
    editPane,
  } = selection;

  function toggleWindow(
    name: EditorWindow,
    open = !layout.open.includes(name),
  ) {
    setWindow(name, open);
    if (open && name === 'chapters') setMobileList(true);
  }

  const issues = useMemo(() => validateEditor(base, state), [base, state]);
  const errors = issues.filter((issue) => issue.level === 'error');
  const before = useMemo(
    () =>
      new Map(
        items(original, length).map((item) => [
          item.id,
          JSON.stringify(valueOf(original, item.id)),
        ]),
      ),
    [original, length],
  );
  const changed = useMemo(
    () =>
      new Set(
        items(shown, length)
          .filter(
            (item) =>
              before.get(item.id) !== JSON.stringify(valueOf(shown, item.id)),
          )
          .map((item) => item.id),
      ),
    [shown, length, before],
  );
  const failing = useMemo(
    () =>
      new Set(
        errors
          .map((issue) => issue.itemId)
          .filter((id): id is string => Boolean(id)),
      ),
    [errors],
  );
  const changes = useMemo(
    () => describeChanges(base, state).length,
    [base, state],
  );
  const nowPlaying = rows
    .filter((item) => item.start <= time && time < item.end)
    .at(-1);
  const playhead = roundTime(time);
  const here = locate(recording, time);
  const markerActions = useEditorMarkers(state, apply, playhead, () =>
    toggleWindow('markers', true),
  );
  const {
    selectedId: selectedMarkerId,
    setSelectedId: setSelectedMarkerId,
    focusId: focusMarker,
    setFocusId: setFocusMarker,
    add: markAt,
    select: selectMarker,
    remove: dropMarker,
  } = markerActions;

  const flash = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Timeline seeks already reveal their target; callers pass reveal:false to keep the view steady.
  const seekTo = useCallback(
    (
      seconds: number,
      options: { play?: boolean; live?: boolean; reveal?: boolean } = {},
    ) => {
      const target = Math.min(Math.max(0, seconds), Math.max(0, length - 0.05));
      if (!options.live && options.reveal !== false)
        setView((current) => revealTime(current, target, length));
      playback.seek(target, options);
    },
    [length, playback.seek],
  );
  function hear(seconds: number, lead = 3) {
    seekTo(seconds - lead, { play: true });
    playback.stopAfter(seconds + 2);
  }
  // Follow playback by turning the page, not recentering after every clock tick.
  useEffect(() => {
    if (!playing || performance.now() - userViewAt.current < 3000) return;
    setView((current) =>
      current.span >= length ||
      (time >= current.from && time <= current.from + current.span * 0.97)
        ? current
        : clampView({ ...current, from: time - current.span * 0.03 }, length),
    );
  }, [time, playing, length]);
  const viewByUser = useCallback((next: TimelineView) => {
    userViewAt.current = performance.now();
    setView(next);
  }, []);
  /** Selecting an item never moves playback unless the caller explicitly requests a jump. */
  function select(
    item: EditorItem,
    jump = false,
    origin: 'sidebar' | 'external' = 'external',
  ) {
    activatePanel('editor');
    selection.select(item, origin, jump);
    if (jump) seekTo(item.start);
  }
  const commands = createEditorCommands(
    { state, original, apply },
    selection,
    { length, playhead, linked, rows },
    {
      activateEditor: () => activatePanel('editor'),
      focusTitle: () => setFocusTitle((value) => value + 1),
      select,
      notify: flash,
    },
  );
  const {
    setItemEdge,
    addSubchapter,
    addPoint,
    removeSelected,
    confirmAndNext,
  } = commands;

  function jumpBoundary(step: 1 | -1) {
    const boundaries = edges(state);
    const found =
      step > 0
        ? boundaries.find((item) => item.time > time + 0.05)
        : [...boundaries].reverse().find((item) => item.time < time - 0.05);
    if (!found) return;
    // At shared times, prefer the chapter edge over a subchapter or point.
    const rank = { chapter: 0, subchapter: 1, point: 2 };
    const target = boundaries
      .filter((item) => Math.abs(item.time - found.time) < 0.005)
      .sort((a, b) => rank[a.lane] - rank[b.lane])[0];
    seekTo(target.time);
    setActiveBoundary(target);
    setSelectedId(target.id);
    revealParents(target.id);
    setSelectionRequest({ id: target.id });
  }
  const followBoundaryPreview = useCallback(
    (id: string, seconds: number) => {
      setSelectedId(id);
      setActiveBoundary(undefined);
      seekTo(seconds, { live: true });
    },
    [setSelectedId, setActiveBoundary, seekTo],
  );
  const boundaryDrag = useBoundaryDrag({
    state,
    length,
    linked,
    showPreview: setPreview,
    apply,
    followPreview: followBoundaryPreview,
    finishSeek: playback.commitSeek,
  });

  function run(action: EditorAction) {
    switch (action) {
      case 'play':
        togglePlay();
        break;
      case 'back':
        seekTo(time - 1);
        break;
      case 'forward':
        seekTo(time + 1);
        break;
      case 'backMore':
        seekTo(time - 5);
        break;
      case 'forwardMore':
        seekTo(time + 5);
        break;
      case 'backFine':
        seekTo(time - 0.1);
        break;
      case 'forwardFine':
        seekTo(time + 0.1);
        break;
      case 'previousBoundary':
        jumpBoundary(-1);
        break;
      case 'nextBoundary':
        jumpBoundary(1);
        break;
      case 'uploadStart':
        seekTo(0);
        break;
      case 'uploadEnd':
        seekTo(length);
        break;
      case 'setStart':
        setItemEdge('start', playhead);
        break;
      case 'setEnd':
        setItemEdge('end', playhead);
        break;
      case 'addSubchapter':
        addSubchapter();
        break;
      case 'addPoint':
        addPoint();
        break;
      case 'delete':
        removeSelected(activeBoundary?.id);
        break;
      case 'hear': {
        const at = activeBoundary?.time ?? selected?.start;
        if (at !== undefined) hear(at);
        break;
      }
      case 'confirm':
        confirmAndNext();
        break;
      case 'zoomIn':
        viewByUser(zoomView(view, 0.5, time, length));
        break;
      case 'zoomOut':
        viewByUser(zoomView(view, 2, time, length));
        break;
      case 'zoomFit':
        viewByUser(fitView(length));
        break;
      case 'snapping':
        setSnapping((value) => !value);
        flash(snapping ? 'Snapping off' : 'Snapping on');
        break;
      case 'help':
        setDialog('help');
        break;
      case 'escape':
        setActiveBoundary(undefined);
        setSelectedMarkerId(undefined);
        break;
      case 'undo':
        dispatch({ type: 'undo' });
        break;
      case 'redo':
        dispatch({ type: 'redo' });
        break;
      case 'mark':
        markAt();
        break;
    }
  }
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (
      dialog ||
      menu ||
      root.current?.querySelector('[popover]:popover-open') ||
      event.defaultPrevented
    )
      return;
    const action = matchShortcut(event);
    if (!action || editable(event.target)) return;
    // Preserve native activation of focused buttons and links.
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      event.target instanceof HTMLElement &&
      event.target.closest('button, a, summary, [role="button"]')
    )
      return;
    event.preventDefault();
    run(action);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    function measure() {
      const area = main.current;
      const timeline = root.current?.querySelector<HTMLElement>('.tl');
      if (area)
        setSizes({
          width: area.clientWidth,
          height: area.offsetHeight,
          timeline: timeline?.offsetHeight ?? 0,
        });
    }
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    if (main.current) observer.observe(main.current);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (focusDetails) document.getElementById('ce-details-title')?.focus();
  }, [focusDetails]);
  useLayoutEffect(() => {
    if (!focusTitle || focusedRequest.current === focusTitle) return;
    const input =
      selected?.lane === 'point' ? pointInput.current : titleInput.current;
    if (!input?.getClientRects().length) return;
    input.focus({ preventScroll: true });
    if (selected?.lane !== 'point') input.select();
    focusedRequest.current = focusTitle;
  }, [focusTitle, expanded, rows]);

  const sectionRows = rows.filter((item) => item.lane !== 'point');
  const checkedCount = state.checked.filter((id) =>
    sectionRows.some((item) => item.id === id),
  ).length;
  const nameOf = (id?: string) =>
    rows.find((item) => item.id === id)?.title ?? id ?? '';
  function closeDialog() {
    setDialog(undefined);
  }
  function editSubmissionIssue(id: string) {
    const item = rows.find((row) => row.id === id);
    if (item) {
      select(item);
      setFocusTitle((value) => value + 1);
    }
    closeDialog();
  }
  function showRecordingDetails() {
    toggleWindow('details', true);
    closeDialog();
  }
  function clearDraftAndClose() {
    resetDraft();
    closeDialog();
  }

  function rename(item: EditorItem) {
    select(item);
    setFocusTitle((value) => value + 1);
  }
  const menus = createEditorMenus(
    {
      playhead,
      rows,
      checked: state.checked,
      chapterCount: state.chapters.length,
      changed,
      originalIds: before,
    },
    commands,
    {
      seek: seekTo,
      hear,
      mark: markAt,
      editMarker: markerActions.edit,
      focusMarker: (marker) => {
        selectMarker(marker);
        setFocusMarker(marker.id);
      },
      removeMarker: dropMarker,
      rename,
      zoomAt: (at) => viewByUser(zoomView(view, 0.4, at, length)),
      fit: () => viewByUser(fitView(length)),
    },
  );
  const chapterItems = menus.chapters;
  function timelineMenu(context: TimelineContext) {
    const description = menus.timeline(context);
    const intent = description.selection;
    if (intent?.kind === 'marker') {
      setSelectedMarkerId(intent.id);
    } else if (intent?.kind === 'boundary') {
      setActiveBoundary(intent.boundary);
      setSelectedId(intent.boundary.id);
    } else if (intent?.kind === 'item') {
      setSelectedId(intent.id);
      setActiveBoundary(undefined);
    }
    setMenu({ x: context.x, y: context.y, items: description.items });
  }
  function openItemMenu(event: MouseEvent<HTMLElement>, item: EditorItem) {
    const target = event.target as HTMLElement;
    if (
      target.closest('.ce-entry, .ce-section-editor') !== event.currentTarget ||
      target.closest('input, textarea, select')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    select(item, false, 'sidebar');
    const trigger =
      target.closest<HTMLElement>('button') ??
      event.currentTarget.querySelector<HTMLElement>(
        '.ce-title, .ce-point-time',
      ) ??
      undefined;
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: menus.item(item, playhead),
      trigger,
    });
  }
  const recordingIssues = issues.filter((issue) => !issue.itemId);
  const transcriptAt = { id: here.upload.youtubeId, time: here.uploadTime };

  return (
    <div
      className={`ce-root ce-workspace${mobileList ? ' is-browsing' : ''}`}
      ref={root}
      tabIndex={-1}
      onBlurCapture={(event) => {
        if (editable(event.target)) dispatch({ type: 'break' });
      }}
    >
      <header className="ce-bar">
        <a className="ce-back" href={back} aria-label="Back to the recording">
          <Icon name="back" />
        </a>
        <div className="ce-bar-title">
          <h1>
            <button
              type="button"
              className="ce-title-edit"
              onClick={() => {
                toggleWindow('details', true);
                setFocusDetails((value) => value + 1);
              }}
              title="Change the title, description, scripture and topics"
            >
              {state.title.trim() || recording.recordingTitle}
              <Icon name="pencil" />
            </button>
          </h1>
          <p>Suggesting changes · {formatDate(recording.serviceDate)}</p>
        </div>
        <p className="ce-status" aria-live="polite">
          <span>
            {checkedCount}/{sectionRows.length} checked
          </span>
          <span>
            {changes} change{changes === 1 ? '' : 's'}
          </span>
          {errors.length > 0 && (
            <span className="ce-error-text">{errors.length} to fix</span>
          )}
          {restored && (
            <span className="ce-restored">
              Draft restored ·{' '}
              <button type="button" className="ce-link" onClick={resetDraft}>
                Start over
              </button>
            </span>
          )}
        </p>
        <div className="ce-bar-actions">
          <button
            type="button"
            className="ce-icon"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={!history.past.length}
            aria-label="Undo"
            title={`Undo${shortcutHint('undo')}`}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="ce-icon"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={!history.future.length}
            aria-label="Redo"
            title={`Redo${shortcutHint('redo')}`}
          >
            <Icon name="redo" />
          </button>
          <button
            ref={windowsButton}
            type="button"
            className="ce-tool ce-windows"
            aria-haspopup="menu"
            aria-expanded={menu?.trigger === windowsButton.current}
            title="Choose the windows beside the video"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu({
                x: box.left,
                y: box.bottom + 4,
                trigger: event.currentTarget,
                items: [
                  ...WINDOWS.map((name) => ({
                    label: WINDOW_TITLES[name],
                    checked: layout.open.includes(name),
                    onSelect: () => toggleWindow(name),
                  })),
                  { separator: true, label: '' },
                  { label: 'Reset the layout', onSelect: resetLayout },
                ],
              });
            }}
          >
            <Icon name="panels" />
            Windows
          </button>
          <button
            type="button"
            className="ce-icon"
            onClick={() => setDialog('help')}
            aria-label="Help and shortcuts"
            title={`Help and shortcuts${shortcutHint('help')}`}
          >
            <Icon name="help" />
          </button>
          <button
            type="button"
            className="button ce-done"
            onClick={() => {
              const invalidTime = root.current?.querySelector<HTMLInputElement>(
                '.ce-time-entry input[aria-invalid="true"], .ce-note-row input[aria-invalid="true"]',
              );
              if (invalidTime) {
                invalidTime.focus({ preventScroll: true });
                flash('Fix the highlighted time before sending your changes.');
                return;
              }
              setDialog('finish');
            }}
          >
            Review & send
          </button>
        </div>
      </header>
      <div
        className="ce-main ce-dock-main"
        ref={main}
        style={layout.top ? { height: layout.top } : undefined}
      >
        <EditorDock
          layout={layout}
          onMove={movePanel}
          onResize={resizePanel}
          onActivate={activatePanel}
          onClose={(name) => toggleWindow(name, false)}
          titles={{
            editor:
              selectedSection?.lane === 'subchapter'
                ? 'Edit subchapter'
                : 'Edit chapter',
          }}
          panels={{
            chapters: (
              <EditorOutlinePanel
                rows={rows}
                selectedId={selectedId}
                selectedSectionId={selectedSection?.id}
                playingId={nowPlaying?.id}
                checked={state.checked}
                expanded={expanded}
                changed={changed}
                originalIds={before}
                issues={issues}
                listRef={list}
                onSelect={(item, jump) => select(item, jump, 'sidebar')}
                onRename={rename}
                onCheck={commands.toggleChecked}
                onExpand={toggleExpanded}
                onContextMenu={openItemMenu}
              />
            ),
            editor: (
              <EditorSectionPanel
                state={state}
                rows={rows}
                selectedId={selectedId}
                selectedSection={selectedSection}
                issues={issues}
                changed={changed}
                originalIds={before}
                length={length}
                linked={linked}
                playhead={playhead}
                commands={commands}
                titleRef={titleInput}
                pointRef={pointInput}
                paneRef={editPane}
                onSelect={(item, jump) => select(item, jump, 'sidebar')}
                onSeek={seekTo}
                onContextMenu={openItemMenu}
                onBack={() => {
                  setWindow('chapters', true);
                  setMobileList(true);
                }}
              />
            ),
            video: (
              <EditorVideoPanel
                playback={{
                  host: playback.host,
                  player: playback.player,
                  unavailable: playback.unavailable,
                  playing: playback.playing,
                  file: playback.file,
                  time: playback.time,
                  playerError: playback.playerError,
                  uploadCount: playback.uploads.length,
                  fileWarning: playback.fileWarning,
                  togglePlay: playback.togglePlay,
                  load: playback.load,
                  useYouTube: playback.useYouTube,
                  useFile: playback.useFile,
                }}
                onSeek={seekTo}
              />
            ),
            details: (
              <EditorRecordingDetails
                state={state}
                topics={base.topics}
                issues={recordingIssues}
                onChange={(change, key) => apply({ ...state, ...change }, key)}
              />
            ),
            readalong: (
              <TranscriptWindow
                videoId={transcriptAt.id}
                time={transcriptAt.time}
                onSeek={(seconds) =>
                  seekTo(recordingTime(recording, transcriptAt.id, seconds))
                }
                onMark={(seconds) =>
                  markAt(
                    roundTime(
                      recordingTime(recording, transcriptAt.id, seconds),
                    ),
                  )
                }
              />
            ),
            markers: (
              <MarkersWindow
                markers={state.markers}
                selectedId={selectedMarkerId}
                focusId={focusMarker}
                playhead={playhead}
                onSelect={setSelectedMarkerId}
                onGo={(marker) => seekTo(marker.at)}
                onEdit={markerActions.edit}
                onRemove={dropMarker}
                onAdd={() => markAt()}
              />
            ),
          }}
        />
      </div>
      <Splitter
        orientation="horizontal"
        label="Height of the editing workspace"
        value={sizes.height}
        min={MIN_TOP}
        max={Math.max(sizes.height + sizes.timeline - MIN_TIMELINE, 1200)}
        onDrag={(height) => setTop(height)}
        onReset={() => setTop(undefined)}
      />
      <EditorToolbar
        playback={playback}
        state={state}
        selected={selected}
        activeBoundary={activeBoundary}
        commands={commands}
        length={length}
        playhead={playhead}
        linked={linked}
        snapping={snapping}
        mobileTools={mobileTools}
        notice={notice}
        onSeek={seekTo}
        onChapterMenu={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setMenu({
            x: box.left,
            y: box.top - 8,
            trigger: event.currentTarget,
            items: chapterItems(playhead),
          });
        }}
        onLinked={setLinked}
        onToggleSnap={() => setSnapping((value) => !value)}
        onToggleMobileTools={() => setMobileTools((value) => !value)}
        onZoom={(factor) => viewByUser(zoomView(view, factor, time, length))}
        onFit={() => viewByUser(fitView(length))}
      />
      <EditorTimeline
        state={shown}
        duration={length}
        time={time}
        view={view}
        onView={viewByUser}
        snapping={snapping}
        linked={linked}
        selectedId={selectedId}
        activeBoundary={activeBoundary}
        changed={changed}
        failing={failing}
        onScrub={(seconds, phase) => {
          setActiveBoundary(undefined);
          setSelectedMarkerId(undefined);
          seekTo(seconds, { live: phase === 'move', reveal: false });
        }}
        onSelect={(item) => {
          select(item, item.lane === 'point');
          setSelectedMarkerId(undefined);
        }}
        onBoundaryMove={boundaryDrag.move}
        onBoundaryCommit={boundaryDrag.commit}
        onBoundaryCancel={boundaryDrag.cancel}
        onAdd={(lane, seconds) => {
          seekTo(seconds, { reveal: false });
          if (lane === 'subchapter') addSubchapter(roundTime(seconds));
          else if (lane === 'point') addPoint(roundTime(seconds));
          else
            setMenu({
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
              items: chapterItems(roundTime(seconds)),
            });
        }}
        onRename={rename}
        onContextMenu={timelineMenu}
        selectedMarkerId={selectedMarkerId}
        onSelectMarker={selectMarker}
        onAddMarker={(seconds) => markAt(roundTime(seconds))}
      />
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />}
      {dialog === 'help' && (
        <EditorHelpDialog
          onClose={() => setDialog(undefined)}
          onAccount={() => setDialog('account')}
        />
      )}
      {dialog === 'account' && (
        <EditorDialog
          title="Make a free GitHub account"
          onClose={() => setDialog(undefined)}
        >
          <SetupGuide
            onDone={() => setDialog(undefined)}
            doneLabel="Back to editing"
          />
        </EditorDialog>
      )}
      {dialog === 'finish' && (
        <EditorSubmissionDialog
          base={base}
          state={state}
          issues={issues}
          nameOf={nameOf}
          onClose={closeDialog}
          onGoTo={editSubmissionIssue}
          onDetails={showRecordingDetails}
          onClear={clearDraftAndClose}
          onIncludeMarkers={markerActions.includeLocal}
          backHref={back}
        />
      )}
    </div>
  );
}

function valueOf(state: EditorState, id: string): unknown {
  return (
    state.chapters.find((chapter) => chapter.id === id) ??
    state.subchapters.find((chapter) => chapter.id === id) ??
    state.points.find((point) => point.id === id)
  );
}
