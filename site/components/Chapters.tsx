import type { DisplayService, DisplaySection } from './archive-display';
import { displayType, formatTime } from '../lib/urls';

export default function Chapters({ service, videoId, time, onChoose }: {
  service: DisplayService; videoId: string; time: number; onChoose: (section: DisplaySection) => void;
}) {
  return <section className="chapters" aria-labelledby="chapters-title"><h2 id="chapters-title">Chapters</h2>
    {service.sections.length ? <ol>{service.sections.map((section) => {
      const active = section.videoId === videoId && time >= section.start && time < section.end;
      const video = service.videos.find((item) => item.id === section.videoId);
      return <li key={section.id}><button className="chapter-row" type="button" aria-current={active ? 'true' : undefined} onClick={() => onChoose(section)}>
        <span className="timestamp">{formatTime(section.start)}</span><span className="chapter-copy"><strong>{section.title}</strong><span>{section.speaker ?? displayType(section.type)} · {formatTime(section.end - section.start)}{service.videos.length > 1 && ` · Video ${video?.sequence}`}</span>{active && <span className="current-chapter">Current chapter</span>}</span>
      </button></li>;
    })}</ol> : <p>Chapters are not available for this service.</p>}
  </section>;
}
