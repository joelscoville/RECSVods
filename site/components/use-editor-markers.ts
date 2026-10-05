import { useState } from 'react';
import {
  addMarker,
  editMarker,
  removeMarker,
  isFileMarker,
  type EditorMarker,
  type EditorState,
} from '../lib/recording-editor';

/** Marker selection/focus is separate from chapter editing and playback selection. */
export function useEditorMarkers(
  state: EditorState,
  apply: (state: EditorState, key?: string) => void,
  playhead: number,
  openMarkers: () => void,
) {
  const [selectedId, setSelectedId] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  function add(seconds = playhead) {
    const result = addMarker(state, seconds);
    apply(result.state);
    setSelectedId(result.id);
    setFocusId(result.id);
    openMarkers();
  }
  function select(marker: EditorMarker) {
    setSelectedId(marker.id);
    setFocusId(undefined);
    openMarkers();
  }
  function remove(id: string) {
    apply(removeMarker(state, id));
    if (selectedId === id) setSelectedId(undefined);
  }
  function edit(
    id: string,
    change: Partial<Omit<EditorMarker, 'id'>>,
    key?: string,
  ) {
    apply(editMarker(state, id, change), key);
  }
  function includeLocal(include: boolean) {
    apply({
      ...state,
      markers: state.markers.map((marker) =>
        isFileMarker(marker) ? marker : { ...marker, include },
      ),
    });
  }
  return {
    selectedId,
    setSelectedId,
    focusId,
    setFocusId,
    add,
    select,
    remove,
    edit,
    includeLocal,
  };
}
