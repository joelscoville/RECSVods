/** Saved dock tree, panel visibility and workspace height. Compact screens keep
 * the desktop arrangement intact while presenting a readable stacked layout. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { activateDock, defaultDock, DOCK_KEY, moveDock, PANEL_TITLES, parseDock, resizeDock, type DockLayout, type DockPanel, type DockPosition } from '../lib/editor-dock';

export const WINDOWS = ['chapters', 'video', 'details', 'readalong', 'markers'] as const;
export type EditorWindow = DockPanel;
export const WINDOW_TITLES = PANEL_TITLES;
export const MIN_TOP = 300, MIN_TIMELINE = 216;

function readLayout(): DockLayout {
  try {
    const current = localStorage.getItem(DOCK_KEY);
    if (current) return parseDock(JSON.parse(current)) ?? defaultDock();
    const old = JSON.parse(localStorage.getItem('recs-chapter-editor:layout:v1') || 'null');
    const next = defaultDock();
    if (Array.isArray(old?.open)) next.open = ['editor', 'video', ...WINDOWS.filter(panel => panel !== 'video' && old.open.includes(panel))];
    if (Number.isFinite(old?.top)) next.top = Math.max(300, Math.min(2000, old.top));
    return next;
  } catch { return defaultDock(); }
}

export function useEditorLayout() {
  const [layout, setLayout] = useState<DockLayout>(readLayout);
  useEffect(() => { try { localStorage.setItem(DOCK_KEY, JSON.stringify(layout)); } catch { /* not saved */ } }, [layout]);
  const toggle = useCallback((name: EditorWindow, value?: boolean) => setLayout(current => {
    const on = value ?? !current.open.includes(name);
    if (name === 'editor' && !on) return current;
    return { ...current, tree: on ? activateDock(current.tree, name) : current.tree,
      open: on ? [...new Set([...current.open, name])] : current.open.filter(item => item !== name) };
  }), []);
  const activate = useCallback((panel: DockPanel) => setLayout(current => ({ ...current, tree: activateDock(current.tree, panel) })), []);
  const move = useCallback((panel: DockPanel, target: DockPanel, position: DockPosition) => setLayout(current => ({ ...current, tree: moveDock(current.tree, panel, target, position) })), []);
  const resize = useCallback((id: string, ratio: number) => setLayout(current => ({ ...current, tree: resizeDock(current.tree, id, ratio) })), []);
  const setTop = useCallback((top: number | undefined) => setLayout(current => ({ ...current, top: top === undefined ? undefined : Math.round(top) })), []);
  const reset = useCallback(() => setLayout(defaultDock()), []);
  return { layout, toggle, activate, move, resize, setTop, reset };
}

/** A drag handle between two areas. `delta` is the pointer's travel since the drag began, in pixels. */
export function Splitter({ orientation, label, value, min, max, onDrag, onReset, grow = 'before' }: {
  orientation: 'vertical' | 'horizontal'; label: string; value: number; min: number; max: number;
  onDrag: (value: number) => void; onReset: () => void;
  grow?: 'before' | 'after';
}) {
  const start = useRef<{ pointer: number; value: number }>(undefined);
  const [active, setActive] = useState(false);
  const along = (event: PointerEvent) => orientation === 'vertical' ? event.clientX : event.clientY;
  // A vertical handle sits left of the window it sizes, so moving left makes it wider.
  const sign = orientation === 'vertical' && grow === 'before' ? -1 : 1;
  const clamp = (next: number) => Math.min(Math.max(next, min), Math.max(min, max));
  return <div role="separator" aria-orientation={orientation} aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={Math.round(max)}
    tabIndex={0} className={`ce-splitter ce-splitter-${orientation}${active ? ' is-active' : ''}`} title={`Drag to resize · double-click to reset`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { pointer: along(event), value }; setActive(true);
    }}
    onPointerMove={event => { if (start.current) onDrag(clamp(start.current.value + sign * (along(event) - start.current.pointer))); }}
    onPointerUp={() => { start.current = undefined; setActive(false); }}
    onPointerCancel={() => { start.current = undefined; setActive(false); }}
    onDoubleClick={onReset}
    onKeyDown={(event: KeyboardEvent) => {
      const step = event.shiftKey ? 64 : 16;
      const directions: Record<string, number> = orientation === 'vertical' ? { ArrowLeft: -step * sign, ArrowRight: step * sign } : { ArrowDown: step, ArrowUp: -step };
      const delta = directions[event.key];
      if (delta === undefined) return;
      event.preventDefault(); event.stopPropagation();
      onDrag(clamp(value + delta));
    }} />;
}
