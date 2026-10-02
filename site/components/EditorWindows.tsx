/** The optional windows beside the video: a transcript and the list of markers. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatClock, isFileMarker, type EditorMarker } from '../lib/recording-editor';
import { lineAt, parseTranscript, readSavedTranscript, saveTranscript, type Transcript, type TranscriptLine } from '../lib/transcript';
import { useScrubbable } from './editor-controls';
import Icon from './Icon';

/* ---------- Transcript ---------- */

const Line = memo(function Line({ line, current, onSeek, onMark }: { line: TranscriptLine; current: boolean; onSeek: (seconds: number) => void; onMark: (seconds: number) => void }) {
  return <li className={current ? 'is-current' : undefined} aria-current={current ? 'true' : undefined}
    onContextMenu={event => { event.preventDefault(); onMark(line.start); }}>
    <button type="button" className="ce-tr-time" onClick={() => onSeek(line.start)} title="Go here">{formatClock(Math.floor(line.start))}</button>
    <span className="ce-tr-text">{line.text}</span>
  </li>;
});

export function TranscriptWindow({ videoId, time, onSeek, onMark }: {
  /** Moves the playhead only: playing stays playing, paused stays paused. */
  videoId: string; time: number; onSeek: (seconds: number) => void; onMark: (seconds: number) => void;
}) {
  // Stable callbacks, so only the lines whose highlight changes re-render as the video plays.
  const handlers = useRef({ onSeek, onMark });
  handlers.current = { onSeek, onMark };
  const seek = useCallback((seconds: number) => {
    manualScroll.current = false;
    setFollowing(true);
    handlers.current.onSeek(seconds);
  }, []);
  const mark = useCallback((seconds: number) => handlers.current.onMark(seconds), []);
  const [transcript, setTranscript] = useState<Transcript | undefined>(() => readSavedTranscript(videoId));
  const [problem, setProblem] = useState<string>();
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState(true), [returnRequest, setReturnRequest] = useState(0);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLOListElement>(null);
  const manualScroll = useRef(false), programmaticTop = useRef<number | undefined>(undefined);
  useEffect(() => {
    setTranscript(readSavedTranscript(videoId)); setProblem(undefined); setQuery(''); setFollowing(true);
    manualScroll.current = false; programmaticTop.current = undefined;
  }, [videoId]);

  const choose = async (file: File) => {
    try {
      const loaded = parseTranscript(file.name, await file.text());
      setTranscript(loaded); setProblem(undefined); setQuery(''); setFollowing(true); manualScroll.current = false;
      if (!saveTranscript(videoId, loaded)) setProblem('Loaded, but too large to keep in this browser: load it again next time.');
    } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
  };
  const lines = transcript?.lines ?? [];
  const current = lineAt(lines, time);
  const words = query.trim().toLowerCase();
  const shown = useMemo(() => words ? lines.map((line, index) => ({ line, index })).filter(({ line }) => line.text.toLowerCase().includes(words)) : lines.map((line, index) => ({ line, index })),
    [lines, words]);
  // Playback and scrubber seeks share one current-line highlight. Browsing is a
  // deliberate pause in automatic scrolling, not a timeout that steals the view back.
  useLayoutEffect(() => {
    const container = list.current;
    if (!container) return;
    const reveal = () => {
      if (!following || words || !container.clientHeight) return;
      const line = container.querySelector<HTMLElement>('.is-current') ?? (current < 0 ? container.firstElementChild as HTMLElement | null : null);
      if (!line) return;
      const viewport = container.getBoundingClientRect(), box = line.getBoundingClientRect();
      const fits = box.height <= viewport.height;
      if (box.top < viewport.top - 1 || (fits && box.bottom > viewport.bottom + 1) || box.top >= viewport.bottom) {
        container.scrollTop += box.top - viewport.top - Math.max(0, (viewport.height - box.height) / 2);
        programmaticTop.current = container.scrollTop;
        manualScroll.current = false;
      }
    };
    reveal();
    // Docking, opening a hidden tab, or resizing can expose a different number of lines.
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [current, following, words, transcript, returnRequest]);
  const browseIntent = () => { manualScroll.current = true; programmaticTop.current = undefined; };
  const scrolled = () => {
    const container = list.current;
    if (!following || !manualScroll.current || !container?.clientHeight || words) return;
    if (programmaticTop.current !== undefined && Math.abs(container.scrollTop - programmaticTop.current) < 1) return;
    const line = container.querySelector<HTMLElement>('.is-current') ?? (current < 0 ? container.firstElementChild as HTMLElement | null : null);
    if (!line) return;
    const viewport = container.getBoundingClientRect(), box = line.getBoundingClientRect();
    if (box.bottom <= viewport.top + 1 || box.top >= viewport.bottom - 1) setFollowing(false);
  };
  const returnToNow = () => {
    manualScroll.current = false; programmaticTop.current = undefined;
    setQuery(''); setFollowing(true); setReturnRequest(value => value + 1);
    list.current?.focus({ preventScroll: true });
  };

  const picker = <input ref={input} type="file" accept=".json,.srt,.vtt,application/json,text/vtt" hidden
    onChange={event => { const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = ''; }} />;
  if (!transcript) return <div className="ce-window-body ce-tr-empty">
    <p>Load a transcript to read along.</p>
    <button type="button" className="button button-secondary" onClick={() => input.current?.click()}>Choose a file</button>
    <p className="ce-muted">Whisper JSON, or captions (.srt, .vtt). It stays in this browser.</p>
    <details className="ce-more"><summary>Get YouTube’s captions</summary>
      <p className="ce-muted">YouTube does not let other sites read its captions, so save them with <a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a>, then choose the .vtt file:</p>
      <pre className="ce-code">yt-dlp --write-auto-subs --sub-langs en --skip-download https://youtu.be/{videoId}</pre>
    </details>
    {problem && <p className="ce-problem" role="alert">{problem}</p>}
    {picker}
  </div>;
  return <div className="ce-window-body ce-tr">
    <div className="ce-tr-tools">
      <input type="search" value={query} placeholder="Find in transcript" aria-label="Find in transcript" onChange={event => { setQuery(event.target.value); if (event.target.value.trim()) setFollowing(false); }} />
      <button type="button" className="ce-tool ce-tr-return" onClick={returnToNow} disabled={following && !words}
        title={following && !words ? 'Following the scrubber. Scroll away to browse.' : 'Show the caption at the scrubber and resume following. Clears transcript search.'}>
        <Icon name="goto" />{following && !words ? 'Following now' : 'Return to now'}
      </button>
    </div>
    {transcript.videoId && transcript.videoId !== videoId && <p className="ce-warning">This transcript is for another video ({transcript.videoId}).</p>}
    {problem && <p className="ce-problem" role="alert">{problem}</p>}
    {words && <p className="ce-muted ce-tr-count">{shown.length} line{shown.length === 1 ? '' : 's'} match</p>}
    <ol className="ce-tr-lines" ref={list} tabIndex={0} aria-label="Transcript lines" onScroll={scrolled} onWheel={browseIntent} onPointerDown={browseIntent}
      onKeyDown={event => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
          && (event.target === event.currentTarget || event.key !== ' ')) {
          browseIntent(); event.stopPropagation();
        }
      }}>
      {shown.map(({ line, index }) => <Line key={index} line={line} current={index === current} onSeek={seek} onMark={mark} />)}
    </ol>
    <p className="ce-tr-foot ce-muted">{transcript.name} · right-click a line to mark it ·{' '}
      <button type="button" className="ce-link" onClick={() => input.current?.click()}>Replace</button> ·{' '}
      <button type="button" className="ce-link" onClick={() => { saveTranscript(videoId, undefined); setTranscript(undefined); }}>Remove</button></p>
    {picker}
  </div>;
}

/* ---------- Markers ---------- */

function MarkerTime({ marker, onSet, onEnd }: { marker: EditorMarker; onSet: (seconds: number) => void; onEnd: () => void }) {
  const scrub = useScrubbable(marker.at, onSet, onEnd);
  return <button type="button" className="ce-marker-time ce-scrubbable" {...scrub} title="Drag sideways to move it">{formatClock(marker.at)}{marker.end !== undefined && `–${formatClock(marker.end)}`}</button>;
}

export function MarkersWindow({ markers, selectedId, focusId, playhead, onSelect, onGo, onEdit, onRemove, onAdd }: {
  markers: EditorMarker[]; selectedId?: string; focusId?: string; playhead: number;
  onSelect: (id: string) => void; onGo: (marker: EditorMarker) => void;
  onEdit: (id: string, change: Partial<EditorMarker>, key?: string) => void; onRemove: (id: string) => void; onAdd: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const session = useRef(0);
  useEffect(() => {
    const container = list.current?.parentElement, marker = list.current?.querySelector<HTMLElement>('.is-selected');
    if (!container?.clientHeight || !marker) return;
    const viewport = container.getBoundingClientRect(), box = marker.getBoundingClientRect();
    if (box.top < viewport.top) container.scrollTop += box.top - viewport.top;
    else if (box.bottom > viewport.bottom) container.scrollTop += Math.min(box.bottom - viewport.bottom, box.top - viewport.top);
  }, [selectedId]);
  useEffect(() => { if (focusId) list.current?.querySelector<HTMLTextAreaElement>(`[data-marker="${focusId}"] textarea`)?.focus({ preventScroll: true }); }, [focusId]);
  const sorted = [...markers].sort((a, b) => a.at - b.at);
  return <div className="ce-window-body ce-markers">
    <div className="ce-markers-tools">
      <button type="button" className="button button-secondary" onClick={onAdd}><Icon name="plus" />Mark {formatClock(playhead)}</button>
      <span className="ce-muted">M marks the playhead</span>
    </div>
    {!sorted.length && <p className="ce-muted ce-markers-empty">No markers yet. Mark anything worth a second look; you choose which to send.</p>}
    <ol className="ce-marker-list" ref={list}>{sorted.map(marker => {
      const mine = !isFileMarker(marker);
      return <li key={marker.id} data-marker={marker.id} className={`ce-marker${marker.id === selectedId ? ' is-selected' : ''}${mine ? ' is-mine' : ''}${mine && !marker.include ? ' is-private' : ''}`}
        onClick={() => onSelect(marker.id)}>
        <div className="ce-marker-row">
          <svg className="ce-marker-flag" viewBox="0 0 16 22" width="13" height="18" aria-hidden="true"><path d="M1.5 1.5h13v12.2L8 20.5l-6.5-6.8z" /></svg>
          <MarkerTime marker={marker} onSet={seconds => onEdit(marker.id, { at: Math.max(0, seconds) }, `marker-time:${marker.id}:${session.current}`)} onEnd={() => { session.current++; }} />
          <span className="ce-muted ce-marker-source">{mine ? 'Yours' : 'In the file'}</span>
          <button type="button" className="ce-icon" onClick={event => { event.stopPropagation(); onGo(marker); }} aria-label={`Go to ${formatClock(marker.at)}`} title="Go to this marker"><Icon name="goto" /></button>
          <button type="button" className="ce-icon" onClick={event => { event.stopPropagation(); onEdit(marker.id, { at: playhead }); }} aria-label="Move to the playhead" title={`Move to ${formatClock(playhead)}`}><Icon name="setStart" /></button>
          <button type="button" className="ce-icon" onClick={event => { event.stopPropagation(); onRemove(marker.id); }} aria-label={mine ? 'Delete marker' : 'Remove from the file'} title={mine ? 'Delete' : 'Remove from the file (resolved)'}><Icon name="trash" /></button>
        </div>
        <textarea rows={2} value={marker.note} placeholder="What should someone look at here?" aria-label={`Note at ${formatClock(marker.at)}`}
          onChange={event => onEdit(marker.id, { note: event.target.value }, `marker-note:${marker.id}`)} />
        {mine && <label className="ce-toggle ce-marker-send"><input type="checkbox" checked={marker.include} onChange={event => onEdit(marker.id, { include: event.target.checked })} /> Send with my changes</label>}
      </li>;
    })}</ol>
  </div>;
}
