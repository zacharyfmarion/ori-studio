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
 * set at build time — the web deploy and desktop build workflows set it, so
 * unsetting it there and redeploying is the kill switch. Read once at build time by Vite, so a build
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

/** Where the web site publishes its models; what the desktop shell reads them from. */
export const CP_DETECT_MODEL_ORIGIN = 'https://oristudio.dev/';

/**
 * A build-time override of where models are read from, for testing a build
 * before its registry is on the site: `VITE_CP_DETECT_MODEL_ORIGIN` names an
 * origin — a PR preview, a local `wrangler pages dev` — and both surfaces
 * read the registry there instead. An origin only; a path or a query is
 * refused rather than half-honoured, and the refusal is logged because a
 * silently ignored override would look exactly like a missing registry.
 *
 * The desktop CSP allows `https://*.oristudio.pages.dev` alongside the site
 * for this; any other origin also needs a CSP entry, or the fetch is blocked.
 */
export function cpDetectModelOriginOverride(
  value: string | undefined = import.meta.env.VITE_CP_DETECT_MODEL_ORIGIN
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const isOrigin =
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      (url.pathname === '/' || url.pathname === '') &&
      url.search === '' &&
      url.hash === '';
    if (isOrigin) return `${url.origin}/`;
  } catch {
    // Not a URL at all; refused below.
  }
  console.error(`VITE_CP_DETECT_MODEL_ORIGIN must be an origin such as https://pr-1.oristudio.pages.dev/; ignoring ${JSON.stringify(value)}`);
  return undefined;
}

/**
 * The URL the model registry resolves against. The web app reads its own
 * origin — the same deploy serves `/models/*` — and the desktop shell, which
 * runs on its own protocol and bundles no model, reads the site's. Its CSP
 * names that origin for the same reason. A build-time override wins on both.
 */
export function cpDetectModelBaseUrl(
  surface: RuntimeSurface,
  override: string | undefined = cpDetectModelOriginOverride()
): string | undefined {
  if (override) return override;
  return surface === 'desktop' ? CP_DETECT_MODEL_ORIGIN : undefined;
}
