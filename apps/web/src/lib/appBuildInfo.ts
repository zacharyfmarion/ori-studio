import { APP_VERSION } from '../constants/release';

/**
 * Which build is running, for the "Copy details" payload of an error fallback.
 *
 * The version comes from package.json via `constants/release.ts`; the commit is
 * stamped in by `define` in vite.config.ts. That global only exists after Vite's
 * define pass — Vitest runs the source without it, so referencing it bare would
 * throw a ReferenceError. Guard with `typeof` and fall back, because the whole
 * point of this module is to be safe to call from an error path.
 */

export interface AppBuildInfo {
  version: string;
  commit: string;
}

const UNKNOWN = 'unknown';

export function appCommit(): string {
  return typeof __APP_COMMIT__ === 'string' && __APP_COMMIT__ !== '' ? __APP_COMMIT__ : UNKNOWN;
}

export function appBuildInfo(): AppBuildInfo {
  return { version: APP_VERSION, commit: appCommit() };
}

/** `0.1.2 (build a1b2c3d)`, or just the version when the commit is unknown. */
export function formatBuildInfo(info: AppBuildInfo = appBuildInfo()): string {
  return info.commit === UNKNOWN ? info.version : `${info.version} (build ${info.commit})`;
}
