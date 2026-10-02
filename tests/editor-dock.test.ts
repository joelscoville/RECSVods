import { describe, expect, it } from 'vitest';
import { activateDock, defaultDock, dockPanels, measureDock, moveDock, PANELS, parseDock, resizeDock, visibleDock, type DockNode, type DockPosition } from '../site/lib/editor-dock';

describe('saved editor docking', () => {
  it('opens reference panels below the complete top row', () => {
    const layout = defaultDock();
    const measured = measureDock(visibleDock(layout.tree, [...layout.open, 'readalong'])!, 1440, 650);
    const transcript = measured.groups.find(group => group.node.active === 'readalong')!;
    expect(transcript.box.width).toBe(1440);
    for (const panel of ['chapters', 'editor', 'video']) {
      const group = measured.groups.find(group => group.node.tabs.includes(panel as typeof PANELS[number]))!;
      expect(group.box.top + group.box.height).toBeLessThan(transcript.box.top);
    }
  });

  it('preserves every panel through split, tab, detach, and repeated moves', () => {
    let tree = defaultDock().tree;
    for (const panel of PANELS) for (const target of PANELS) for (const position of ['left', 'right', 'above', 'below', 'tab'] as DockPosition[]) {
      tree = moveDock(tree, panel, target, position);
      expect(dockPanels(tree).sort()).toEqual([...PANELS].sort());
      expect(parseDock({ tree, open: [...PANELS] })).toBeDefined();
    }
  });

  it('keeps hidden positions while resizing the visible tree, and restores a closed tab', () => {
    const layout = defaultDock();
    layout.tree = moveDock(layout.tree, 'readalong', 'video', 'left');
    const visible = visibleDock(layout.tree, [...layout.open, 'readalong'])!;
    const divider = measureDock(visible, 1500, 700).dividers.find(divider => divider.node.id !== 'navigation' && divider.node.id !== 'writing')!;
    layout.tree = resizeDock(layout.tree, divider.node.id, 0.65);
    const reopened = activateDock(layout.tree, 'readalong');
    const before = measureDock(visibleDock(reopened, [...layout.open, 'readalong'])!, 1500, 700);
    const after = measureDock(visibleDock(activateDock(reopened, 'readalong'), [...layout.open, 'readalong'])!, 1500, 700);
    expect(after).toEqual(before);
    expect(dockPanels(layout.tree)).toContain('details');
    expect(dockPanels(visibleDock(layout.tree, layout.open)!)).not.toContain('readalong');
  });

  it('rejects corrupt layouts and unsafe sizes', () => {
    expect(parseDock(null)).toBeUndefined();
    const layout = defaultDock();
    expect(parseDock({ ...layout, tree: { kind: 'group', id: 'broken', tabs: ['editor', 'editor'], active: 'editor' } })).toBeUndefined();
    expect(parseDock({ ...layout, open: ['video'] })).toBeUndefined();
    expect(parseDock({ ...layout, tree: { ...layout.tree, ratio: NaN } })).toBeUndefined();
    expect(parseDock({ ...layout, top: 999999 })?.top).toBe(2000);
  });

  it('enforces minimum sizes and keeps complex arrangements inside a scrollable canvas', () => {
    let tree: DockNode = defaultDock().tree;
    tree = moveDock(tree, 'details', 'editor', 'right');
    tree = moveDock(tree, 'markers', 'details', 'right');
    const measured = measureDock(tree, 1000, 400);
    expect(measured.width).toBeGreaterThan(1000);
    for (const { box } of measured.groups) {
      expect(box.width).toBeGreaterThanOrEqual(210);
      expect(box.height).toBeGreaterThanOrEqual(160);
      expect(box.left + box.width).toBeLessThanOrEqual(measured.width + 0.01);
      expect(box.top + box.height).toBeLessThanOrEqual(measured.height + 0.01);
    }
  });
});
