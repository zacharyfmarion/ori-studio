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
