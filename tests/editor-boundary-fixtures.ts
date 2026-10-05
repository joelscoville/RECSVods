import type { EditorState } from '../site/lib/recording-editor';

/** Hand-authored geometry: a touching chapter boundary, child edge and point. */
export function boundaryState(): EditorState {
  return {
    title: 'Boundary fixture',
    description: '',
    scripture: [],
    topics: [],
    markers: [],
    checked: [],
    chapters: [
      {
        id: 'opening',
        title: 'Opening',
        kind: 'opening',
        start: 0,
        end: 50,
        scripture: [],
      },
      {
        id: 'sermon',
        title: 'Sermon',
        kind: 'sermon',
        start: 50,
        end: 100,
        scripture: [],
      },
      {
        id: 'closing',
        title: 'Closing',
        kind: 'closing',
        start: 100,
        end: 120,
        scripture: [],
      },
    ],
    subchapters: [
      {
        id: 'song',
        parentId: 'opening',
        title: 'Song',
        kind: 'music',
        start: 10,
        end: 50,
        scripture: [],
      },
    ],
    points: [
      { id: 'song-note', parentId: 'song', time: 20, text: 'The choir sings.' },
      {
        id: 'sermon-note',
        parentId: 'sermon',
        time: 50,
        text: 'The preacher begins.',
      },
    ],
  };
}
