import type { DisplayEntry, DisplayRecording } from './archive-display';
import OutlineRows from './OutlineRows';

export default function Chapters({ recording, time, onChoose, base = '/', selectedId, subsections, listId }: {
  recording: DisplayRecording; time: number; onChoose: (entry: DisplayEntry) => void; base?: string; selectedId?: string;
  subsections?: { shown: boolean; toggle: () => void }; listId?: string;
}) {
  return <section className="chapters" aria-labelledby="chapters-title"><h2 id="chapters-title">Chapters</h2>
    {recording.entries.length ? <OutlineRows recording={recording} base={base} time={time} onChoose={onChoose} selectedId={selectedId} subsections={subsections} listId={listId} /> : <p>Chapters are not available for this recording.</p>}
  </section>;
}
