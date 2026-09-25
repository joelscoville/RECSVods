import type { HomeItem } from './archive-display';
import { displayType, formatDate, formatTime } from '../lib/urls';
import Icon from './Icon';

export default function VideoCard({ item, progress }: { item: HomeItem; progress?: number }) {
  return <article className="video-card">
    <a className="video-card-link" href={item.href}>
      <div className="video-art" aria-hidden="true"><Icon name="video" />{progress !== undefined && <span className="resume-track"><span style={{ width: `${Math.min(100, Math.max(0, progress / item.duration * 100))}%` }} /></span>}</div>
      <h2>{item.title}</h2>
      <p className="card-metadata"><time dateTime={item.date}>{formatDate(item.date)}</time>{item.speaker && <> · {item.speaker}</>}</p>
      <p className="card-context">{displayType(item.type)}{progress !== undefined && <> · Resume at {formatTime(progress)}</>}</p>
      {item.preview && <span className="preview-label">Unreviewed preview</span>}
    </a>
  </article>;
}
