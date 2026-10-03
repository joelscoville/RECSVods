import type { UnavailableSpan } from '../lib/player';
import { formatTime } from '../lib/urls';

export default function UnavailableRecording({ span, onGo }: { span: UnavailableSpan; onGo: (time: number) => void }) {
  return <>
    <h2>This part is unavailable</h2>
    <p role="status">The upload covering {formatTime(span.start)}–{formatTime(span.end)} is marked unavailable. Recording times include this gap.</p>
    <div className="action-row">
      {span.previous !== undefined && <button type="button" className="button button-secondary" onClick={() => onGo(span.previous!)}>Previous available part · {formatTime(span.previous)}</button>}
      {span.next !== undefined && <button type="button" className="button button-secondary" onClick={() => onGo(span.next!)}>Next available part · {formatTime(span.next)}</button>}
      {span.previous === undefined && span.next === undefined && <p>No uploads in this recording are currently available.</p>}
    </div>
  </>;
}
