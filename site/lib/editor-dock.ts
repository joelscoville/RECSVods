/** Serializable docking geometry. Hidden panels keep their place in the tree. */
export const PANELS = ['chapters', 'editor', 'video', 'readalong', 'details', 'markers'] as const;
export type DockPanel = typeof PANELS[number];
export const PANEL_TITLES: Record<DockPanel, string> = {
  chapters: 'Chapters', editor: 'Edit chapter', video: 'Video', readalong: 'Transcript', details: 'Details', markers: 'Markers',
};
export type DockPosition = 'left' | 'right' | 'above' | 'below' | 'tab';
export type DockNode =
  | { kind: 'group'; id: string; tabs: DockPanel[]; active: DockPanel }
  | { kind: 'split'; id: string; axis: 'row' | 'column'; ratio: number; first: DockNode; second: DockNode };
export interface DockLayout { tree: DockNode; open: DockPanel[]; top?: number }
export const DOCK_KEY = 'recs-chapter-editor:layout:v2';
export const DIVIDER = 8, DOCK_HEADER = 44;
export const defaultDock = (): DockLayout => ({
  open: ['chapters', 'editor', 'video'],
  tree: { kind: 'split', id: 'bottom', axis: 'column', ratio: 0.56,
    first: { kind: 'split', id: 'navigation', axis: 'row', ratio: 0.19,
      first: { kind: 'group', id: 'chapters', tabs: ['chapters'], active: 'chapters' },
      second: { kind: 'split', id: 'writing', axis: 'row', ratio: 0.6,
        first: { kind: 'group', id: 'editor', tabs: ['editor'], active: 'editor' },
        second: { kind: 'group', id: 'video', tabs: ['video'], active: 'video' } } },
    second: { kind: 'group', id: 'reference', tabs: ['readalong', 'details', 'markers'], active: 'readalong' } },
});

export function dockPanels(node: DockNode): DockPanel[] {
  return node.kind === 'group' ? node.tabs : [...dockPanels(node.first), ...dockPanels(node.second)];
}

/** Reject malformed, duplicated or excessively deep saved trees before rendering. */
export function parseDock(value: unknown): DockLayout | undefined {
  if (!value || typeof value !== 'object') return;
  const saved = value as Partial<DockLayout>, ids = new Set<string>(), panels = new Set<DockPanel>();
  function valid(value: unknown, depth = 0): value is DockNode {
    if (!value || typeof value !== 'object' || depth > 12) return false;
    const node = value as DockNode;
    if (typeof node.id !== 'string' || ids.has(node.id)) return false;
    ids.add(node.id);
    if (node.kind === 'group') {
      if (!Array.isArray(node.tabs) || !node.tabs.length || !node.tabs.includes(node.active)) return false;
      return node.tabs.every(panel => {
        if (!PANELS.includes(panel) || panels.has(panel)) return false;
        panels.add(panel); return true;
      });
    }
    return node.kind === 'split' && ['row', 'column'].includes(node.axis) && Number.isFinite(node.ratio)
      && node.ratio >= 0.05 && node.ratio <= 0.95 && valid(node.first, depth + 1) && valid(node.second, depth + 1);
  }
  if (!valid(saved.tree) || panels.size !== PANELS.length || !Array.isArray(saved.open)
    || !saved.open.includes('editor') || saved.open.some(panel => !PANELS.includes(panel)) || new Set(saved.open).size !== saved.open.length) return;
  const top = typeof saved.top === 'number' && Number.isFinite(saved.top) ? Math.max(300, Math.min(2000, saved.top)) : undefined;
  return { tree: saved.tree, open: saved.open, ...(top ? { top } : {}) };
}

export function visibleDock(node: DockNode, open: DockPanel[]): DockNode | undefined {
  if (node.kind === 'group') {
    const tabs = node.tabs.filter(panel => open.includes(panel));
    return tabs.length ? { ...node, tabs, active: tabs.includes(node.active) ? node.active : tabs[0] } : undefined;
  }
  const first = visibleDock(node.first, open), second = visibleDock(node.second, open);
  return first && second ? { ...node, first, second } : first ?? second;
}

export function activateDock(node: DockNode, panel: DockPanel): DockNode {
  if (node.kind === 'group') return node.tabs.includes(panel) ? { ...node, active: panel } : node;
  return { ...node, first: activateDock(node.first, panel), second: activateDock(node.second, panel) };
}

function removePanel(node: DockNode, panel: DockPanel): DockNode | undefined {
  if (node.kind === 'group') {
    const tabs = node.tabs.filter(item => item !== panel);
    return tabs.length ? { ...node, tabs, active: tabs.includes(node.active) ? node.active : tabs[0] } : undefined;
  }
  const first = removePanel(node.first, panel), second = removePanel(node.second, panel);
  return first && second ? { ...node, first, second } : first ?? second;
}

export function moveDock(node: DockNode, panel: DockPanel, target: DockPanel, position: DockPosition): DockNode {
  if (panel === target || !dockPanels(node).includes(panel) || !dockPanels(node).includes(target)) return node;
  const trimmed = removePanel(node, panel)!;
  function insert(node: DockNode): DockNode {
    if (node.kind === 'split') return { ...node, first: insert(node.first), second: insert(node.second) };
    if (!node.tabs.includes(target)) return node;
    if (position === 'tab') return { ...node, tabs: [...node.tabs, panel], active: panel };
    const group: DockNode = { kind: 'group', id: crypto.randomUUID(), tabs: [panel], active: panel };
    return { kind: 'split', id: crypto.randomUUID(), axis: position === 'left' || position === 'right' ? 'row' : 'column', ratio: 0.5,
      first: position === 'left' || position === 'above' ? group : node,
      second: position === 'left' || position === 'above' ? node : group };
  }
  return insert(trimmed);
}

export function resizeDock(node: DockNode, id: string, ratio: number): DockNode {
  if (node.kind === 'group') return node;
  return node.id === id ? { ...node, ratio: Math.max(0.05, Math.min(0.95, ratio)) }
    : { ...node, first: resizeDock(node.first, id, ratio), second: resizeDock(node.second, id, ratio) };
}

export function dockMinimum(node: DockNode): { width: number; height: number } {
  if (node.kind === 'group') return {
    width: Math.max(...node.tabs.map(panel => panel === 'editor' ? 360 : panel === 'chapters' ? 210 : 280)),
    height: node.tabs.includes('editor') ? 240 : node.tabs.includes('video') || node.tabs.includes('readalong') ? 220 : 160,
  };
  const a = dockMinimum(node.first), b = dockMinimum(node.second);
  return node.axis === 'row' ? { width: a.width + DIVIDER + b.width, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + DIVIDER + b.height };
}
export interface DockBox { left: number; top: number; width: number; height: number }
export interface DockGroup { node: Extract<DockNode, { kind: 'group' }>; box: DockBox }
export interface DockDivider { node: Extract<DockNode, { kind: 'split' }>; box: DockBox; span: number; value: number; min: number; max: number }
export function measureDock(tree: DockNode, width: number, height: number) {
  const groups: DockGroup[] = [], dividers: DockDivider[] = [], minimum = dockMinimum(tree);
  const canvas = { width: Math.max(width, minimum.width), height: Math.max(height, minimum.height) };
  function visit(node: DockNode, box: DockBox) {
    if (node.kind === 'group') { groups.push({ node, box }); return; }
    const horizontal = node.axis === 'row', dimension = horizontal ? 'width' : 'height';
    const span = box[dimension] - DIVIDER, min = dockMinimum(node.first)[dimension], max = span - dockMinimum(node.second)[dimension];
    const value = Math.max(min, Math.min(max, span * node.ratio));
    const a = { ...box, [dimension]: value }, b = { ...box, [dimension]: span - value };
    const divider = { ...box, [dimension]: DIVIDER };
    if (horizontal) { divider.left += value; b.left += value + DIVIDER; }
    else { divider.top += value; b.top += value + DIVIDER; }
    dividers.push({ node, box: divider, span, value, min, max });
    visit(node.first, a); visit(node.second, b);
  }
  visit(tree, { left: 0, top: 0, ...canvas });
  return { ...canvas, groups, dividers };
}
