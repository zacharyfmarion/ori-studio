import { readJson, storageKey, STORAGE_KEYS, writeJson } from '../lib/storage';
import {
  DESKTOP_BUILDS,
  LATEST_RELEASE_API_URL,
  parseRelease,
  type DesktopBuild,
  type DesktopRelease,
} from './desktopDownload';

const CACHE_KEY = storageKey(STORAGE_KEYS.desktopRelease);

/**
 * How long a cached release is served without asking GitHub again.
 *
 * A day. Releases are weeks apart, and the cost of being a day late is that the
 * button says `0.4.0` for one more session — where the cost of asking every load
 * is a share of a limit measured per client IP, spent on an answer that almost
 * never changes.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  release: DesktopRelease;
}

/**
 * The in-flight request, shared by every caller.
 *
 * Three controls mount at once on the landing page. Without this they would each
 * open their own request for the same JSON, and burn three of an hourly sixty to
 * learn the same thing.
 */
let pending: Promise<DesktopRelease | null> | null = null;

/** Resolved value, so a remount after the first load costs nothing at all. */
let resolved: DesktopRelease | null = null;

/**
 * Validate a build read back out of storage.
 *
 * Checked field by field rather than trusted, because this crossed a boundary
 * the app does not control: an entry written by an older build — from before an
 * id was renamed, or before a platform existed — is still sitting on the origin
 * after the code that wrote it has been replaced. An unknown id is dropped, so a
 * stale entry degrades to fewer builds rather than to a menu item pointing at
 * something no release has.
 */
function validBuild(value: unknown): value is DesktopBuild {
  if (typeof value !== 'object' || value === null) return false;
  const build = value as Partial<DesktopBuild>;
  return (
    typeof build.url === 'string' &&
    build.url.startsWith('https://') &&
    typeof build.size === 'number' &&
    Number.isFinite(build.size) &&
    DESKTOP_BUILDS.some((spec) => spec.id === build.id && spec.os === build.os)
  );
}

function readCache(now: number): DesktopRelease | null {
  const entry = readJson<CacheEntry | null>(CACHE_KEY, null);
  if (!entry || typeof entry.fetchedAt !== 'number') return null;
  if (now - entry.fetchedAt > CACHE_TTL_MS) return null;

  const release = entry.release;
  if (typeof release?.version !== 'string' || release.version === '') return null;
  if (!Array.isArray(release.builds)) return null;
  const builds = release.builds.filter(validBuild);
  if (builds.length === 0) return null;
  return { version: release.version, builds };
}

/** The host's `fetch`, or `null` where there is none (a server-side render). */
function hostFetch(): typeof fetch | null {
  return typeof fetch === 'undefined' ? null : fetch;
}

/**
 * The newest desktop release, or `null` when it cannot be established.
 *
 * Never throws and never rejects. Every failure — offline, rate-limited, blocked
 * by an extension, a shape this version does not recognize — resolves `null`,
 * because the caller's fallback is a working link to the releases page and a
 * thrown error would replace that with nothing.
 */
export async function fetchDesktopRelease(
  fetchImpl?: typeof fetch,
  now: number = Date.now()
): Promise<DesktopRelease | null> {
  if (resolved) return resolved;

  const cached = readCache(now);
  if (cached) {
    resolved = cached;
    return cached;
  }

  const request = fetchImpl ?? hostFetch();
  if (!request) return null;
  if (pending) return pending;

  pending = (async () => {
    try {
      // A CORS-mode fetch, which is what makes this legal on a page served
      // `Cross-Origin-Embedder-Policy: require-corp` (see `public/_headers`):
      // COEP's resource-policy check only applies to `no-cors` subresources, and
      // the API answers `Access-Control-Allow-Origin: *`.
      const response = await request(LATEST_RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return null;
      const release = parseRelease(await response.json());
      if (release) {
        resolved = release;
        writeJson(CACHE_KEY, { fetchedAt: now, release } satisfies CacheEntry);
      }
      return release;
    } catch {
      return null;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/** Test seam: drops the module-level memo so each case starts cold. */
export function resetDesktopReleaseCache(): void {
  resolved = null;
  pending = null;
}
