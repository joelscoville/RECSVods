import type { DisplayService } from './archive-display';
import { browseUrl, type BrowsePage as BrowsePageData } from '../lib/browse';
import { displayType, formatDate, formatTime, serviceUrl, watchUrl } from '../lib/urls';
import BrowseNavigation from './BrowseNavigation';
import PassageResult from './PassageResult';

export default function BrowsePage({ page, services, base }: { page: BrowsePageData; services: DisplayService[]; base: string }) {
  const selectedServices = new Set(page.serviceIds);
  const selectedSections = new Set(page.sectionIds);
  const selectedPassages = new Set(page.passageIds);
  const passages = services.flatMap((service) => service.passages).filter((passage) => selectedPassages.has(passage.id));
  return <main id="main" className="browse-main service-main page-width" tabIndex={-1}>
    <nav className="action-row" aria-label="Breadcrumb"><a className="text-link" href={browseUrl(base)}>Browse the archive</a>{page.parent && <><span aria-hidden="true">/</span><a className="text-link" href={browseUrl(base, page.parent.path)}>{page.parent.title}</a></>}</nav>
    <header className="service-heading"><h1>{page.title}</h1></header>
    {page.links && <BrowseNavigation base={base} categories={page.links} label={`Browse ${page.title.toLowerCase()}`} />}
    {!!page.serviceIds?.length && <ul className="browse-service-list">{services.filter((service) => selectedServices.has(service.id)).map((service) => <li key={service.id}>
      <a className="chapter-row" href={serviceUrl(base, service.id)}><span className="chapter-copy"><strong>{page.path === 'sermons' ? service.sermonTitle ?? service.title : service.title}</strong><span><time dateTime={service.date}>{formatDate(service.date)}</time> · {displayType(service.type)} · {service.videos.length} {service.videos.length === 1 ? 'recording' : 'recordings'}</span>{service.preview && <span className="preview-label">Unreviewed preview</span>}</span></a>
    </li>)}</ul>}
    {!!page.sectionIds?.length && <section className="service-chapters" aria-label="Sermons and chapters"><ol>{services.flatMap((service) => service.sections.filter((section) => selectedSections.has(section.id)).map((section) => <li key={section.id}>
      <a className="chapter-row" href={watchUrl(base, { service: service.id, video: section.videoId, start: section.start })}><span className="timestamp">{formatTime(section.start)}</span><span className="chapter-copy"><strong>{section.type === 'sermon' ? service.sermonTitle ?? section.title : section.title}</strong><span><time dateTime={service.date}>{formatDate(service.date)}</time> · {displayType(section.type)} · {formatTime(section.end - section.start)}{section.speaker && ` · ${section.speaker}`}</span>{service.videos.length > 1 && <span>Video {service.videos.find((video) => video.id === section.videoId)?.sequence}</span>}{service.preview && <span className="preview-label">Unreviewed preview</span>}</span></a>
      <a className="text-link" href={serviceUrl(base, service.id)}>View full service</a>
    </li>))}</ol></section>}
    {passages.length > 0 && <section aria-label="Passages"><ol className="result-list">{passages.map((passage) => <li key={passage.id}><PassageResult passage={passage} base={base} /></li>)}</ol></section>}
  </main>;
}
