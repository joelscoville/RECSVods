import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Edge, EditorItem, EditorState } from '../lib/recording-editor';
import { requestedEditorTime } from './use-editor-playback';

/** Selection/reveal state has no media side effects; the caller explicitly seeks. */
export function useEditorSelection({ original, rows, length, hydrated, root }: {
  original: EditorState; rows: EditorItem[]; length: number; hydrated: boolean; root: RefObject<HTMLDivElement | null>;
}) {
  const first = original.chapters.find(chapter => chapter.kind === 'sermon')?.id ?? original.chapters[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(first);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(first ? [first] : []));
  const [activeBoundary, setActiveBoundary] = useState<Edge>(), [mobileList, setMobileList] = useState(false);
  const [selectionRequest, setSelectionRequest] = useState<{ id: string; anchorTop?: number }>();
  const list = useRef<HTMLOListElement>(null), editPane = useRef<HTMLDivElement>(null), initialized = useRef<EditorState>(undefined);
  const revealParents = useCallback((id: string, from = rows) => {
    const parents: string[] = [];
    let parent = from.find(item => item.id === id)?.parentId;
    while (parent) { parents.push(parent); parent = from.find(item => item.id === parent)?.parentId; }
    setExpanded(current => parents.some(id => !current.has(id)) ? new Set([...current, ...parents]) : current);
  }, [rows]);
  useEffect(() => {
    if (!hydrated || initialized.current === original) return;
    initialized.current = original;
    const at = requestedEditorTime(length);
    const under = at === undefined ? rows.find(row => row.id === first) : rows.filter(item => item.start <= at && at < item.end).at(-1);
    if (under) { setSelectedId(under.id); setSelectionRequest({ id: under.id }); revealParents(under.id); }
  }, [hydrated, original, length, rows, first, revealParents]);
  const selected = rows.find(item => item.id === selectedId);
  const selectedSection = selected?.lane === 'point' ? rows.find(item => item.id === selected.parentId) : selected;
  useEffect(() => {
    if (hydrated && selectedId && !selected) {
      const fallback = rows.find(row => row.id === selectedId.split('/point-')[0]) ?? rows.find(row => row.id === first) ?? rows[0];
      setSelectedId(fallback?.id); if (fallback) { setSelectionRequest({ id: fallback.id }); revealParents(fallback.id); }
    }
  }, [hydrated, selectedId, selected, rows, first, revealParents]);
  useLayoutEffect(() => {
    const pane = editPane.current;
    if (!pane) return;
    if (selected?.lane === 'point') {
      const note = pane.querySelector<HTMLElement>(`[data-entry="${selected.id}"]`);
      if (note) {
        const box = pane.getBoundingClientRect(), target = note.getBoundingClientRect();
        if (target.top < box.top || target.bottom > box.bottom) pane.scrollTop += target.top - box.top - 12;
      }
    } else pane.scrollTop = 0;
  }, [selectedId]);
  useLayoutEffect(() => {
    if (!selectionRequest) return;
    if (window.matchMedia('(max-width: 760px)').matches && !mobileList) {
      const target = editPane.current?.querySelector<HTMLElement>(`[data-entry="${selectionRequest.id}"]`) ?? editPane.current;
      if (target && !target.contains(document.activeElement)) {
        const toolbarHeight = root.current?.querySelector('.ce-toolbar')?.getBoundingClientRect().height ?? 0;
        window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - toolbarHeight - 16 });
      }
      setSelectionRequest(undefined); return;
    }
    const container = list.current;
    if (!container) { setSelectionRequest(undefined); return; }
    const target = rows.find(item => item.id === selectionRequest.id);
    const header = container.querySelector<HTMLElement>(`[data-entry="${target?.lane === 'point' ? target.parentId : selectionRequest.id}"] > [data-entry-header]`);
    if (!header?.getClientRects().length) return;
    if (container.scrollHeight > container.clientHeight + 1) {
      const box = container.getBoundingClientRect(), row = header.getBoundingClientRect();
      if (selectionRequest.anchorTop !== undefined) container.scrollTop += row.top - box.top - selectionRequest.anchorTop;
      else if (row.top < box.top) container.scrollTop += row.top - box.top;
      else if (row.bottom > box.bottom) container.scrollTop += row.top + Math.min(row.height, box.height) - box.bottom;
    }
    setSelectionRequest(undefined);
  }, [selectionRequest, expanded, rows, mobileList, root]);
  const select = (item: EditorItem, origin: 'sidebar' | 'external' = 'external', jump = false) => {
    setMobileList(false); setActiveBoundary(undefined);
    const header = list.current?.querySelector<HTMLElement>(`[data-entry="${item.id}"] > [data-entry-header]`);
    const anchorTop = origin === 'sidebar' && header?.getClientRects().length ? header.getBoundingClientRect().top - list.current!.getBoundingClientRect().top : undefined;
    if (item.id !== selectedId || mobileList || jump) setSelectionRequest({ id: item.id, anchorTop });
    revealParents(item.id); setSelectedId(item.id);
  };
  const toggleExpanded = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return { selectedId, setSelectedId, selected, selectedSection, expanded, revealParents, toggleExpanded,
    activeBoundary, setActiveBoundary, mobileList, setMobileList, setSelectionRequest, list, editPane, select };
}
