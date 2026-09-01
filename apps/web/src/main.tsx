import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import {
  AnalyticsRuntimeProvider,
  initializePostHog,
  type PostHogClientLike,
} from './analytics';
import {
  initializeSentry,
  MonitoringRuntimeProvider,
  type SentryClientLike,
} from './monitoring';
import { AppErrorBoundary } from './components/errors/AppErrorBoundary';
import { readBoolean, storageKey, STORAGE_KEYS } from './lib/storage';
import { registerServiceWorker } from './pwa/register';
import { createAppRouter, setAppRouter } from './routing/appRouter';
import { SEO_CONTENT_ID } from './seo/siteMeta';
import './i18n';
import './index.css';
import './styles/theme.css';
import './App.css';

// Drop the prerendered landing copy the build injected for crawlers (see
// `scripts/prerender-landing.mjs`). React is about to render the same words from the same
// components, so leaving it would stack two copies of the page on top of each other.
//
// Before `createRoot`, not after: the node is a sibling of `#root`, so nothing else would
// ever take it away. In dev there is no prerender and this is a no-op.
document.getElementById(SEO_CONTENT_ID)?.remove();

const router = createAppRouter();
setAppRouter(router);

// One switch governs both: opting out of usage analytics also opts out of crash
// reports. Read once, before either client starts, so they cannot disagree.
const analyticsEnabled = readBoolean(storageKey(STORAGE_KEYS.analyticsEnabled), true);

// Sentry goes up first, ahead of everything else that could throw, so a failure
// while the rest of the app is still starting is still captured. Same shape of
// firewall as PostHog below: no build-time DSN means `init` never runs, so local
// and preview builds report nothing.
const monitoringReady = initializeSentry(
  Sentry as unknown as SentryClientLike,
  { monitoringEnabled: analyticsEnabled },
  import.meta.env
);
const monitoringClient = monitoringReady ? (Sentry as unknown as SentryClientLike) : null;

// Initialize PostHog before the first render so autocapture/pageview see the
// full session. This is a no-op (returns false) unless both build-time keys are
// present — the dev/prod firewall — so local and preview builds never capture.
const analyticsReady = initializePostHog(
  posthog as unknown as PostHogClientLike,
  { analyticsEnabled },
  import.meta.env
);
const analyticsClient = analyticsReady ? (posthog as unknown as PostHogClientLike) : null;

// The outermost boundary. The router has its own `errorElement` for everything
// inside the route tree; this only catches what is above or around it, so that
// a failure there is still a readable, copyable report rather than a blank page.
// Both reporting providers sit outside it so a caught error can still be
// reported — the boundary reaches them through their module singletons.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalyticsRuntimeProvider client={analyticsClient}>
      <MonitoringRuntimeProvider client={monitoringClient}>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </MonitoringRuntimeProvider>
    </AnalyticsRuntimeProvider>
  </StrictMode>
);

// Last, and it waits for `load` on top of that: registration kicks off an
// install that refetches most of what the page is already downloading, and the
// only thing it buys on this visit is a cache for the next one. Production web
// builds only — see `pwa/register.ts`.
registerServiceWorker();
