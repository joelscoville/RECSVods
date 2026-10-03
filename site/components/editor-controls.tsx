import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { formatTimecode, parseTimecode } from '../lib/timecode';
import { formatClock } from '../lib/recording-editor';

/** Keep invalid input visible, and make Escape a real cancellation. */
export function TimeInput({ value, label, min = 0, max = Infinity, relative = false, className,
  onCommit, onCancel }: { value: number; label: string; min?: number; max?: number; relative?: boolean; className?: string;
  onCommit: (value: number, reason: 'enter' | 'blur') => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(formatTimecode(value)), [error, setError] = useState('');
  const finished = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  const commit = (reason: 'enter' | 'blur') => {
    if (finished.current) return;
    let next: number;
    try {
      const text = draft.trim();
      next = relative && /^[+-]\d+(?:\.\d+)?$/.test(text) ? value + Number(text)
        : /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : parseTimecode(text);
    } catch { setError('Enter a time like 33:05 or a number of seconds.'); return; }
    if (!Number.isFinite(next) || next < min || next > max) { setError(`Use a time from ${formatClock(min)}${Number.isFinite(max) ? ` to ${formatClock(max)}` : ' onwards'}.`); return; }
    finished.current = true; onCommit(next, reason);
  };
  return <span className="ce-time-entry">
    <input ref={input} className={className} autoFocus value={draft} aria-label={label} aria-invalid={Boolean(error)}
      onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={() => commit('blur')}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit('enter'); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finished.current = true; onCancel(); }
      }} />
    {error && <span className="ce-time-error" role="alert">{error}</span>}
  </span>;
}

/** Press and drag sideways on a number to change it, as in video editors: 0.1 s per pixel,
 * Shift for 1 s, Alt/Option for 0.01 s. A plain click still clicks. */
export function useScrubbable(value: number, onChange: (next: number) => void, onEnd?: (value: number) => void, limits: readonly [number, number] = [0, Infinity]) {
  const drag = useRef<{ x: number; value: number; moved: boolean; pointer: number } | null>(null);
  const suppressClick = useRef(false);
  const finish = () => { document.documentElement.classList.remove('ce-scrubbing'); };
  useEffect(() => finish, []);
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      drag.current = { x: event.clientX, value, moved: false, pointer: event.pointerId };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const active = drag.current;
      if (!active) return;
      const dx = event.clientX - active.x;
      if (!active.moved) {
        if (Math.abs(dx) < 3) return;
        active.moved = true;
        try { event.currentTarget.setPointerCapture(active.pointer); } catch { /* Capture is a nicety; the drag still works. */ }
        document.documentElement.classList.add('ce-scrubbing');
      }
      const rate = event.shiftKey ? 1 : event.altKey ? 0.01 : 0.1;
      active.value = Math.min(limits[1], Math.max(limits[0], Math.round((active.value + dx * rate) * 100) / 100));
      active.x = event.clientX;
      onChange(active.value);
    },
    onPointerUp() {
      const active = drag.current;
      drag.current = null;
      finish();
      if (active?.moved) { suppressClick.current = true; onEnd?.(active.value); }
    },
    onPointerCancel() { drag.current = null; finish(); },
    onClickCapture(event: ReactMouseEvent) {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    },
  };
}

export interface MenuItem { label: string; hint?: string; onSelect?: () => void; disabled?: boolean; separator?: boolean; checked?: boolean }
export interface MenuRequest { x: number; y: number; items: MenuItem[]; trigger?: HTMLElement }

/** A right-click menu: arrow keys and Enter work, Esc or a click elsewhere closes it. */
export function ContextMenu({ menu, onClose }: { menu: MenuRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const origin = useRef(menu.trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const close = useRef(onClose); close.current = onClose;
  const dismiss = (restore = true) => { if (restore) origin.current?.focus({ preventScroll: true }); close.current(); };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Keep the menu on screen.
    const box = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(menu.x, innerWidth - box.width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(menu.y, innerHeight - box.height - 4))}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (event: Event) => { if (!element.contains(event.target as Node)) close.current(); };
    const leave = () => close.current();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', leave);
    window.addEventListener('blur', leave);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', leave); window.removeEventListener('blur', leave); };
  }, [menu]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    else if (event.key === 'Tab') {
      event.preventDefault();
      const stops = [...document.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length && !ref.current?.contains(element));
      const next = stops[stops.indexOf(origin.current!) + (event.shiftKey ? -1 : 1)];
      dismiss(false); (next ?? origin.current)?.focus({ preventScroll: true });
    }
    else if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus(); }
    event.stopPropagation();
  };
  return <div ref={ref} className="ce-menu" role="menu" style={{ left: menu.x, top: menu.y }} onKeyDown={onKeyDown} onContextMenu={event => event.preventDefault()}>
    {menu.items.map((item, i) => item.separator ? <div key={i} className="ce-menu-separator" role="separator" />
      : <button key={i} type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} disabled={item.disabled}
        className={item.checked === undefined ? undefined : 'ce-menu-check'} onClick={() => { dismiss(); item.onSelect?.(); }}>
        <span>{item.label}</span>{item.hint && <kbd>{item.hint}</kbd>}</button>)}
  </div>;
}
