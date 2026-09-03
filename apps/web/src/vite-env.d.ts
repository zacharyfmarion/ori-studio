/// <reference types="vite/client" />

/**
 * Build commit injected by `define` in vite.config.ts. Read it through
 * `lib/appBuildInfo.ts` rather than touching the global directly — under Vitest
 * there is no `define` pass, so the raw identifier is undeclared at runtime and
 * only the accessor knows to tolerate that.
 */
declare const __APP_COMMIT__: string;
/** `ori-studio@<version>+<commit>` — the key Sentry symbolication joins on. */
declare const __SENTRY_RELEASE__: string;

/**
 * Build-time PostHog config, inlined by Vite from the CI env (see
 * `.github/workflows/deploy-web.yml`). Optional on purpose: when either is
 * absent, analytics never initializes (the dev/prod firewall).
 */
interface ImportMetaEnv {
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  /** `'1'` ships CP detection in a deployed build; absent means no entry point and no runtime. */
  readonly VITE_CP_DETECT?: string;
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
}
