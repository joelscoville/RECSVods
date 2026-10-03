import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { formatClock, type EditorIssue, type EditorPoint } from '../lib/recording-editor';
import { TimeInput } from './editor-controls';
import Icon from './Icon';

/** A point is a timestamped description, not a named/ranged outline section. */
export default function EditorPointNote({ point, selected, limits, playhead, issues, inputRef,
  onSelect, onGo, onText, onTime, onRemove, onContextMenu }: {
  point: EditorPoint; selected: boolean; limits: [number, number]; playhead: number; issues: EditorIssue[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSelect: () => void; onGo: () => void; onText: (text: string) => void; onTime: (time: number) => void;
  onRemove: () => void; onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null), stamp = useRef<HTMLButtonElement>(null);
  const [typingTime, setTypingTime] = useState(false);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const fit = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight + 2}px`; };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; fit(); } });
    observer.observe(element); return () => observer.disconnect();
  }, [point.text]);
  const editTime = () => { onSelect(); setTypingTime(true); };
  const returnFocus = () => requestAnimationFrame(() => stamp.current?.focus({ preventScroll: true }));
  return <li className={`ce-entry ce-point-note${selected ? ' is-selected' : ''}`} data-entry={point.id} data-lane="point"
    onClick={event => event.stopPropagation()} onContextMenu={onContextMenu}>
    <div className="ce-note-row" data-entry-header>
      {typingTime ? <TimeInput value={point.time} label="Description time" min={limits[0]} max={limits[1]}
        onCommit={(value, reason) => { onTime(value); setTypingTime(false); if (reason === 'enter') returnFocus(); }}
        onCancel={() => { setTypingTime(false); returnFocus(); }} />
        : <button ref={stamp} type="button" className="ce-point-time" onClick={onGo} onDoubleClick={editTime}
          aria-label={`Go to ${formatClock(point.time)}`} title="Go to this moment. Double-click or press F2 to edit the time."
          onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); editTime(); } }}>{formatClock(point.time)}</button>}
      <textarea ref={element => { area.current = element; if (selected) inputRef.current = element; }} className="ce-point-text"
        rows={1} aria-label={`Description at ${formatClock(point.time)}`} placeholder="Describe what happens here…" value={point.text}
        onFocus={onSelect} onChange={event => onText(event.target.value)} />
    </div>
    <div className="ce-note-tools">
      {!typingTime && <button type="button" className="ce-link" onClick={editTime}>Edit time</button>}
      <button type="button" className="ce-link" onClick={() => onTime(playhead)} disabled={playhead < limits[0] || playhead > limits[1] || Math.abs(point.time - playhead) < 0.01}>Use playhead time</button>
      <button type="button" className="ce-icon" aria-label={`Remove description at ${formatClock(point.time)}`} onClick={onRemove}><Icon name="trash" /></button>
    </div>
    {issues.length > 0 && <ul className="ce-notes ce-note-errors">{issues.map(issue => <li className="is-error" key={issue.message}>{issue.message}</li>)}</ul>}
  </li>;
}
