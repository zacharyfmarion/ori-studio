/// <reference types="vite/client" />

/**
 * Build commit injected by `define` in vite.config.ts. Read it through
 * `lib/appBuildInfo.ts` rather than touching the global directly — under Vitest
 * there is no `define` pass, so the raw identifier is undeclared at runtime and
 * only the accessor knows to tolerate that.
 */
declare const __APP_COMMIT__: string;
