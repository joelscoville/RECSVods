import { loadArchive, publishedServices, flattenChapters, type BuildMode } from './archive';
import { displayServices } from '../components/archive-display';

export function loadPublicArchive(mode: BuildMode, root = process.cwd()) {
  const archive = loadArchive(root);
  const eligible = publishedServices(archive, mode), chapters = flattenChapters(eligible, mode);
  return { chapters, services: displayServices(eligible, chapters) };
}
