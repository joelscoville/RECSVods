import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addMarker,
  chapterAt,
  chapterTitle,
  describeChanges,
  edgeLimits,
  editMarker,
  editChapter,
  editPoint,
  edges,
  formatClock,
  isFileMarker,
  items,
  lengthOf,
  outline,
  removeMarker,
  roundTime,
  setEdge,
  toggleChecked,
  validateEditor,
  type EditorItem,
  type EditorMarker,
  type EditorRecording,
  type EditorState,
} from '../lib/recording-editor';
import {
  CHAPTER_TITLES,
  CHAPTER_KINDS,
  locate,
  recordingTime,
  words,
  type ChapterKind,
} from '../lib/recording-schema';
import { useEditorSession } from './use-editor-session';
import { useEditorPlayback } from './use-editor-playback';
import { useEditorSelection } from './use-editor-selection';
import { useBoundaryDrag } from './use-boundary-drag';
import { createEditorCommands } from './editor-commands';
import UnavailableRecording from './UnavailableRecording';
import {
  isMac,
  keyText,
  matchShortcut,
  SHORTCUTS,
  shortcutHint,
  type EditorAction,
} from '../lib/editor-keys';
import Modal from './EditorDialog';
import EditorSubmissionDialog from './EditorSubmissionDialog';
import EditorTimeline, { type TimelineContext } from './EditorTimeline';
import {
  ContextMenu,
  TimeInput,
  useScrubbable,
  type MenuItem,
  type MenuRequest,
} from './editor-controls';
import EditorPointNote from './EditorPointNote';
import EditorTitleField from './EditorTitleField';
import EditorDock from './EditorDock';
import {
  clampView,
  fitView,
  revealTime,
  zoomView,
  type TimelineView,
} from '../lib/timeline-view';
import { parseScriptureReference } from '../lib/scripture';
import { formatDate, serviceUrl } from '../lib/urls';
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

/* ---------- Small pieces ---------- */

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function Key({ children }: { children: ReactNode }) {
  return <kbd className="ce-key">{children}</kbd>;
}

function WordCount({ text }: { text: string }) {
  return <span className="ce-muted"> {words(text)} words</span>;
}

function ChipList({
  label,
  items,
  onChange,
  placeholder,
  validate,
  max,
  options,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  validate?: (value: string) => string | undefined;
  max?: number;
  /** A fixed list to choose from, as value → shown name. */
  options?: { value: string; name: string }[];
}) {
  const [draft, setDraft] = useState(''),
    [problem, setProblem] = useState('');
  const add = (value = draft.trim()) => {
    if (!value) return;
    const error = validate?.(value);
    if (error) {
      setProblem(error);
      return;
    }
    if (!items.includes(value)) onChange([...items, value]);
    setDraft('');
    setProblem('');
  };
  const full = max !== undefined && items.length >= max;
  const nameOf = (value: string) =>
    options?.find((option) => option.value === value)?.name ?? value;
  return (
    <div className="ce-field">
      <span className="ce-label">
        {label}
        {max !== undefined && (
          <span className="ce-muted">
            {' '}
            {items.length}/{max}
          </span>
        )}
      </span>
      <ul className="ce-chips">
        {items.map((item) => (
          <li key={item}>
            <span>{nameOf(item)}</span>
            <button
              type="button"
              aria-label={`Remove ${nameOf(item)}`}
              onClick={() => onChange(items.filter((value) => value !== item))}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
        {!items.length && <li className="ce-empty">None</li>}
      </ul>
      <div className="ce-chip-add">
        {options ? (
          <select
            value=""
            aria-label={`Add ${label.toLowerCase()}`}
            disabled={full}
            onChange={(event) => add(event.target.value)}
          >
            <option value="">
              {full ? 'Full: remove one to add another' : placeholder}
            </option>
            {options
              .filter((option) => !items.includes(option.value))
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.name}
                </option>
              ))}
          </select>
        ) : (
          <>
            <input
              value={draft}
              placeholder={
                full ? `Full: remove one to add another` : placeholder
              }
              aria-label={`Add ${label.toLowerCase()}`}
              disabled={full}
              onChange={(event) => {
                setDraft(event.target.value);
                setProblem('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <button
              type="button"
              className="button button-secondary"
              onClick={() => add()}
              disabled={full || !draft.trim()}
            >
              Add
            </button>
          </>
        )}
      </div>
      {problem && (
        <p className="ce-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** One edge on one line: nudge it, set it to the playhead, click the time to hear it, or (rarely) type it. */
function EdgeControl({
  label,
  value,
  onSet,
  onPlayhead,
  onGo,
  playhead,
  changed,
  onScrub,
  onScrubEnd,
  limits,
}: {
  label: string;
  value: number;
  onSet: (seconds: number) => void;
  onPlayhead: () => void;
  onGo: () => void;
  playhead: number;
  changed: boolean;
  onScrub: (seconds: number) => void;
  onScrubEnd: () => void;
  limits: [number, number];
}) {
  const scrub = useScrubbable(value, onScrub, onScrubEnd, limits);
  const [typing, setTyping] = useState(false),
    button = useRef<HTMLButtonElement>(null);
  const restoreFocus = () =>
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  const atPlayhead = Math.abs(playhead - value) < 0.01;
  return (
    <div
      className={`ce-edge${changed ? ' is-changed' : ''}`}
      role="group"
      aria-label={label}
    >
      <span className="ce-edge-label">{label}</span>
      <button
        type="button"
        className="ce-step"
        onClick={() => onSet(value - 1)}
        disabled={value - 1 < limits[0]}
        aria-label={`${label} one second earlier`}
      >
        −1s
      </button>
      {!typing ? (
        <button
          ref={button}
          type="button"
          className="ce-edge-time ce-scrubbable"
          onClick={onGo}
          onDoubleClick={() => setTyping(true)}
          {...scrub}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault();
              setTyping(true);
            }
          }}
          title="Click to go here. Drag to adjust. Double-click or press F2 to type a time."
          aria-label={`${label} ${formatClock(value)}. Click to go here; drag sideways to adjust.`}
        >
          <Icon name="goto" />
          {formatClock(value)}
        </button>
      ) : (
        <TimeInput
          className="ce-edge-time"
          value={value}
          label={`${label} time`}
          min={limits[0]}
          max={limits[1]}
          onCommit={(next, reason) => {
            onSet(next);
            setTyping(false);
            if (reason === 'enter') restoreFocus();
          }}
          onCancel={() => {
            setTyping(false);
            restoreFocus();
          }}
        />
      )}
      <button
        type="button"
        className="ce-step"
        onClick={() => onSet(value + 1)}
        disabled={value + 1 > limits[1]}
        aria-label={`${label} one second later`}
      >
        +1s
      </button>
      <button
        type="button"
        className="ce-set"
        onClick={onPlayhead}
        disabled={atPlayhead || playhead < limits[0] || playhead > limits[1]}
      >
        {atPlayhead ? 'At playhead' : `Set to ${formatClock(playhead)}`}
      </button>
    </div>
  );
}

/** The time readout: shows the playhead; click it to type a time (12:34, 1:02:03) or a relative jump (+5, -2.5). */
function TimeReadout({
  time,
  duration,
  onSeek,
  onScrub,
}: {
  time: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onScrub: (seconds: number) => void;
}) {
  const [typing, setTyping] = useState(false),
    button = useRef<HTMLButtonElement>(null);
  const scrub = useScrubbable(time, onScrub, onSeek, [0, duration]);
  const restoreFocus = () =>
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  return !typing ? (
    <button
      ref={button}
      type="button"
      className="ce-readout ce-scrubbable"
      onClick={() => setTyping(true)}
      {...scrub}
      title="Drag sideways to scrub (Shift: faster, Alt: finer). Click to type a time, or +5 / -2 to jump"
      aria-label={`Playhead ${formatClock(time)}. Click to type a time.`}
    >
      <span aria-label="Playhead">{formatClock(time)}</span>
      <span className="ce-readout-total"> / {formatClock(duration)}</span>
    </button>
  ) : (
    <TimeInput
      className="ce-readout ce-readout-input"
      value={time}
      label="Go to time"
      max={duration}
      relative
      onCommit={(next, reason) => {
        onSeek(next);
        setTyping(false);
        if (reason === 'enter') restoreFocus();
      }}
      onCancel={() => {
        setTyping(false);
        restoreFocus();
      }}
    />
  );
}

const SPEEDS = [0.5, 1, 1.5, 2];

/* ---------- The editor ---------- */

/** `backHref` replaces the recording page link where that page is not built (the developer view of drafts). */
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
  const {
    time,
    playing,
    speed,
    availableSpeeds,
    speedNotice,
    player,
    playerError,
    file,
    fileWarning,
    host,
    uploads,
    load,
    togglePlay,
    useFile,
    useYouTube,
    changeSpeed,
    unavailable,
  } = playback;
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
  const [selectedMarkerId, setSelectedMarkerId] = useState<string>();
  const [focusMarker, setFocusMarker] = useState<string>();
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
  const toggleWindow = (
    name: EditorWindow,
    open = !layout.open.includes(name),
  ) => {
    setWindow(name, open);
    if (open && name === 'chapters') setMobileList(true);
  };
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
  const fileInput = useRef<HTMLInputElement>(null);
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
  const issuesFor = (id: string) =>
    issues.filter((issue) => issue.itemId === id);
  const nowPlaying = rows
    .filter((item) => item.start <= time && time < item.end)
    .at(-1);
  const playhead = roundTime(time);
  const here = locate(recording, time);

  const flash = useCallback((message: string) => {
    setNotice(message);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ---------- Moving the playhead ---------- */
  /** `reveal: false` for seeks made on the timeline itself: the spot is already in view, so the view stays put. */
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
  /** Plays from 3 seconds before a moment to 2 seconds after, then stops. */
  const hear = (seconds: number, lead = 3) => {
    seekTo(seconds - lead, { play: true });
    playback.stopAfter(seconds + 2);
  };
  // While playing, a zoomed-in timeline turns the page when the playhead reaches its right edge (as in video
  // editors) instead of re-centring on every tick, so clicking somewhere never makes the view jump.
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
  /** Selecting never moves the playhead unless asked (`jump`). */
  const select = (
    item: EditorItem,
    jump = false,
    origin: 'sidebar' | 'external' = 'external',
  ) => {
    activatePanel('editor');
    selection.select(item, origin, jump);
    if (jump) seekTo(item.start);
  };

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
    canSetEdge,
    addSubchapter,
    addPoint,
    startChapter,
    removeSelected,
    confirmAndNext,
    revertItem,
  } = commands;
  const scrubSession = useRef(0);
  const jumpBoundary = (step: 1 | -1) => {
    const list = edges(state);
    const found =
      step > 0
        ? list.find((item) => item.time > time + 0.05)
        : [...list].reverse().find((item) => item.time < time - 0.05);
    if (!found) return;
    // Where several edges share a moment, prefer the chapter's.
    const rank = { chapter: 0, subchapter: 1, point: 2 };
    const target = list
      .filter((item) => Math.abs(item.time - found.time) < 0.005)
      .sort((a, b) => rank[a.lane] - rank[b.lane])[0];
    seekTo(target.time);
    setActiveBoundary(target);
    setSelectedId(target.id);
    revealParents(target.id);
    setSelectionRequest({ id: target.id });
  };

  /* ---------- Markers ---------- */
  const markAt = (seconds = playhead) => {
    const result = addMarker(state, seconds);
    apply(result.state);
    setSelectedMarkerId(result.id);
    setFocusMarker(result.id);
    toggleWindow('markers', true);
  };
  const selectMarker = (marker: EditorMarker) => {
    setSelectedMarkerId(marker.id);
    setFocusMarker(undefined);
    toggleWindow('markers', true);
  };
  const dropMarker = (id: string) => {
    apply(removeMarker(state, id));
    if (selectedMarkerId === id) setSelectedMarkerId(undefined);
  };
  const markerMenu = (marker: EditorMarker): MenuItem[] => {
    const mine = !isFileMarker(marker);
    return [
      {
        label: `Go to ${formatClock(marker.at)}`,
        onSelect: () => seekTo(marker.at),
      },
      {
        label: `Move it to the playhead (${formatClock(playhead)})`,
        disabled: Math.abs(playhead - marker.at) < 0.01,
        onSelect: () => apply(editMarker(state, marker.id, { at: playhead })),
      },
      {
        label: 'Edit the note',
        onSelect: () => {
          selectMarker(marker);
          setFocusMarker(marker.id);
        },
      },
      ...(mine
        ? [
            {
              label: 'Send with my changes',
              checked: marker.include,
              onSelect: () =>
                apply(
                  editMarker(state, marker.id, { include: !marker.include }),
                ),
            },
          ]
        : []),
      { separator: true, label: '' },
      {
        label: mine ? 'Delete marker' : 'Remove from the file (resolved)',
        onSelect: () => dropMarker(marker.id),
      },
    ];
  };

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

  /* ---------- Keyboard: one table (lib/editor-keys) ---------- */
  const run = (action: EditorAction) => {
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
  };
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event: KeyboardEvent) => {
    if (
      dialog ||
      menu ||
      root.current?.querySelector('[popover]:popover-open') ||
      event.defaultPrevented
    )
      return;
    const action = matchShortcut(event);
    if (!action || editable(event.target)) return;
    // Space and Enter on a focused button press that button, as everywhere else.
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
  // Desktop pane sizes, for the resize handles' limits.
  useEffect(() => {
    const measure = () => {
      const area = main.current,
        timeline = root.current?.querySelector<HTMLElement>('.tl');
      if (area)
        setSizes({
          width: area.clientWidth,
          height: area.offsetHeight,
          timeline: timeline?.offsetHeight ?? 0,
        });
    };
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

  function includeLocalMarkers(include: boolean) {
    const markers = state.markers.map((marker) => {
      return isFileMarker(marker) ? marker : { ...marker, include };
    });
    apply({ ...state, markers });
  }

  /* ---------- Right-click menus: every item also exists as a button or shortcut ---------- */
  const keyOf = (action: EditorAction) => {
    const label = SHORTCUTS.find((item) => item.action === action)?.label;
    return label && keyText(label);
  };
  const rename = (item: EditorItem) => {
    // Rename explicitly opens a field; reveal it if the action was invoked from
    // controls lower in the sidebar, rather than keeping the field off screen.
    select(item);
    setFocusTitle((value) => value + 1);
  };
  const chapterItems = (at: number): MenuItem[] =>
    CHAPTER_KINDS.map((kind) => ({
      label: `Add ${chapterTitle(kind)} chapter at ${formatClock(at)}`,
      onSelect: () => startChapter(kind, at),
    }));
  const itemMenu = (item: EditorItem, at: number): MenuItem[] => {
    const checked = state.checked.includes(item.id),
      inside = at > item.start + 0.5 && at < item.end - 0.5;
    const entries: (MenuItem | false | undefined)[] = [
      {
        label: `Play from ${formatClock(at)}`,
        onSelect: () => seekTo(at, { play: true }),
      },
      {
        label: 'Play from its start',
        onSelect: () => seekTo(item.start, { play: true }),
      },
      item.lane !== 'point' && {
        label: 'Play up to its end (from 5 s before)',
        onSelect: () => hear(item.end, 5),
      },
      {
        label: 'Hear its start (3 s before to 2 s after)',
        onSelect: () => hear(item.start),
      },
      {
        label: `Mark ${formatClock(at)}`,
        hint: at === playhead ? keyOf('mark') : undefined,
        onSelect: () => markAt(at),
      },
      { separator: true, label: '' },
      {
        label:
          item.lane === 'point'
            ? `Move it to ${formatClock(at)}`
            : `Start here (${formatClock(at)})`,
        hint: at === playhead ? keyOf('setStart') : undefined,
        disabled: !canSetEdge(item, 'start', at),
        onSelect: () => setItemEdge('start', at, item.id),
      },
      item.lane !== 'point' && {
        label: `End here (${formatClock(at)})`,
        hint: at === playhead ? keyOf('setEnd') : undefined,
        disabled: !canSetEdge(item, 'end', at),
        onSelect: () => setItemEdge('end', at, item.id),
      },
      item.lane === 'chapter' && {
        label: `Add a subchapter at ${formatClock(at)}`,
        hint: at === playhead ? keyOf('addSubchapter') : undefined,
        disabled: !inside,
        onSelect: () => addSubchapter(at),
      },
      item.lane !== 'point' && {
        label: `Add a point at ${formatClock(at)}`,
        hint: at === playhead ? keyOf('addPoint') : undefined,
        disabled: at < item.start || at >= item.end,
        onSelect: () => addPoint(at),
      },
      { separator: true, label: '' },
      {
        label: item.lane === 'point' ? 'Edit point text' : 'Rename',
        onSelect: () => rename(item),
      },
      item.lane !== 'point' && {
        label: checked ? 'Mark as not checked' : 'Mark as checked',
        onSelect: () => apply(toggleChecked(state, item.id)),
      },
      { separator: true, label: '' },
      {
        label:
          item.lane === 'chapter'
            ? 'Remove chapter and its contents'
            : item.lane === 'subchapter'
              ? 'Remove subchapter and its points'
              : 'Remove point',
        hint: keyOf('delete'),
        disabled: item.lane === 'chapter' && state.chapters.length < 2,
        onSelect: () => removeSelected(item.id),
      },
      changed.has(item.id) &&
        before.has(item.id) && {
          label: 'Undo my edits to this',
          onSelect: () => revertItem(item.id),
        },
    ];
    return entries.filter((entry): entry is MenuItem => Boolean(entry));
  };
  const timelineMenu = (context: TimelineContext) => {
    const at = roundTime(context.time);
    let entries: MenuItem[];
    if (context.marker) {
      entries = markerMenu(context.marker);
      setSelectedMarkerId(context.marker.id);
    } else if (context.lane === 'marks') {
      entries = [
        {
          label: `Mark ${formatClock(at)}`,
          hint: at === playhead ? keyOf('mark') : undefined,
          onSelect: () => markAt(at),
        },
        {
          label: `Play from ${formatClock(at)}`,
          onSelect: () => seekTo(at, { play: true }),
        },
      ];
    } else if (context.boundary) {
      const boundary = context.boundary;
      const item = rows.find((item) => item.id === boundary.id);
      entries = [
        {
          label: `Hear this edge (${formatClock(boundary.time)})`,
          hint: keyOf('hear'),
          onSelect: () => hear(boundary.time),
        },
        {
          label: `Move it to the playhead (${formatClock(playhead)})`,
          disabled:
            Math.abs(playhead - boundary.time) < 0.01 ||
            !canSetEdge(item, boundary.edge, playhead),
          onSelect: () =>
            apply(setEdge(state, length, boundary, playhead, linked)),
        },
      ];
      setActiveBoundary(boundary);
      setSelectedId(boundary.id);
    } else if (context.item) {
      entries = itemMenu(context.item, at);
      setSelectedId(context.item.id);
      setActiveBoundary(undefined);
    } else if (context.lane === 'ruler') {
      entries = [
        {
          label: `Play from ${formatClock(at)}`,
          onSelect: () => seekTo(at, { play: true }),
        },
        { label: `Move the playhead here`, onSelect: () => seekTo(at) },
        { label: `Mark ${formatClock(at)}`, onSelect: () => markAt(at) },
        { separator: true, label: '' },
        {
          label: 'Zoom in here',
          onSelect: () => viewByUser(zoomView(view, 0.4, at, length)),
        },
        {
          label: 'Show the whole recording',
          hint: keyOf('zoomFit'),
          onSelect: () => viewByUser(fitView(length)),
        },
      ];
    } else {
      entries = [
        ...(context.lane === 'subchapter'
          ? [
              {
                label: `Add a subchapter at ${formatClock(at)}`,
                onSelect: () => addSubchapter(at),
              },
            ]
          : context.lane === 'point'
            ? [
                {
                  label: `Add a key point at ${formatClock(at)}`,
                  onSelect: () => addPoint(at),
                },
              ]
            : chapterItems(at)),
        {
          label: `Play from ${formatClock(at)}`,
          onSelect: () => seekTo(at, { play: true }),
        },
      ];
    }
    setMenu({ x: context.x, y: context.y, items: entries });
  };

  /* ---------- Render ---------- */
  const rowFor = (item: EditorItem, inspector = false): ReactNode => {
    const isSelected = item.id === selectedId,
      own = issuesFor(item.id);
    const checked = state.checked.includes(item.id),
      wasChanged = changed.has(item.id),
      isNew = !before.has(item.id);
    const section = [...state.chapters, ...state.subchapters].find(
      (entry) => entry.id === item.id,
    );
    const point =
      item.lane === 'point'
        ? state.points.find((entry) => entry.id === item.id)
        : undefined;
    const contextMenu = (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('.ce-entry, .ce-section-editor') !==
          event.currentTarget ||
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
        items: itemMenu(item, playhead),
        trigger,
      });
    };
    if (point)
      return (
        <EditorPointNote
          key={point.id}
          point={point}
          selected={isSelected}
          playhead={playhead}
          issues={own}
          inputRef={pointInput}
          limits={edgeLimits(state, length, {
            id: point.id,
            lane: 'point',
            edge: 'start',
          })}
          onSelect={() => select(item, false, 'sidebar')}
          onGo={() => select(item, true, 'sidebar')}
          onText={(text) =>
            apply(
              editPoint(state, point.id, { text }),
              `point-text:${point.id}`,
            )
          }
          onTime={(value) => setItemEdge('start', value, point.id)}
          onRemove={() => removeSelected(point.id)}
          onContextMenu={contextMenu}
        />
      );
    const children = rows.filter(
      (child) => child.parentId === item.id && child.lane !== 'point',
    );
    const contentsId = `ce-contents-${item.id}`;
    const rowErrors = own.filter((issue) => issue.level === 'error');
    const edge = (label: string, which: 'start' | 'end', value: number) => (
      <EdgeControl
        key={which}
        label={label}
        value={value}
        playhead={playhead}
        changed={wasChanged}
        limits={edgeLimits(
          state,
          length,
          { lane: item.lane, id: item.id, edge: which },
          linked,
        )}
        onSet={(seconds) => setItemEdge(which, seconds, item.id)}
        onPlayhead={() => setItemEdge(which, playhead, item.id)}
        onGo={() => seekTo(value)}
        onScrub={(seconds) => {
          setItemEdge(
            which,
            seconds,
            item.id,
            linked,
            `scrub-${scrubSession.current}`,
          );
          seekTo(seconds, { live: true });
        }}
        onScrubEnd={() => {
          scrubSession.current++;
        }}
      />
    );
    if (inspector && section)
      return (
        <div
          className="ce-section-editor"
          key={item.id}
          data-entry={item.id}
          data-lane={item.lane}
          onContextMenu={contextMenu}
        >
          {item.parentId && (
            <p className="ce-parent-name">In {nameOf(item.parentId)}</p>
          )}
          <EditorTitleField
            value={section.title}
            label={
              item.lane === 'subchapter' ? 'Subchapter title' : 'Chapter title'
            }
            inputRef={titleInput}
            onSelect={() => select(item, false, 'sidebar')}
            onCommit={(title) => apply(editChapter(state, item.id, { title }))}
            onExit={() => editPane.current?.focus({ preventScroll: true })}
          />
          <section
            className="ce-descriptions"
            aria-label="Timestamped descriptions"
          >
            <h3>Timestamped descriptions</h3>
            <ol>
              {rows
                .filter(
                  (child) =>
                    child.parentId === item.id && child.lane === 'point',
                )
                .map((child) => rowFor(child))}
            </ol>
            {!state.points.some((point) => point.parentId === item.id) && (
              <p className="ce-muted">
                No descriptions yet. Move the playhead to a moment in this
                section, then add one.
              </p>
            )}
            <button
              type="button"
              className="ce-action"
              disabled={playhead < section.start || playhead >= section.end}
              onClick={() => addPoint(playhead, section.id)}
            >
              <Icon name="plus" />
              Add description at {formatClock(playhead)}
            </button>
          </section>
          <section
            className="ce-section-settings"
            aria-label="Section timing and metadata"
          >
            <h3>Timing and details</h3>
            {edge('Start', 'start', section.start)}
            {edge('End', 'end', section.end)}
            <label className="ce-field">
              <span className="ce-label">Type</span>
              <select
                value={section.kind}
                onChange={(event) =>
                  apply(
                    editChapter(state, section.id, {
                      kind: event.target.value as ChapterKind,
                    }),
                  )
                }
              >
                {CHAPTER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CHAPTER_TITLES[kind]}
                  </option>
                ))}
              </select>
            </label>
            <ChipList
              label="Scripture"
              items={section.scripture}
              placeholder="e.g. John 16:25–33"
              onChange={(scripture) =>
                apply(editChapter(state, section.id, { scripture }))
              }
              validate={(value) =>
                parseScriptureReference(value)
                  ? undefined
                  : 'Enter a Bible passage, such as John 16:25–33.'
              }
            />
          </section>
          {own.length > 0 && (
            <ul className="ce-notes">
              {own.map((issue) => (
                <li key={issue.message} className={`is-${issue.level}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <div className="ce-actions">
            {item.lane === 'chapter' && (
              <button
                type="button"
                className="ce-action"
                disabled={playhead <= section.start || playhead >= section.end}
                onClick={() => addSubchapter()}
              >
                <Icon name="plus" />
                Subchapter at {formatClock(playhead)}
              </button>
            )}
            <button
              type="button"
              className="ce-action"
              onClick={() => removeSelected(item.id)}
              disabled={item.lane === 'chapter' && state.chapters.length < 2}
            >
              <Icon name="close" />
              Remove {item.lane}
            </button>
            {!isNew && wasChanged && (
              <button
                type="button"
                className="ce-action"
                onClick={() => revertItem(item.id)}
              >
                <Icon name="undo" />
                Undo edits
              </button>
            )}
            <button
              type="button"
              className="ce-confirm"
              onClick={() => commands.confirmSection(item.id)}
            >
              <Icon name="check" />
              Mark checked & next
            </button>
          </div>
        </div>
      );
    return (
      <li
        key={item.id}
        data-entry={item.id}
        data-lane={item.lane}
        className={`ce-entry ce-chapter${item.lane !== 'chapter' ? ' is-sub' : ''}${selectedSection?.id === item.id ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}${checked ? ' is-checked' : ''}${nowPlaying?.id === item.id ? ' is-playing' : ''}${rowErrors.length ? ' has-error' : ''}`}
        onContextMenu={contextMenu}
      >
        <div
          className="ce-row"
          data-entry-header
          onClick={(event) => {
            if (
              !(event.target as HTMLElement).closest(
                'button, select, input, textarea, a, summary',
              )
            )
              select(item, false, 'sidebar');
          }}
        >
          <button
            type="button"
            className="ce-check"
            aria-pressed={checked}
            aria-label={
              checked
                ? `Unmark “${item.title}” as checked`
                : `Mark “${item.title}” as checked`
            }
            onClick={() => apply(toggleChecked(state, item.id))}
          >
            <span className="ce-check-mark">
              {checked && <Icon name="check" />}
            </span>
          </button>
          <button
            type="button"
            className="ce-range"
            onClick={() => select(item, true, 'sidebar')}
            aria-current={isSelected ? 'true' : undefined}
            title="Jump to its start"
            aria-label={`${formatClock(item.start)}${item.lane === 'point' ? '' : ` to ${formatClock(item.end)}`}: jump to the start`}
          >
            {formatClock(Math.floor(item.start))}
            {item.lane !== 'point' && `–${formatClock(Math.floor(item.end))}`}
          </button>
          <div className="ce-title-cell">
            {children.length > 0 ? (
              <button
                type="button"
                className="ce-expand"
                aria-expanded={expanded.has(item.id)}
                aria-controls={contentsId}
                aria-label={`${expanded.has(item.id) ? 'Collapse' : 'Expand'} ${item.title}`}
                onClick={() => toggleExpanded(item.id)}
              >
                <Icon name="chevron" />
              </button>
            ) : (
              <span className="ce-expand-space" aria-hidden="true" />
            )}
            <button
              type="button"
              className="ce-title"
              aria-current={
                selectedSection?.id === item.id ? 'true' : undefined
              }
              onClick={() => select(item, false, 'sidebar')}
              onDoubleClick={() => rename(item)}
              onKeyDown={(event) => {
                if (event.key === 'F2') {
                  event.preventDefault();
                  rename(item);
                }
              }}
              title={item.title}
            >
              {item.title}
            </button>
          </div>
          <span className="ce-flags">
            {isNew ? (
              <span className="ce-flag">New</span>
            ) : (
              wasChanged && <span className="ce-flag">Edited</span>
            )}
            {rowErrors.length > 0 && (
              <span
                className="ce-flag ce-flag-error"
                title={rowErrors.map((issue) => issue.message).join('\n')}
              >
                Fix
              </span>
            )}
          </span>
        </div>
        {children.length > 0 && (
          <ol
            id={contentsId}
            className="ce-children"
            hidden={!expanded.has(item.id)}
          >
            {children.map((child) => rowFor(child))}
          </ol>
        )}
      </li>
    );
  };
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
              <section
                className="ce-window ce-list-pane"
                aria-label="Chapter navigation"
              >
                <div className="ce-nav-caption">
                  <span>Choose a section to edit</span>
                  <span>Checked</span>
                </div>
                <ol className="ce-list" ref={list}>
                  {rows
                    .filter((item) => item.lane === 'chapter')
                    .map((item) => rowFor(item))}
                </ol>
              </section>
            ),
            editor: (
              <section
                className="ce-window ce-editor-pane"
                aria-label="Selected section"
              >
                <div className="ce-list-head ce-mobile-editor-head">
                  <button
                    type="button"
                    className="ce-link ce-back-to-list"
                    onClick={() => {
                      setWindow('chapters', true);
                      setMobileList(true);
                    }}
                  >
                    Back to chapters
                  </button>
                  <h2>
                    Edit{' '}
                    {selectedSection?.lane === 'subchapter'
                      ? 'subchapter'
                      : 'chapter'}
                  </h2>
                </div>
                <div className="ce-editor-body" ref={editPane} tabIndex={-1}>
                  {selectedSection ? (
                    rowFor(selectedSection, true)
                  ) : (
                    <p className="ce-muted">
                      Choose a chapter or subchapter to edit its title and
                      descriptions.
                    </p>
                  )}
                </div>
              </section>
            ),
            video: (
              <section className="ce-player-pane" aria-label="Video player">
                <div className="ce-stage-wrap">
                  <div className="ce-stage">
                    <div
                      ref={host}
                      className={`ce-host${player === 'ready' && !unavailable ? '' : ' youtube-host-hidden'}`}
                    />
                    {player === 'ready' && !unavailable && (
                      <button
                        type="button"
                        className="ce-click-layer"
                        onClick={togglePlay}
                        aria-label={playing ? 'Pause' : 'Play'}
                        tabIndex={-1}
                      />
                    )}
                    {unavailable && (
                      <div className="ce-stage-message ce-unavailable">
                        <UnavailableRecording
                          span={unavailable}
                          onGo={(at) => seekTo(at)}
                        />
                      </div>
                    )}
                    {player !== 'ready' && !unavailable && (
                      <div className="ce-stage-message">
                        {player === 'idle' && (
                          <>
                            <button
                              type="button"
                              className="ce-load"
                              onClick={() => load(time)}
                              aria-label="Load video"
                            >
                              <Icon name="play" />
                            </button>
                            <p>
                              {file
                                ? `Plays ${file.name} from this computer.`
                                : 'Plays from YouTube. YouTube will receive connection information.'}
                            </p>
                          </>
                        )}
                        {player === 'loading' && (
                          <p role="status">Loading the video…</p>
                        )}
                        {player === 'error' && (
                          <>
                            <p role="alert">{playerError}</p>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => load(time)}
                            >
                              Try again
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <p className="ce-source">
                  {file ? (
                    <>
                      Local file: <strong>{file.name}</strong> (not uploaded).{' '}
                      <button
                        type="button"
                        className="ce-link"
                        onClick={useYouTube}
                      >
                        Use YouTube instead
                      </button>
                    </>
                  ) : (
                    <>
                      Source: YouTube
                      {uploads.length > 1 &&
                        ` (${uploads.length} uploads, played as one)`}
                      .{' '}
                      {uploads.length === 1 && (
                        <button
                          type="button"
                          className="ce-link"
                          onClick={() => fileInput.current?.click()}
                        >
                          Use a video file on this computer instead
                        </button>
                      )}
                    </>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];
                      if (chosen) useFile(chosen);
                      event.target.value = '';
                    }}
                  />
                </p>
                {fileWarning && (
                  <p className="ce-warning" role="alert">
                    {fileWarning}
                  </p>
                )}
              </section>
            ),
            details: (
              <div className="ce-window-body ce-details-window">
                <label className="ce-field">
                  <span className="ce-label">
                    Title{' '}
                    <span className="ce-muted">
                      the sermon title as announced
                    </span>
                  </span>
                  <input
                    id="ce-details-title"
                    value={state.title}
                    onChange={(event) =>
                      apply(
                        { ...state, title: event.target.value },
                        'recording-title',
                      )
                    }
                  />
                </label>
                <label className="ce-field ce-grow">
                  <span className="ce-label">
                    Sermon description <WordCount text={state.description} />
                  </span>
                  <textarea
                    rows={8}
                    value={state.description}
                    placeholder="What the sermon argues and asks of the listener, in one paragraph."
                    onChange={(event) =>
                      apply(
                        { ...state, description: event.target.value },
                        'recording-description',
                      )
                    }
                  />
                </label>
                <ChipList
                  label="Scripture"
                  items={state.scripture}
                  placeholder="e.g. John 15:1-11"
                  onChange={(list) => apply({ ...state, scripture: list })}
                  validate={(value) =>
                    parseScriptureReference(value)
                      ? undefined
                      : 'That is not a Bible reference this archive understands. Try “Book 3:16” or “Book 3:16-18”.'
                  }
                />
                <ChipList
                  label="Topics"
                  items={state.topics}
                  placeholder="Choose a topic"
                  onChange={(list) => apply({ ...state, topics: list })}
                  options={base.topics.map((topic) => ({
                    value: topic.topicId,
                    name: topic.topicName,
                  }))}
                />
                {recordingIssues.map((issue) => (
                  <p
                    key={issue.message}
                    className={`ce-problem is-${issue.level}`}
                  >
                    {issue.message}
                  </p>
                ))}
              </div>
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
                onEdit={(id, change, key) =>
                  apply(editMarker(state, id, change), key)
                }
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

      <div
        className={`ce-toolbar${mobileTools ? ' is-open' : ''}`}
        role="toolbar"
        aria-label="Timeline tools"
      >
        <div className="ce-tool-group">
          <button
            type="button"
            className="ce-tool ce-play"
            onClick={togglePlay}
            disabled={Boolean(unavailable)}
            aria-label={playing ? 'Pause' : 'Play'}
            title={
              unavailable
                ? 'Choose an available part to play'
                : `${playing ? 'Pause' : 'Play'}${shortcutHint('play')}`
            }
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <TimeReadout
            time={time}
            duration={length}
            onSeek={(seconds) => seekTo(seconds)}
            onScrub={(seconds) => seekTo(seconds, { live: true })}
          />
          <div
            className="ce-segmented"
            role="group"
            aria-label="Playback speed"
          >
            {SPEEDS.map((rate) => (
              <button
                type="button"
                key={rate}
                aria-pressed={speed === rate}
                disabled={
                  availableSpeeds.length > 0 && !availableSpeeds.includes(rate)
                }
                title={
                  availableSpeeds.length > 0 && !availableSpeeds.includes(rate)
                    ? 'Not supported by this video'
                    : `Play at ${rate}× speed`
                }
                onClick={() => changeSpeed(rate)}
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>
        {speedNotice && (
          <span className="ce-notice-inline" role="status">
            {speedNotice}
          </span>
        )}
        <button
          type="button"
          className="ce-tool ce-mobile-tools"
          aria-expanded={mobileTools}
          onClick={() => setMobileTools((value) => !value)}
        >
          Timeline tools
        </button>
        <div className="ce-tool-group">
          <button
            type="button"
            className="ce-tool"
            onClick={() => setItemEdge('start', playhead)}
            disabled={!canSetEdge(selected, 'start', playhead)}
            title={`Start the selected item at the playhead${shortcutHint('setStart')}`}
          >
            <Icon name="setStart" />
            Start here
          </button>
          <button
            type="button"
            className="ce-tool"
            onClick={() => setItemEdge('end', playhead)}
            disabled={!canSetEdge(selected, 'end', playhead)}
            title={`End the selected item at the playhead${shortcutHint('setEnd')}`}
          >
            <Icon name="setEnd" />
            End here
          </button>
          <button
            type="button"
            className="ce-tool"
            aria-haspopup="menu"
            title="Start a chapter at the playhead"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu({
                x: box.left,
                y: box.top - 8,
                trigger: event.currentTarget,
                items: chapterItems(playhead),
              });
            }}
          >
            <Icon name="split" />
            Chapter
          </button>
          <button
            type="button"
            className="ce-tool"
            onClick={() => addSubchapter()}
            disabled={!chapterAt(state, playhead)}
            title={`Add a subchapter at the playhead${shortcutHint('addSubchapter')}`}
          >
            <Icon name="plus" />
            Subchapter
          </button>
          <button
            type="button"
            className="ce-tool"
            onClick={() => addPoint()}
            disabled={!chapterAt(state, playhead)}
            title={`Add a description at the playhead${shortcutHint('addPoint')}`}
          >
            <Icon name="plus" />
            Description
          </button>
          <button
            type="button"
            className="ce-tool"
            onClick={() => removeSelected(activeBoundary?.id)}
            disabled={!selected}
            title={`Remove the selected chapter, subchapter or point${shortcutHint('delete')}`}
          >
            <Icon name="trash" />
            Delete
          </button>
        </div>
        <div className="ce-tool-group">
          {notice && (
            <span className="ce-notice-inline" role="status">
              {notice}
            </span>
          )}
          <label
            className="ce-toggle"
            title="Move touching chapter boundaries and points together. Hold Alt (Option) while dragging to move only one edge."
          >
            <input
              type="checkbox"
              checked={linked}
              onChange={(event) => setLinked(event.target.checked)}
            />{' '}
            Move touching edges together
          </label>
          <button
            type="button"
            className="ce-tool"
            aria-pressed={snapping}
            onClick={() => setSnapping((value) => !value)}
            aria-label="Snapping"
            title={`Snapping: edges stick to the playhead and other edges${shortcutHint('snapping')}`}
          >
            <Icon name="magnet" />
            Snap
          </button>
          <button
            type="button"
            className="ce-tool ce-icon-tool"
            onClick={() => viewByUser(zoomView(view, 2, time, length))}
            aria-label="Zoom out"
            title={`Zoom out${shortcutHint('zoomOut')}`}
          >
            <Icon name="minus" />
          </button>
          <button
            type="button"
            className="ce-tool ce-icon-tool"
            onClick={() => viewByUser(zoomView(view, 0.5, time, length))}
            aria-label="Zoom in"
            title={`Zoom in${shortcutHint('zoomIn')}`}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="ce-tool"
            onClick={() => viewByUser(fitView(length))}
            title={`Show the whole recording${shortcutHint('zoomFit')}`}
          >
            Fit
          </button>
        </div>
      </div>
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
        <HelpDialog
          onClose={() => setDialog(undefined)}
          onAccount={() => setDialog('account')}
        />
      )}
      {dialog === 'account' && (
        <Modal
          title="Make a free GitHub account"
          onClose={() => setDialog(undefined)}
        >
          <SetupGuide
            onDone={() => setDialog(undefined)}
            doneLabel="Back to editing"
          />
        </Modal>
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
          onIncludeMarkers={includeLocalMarkers}
          backHref={back}
        />
      )}
    </div>
  );
}

/** An item's editable values, to tell what changed. */
function valueOf(state: EditorState, id: string): unknown {
  return (
    state.chapters.find((chapter) => chapter.id === id) ??
    state.subchapters.find((chapter) => chapter.id === id) ??
    state.points.find((point) => point.id === id)
  );
}

/* ---------- Dialogs ---------- */

function HelpDialog({
  onClose,
  onAccount,
}: {
  onClose: () => void;
  onAccount: () => void;
}) {
  const groups = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))];
  return (
    <Modal title="How this works" onClose={onClose}>
      <ol className="ce-steps">
        <li>
          <strong>Choose a chapter or subchapter.</strong> Its full title and
          timestamped descriptions appear in the editing area.
        </li>
        <li>
          <strong>Edit the title and descriptions directly.</strong> Click a
          timestamp or timeline diamond to listen there. Selecting text to edit
          does not move playback.
        </li>
        <li>
          <strong>Review & send</strong> opens a summary and instructions for
          sending through GitHub. Your edits stay in this browser until you send
          them.
        </li>
        <li>
          Press K to add a <strong>timestamped description</strong> at the
          playhead. Descriptions help search and reviewers; viewers see the
          named chapters and subchapters. Press P to add a subchapter.
        </li>
        <li>
          Press <strong>M</strong> to mark a moment to come back to. Your marks
          stay private unless you tick <strong>Send with my changes</strong>.
        </li>
        <li>
          <strong>Arrange your workspace.</strong> Drag panel headers to an edge
          to split the space, or to the middle to group panels as tabs. The Move
          button offers the same choices without dragging. Drag dividers to
          resize; focused dividers also use arrow keys.
        </li>
        <li>
          <strong>Windows</strong> opens the transcript, review markers,
          recording details and video. The transcript starts in a full-width
          bottom area. Your arrangement is saved in this browser; Windows →
          Reset the layout restores the starting arrangement.
        </li>
        <li>Right-click anything for more options.</li>
      </ol>
      <p>
        Sending needs a free GitHub account.{' '}
        <button type="button" className="text-link" onClick={onAccount}>
          Help me make one
        </button>
      </p>
      <p className="ce-muted">
        Everything works with the mouse; these keys are shortcuts. They pause
        while you type in a box.
      </p>
      {groups.map((group) => (
        <section key={group} className="ce-shortcut-group">
          <h3 className="ce-subhead">{group}</h3>
          <table className="ce-shortcuts">
            <tbody>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map(
                (shortcut) => (
                  <tr key={shortcut.action}>
                    <th scope="row">
                      <Key>{keyText(shortcut.label)}</Key>
                    </th>
                    <td>{keyText(shortcut.help)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </section>
      ))}
      <p className="ce-muted">
        {isMac()
          ? 'While dragging an edge: Option moves it alone, Cmd turns snapping off, Esc cancels. Cmd + scroll zooms the timeline.'
          : 'While dragging an edge: Alt moves it alone, Ctrl turns snapping off, Esc cancels. Ctrl + scroll zooms the timeline.'}
      </p>
    </Modal>
  );
}
