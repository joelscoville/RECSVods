import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Edge, EditorItem, EditorState } from '../lib/recording-editor';
import { requestedEditorTime } from './use-editor-playback';

interface SelectionRequest {
  id: string;
  anchorTop?: number;
}

interface EditorSelectionOptions {
  original: EditorState;
  rows: EditorItem[];
  length: number;
  hydrated: boolean;
  root: RefObject<HTMLDivElement | null>;
}

/** Selection/reveal state has no media side effects; the caller explicitly seeks. */
export function useEditorSelection({
  original,
  rows,
  length,
  hydrated,
  root,
}: EditorSelectionOptions) {
  const first =
    original.chapters.find((chapter) => chapter.kind === 'sermon')?.id ??
    original.chapters[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(first);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(first ? [first] : []),
  );
  const [activeBoundary, setActiveBoundary] = useState<Edge>();
  const [mobileList, setMobileList] = useState(false);
  const [selectionRequest, setSelectionRequest] = useState<SelectionRequest>();
  const list = useRef<HTMLOListElement>(null);
  const editPane = useRef<HTMLDivElement>(null);
  const initialized = useRef<EditorState>(undefined);

  const revealParents = useCallback(
    (id: string, from = rows) => {
      const parents: string[] = [];
      let parentId = from.find((item) => item.id === id)?.parentId;
      while (parentId) {
        parents.push(parentId);
        parentId = from.find((item) => item.id === parentId)?.parentId;
      }

      setExpanded((current) => {
        const hasCollapsedParent = parents.some((id) => !current.has(id));
        return hasCollapsedParent ? new Set([...current, ...parents]) : current;
      });
    },
    [rows],
  );

  useEffect(() => {
    if (!hydrated || initialized.current === original) {
      return;
    }
    initialized.current = original;

    const requestedTime = requestedEditorTime(length);
    const initialSelection =
      requestedTime === undefined
        ? rows.find((row) => row.id === first)
        : rows
            .filter(
              (item) => item.start <= requestedTime && requestedTime < item.end,
            )
            .at(-1);

    if (initialSelection) {
      setSelectedId(initialSelection.id);
      setSelectionRequest({ id: initialSelection.id });
      revealParents(initialSelection.id);
    }
  }, [hydrated, original, length, rows, first, revealParents]);

  const selected = rows.find((item) => item.id === selectedId);
  const selectedSection =
    selected?.lane === 'point'
      ? rows.find((item) => item.id === selected.parentId)
      : selected;

  useEffect(() => {
    if (!hydrated || !selectedId || selected) {
      return;
    }

    // Undo/deletion can remove the selection. Prefer its owner before the default chapter.
    const ownerId = selectedId.split('/point-')[0];
    const fallback =
      rows.find((row) => row.id === ownerId) ??
      rows.find((row) => row.id === first) ??
      rows[0];
    setSelectedId(fallback?.id);
    if (fallback) {
      setSelectionRequest({ id: fallback.id });
      revealParents(fallback.id);
    }
  }, [hydrated, selectedId, selected, rows, first, revealParents]);

  useLayoutEffect(() => {
    const pane = editPane.current;
    if (!pane) {
      return;
    }
    if (selected?.lane !== 'point') {
      pane.scrollTop = 0;
      return;
    }

    const note = pane.querySelector<HTMLElement>(
      `[data-entry="${selected.id}"]`,
    );
    if (!note) {
      return;
    }
    const paneBounds = pane.getBoundingClientRect();
    const noteBounds = note.getBoundingClientRect();
    const outsidePane =
      noteBounds.top < paneBounds.top || noteBounds.bottom > paneBounds.bottom;
    if (outsidePane) {
      pane.scrollTop += noteBounds.top - paneBounds.top - 12;
    }
  }, [selectedId]);

  useLayoutEffect(() => {
    if (!selectionRequest) {
      return;
    }

    function revealMobileEditor(request: SelectionRequest) {
      const target =
        editPane.current?.querySelector<HTMLElement>(
          `[data-entry="${request.id}"]`,
        ) ?? editPane.current;
      if (target && !target.contains(document.activeElement)) {
        const toolbarHeight =
          root.current?.querySelector('.ce-toolbar')?.getBoundingClientRect()
            .height ?? 0;
        const top =
          window.scrollY +
          target.getBoundingClientRect().top -
          toolbarHeight -
          16;
        window.scrollTo({ top });
      }
      setSelectionRequest(undefined);
    }

    function revealSidebarSelection(request: SelectionRequest) {
      const container = list.current;
      if (!container) {
        setSelectionRequest(undefined);
        return;
      }

      const target = rows.find((item) => item.id === request.id);
      const headerId = target?.lane === 'point' ? target.parentId : request.id;
      const header = container.querySelector<HTMLElement>(
        `[data-entry="${headerId}"] > [data-entry-header]`,
      );
      if (!header?.getClientRects().length) {
        return;
      }

      if (container.scrollHeight > container.clientHeight + 1) {
        const containerBounds = container.getBoundingClientRect();
        const rowBounds = header.getBoundingClientRect();
        if (request.anchorTop !== undefined) {
          container.scrollTop +=
            rowBounds.top - containerBounds.top - request.anchorTop;
        } else if (rowBounds.top < containerBounds.top) {
          container.scrollTop += rowBounds.top - containerBounds.top;
        } else if (rowBounds.bottom > containerBounds.bottom) {
          container.scrollTop +=
            rowBounds.top +
            Math.min(rowBounds.height, containerBounds.height) -
            containerBounds.bottom;
        }
      }
      setSelectionRequest(undefined);
    }

    if (window.matchMedia('(max-width: 760px)').matches && !mobileList) {
      revealMobileEditor(selectionRequest);
    } else {
      revealSidebarSelection(selectionRequest);
    }
  }, [selectionRequest, expanded, rows, mobileList, root]);

  function select(
    item: EditorItem,
    origin: 'sidebar' | 'external' = 'external',
    jump = false,
  ) {
    setMobileList(false);
    setActiveBoundary(undefined);

    const header = list.current?.querySelector<HTMLElement>(
      `[data-entry="${item.id}"] > [data-entry-header]`,
    );
    let anchorTop: number | undefined;
    if (origin === 'sidebar' && header?.getClientRects().length) {
      anchorTop =
        header.getBoundingClientRect().top -
        list.current!.getBoundingClientRect().top;
    }
    if (item.id !== selectedId || mobileList || jump) {
      setSelectionRequest({ id: item.id, anchorTop });
    }

    revealParents(item.id);
    setSelectedId(item.id);
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return {
    selectedId,
    setSelectedId,
    selected,
    selectedSection,
    expanded,
    revealParents,
    toggleExpanded,
    activeBoundary,
    setActiveBoundary,
    mobileList,
    setMobileList,
    setSelectionRequest,
    list,
    editPane,
    select,
  };
}
