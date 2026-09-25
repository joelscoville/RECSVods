import type { SearchPassage } from '../lib/types';
import { displayType, formatDate, formatTime, serviceUrl, watchUrl } from '../lib/urls';
import Icon from './Icon';
import ScriptureLinks from './ScriptureLinks';

export default function PassageResult({ passage, reasons, base }: { passage: SearchPassage; reasons?: string[]; base: string }) {
  return <article className="passage-result">
    <div className="passage-time"><span>{formatTime(passage.start)}–{formatTime(passage.end)}</span><span>{formatTime(passage.end - passage.start)}</span></div>
    <div className="passage-result-body">
      <h2><a href={watchUrl(base, { id: passage.id })}>{passage.title}</a></h2>
      <p className="metadata"><time dateTime={passage.date}>{formatDate(passage.date)}</time> · {displayType(passage.type)}{passage.speaker && <> · {passage.speaker}</>}</p>
      <p className="service-context">{passage.serviceTitle}</p>
      {passage.scripture.length > 0 && <p className="scripture"><ScriptureLinks references={passage.scripture} displayReferences={passage.scriptureDisplay} /></p>}
      <p>{passage.summary}</p>
      {passage.preview && <p className="preview-label">Unreviewed preview</p>}
      {reasons && reasons.length > 0 && <p className="match-reasons"><strong>Matched:</strong> {reasons.join(' · ')}</p>}
      <div className="action-row"><a className="button" href={watchUrl(base, { id: passage.id })}><Icon name="play" />Play passage</a><a className="text-link" href={serviceUrl(base, passage.serviceId)}>{passage.type === 'sermon' ? 'View full sermon' : 'View full service'}</a></div>
    </div>
  </article>;
}
