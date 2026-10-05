import { useRef, useState } from 'react';
import { formatClock } from '../lib/recording-editor';
import { words } from '../lib/recording-schema';
import { TimeInput, useScrubbable } from './editor-controls';
import Icon from './Icon';

export function WordCount({ text }: { text: string }) {
  return <span className="ce-muted"> {words(text)} words</span>;
}

export function ChipList({
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
  options?: { value: string; name: string }[];
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  function add(value = draft.trim()) {
    if (!value) return;
    const error = validate?.(value);
    if (error) {
      setProblem(error);
      return;
    }
    if (!items.includes(value)) onChange([...items, value]);
    setDraft('');
    setProblem('');
  }
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

export function EdgeControl({
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
  const [typing, setTyping] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
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

export function TimeReadout({
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
  const [typing, setTyping] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
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
