/** Editor operations for named chapters, subchapters and timestamp-only points. */
import { z } from 'zod';
import {
  CHAPTER_KINDS,
  CHAPTER_TITLES,
  RecordingSchema,
  recordingLength,
  type ChapterKind,
  type Recording,
  type RecordingSource,
  type Topic,
} from './recording-schema';
import { MINOR_TITLE_WORDS } from './title-case';
import { formatTimecode } from './timecode';

export interface EditorRecording {
  id: string;
  recording: Recording;
  topics: Topic[];
}
export interface EditorChapter {
  id: string;
  kind: ChapterKind;
  title: string;
  start: number;
  end: number;
  scripture: string[];
}
export interface EditorSubchapter extends EditorChapter {
  parentId: string;
}
export interface EditorPoint {
  id: string;
  parentId: string;
  time: number;
  text: string;
}
export interface EditorMarker {
  id: string;
  at: number;
  end?: number;
  note: string;
  include: boolean;
}
export interface EditorState {
  title: string;
  description: string;
  scripture: string[];
  topics: string[];
  chapters: EditorChapter[];
  subchapters: EditorSubchapter[];
  points: EditorPoint[];
  markers: EditorMarker[];
  checked: string[];
}
export type Lane = 'chapter' | 'subchapter' | 'point';
/** For layout a point has zero width; it is never serialized as a range. */
export interface EditorItem {
  id: string;
  lane: Lane;
  start: number;
  end: number;
  title: string;
  parentId?: string;
  group: 'frame' | 'word' | 'worship';
}
export interface EditorIssue {
  level: 'error' | 'warning';
  message: string;
  itemId?: string;
}
export const isFileMarker = (marker: EditorMarker) =>
  marker.id.startsWith('file-');
export const roundTime = (seconds: number) =>
  Math.max(0, Math.round(seconds * 100) / 100);
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
const byStart = <T extends { start: number }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.start - b.start);
export const lengthOf = (base: EditorRecording) =>
  recordingLength(base.recording);
export const chapterTitle = (kind: ChapterKind) => CHAPTER_TITLES[kind];
export const pointTitle = (point: EditorPoint) =>
  `Description at ${formatClock(point.time)}`;
export const subchapterTitle = (chapter: EditorSubchapter) =>
  chapter.title.trim() || 'Untitled subchapter';
const nextId = (prefix: string, taken: { id: string }[]) => {
  let n = 1;
  while (taken.some((item) => item.id === `${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};
const sections = (state: EditorState) => [
  ...state.chapters,
  ...state.subchapters,
];
export function initialState({ recording }: EditorRecording): EditorState {
  const chapters: EditorChapter[] = [],
    subchapters: EditorSubchapter[] = [],
    points: EditorPoint[] = [];
  const convert = (chapter: Recording['chapters'][number]): EditorChapter => {
    chapter.points?.forEach((point, i) =>
      points.push({
        id: `${chapter.chapterId}/point-${i + 1}`,
        parentId: chapter.chapterId,
        time: point.pointTime,
        text: point.pointText,
      }),
    );
    return {
      id: chapter.chapterId,
      kind: chapter.chapterKind,
      title: chapter.chapterTitle,
      start: chapter.chapterStart,
      end: chapter.chapterEnd,
      scripture: [...(chapter.chapterScripture ?? [])],
    };
  };
  for (const chapter of recording.chapters) {
    chapters.push(convert(chapter));
    for (const child of chapter.subchapters ?? [])
      subchapters.push({ ...convert(child), parentId: chapter.chapterId });
  }
  return {
    title: recording.recordingTitle,
    description: recording.sermonDescription ?? '',
    scripture: [...(recording.sermonScripture ?? [])],
    topics: [...(recording.sermonTopics ?? [])],
    chapters,
    subchapters,
    points,
    markers: (recording.markers ?? []).map((marker, i) => ({
      id: `file-${i}`,
      at: marker.markerTime,
      ...(marker.markerEnd !== undefined ? { end: marker.markerEnd } : {}),
      note: marker.markerNote,
      include: true,
    })),
    checked: [],
  };
}
export function chapterEndOf(
  state: EditorState,
  _length: number,
  id: string,
): number {
  return sections(state).find((chapter) => chapter.id === id)?.end ?? 0;
}
export const sermonOf = (state: EditorState) =>
  state.chapters.find((chapter) => chapter.kind === 'sermon');
export const chapterAt = (state: EditorState, time: number) =>
  state.chapters.find((chapter) => time >= chapter.start && time < chapter.end);
const groupOf = (kind: ChapterKind) =>
  kind === 'sermon' || kind === 'qa'
    ? ('word' as const)
    : kind === 'music' || kind === 'communion'
      ? ('worship' as const)
      : ('frame' as const);
export function items(state: EditorState, _length: number): EditorItem[] {
  return [
    ...byStart(state.chapters).map((chapter): EditorItem => ({
      ...chapter,
      lane: 'chapter',
      title: chapter.title.trim() || 'Untitled chapter',
      group: groupOf(chapter.kind),
    })),
    ...byStart(state.subchapters).map((chapter): EditorItem => ({
      ...chapter,
      lane: 'subchapter',
      title: subchapterTitle(chapter),
      group: groupOf(chapter.kind),
    })),
    ...state.points.map((point): EditorItem => ({
      id: point.id,
      parentId: point.parentId,
      lane: 'point',
      start: point.time,
      end: point.time,
      title: pointTitle(point),
      group: 'word',
    })),
  ];
}
export function outline(state: EditorState, length: number): EditorItem[] {
  const all = items(state, length);
  const children = (id: string): EditorItem[] =>
    all
      .filter((item) => item.parentId === id)
      .sort((a, b) => a.start - b.start || (a.lane === 'point' ? 1 : -1))
      .flatMap((item) => [item, ...children(item.id)]);
  return all
    .filter((item) => item.lane === 'chapter')
    .flatMap((item) => [item, ...children(item.id)]);
}
export const MIN_SECONDS = 0.01;
export interface Edge {
  lane: Lane;
  id: string;
  edge: 'start' | 'end';
  time: number;
}
export function edges(state: EditorState): Edge[] {
  return [
    ...state.chapters.flatMap((chapter): Edge[] => [
      { lane: 'chapter', id: chapter.id, edge: 'start', time: chapter.start },
      { lane: 'chapter', id: chapter.id, edge: 'end', time: chapter.end },
    ]),
    ...state.subchapters.flatMap((chapter): Edge[] => [
      {
        lane: 'subchapter',
        id: chapter.id,
        edge: 'start',
        time: chapter.start,
      },
      { lane: 'subchapter', id: chapter.id, edge: 'end', time: chapter.end },
    ]),
    ...state.points.map((point): Edge => ({
      lane: 'point',
      id: point.id,
      edge: 'start',
      time: point.time,
    })),
  ].sort((a, b) => a.time - b.time);
}
function movement(
  state: EditorState,
  edge: Pick<Edge, 'lane' | 'id' | 'edge'>,
  linked: boolean,
) {
  const target = sections(state).find((item) => item.id === edge.id);
  const old = target?.[edge.edge] ?? NaN;
  const related = (item: EditorChapter | EditorSubchapter) =>
    edge.lane === 'chapter' ||
    (target &&
      'parentId' in target &&
      'parentId' in item &&
      item.parentId === target.parentId);
  const moves = (
    item: EditorChapter | EditorSubchapter,
    which: 'start' | 'end',
  ) =>
    (item.id === edge.id && which === edge.edge) ||
    (linked && related(item) && same(item[which], old));
  return { target, old, moves };
}
/** All entry methods use the same bounds, including the contents of linked neighbours. */
export function edgeLimits(
  state: EditorState,
  length: number,
  edge: Pick<Edge, 'lane' | 'id' | 'edge'>,
  linked = true,
): [number, number] {
  if (edge.lane === 'point') {
    const point = state.points.find((point) => point.id === edge.id),
      owner = sections(state).find((chapter) => chapter.id === point?.parentId);
    return owner ? [owner.start, owner.end - MIN_SECONDS] : [0, length];
  }
  const { old, moves } = movement(state, edge, linked);
  let low = 0,
    high = length;
  for (const item of sections(state)) {
    const start = moves(item, 'start'),
      end = moves(item, 'end');
    if (!start && !end) continue;
    const parent =
      'parentId' in item
        ? state.chapters.find((parent) => parent.id === item.parentId)
        : undefined;
    const siblings = byStart(
      'parentId' in item
        ? state.subchapters.filter((child) => child.parentId === item.parentId)
        : state.chapters,
    );
    const index = siblings.indexOf(item),
      previous = siblings[index - 1],
      next = siblings[index + 1];
    const children = state.subchapters.filter(
      (child) => child.parentId === item.id,
    );
    const notes = state.points.filter(
      (point) =>
        point.parentId === item.id && !(linked && same(point.time, old)),
    );
    if (start) {
      high = Math.min(
        high,
        item.end - MIN_SECONDS,
        ...notes.map((point) => point.time),
        ...children
          .filter((child) => !moves(child, 'start'))
          .map((child) => child.start),
      );
      if (parent && !moves(parent, 'start')) low = Math.max(low, parent.start);
      if (previous && !moves(previous, 'end'))
        low = Math.max(low, previous.end);
    }
    if (end) {
      low = Math.max(
        low,
        item.start + MIN_SECONDS,
        ...notes.map((point) => point.time + MIN_SECONDS),
        ...children
          .filter((child) => !moves(child, 'end'))
          .map((child) => child.end),
      );
      if (parent && !moves(parent, 'end')) high = Math.min(high, parent.end);
      if (next && !moves(next, 'start')) high = Math.min(high, next.start);
    }
  }
  return [low, high];
}
export function setEdge(
  state: EditorState,
  length: number,
  edge: Pick<Edge, 'lane' | 'id' | 'edge'>,
  seconds: number,
  linked = true,
): EditorState {
  const current =
    edge.lane === 'point'
      ? state.points.find((point) => point.id === edge.id)?.time
      : sections(state).find((item) => item.id === edge.id)?.[edge.edge];
  if (seconds === current) return state;
  const [low, high] = edgeLimits(state, length, edge, linked);
  const time = roundTime(seconds);
  if (!Number.isFinite(seconds) || seconds < 0 || time < low || time > high)
    return state;
  if (edge.lane === 'point')
    return {
      ...state,
      points: state.points.map((point) =>
        point.id === edge.id ? { ...point, time } : point,
      ),
    };
  const { target: chapter, old, moves } = movement(state, edge, linked);
  if (!chapter || same(chapter[edge.edge], time)) return state;
  const update = <T extends EditorChapter>(item: T): T => ({
    ...item,
    ...(moves(item, 'start') ? { start: time } : {}),
    ...(moves(item, 'end') ? { end: time } : {}),
  });
  const moved = new Set(
    sections(state)
      .filter((item) => moves(item, 'start') || moves(item, 'end'))
      .map((item) => item.id),
  );
  return {
    ...state,
    chapters: state.chapters.map(update),
    subchapters: state.subchapters.map(update),
    points: state.points.map((point) =>
      linked && moved.has(point.parentId) && same(point.time, old)
        ? { ...point, time }
        : point,
    ),
  };
}
export function snapTime(
  time: number,
  candidates: readonly number[],
  tolerance: number,
): { time: number; snapped?: number } {
  let best: number | undefined;
  for (const candidate of candidates)
    if (
      Math.abs(candidate - time) <= tolerance &&
      (best === undefined || Math.abs(candidate - time) < Math.abs(best - time))
    )
      best = candidate;
  return best === undefined ? { time } : { time: best, snapped: best };
}
export type AddResult = { state: EditorState; id?: string; reason?: string };
export function startChapterAt(
  state: EditorState,
  length: number,
  kind: ChapterKind,
  seconds: number,
): AddResult {
  const time = roundTime(seconds),
    owner = chapterAt(state, time);
  if (
    time >= length ||
    state.chapters.some((chapter) => same(chapter.start, time))
  )
    return { state, reason: 'Choose a different chapter start.' };
  if (state.subchapters.some((child) => child.start < time && child.end > time))
    return {
      state,
      reason: 'This would cut through a subchapter. Adjust it first.',
    };
  const id = nextId('chapter', sections(state));
  const end =
    owner?.end ??
    Math.min(
      length,
      ...state.chapters
        .filter((chapter) => chapter.start > time)
        .map((chapter) => chapter.start),
    );
  const reparent = owner
    ? state.subchapters.filter(
        (child) => child.parentId === owner.id && child.start >= time,
      )
    : [];
  return {
    id,
    state: {
      ...state,
      chapters: byStart([
        ...state.chapters.map((chapter) =>
          chapter === owner ? { ...chapter, end: time } : chapter,
        ),
        { id, kind, title: '', start: time, end, scripture: [] },
      ]),
      subchapters: state.subchapters.map((child) =>
        reparent.includes(child) ? { ...child, parentId: id } : child,
      ),
      points: state.points.map((point) =>
        owner && point.parentId === owner.id && point.time >= time
          ? { ...point, parentId: id }
          : point,
      ),
    },
  };
}
export function addSubchapterAt(
  state: EditorState,
  length: number,
  seconds: number,
): AddResult {
  const time = roundTime(seconds),
    owner = chapterAt(state, time);
  if (!owner)
    return { state, reason: 'Move the playhead inside a chapter first.' };
  const siblings = state.subchapters.filter(
    (child) => child.parentId === owner.id,
  );
  if (siblings.some((child) => time >= child.start && time < child.end))
    return { state, reason: 'There is already a subchapter here.' };
  const end = Math.min(
    owner.end,
    ...siblings
      .filter((child) => child.start > time)
      .map((child) => child.start),
  );
  if (end - time < MIN_SECONDS || time >= length)
    return { state, reason: 'There is no room for a subchapter here.' };
  const id = nextId('subchapter', sections(state));
  return {
    id,
    state: {
      ...state,
      subchapters: byStart([
        ...state.subchapters,
        {
          id,
          parentId: owner.id,
          kind: owner.kind,
          title: '',
          start: time,
          end,
          scripture: [],
        },
      ]),
    },
  };
}
export function addPointAt(
  state: EditorState,
  _length: number,
  seconds: number,
  parentId?: string,
): AddResult {
  const time = roundTime(seconds);
  const owner = parentId
    ? sections(state).find(
        (chapter) =>
          chapter.id === parentId &&
          time >= chapter.start &&
          time < chapter.end,
      )
    : (state.subchapters.find(
        (child) => time >= child.start && time < child.end,
      ) ?? chapterAt(state, time));
  if (!owner)
    return {
      state,
      reason: 'Move the playhead inside the chapter or subchapter first.',
    };
  const id = nextId('point', [...state.points, ...sections(state)]);
  return {
    id,
    state: {
      ...state,
      points: [...state.points, { id, parentId: owner.id, time, text: '' }],
    },
  };
}
export function removeItem(state: EditorState, id: string): EditorState {
  if (state.chapters.length === 1 && state.chapters[0].id === id) return state;
  const removed = new Set([
    id,
    ...state.subchapters
      .filter((child) => child.parentId === id)
      .map((child) => child.id),
  ]);
  state.points
    .filter((point) => removed.has(point.parentId))
    .forEach((point) => removed.add(point.id));
  return {
    ...state,
    chapters: state.chapters.filter((item) => !removed.has(item.id)),
    subchapters: state.subchapters.filter((item) => !removed.has(item.id)),
    points: state.points.filter((item) => !removed.has(item.id)),
    checked: state.checked.filter((item) => !removed.has(item)),
  };
}
export const editChapter = (
  state: EditorState,
  id: string,
  change: Partial<Omit<EditorChapter, 'id'>>,
): EditorState => ({
  ...state,
  chapters: state.chapters.map((item) =>
    item.id === id ? { ...item, ...change } : item,
  ),
  subchapters: state.subchapters.map((item) =>
    item.id === id ? { ...item, ...change } : item,
  ),
});
export const editPoint = (
  state: EditorState,
  id: string,
  change: Partial<Omit<EditorPoint, 'id'>>,
): EditorState => ({
  ...state,
  points: state.points.map((point) =>
    point.id === id ? { ...point, ...change } : point,
  ),
});
export function toggleChecked(
  state: EditorState,
  id: string,
  value = !state.checked.includes(id),
): EditorState {
  return {
    ...state,
    checked: value
      ? [...new Set([...state.checked, id])]
      : state.checked.filter((item) => item !== id),
  };
}
export function addMarker(
  state: EditorState,
  at: number,
  note = '',
): { state: EditorState; id: string } {
  const id = nextId('mark', state.markers);
  return {
    id,
    state: {
      ...state,
      markers: [
        ...state.markers,
        { id, at: roundTime(at), note, include: false },
      ],
    },
  };
}
export const editMarker = (
  state: EditorState,
  id: string,
  change: Partial<Omit<EditorMarker, 'id'>>,
): EditorState => ({
  ...state,
  markers: state.markers.map((marker) =>
    marker.id === id
      ? {
          ...marker,
          ...change,
          ...(change.at !== undefined &&
          marker.end !== undefined &&
          !Object.hasOwn(change, 'end')
            ? { end: roundTime(change.at + marker.end - marker.at) }
            : {}),
        }
      : marker,
  ),
});
export const removeMarker = (state: EditorState, id: string): EditorState => ({
  ...state,
  markers: state.markers.filter((marker) => marker.id !== id),
});

export function toRecording(
  base: EditorRecording,
  state: EditorState,
): { source: RecordingSource; placement: Map<string, string> } {
  const placement = new Map<string, string>();

  function serializeSection(
    chapter: EditorChapter,
    sourcePath: string,
  ): RecordingSource['chapters'][number] {
    placement.set(sourcePath, chapter.id);
    const points = state.points
      .filter((point) => point.parentId === chapter.id)
      .sort((a, b) => a.time - b.time);

    const section: RecordingSource['chapters'][number] = {
      chapterId: chapter.id,
      chapterTitle: chapter.title.trim(),
      chapterKind: chapter.kind,
      chapterStart: formatTimecode(chapter.start),
      chapterEnd: formatTimecode(chapter.end),
    };
    if (chapter.scripture.length) {
      section.chapterScripture = [...chapter.scripture];
    }
    if (points.length) {
      section.points = points.map((point, index) => {
        placement.set(`${sourcePath}.points.${index}`, point.id);
        return {
          pointTime: formatTimecode(point.time),
          pointText: point.text.trim(),
        };
      });
    }
    return section;
  }

  function serializeChapter(chapter: EditorChapter, index: number) {
    const children = byStart(
      state.subchapters.filter((child) => child.parentId === chapter.id),
    );
    const sourcePath = `chapters.${index}`;
    const section = serializeSection(chapter, sourcePath);
    if (children.length) {
      section.subchapters = children.map((child, childIndex) => {
        return serializeSection(
          child,
          `${sourcePath}.subchapters.${childIndex}`,
        );
      });
    }
    return section;
  }

  function serializeUpload({
    uploadSkip,
    ...upload
  }: Recording['uploads'][number]) {
    return {
      ...upload,
      uploadDuration: formatTimecode(upload.uploadDuration),
      ...(uploadSkip !== undefined
        ? { uploadSkip: formatTimecode(uploadSkip) }
        : {}),
    };
  }

  function serializeMarker(marker: EditorMarker) {
    return {
      markerTime: formatTimecode(marker.at),
      ...(marker.end !== undefined
        ? { markerEnd: formatTimecode(marker.end) }
        : {}),
      markerNote: marker.note.trim(),
    };
  }

  const chapters = byStart(state.chapters).map(serializeChapter);
  const includedMarkers = state.markers
    .filter((marker) => isFileMarker(marker) || marker.include)
    .sort((a, b) => a.at - b.at);

  // Preserve source clock precision. Only intentional timing edits round their values.
  const source: RecordingSource = {
    recordingTitle: state.title.trim(),
    serviceDate: base.recording.serviceDate,
    status: 'published',
    ...(state.description.trim()
      ? { sermonDescription: state.description.trim().replace(/\s+/gu, ' ') }
      : {}),
    ...(state.scripture.length ? { sermonScripture: state.scripture } : {}),
    ...(state.topics.length ? { sermonTopics: state.topics } : {}),
    uploads: base.recording.uploads.map(serializeUpload),
    chapters,
    ...(includedMarkers.length
      ? { markers: includedMarkers.map(serializeMarker) }
      : {}),
  };
  return { source, placement };
}
export function validateEditor(
  base: EditorRecording,
  state: EditorState,
): EditorIssue[] {
  const issues: EditorIssue[] = [],
    { source, placement } = toRecording(base, state);
  for (const child of state.subchapters)
    if (!state.chapters.some((chapter) => chapter.id === child.parentId))
      issues.push({
        level: 'error',
        itemId: child.id,
        message: 'Choose a parent chapter.',
      });
  for (const point of state.points)
    if (!sections(state).some((chapter) => chapter.id === point.parentId))
      issues.push({
        level: 'error',
        itemId: point.id,
        message: 'Choose a chapter or subchapter for this point.',
      });
  for (const topic of state.topics)
    if (!base.topics.some((item) => item.topicId === topic))
      issues.push({
        level: 'error',
        message: `Topics: “${topic}” is not in the topic list.`,
      });
  const result = RecordingSchema.safeParse(source);
  if (!result.success)
    for (const issue of result.error.issues) {
      let path = issue.path.join('.'),
        itemId: string | undefined;
      while (path && !itemId) {
        itemId = placement.get(path);
        path = path.split('.').slice(0, -1).join('.');
      }
      const field = String(issue.path.at(-1));
      const label: Record<string, string> = {
        chapterTitle: 'Title',
        pointText: 'Description',
        chapterStart: 'Start',
        chapterEnd: 'End',
        pointTime: 'Time',
        recordingTitle: 'Title',
        sermonDescription: 'Sermon description',
        sermonTopics: 'Topics',
        sermonScripture: 'Scripture',
      };
      const message =
        field === 'pointText' && issue.message === 'required text'
          ? 'Add a description, or remove this empty description.'
          : `${issue.path[0] === 'markers' ? 'Marker: ' : label[field] ? `${label[field]}: ` : ''}${issue.message}`;
      issues.push({ level: 'error', ...(itemId ? { itemId } : {}), message });
    }
  return issues;
}
export function describeChanges(
  base: EditorRecording,
  state: EditorState,
): string[] {
  const before = initialState(base),
    lines: string[] = [];
  for (const [field, label] of [
    ['title', 'Title'],
    ['description', 'Sermon description'],
    ['scripture', 'Scripture'],
    ['topics', 'Topics'],
  ] as const) {
    if (JSON.stringify(before[field]) !== JSON.stringify(state[field]))
      lines.push(`${label} changed`);
  }
  const compare = <T extends { id: string }>(
    label: string,
    was: T[],
    now: T[],
    name: (item: T) => string,
  ) => {
    for (const item of was)
      if (!now.some((other) => other.id === item.id))
        lines.push(`${label} “${name(item)}” removed`);
    for (const item of now) {
      const old = was.find((other) => other.id === item.id);
      if (!old) lines.push(`${label} “${name(item)}” added`);
      else if (JSON.stringify(old) !== JSON.stringify(item))
        lines.push(`${label} “${name(item)}” changed`);
    }
  };
  compare('Chapter', before.chapters, state.chapters, (item) => item.title);
  compare(
    'Subchapter',
    before.subchapters,
    state.subchapters,
    (item) => item.title,
  );
  compare('Point', before.points, state.points, pointTitle);
  const sent = (markers: EditorMarker[]) =>
    markers.filter((marker) => isFileMarker(marker) || marker.include);
  compare(
    'Marker',
    sent(before.markers),
    sent(state.markers),
    (marker) => `${formatClock(marker.at)} ${marker.note}`,
  );
  return lines;
}
export function titleCase(title: string): string {
  const words = title.trim().split(/(\s+|[—–])/u),
    indexes = words
      .map((word, i) => (/\S/u.test(word) && !/^[—–]$/u.test(word) ? i : -1))
      .filter((i) => i >= 0);
  return words
    .map((word, i) =>
      indexes.indexOf(i) < 0
        ? word
        : indexes.indexOf(i) > 0 &&
            indexes.indexOf(i) < indexes.length - 1 &&
            MINOR_TITLE_WORDS.has(word.toLowerCase())
          ? word.toLowerCase()
          : word.replace(/\p{L}/u, (letter) => letter.toUpperCase()),
    )
    .join('');
}
export function formatClock(seconds: number): string {
  return formatTimecode(roundTime(seconds)).replace(
    /\.(\d)$/,
    (_, digit: string) => `.${digit}0`,
  );
}
const Seconds = z.number().finite().nonnegative();
const LocalChapter = z.object({
  id: z.string(),
  kind: z.enum(CHAPTER_KINDS),
  title: z.string(),
  start: Seconds,
  end: Seconds,
  scripture: z.array(z.string()).default([]),
});
export const DraftStateSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    scripture: z.array(z.string()),
    topics: z.array(z.string()),
    chapters: z.array(LocalChapter).min(1),
    subchapters: z.array(LocalChapter.extend({ parentId: z.string() })),
    points: z.array(
      z.object({
        id: z.string(),
        parentId: z.string(),
        time: Seconds,
        text: z.string(),
      }),
    ),
    markers: z.array(
      z.object({
        id: z.string(),
        at: Seconds,
        end: Seconds.optional(),
        note: z.string(),
        include: z.boolean(),
      }),
    ),
    checked: z.array(z.string()),
  })
  .superRefine((state, ctx) => {
    const ids = [...state.chapters, ...state.subchapters, ...state.points].map(
      (item) => item.id,
    );
    if (
      new Set(ids).size !== ids.length ||
      state.subchapters.some(
        (child) =>
          !state.chapters.some((parent) => parent.id === child.parentId),
      ) ||
      state.points.some(
        (point) =>
          !sections(state).some((owner) => owner.id === point.parentId),
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Draft section identities or parents are invalid',
      });
    }
  });
export const SOURCE_BRANCH = 'main';
export const recordingFilePath = (id: string) => `services/${id}.yaml`;
const pathOf = (value: string) =>
  value.split('/').map(encodeURIComponent).join('/');
const ownerRepo = (repositoryUrl: string) =>
  new URL(repositoryUrl).pathname.replace(/^\/|\/$/g, '');
export const githubRawUrl = (
  repositoryUrl: string,
  branch: string,
  file: string,
) =>
  `https://raw.githubusercontent.com/${ownerRepo(repositoryUrl)}/${pathOf(branch)}/${pathOf(file)}`;
export const githubEditUrl = (
  repositoryUrl: string,
  branch: string,
  file: string,
) => `${repositoryUrl}/edit/${pathOf(branch)}/${pathOf(file)}`;
