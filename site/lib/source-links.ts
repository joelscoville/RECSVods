/** Build-only module. Import from astro.config.mjs, never from a browser component. */
import { execFileSync } from 'node:child_process';
import { loadArchive, publishedServices, type BuildMode, type Service } from './archive';
import { validateRepositoryUrl, validateSourceRef, type CorrectionConfig } from './corrections';

type Environment = Record<string, string | undefined>;
type GitRead = (args: string[]) => string | undefined;
export function gitReader(root: string): GitRead {
  return (args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch { return undefined; } // Never expose Git stderr, a remote credential or a local path.
  };
}
function remoteRepository(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ssh = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)$/.exec(value);
  return validateRepositoryUrl(ssh ? `https://github.com/${ssh[1]}` : value);
}
export function resolveRepositoryConfig(env: Environment, git: GitRead): Pick<CorrectionConfig, 'repositoryUrl' | 'sourceRef'> {
  const repositoryUrl = env.PUBLIC_REPOSITORY_URL !== undefined
    ? validateRepositoryUrl(env.PUBLIC_REPOSITORY_URL)
    : env.GITHUB_REPOSITORY ? validateRepositoryUrl(`https://github.com/${env.GITHUB_REPOSITORY}`) : remoteRepository(git(['remote', 'get-url', 'origin']));
  if (env.PUBLIC_REPOSITORY_URL !== undefined && !repositoryUrl) throw new Error('PUBLIC_REPOSITORY_URL must be an HTTPS github.com owner/repository URL without credentials, query or fragment');
  const ref = env.PUBLIC_SOURCE_REF ?? (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git(['branch', '--show-current']) || env.GITHUB_SHA || git(['rev-parse', '--verify', 'HEAD']));
  const sourceRef = ref ? validateSourceRef(ref) : undefined;
  if (env.PUBLIC_SOURCE_REF !== undefined && !sourceRef) throw new Error('PUBLIC_SOURCE_REF must be a valid branch, tag or commit ref');
  return { repositoryUrl, sourceRef };
}

/** No source re-reading or Git tracking is needed for chapter correction context. */
export function buildCorrectionConfig(services: Service[], mode: BuildMode, repository: Pick<CorrectionConfig, 'repositoryUrl' | 'sourceRef'>): CorrectionConfig {
  const config: CorrectionConfig = { ...repository, services: {}, chapters: {} };
  for (const service of publishedServices(services, mode)) {
    for (const chapter of service.chapters) {
      config.chapters[chapter.id] = { serviceId: service.id, videoId: chapter.video_id, start: chapter.start, end: chapter.end };
    }
    config.services[service.id] = {
      videos: service.videos.map(({ id, duration }) => ({ id, duration })),
    };
  }
  return config;
}
export function loadCorrectionConfig(root = process.cwd(), env: Environment = process.env): CorrectionConfig {
  const git = gitReader(root);
  const repository = resolveRepositoryConfig(env, git);
  return buildCorrectionConfig(loadArchive(root), env.ARCHIVE_MODE === 'preview' ? 'preview' : 'production', repository);
}
