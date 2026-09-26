/** Build-only module. Import from astro.config.mjs, never from a browser component. */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { loadArchive, parseYaml, publishedServices, ServiceSourceSchema, type BuildMode, type Service } from './archive';
import { validateRepositoryUrl, validateSourceRef, validSourcePath, type CorrectionConfig } from './corrections';

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

/** Injectable read/track boundaries keep tests offline and independent of the real working tree. */
export function buildCorrectionConfig(services: Service[], mode: BuildMode, repository: Pick<CorrectionConfig, 'repositoryUrl' | 'sourceRef'>,
  tracked: ReadonlySet<string>, readSource: (filename: string) => string | undefined): CorrectionConfig {
  const config: CorrectionConfig = { ...repository, services: {}, passages: {} };
  for (const service of publishedServices(services, mode)) {
    const filename = `services/${service.date.slice(0, 4)}/${service.id}/service.yaml`;
    let source: ReturnType<typeof ServiceSourceSchema.parse> | undefined;
    // Re-parse the original validated source: the normalized loader deliberately drops transcript_file.
    const text = validSourcePath(filename) ? readSource(filename) : undefined;
    if (text !== undefined) {
      try {
        const result = ServiceSourceSchema.safeParse(parseYaml(text, filename));
        if (result.success && result.data.id === service.id && result.data.date === service.date) source = result.data;
      } catch { /* A concurrently edited/unreadable source has no stable edit target. */ }
    }
    const paths = new Set<string>();
    for (const passage of service.passages) {
      const original = source?.passages.find((item) => item.id === passage.id && item.video_id === passage.video_id && item.section_id === passage.section_id);
      const candidate = original?.transcript_file ? `${path.posix.dirname(filename)}/${original.transcript_file}` : original?.transcript ? filename : undefined;
      const sourcePath = candidate && validSourcePath(candidate) && tracked.has(filename) && tracked.has(candidate)
        && (candidate === filename || readSource(candidate) !== undefined) ? candidate : undefined;
      if (sourcePath) paths.add(sourcePath);
      config.passages[passage.id] = { serviceId: service.id, videoId: passage.video_id, sectionId: passage.section_id, start: passage.start, end: passage.end, ...(sourcePath ? { sourcePath } : {}) };
    }
    // A whole-service action is meaningful only when its transcripts share one known source.
    const sourcePath = paths.size === 1 && service.passages.every((passage) => config.passages[passage.id].sourcePath) ? [...paths][0] : undefined;
    config.services[service.id] = {
      videos: service.videos.map(({ id, duration }) => ({ id, duration })),
      sections: service.sections.map(({ id, video_id, start, end }) => ({ id, videoId: video_id, start, end })),
      ...(sourcePath ? { sourcePath } : {}),
    };
  }
  return config;
}
export function loadCorrectionConfig(root = process.cwd(), env: Environment = process.env): CorrectionConfig {
  const git = gitReader(root);
  const repository = resolveRepositoryConfig(env, git);
  const tracked = new Set((git(['ls-files', '-z', '--', 'services']) ?? '').split('\0').filter(Boolean));
  const absoluteRoot = realpathSync(root);
  const readSource = (filename: string): string | undefined => {
    if (!validSourcePath(filename)) return undefined;
    try {
      const absolute = path.join(absoluteRoot, filename);
      // Deny symlinks, including intermediate directories and paths leaving the repository.
      if (realpathSync(absolute) !== absolute) return undefined;
      return readFileSync(absolute, 'utf8');
    } catch { return undefined; }
  };
  return buildCorrectionConfig(loadArchive(root), env.ARCHIVE_MODE === 'preview' ? 'preview' : 'production', repository, tracked, readSource);
}
