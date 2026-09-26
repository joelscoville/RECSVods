import type { DisplayService } from './archive-display';
import { browseUrl, type BrowsePage as BrowsePageData } from '../lib/browse';
import { displayType, formatDate, formatTime, serviceUrl, watchUrl } from '../lib/urls';
import BrowseNavigation from './BrowseNavigation';
import CorrectionLinks from './CorrectionLinks';

export default function BrowsePage({ page, services, base }: { page: BrowsePageData; services: DisplayService[]; base: string }) {
  const selectedServices = new Set(page.serviceIds);
  const selectedChapters = new Set(page.chapterIds);
  return <main id="main" className="browse-main service-main page-width" tabIndex={-1}>
    <nav className="action-row" aria-label="Breadcrumb"><a className="text-link" href={browseUrl(base)}>Browse the archive</a>{page.parent && <><span aria-hidden="true">/</span><a className="text-link" href={browseUrl(base, page.parent.path)}>{page.parent.title}</a></>}</nav>
    <header className="service-heading"><h1>{page.title}</h1></header>
    {page.links && <BrowseNavigation base={base} categories={page.links} label={`Browse ${page.title.toLowerCase()}`} />}
    {!!page.serviceIds?.length && <ul className="browse-service-list">{services.filter((service) => selectedServices.has(service.id)).map((service) => <li key={service.id}>
      <a className="chapter-row" href={serviceUrl(base, service.id)}><span className="chapter-copy"><strong>{page.path === 'sermons' ? service.sermonTitle ?? service.title : service.title}</strong><span><time dateTime={service.date}>{formatDate(service.date)}</time> · {displayType(service.type)} · {service.videos.length} {service.videos.length === 1 ? 'recording' : 'recordings'}</span>{service.preview && <span className="preview-label">Unreviewed preview</span>}</span></a>
      {service.series && <a className="text-link" href={browseUrl(base, `series/${service.series.id}`)}>Series: {service.series.name}</a>}
    </li>)}</ul>}
    {!!page.chapterIds?.length && <section className="service-chapters" aria-label="Sermons and chapters"><ol>{services.flatMap((service) => service.chapters.filter((chapter) => !chapter.parentId && selectedChapters.has(chapter.id)).map((chapter) => <li key={chapter.id}>
      <a className="chapter-row" href={watchUrl(base, { chapter: chapter.id })}><span className="timestamp">{formatTime(chapter.start)}</span><span className="chapter-copy"><strong>{chapter.title}</strong><span><time dateTime={service.date}>{formatDate(service.date)}</time> · {displayType(chapter.type)} · {formatTime(chapter.end - chapter.start)}{chapter.speaker && ` · ${chapter.speaker}`}</span>{service.videos.length > 1 && <span>Video {service.videos.find((video) => video.id === chapter.videoId)?.sequence}</span>}{service.preview && <span className="preview-label">Unreviewed preview</span>}</span></a>
      <div className="action-row"><a className="text-link" href={serviceUrl(base, service.id)}>View full service</a><CorrectionLinks target={{ chapterId: chapter.id }} base={base} /></div>
    </li>))}</ol></section>}
  </main>;
}
