import type { MouseEvent } from 'react';
import {
  chapterAt,
  type Edge,
  type EditorItem,
  type EditorState,
} from '../lib/recording-editor';
import { shortcutHint } from '../lib/editor-keys';
import type { EditorCommands } from './editor-commands';
import type {
  useEditorPlayback,
  EditorSeekOptions,
} from './use-editor-playback';
import { TimeReadout } from './editor-fields';
import Icon from './Icon';

interface ToolbarProps {
  playback: Pick<
    ReturnType<typeof useEditorPlayback>,
    | 'time'
    | 'playing'
    | 'speed'
    | 'availableSpeeds'
    | 'speedNotice'
    | 'unavailable'
    | 'togglePlay'
    | 'changeSpeed'
  >;
  state: EditorState;
  selected?: EditorItem;
  activeBoundary?: Edge;
  commands: EditorCommands;
  length: number;
  playhead: number;
  linked: boolean;
  snapping: boolean;
  mobileTools: boolean;
  notice?: string;
  onSeek: (seconds: number, options?: EditorSeekOptions) => void;
  onChapterMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onLinked: (linked: boolean) => void;
  onToggleSnap: () => void;
  onToggleMobileTools: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}
const SPEEDS = [0.5, 1, 1.5, 2];

export default function EditorToolbar({
  playback,
  state,
  selected,
  activeBoundary,
  commands,
  length,
  playhead,
  linked,
  snapping,
  mobileTools,
  notice,
  onSeek,
  onChapterMenu,
  onLinked,
  onToggleSnap,
  onToggleMobileTools,
  onZoom,
  onFit,
}: ToolbarProps) {
  const {
    time,
    playing,
    speed,
    availableSpeeds,
    speedNotice,
    unavailable,
    togglePlay,
    changeSpeed,
  } = playback;
  return (
    <div
      className={`ce-toolbar${mobileTools ? ' is-open' : ''}`}
      role="toolbar"
      aria-label="Timeline tools"
    >
      <div className="ce-tool-group">
        <button
          type="button"
          className="ce-tool ce-play"
          onClick={togglePlay}
          disabled={Boolean(unavailable)}
          aria-label={playing ? 'Pause' : 'Play'}
          title={
            unavailable
              ? 'Choose an available part to play'
              : `${playing ? 'Pause' : 'Play'}${shortcutHint('play')}`
          }
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <TimeReadout
          time={time}
          duration={length}
          onSeek={(seconds) => onSeek(seconds)}
          onScrub={(seconds) => onSeek(seconds, { live: true })}
        />
        <div className="ce-segmented" role="group" aria-label="Playback speed">
          {SPEEDS.map((rate) => (
            <button
              type="button"
              key={rate}
              aria-pressed={speed === rate}
              disabled={
                availableSpeeds.length > 0 && !availableSpeeds.includes(rate)
              }
              title={
                availableSpeeds.length > 0 && !availableSpeeds.includes(rate)
                  ? 'Not supported by this video'
                  : `Play at ${rate}× speed`
              }
              onClick={() => changeSpeed(rate)}
            >
              {rate}×
            </button>
          ))}
        </div>
      </div>
      {speedNotice && (
        <span className="ce-notice-inline" role="status">
          {speedNotice}
        </span>
      )}
      <button
        type="button"
        className="ce-tool ce-mobile-tools"
        aria-expanded={mobileTools}
        onClick={onToggleMobileTools}
      >
        Timeline tools
      </button>
      <div className="ce-tool-group">
        <button
          type="button"
          className="ce-tool"
          onClick={() => commands.setItemEdge('start', playhead)}
          disabled={!commands.canSetEdge(selected, 'start', playhead)}
          title={`Start the selected item at the playhead${shortcutHint('setStart')}`}
        >
          <Icon name="setStart" />
          Start here
        </button>
        <button
          type="button"
          className="ce-tool"
          onClick={() => commands.setItemEdge('end', playhead)}
          disabled={!commands.canSetEdge(selected, 'end', playhead)}
          title={`End the selected item at the playhead${shortcutHint('setEnd')}`}
        >
          <Icon name="setEnd" />
          End here
        </button>
        <button
          type="button"
          className="ce-tool"
          aria-haspopup="menu"
          title="Start a chapter at the playhead"
          onClick={onChapterMenu}
        >
          <Icon name="split" />
          Chapter
        </button>
        <button
          type="button"
          className="ce-tool"
          onClick={() => commands.addSubchapter()}
          disabled={!chapterAt(state, playhead)}
          title={`Add a subchapter at the playhead${shortcutHint('addSubchapter')}`}
        >
          <Icon name="plus" />
          Subchapter
        </button>
        <button
          type="button"
          className="ce-tool"
          onClick={() => commands.addPoint()}
          disabled={!chapterAt(state, playhead)}
          title={`Add a description at the playhead${shortcutHint('addPoint')}`}
        >
          <Icon name="plus" />
          Description
        </button>
        <button
          type="button"
          className="ce-tool"
          onClick={() => commands.removeSelected(activeBoundary?.id)}
          disabled={!selected}
          title={`Remove the selected chapter, subchapter or point${shortcutHint('delete')}`}
        >
          <Icon name="trash" />
          Delete
        </button>
      </div>
      <div className="ce-tool-group">
        {notice && (
          <span className="ce-notice-inline" role="status">
            {notice}
          </span>
        )}
        <label
          className="ce-toggle"
          title="Move touching chapter boundaries and points together. Hold Alt (Option) while dragging to move only one edge."
        >
          <input
            type="checkbox"
            checked={linked}
            onChange={(event) => onLinked(event.target.checked)}
          />{' '}
          Move touching edges together
        </label>
        <button
          type="button"
          className="ce-tool"
          aria-pressed={snapping}
          onClick={onToggleSnap}
          aria-label="Snapping"
          title={`Snapping: edges stick to the playhead and other edges${shortcutHint('snapping')}`}
        >
          <Icon name="magnet" />
          Snap
        </button>
        <button
          type="button"
          className="ce-tool ce-icon-tool"
          onClick={() => onZoom(2)}
          aria-label="Zoom out"
          title={`Zoom out${shortcutHint('zoomOut')}`}
        >
          <Icon name="minus" />
        </button>
        <button
          type="button"
          className="ce-tool ce-icon-tool"
          onClick={() => onZoom(0.5)}
          aria-label="Zoom in"
          title={`Zoom in${shortcutHint('zoomIn')}`}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="ce-tool"
          onClick={onFit}
          title={`Show the whole recording${shortcutHint('zoomFit')}`}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
