import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadArchive, type Service } from '../site/lib/archive';
import { isTitleCase } from '../site/lib/outline';

export function validateServiceOutline(service: Service): void {
  for (const chapter of service.chapters) if (!isTitleCase(chapter.title)) throw new Error(`${service.id}/${chapter.id}: public chapter/subsection title must use Title Case`);
  const sermon = service.type === 'sermon' || service.chapters.some(chapter => !chapter.parent_id && chapter.type === 'sermon');
  if (sermon && !service.sermon_description?.trim()) throw new Error(`${service.id}: the sermon needs one holistic description`);
  if (service.sermon_description && (/^\s*(?:thesis|points)\s*:/i.test(service.sermon_description)
    || /^\s*\d+[.)]\s/.test(service.sermon_description) || /\n\s*\n/.test(service.sermon_description))) {
    throw new Error(`${service.id}: use one natural paragraph, not a labelled or numbered outline`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const services = loadArchive(); services.forEach(validateServiceOutline);
  console.log(`Concise outline metadata valid: ${services.length} services. Argument quality and grouping still require human review.`);
}
