import type { RuntimeSurface } from './runtime';

export type AppFeatureId =
  | 'browserDownloads'
  | 'nativeFileDialogs'
  | 'nativeMenus'
  | 'nativeWindowTitle';

const FEATURE_SURFACES: Record<AppFeatureId, RuntimeSurface[]> = {
  browserDownloads: ['web'],
  nativeFileDialogs: ['desktop'],
  nativeMenus: ['desktop'],
  nativeWindowTitle: ['desktop'],
};

export function isFeatureVisible(featureId: AppFeatureId, surface: RuntimeSurface): boolean {
  return FEATURE_SURFACES[featureId].includes(surface);
}

/**
 * Whether this build carries CP detection at all.
 *
 * Dev builds always do. A deployed build does only when `VITE_CP_DETECT=1` was
 * set at build time — the deploy workflows set it, so unsetting it there and
 * redeploying is the kill switch. Read once at build time by Vite, so a build
 * without it ships no entry point and a worker that refuses to load the
 * runtime.
 */
export function isCpDetectBuildEnabled(env: { DEV?: boolean; VITE_CP_DETECT?: string } = import.meta.env): boolean {
  return Boolean(env.DEV) || env.VITE_CP_DETECT === '1';
}

/**
 * Whether this surface should show CP detection.
 *
 * A phone is refused on purpose: the dialog's crop and review steps do not fit
 * a phone, and a half-working flow is worse than none. Decided from the
 * layout, not the runtime, so a narrow desktop window is not mistaken for a
 * phone and a phone in a browser is.
 */
export function isCpDetectSurfaceAvailable(probe: { buildEnabled: boolean; phone: boolean }): boolean {
  return probe.buildEnabled && !probe.phone;
}
