import { useRef } from 'react';
import type { useEditorPlayback } from './use-editor-playback';
import UnavailableRecording from './UnavailableRecording';
import Icon from './Icon';

export default function EditorVideoPanel({
  playback,
  onSeek,
}: {
  playback: ReturnType<typeof useEditorPlayback>;
  onSeek: (seconds: number) => void;
}) {
  const {
    host,
    player,
    unavailable,
    playing,
    togglePlay,
    file,
    time,
    load,
    playerError,
    uploads,
    useYouTube,
    useFile,
    fileWarning,
  } = playback;
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section className="ce-player-pane" aria-label="Video player">
      <div className="ce-stage-wrap">
        <div className="ce-stage">
          <div
            ref={host}
            className={`ce-host${player === 'ready' && !unavailable ? '' : ' youtube-host-hidden'}`}
          />
          {player === 'ready' && !unavailable && (
            <button
              type="button"
              className="ce-click-layer"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              tabIndex={-1}
            />
          )}
          {unavailable && (
            <div className="ce-stage-message ce-unavailable">
              <UnavailableRecording span={unavailable} onGo={onSeek} />
            </div>
          )}
          {player !== 'ready' && !unavailable && (
            <div className="ce-stage-message">
              {player === 'idle' && (
                <>
                  <button
                    type="button"
                    className="ce-load"
                    onClick={() => load(time)}
                    aria-label="Load video"
                  >
                    <Icon name="play" />
                  </button>
                  <p>
                    {file
                      ? `Plays ${file.name} from this computer.`
                      : 'Plays from YouTube. YouTube will receive connection information.'}
                  </p>
                </>
              )}
              {player === 'loading' && <p role="status">Loading the video…</p>}
              {player === 'error' && (
                <>
                  <p role="alert">{playerError}</p>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => load(time)}
                  >
                    Try again
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="ce-source">
        {file ? (
          <>
            Local file: <strong>{file.name}</strong> (not uploaded).{' '}
            <button type="button" className="ce-link" onClick={useYouTube}>
              Use YouTube instead
            </button>
          </>
        ) : (
          <>
            Source: YouTube
            {uploads.length > 1 &&
              ` (${uploads.length} uploads, played as one)`}
            .{' '}
            {uploads.length === 1 && (
              <button
                type="button"
                className="ce-link"
                onClick={() => fileInput.current?.click()}
              >
                Use a video file on this computer instead
              </button>
            )}
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) useFile(chosen);
            event.target.value = '';
          }}
        />
      </p>
      {fileWarning && (
        <p className="ce-warning" role="alert">
          {fileWarning}
        </p>
      )}
    </section>
  );
}
