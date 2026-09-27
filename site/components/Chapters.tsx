import type { DisplayService, DisplayChapter } from './archive-display';
import OutlineRows from './OutlineRows';

export default function Chapters({ service, videoId, time, onChoose, base = '/', selectedId, subsections, listId }: {
  service: DisplayService; videoId: string; time: number; onChoose: (chapter: DisplayChapter) => void; base?: string; selectedId?: string;
  subsections?: { shown: boolean; toggle: () => void }; listId?: string;
}) {
  return <section className="chapters" aria-labelledby="chapters-title"><h2 id="chapters-title">Chapters</h2>
    {service.chapters.length ? <OutlineRows service={service} base={base} videoId={videoId} time={time} onChoose={onChoose} selectedId={selectedId} subsections={subsections} listId={listId} /> : <p>Chapters are not available for this service.</p>}
  </section>;
}
