import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { DOCK_HEADER, measureDock, PANELS, PANEL_TITLES, visibleDock,
  type DockBox, type DockLayout, type DockPanel, type DockPosition } from '../lib/editor-dock';
import { Splitter } from './editor-layout';
import Icon from './Icon';

const POSITIONS: { value: DockPosition; label: string }[] = [
  { value: 'left', label: 'To the left' }, { value: 'right', label: 'To the right' },
  { value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }, { value: 'tab', label: 'As a tab' },
];
const styleBox = (box: DockBox): CSSProperties => ({ left: box.left, top: box.top, width: box.width, height: box.height });

function MovePanel({ panel, targets, onMove }: {
  panel: DockPanel; targets: DockPanel[]; onMove: (panel: DockPanel, target: DockPanel, position: DockPosition) => void;
}) {
  const [target, setTarget] = useState(targets[0]), [position, setPosition] = useState<DockPosition>('right');
  const popover = useRef<HTMLDivElement>(null);
  const chosen = targets.includes(target) ? target : targets[0];
  return <>
    <button type="button" className="ce-dock-move ce-tool" popoverTarget={`dock-move-${panel}`} aria-label={`Move ${PANEL_TITLES[panel]}`}
      onClick={event => {
        const box = event.currentTarget.getBoundingClientRect();
        if (popover.current) {
          popover.current.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 304))}px`;
          popover.current.style.top = `${Math.max(8, Math.min(box.bottom + 4, innerHeight - 260))}px`;
        }
      }}><Icon name="panels" /><span>Move</span></button>
    <div ref={popover} id={`dock-move-${panel}`} className="ce-dock-move-popover" popover="auto">
      <h3>Move {PANEL_TITLES[panel]}</h3>
      <label>Position<select value={position} onChange={event => setPosition(event.target.value as DockPosition)}>
        {POSITIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <label>Relative to<select value={chosen} onChange={event => setTarget(event.target.value as DockPanel)}>
        {targets.map(panel => <option key={panel} value={panel}>{PANEL_TITLES[panel]}</option>)}
      </select></label>
      <div className="action-row">
        <button type="button" className="button" disabled={!chosen} onClick={() => {
          popover.current?.hidePopover(); onMove(panel, chosen, position);
        }}>Move panel</button>
        <button type="button" className="button button-secondary" popoverTarget={`dock-move-${panel}`} popoverTargetAction="hide">Cancel</button>
      </div>
    </div>
  </>;
}

/** Content panels are permanent siblings. Docking changes coordinates, never
 * their React parent or DOM position (moving an iframe would restart playback). */
export default function EditorDock({ layout, panels, titles, onMove, onResize, onActivate, onClose }: {
  layout: DockLayout; panels: Record<DockPanel, ReactNode>; titles?: Partial<Record<DockPanel, string>>;
  onMove: (panel: DockPanel, target: DockPanel, position: DockPosition) => void;
  onResize: (id: string, ratio: number) => void; onActivate: (panel: DockPanel) => void; onClose: (panel: DockPanel) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 570 });
  const [compact, setCompact] = useState(false);
  const [dragging, setDragging] = useState<DockPanel>();
  const [drop, setDrop] = useState<{ target: DockPanel; position: DockPosition; box: DockBox }>();
  const dropRef = useRef<typeof drop>(undefined);
  const drag = useRef<{ panel: DockPanel; x: number; y: number; started: boolean }>(undefined);
  const suppressClick = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const tree = useMemo(() => visibleDock(layout.tree, layout.open)!, [layout.tree, layout.open]);
  const geometry = useMemo(() => measureDock(tree, size.width, size.height), [tree, size]);
  const title = (panel: DockPanel) => titles?.[panel] ?? PANEL_TITLES[panel];
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    const media = matchMedia('(max-width: 999px)');
    const adapt = () => setCompact(media.matches);
    adapt(); media.addEventListener('change', adapt);
    return () => { observer.disconnect(); media.removeEventListener('change', adapt); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { drag.current = undefined; dropRef.current = undefined; setDragging(undefined); setDrop(undefined); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, []);
  const move = (panel: DockPanel, target: DockPanel, position: DockPosition, keyboard = true) => {
    onMove(panel, target, position); setDragging(undefined); setDrop(undefined); dropRef.current = undefined;
    setAnnouncement(`${title(panel)} moved ${position === 'tab' ? 'into a tab group with' : position === 'left' || position === 'right' ? `to the ${position} of` : position} ${title(target)}.`);
    if (keyboard) requestAnimationFrame(() => document.getElementById(`dock-tab-${panel}`)?.focus({ preventScroll: true }));
  };
  const startDrag = (event: PointerEvent<HTMLElement>, panel: DockPanel) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { panel, x: event.clientX, y: event.clientY, started: false };
    suppressClick.current = false;
  };
  const over = (event: PointerEvent) => {
    const session = drag.current;
    if (!session || compact) return;
    if (!session.started && Math.hypot(event.clientX - session.x, event.clientY - session.y) < 6) return;
    session.started = true; suppressClick.current = true; setDragging(session.panel);
    const bounds = viewport.current!.getBoundingClientRect();
    const localX = event.clientX - bounds.left + viewport.current!.scrollLeft, localY = event.clientY - bounds.top + viewport.current!.scrollTop;
    const group = geometry.groups.find(({ box }) => localX >= box.left && localX <= box.left + box.width && localY >= box.top && localY <= box.top + box.height);
    const target = group?.node.tabs.find(panel => panel !== session.panel);
    if (!group || !target || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dropRef.current = undefined; setDrop(undefined); return;
    }
    const { box } = group;
    const x = (localX - box.left) / box.width, y = (localY - box.top) / box.height;
    const distance = Math.min(x, 1 - x, y, 1 - y);
    const position: DockPosition = distance > 0.25 ? 'tab' : distance === x ? 'left' : distance === 1 - x ? 'right' : distance === y ? 'above' : 'below';
    const preview = { ...box };
    if (position === 'left' || position === 'right') { preview.width /= 2; if (position === 'right') preview.left += preview.width; }
    if (position === 'above' || position === 'below') { preview.height /= 2; if (position === 'below') preview.top += preview.height; }
    dropRef.current = { target, position, box: preview }; setDrop(dropRef.current);
  };
  const endDrag = () => {
    const session = drag.current, destination = dropRef.current;
    drag.current = undefined;
    if (session?.started && destination) move(session.panel, destination.target, destination.position, false);
    else { setDragging(undefined); setDrop(undefined); dropRef.current = undefined; }
    // Suppress only the click generated by this pointer-up, not the next real click.
    setTimeout(() => { suppressClick.current = false; }, 0);
  };
  return <div ref={viewport} className={`ce-dock${compact ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`}>
    <div className="ce-dock-canvas" style={compact ? undefined : { width: geometry.width, height: geometry.height }}>
      {PANELS.map(panel => {
        const group = geometry.groups.find(group => group.node.tabs.includes(panel));
        const shown = compact ? layout.open.includes(panel) : group?.node.active === panel;
        return <div key={panel} id={`dock-panel-${panel}`} role={compact ? 'region' : 'tabpanel'}
          aria-label={title(panel)} className={`ce-dock-panel ce-dock-panel-${panel}`} hidden={!shown}
          style={!compact && group ? styleBox({ ...group.box, top: group.box.top + DOCK_HEADER, height: group.box.height - DOCK_HEADER }) : undefined}>
          <div className="ce-dock-mobile-head"><h2>{title(panel)}</h2>{panel !== 'editor' && <button type="button" className="ce-icon" aria-label={`Close ${title(panel)}`} onClick={() => onClose(panel)}><Icon name="close" /></button>}</div>
          {panels[panel]}
        </div>;
      })}
      {!compact && geometry.groups.map(({ node, box }) => <div className="ce-dock-header" key={node.id} style={styleBox({ ...box, height: DOCK_HEADER })}
        onPointerDown={event => { if ((event.target as HTMLElement).closest('button, input, select, [popover]')) return; startDrag(event, node.active); }}
        onPointerMove={over} onPointerUp={endDrag} onPointerCancel={() => { drag.current = undefined; endDrag(); }}>
        <div className="ce-dock-tabs" role="tablist" aria-label="Panel group">
          {node.tabs.map(panel => <button key={panel} id={`dock-tab-${panel}`} type="button" role="tab" aria-selected={node.active === panel}
            aria-controls={`dock-panel-${panel}`} tabIndex={node.active === panel ? 0 : -1}
            title={`Drag ${title(panel)} to rearrange`} onPointerDown={event => { event.stopPropagation(); startDrag(event, panel); }}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onActivate(panel); }} onKeyDown={event => {
              const index = node.tabs.indexOf(panel);
              const next = event.key === 'ArrowRight' ? (index + 1) % node.tabs.length : event.key === 'ArrowLeft' ? (index + node.tabs.length - 1) % node.tabs.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? node.tabs.length - 1 : undefined;
              if (next === undefined) return;
              event.preventDefault(); onActivate(node.tabs[next]); document.getElementById(`dock-tab-${node.tabs[next]}`)?.focus({ preventScroll: true });
            }}>{title(panel)}</button>)}
        </div>
        <MovePanel key={node.active} panel={node.active} targets={layout.open.filter(panel => panel !== node.active)} onMove={move} />
        {node.active !== 'editor' && <button type="button" className="ce-icon ce-dock-close" aria-label={`Close ${title(node.active)}`} onClick={() => onClose(node.active)}><Icon name="close" /></button>}
      </div>)}
      {!compact && geometry.dividers.map(({ node, box, span, value, min, max }) => <div className="ce-dock-divider" key={node.id} style={styleBox(box)}>
        <Splitter orientation={node.axis === 'row' ? 'vertical' : 'horizontal'} grow="after" label={`Resize ${PANEL_TITLES[firstPanel(node.first)]} and ${PANEL_TITLES[firstPanel(node.second)]}`}
          value={value} min={min} max={max} onDrag={value => onResize(node.id, value / span)} onReset={() => onResize(node.id, 0.5)} />
      </div>)}
      {dragging && !compact && <div className="ce-dock-drag-shield" />}
      {drop && dragging && <div className="ce-dock-drop-preview" style={styleBox(drop.box)}>
        <span>{drop.position === 'tab' ? 'Group as tabs' : `Move ${title(dragging)} ${drop.position}`}</span>
      </div>}
    </div>
    <span className="sr-only" role="status">{announcement}</span>
  </div>;
}

function firstPanel(node: import('../lib/editor-dock').DockNode): DockPanel {
  return node.kind === 'group' ? node.active : firstPanel(node.first);
}
