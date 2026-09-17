// First, before any module that could call a missing built-in at load time.
import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import {
  AnalyticsRuntimeProvider,
  consumeInternalUserFlag,
  initializePostHog,
  track,
  type PostHogClientLike,
} from './analytics';
import { initializeSentry, MonitoringRuntimeProvider, type SentryClientLike } from './monitoring';
import { installTranslatedDomGuard } from './lib/translatedDomGuard';
import { probeModuleWorkerSupport } from './lib/moduleWorkerSupport';
import { AppErrorBoundary } from './components/errors/AppErrorBoundary';
import { UnsupportedBrowserNotice } from './components/errors/UnsupportedBrowserNotice';
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

// `?internal=1` marks this device as a developer's own so analytics can filter it
// out. Consumed before the router reads the URL and before PostHog registers
// anything, so the parameter reaches neither.
consumeInternalUserFlag();

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

// Before the first render: an in-page translator (Google Translate and friends) rewraps
// text nodes React owns, and React throws the moment it tries to remove one. See
// `translatedDomGuard` for why the app tolerates that rather than opting out of translation.
//
// Counted, not reported. A blocked call is the guard doing its job — nothing broke and there
// is no stack worth reading — so the only question left is how many sessions are being
// translated, and that is an analytics question. It went to Sentry first (ORI-STUDIO-A) and
// arrived as an "error" from five users in twelve days whose sessions were all fine.
let reportedTranslatedDom = false;
installTranslatedDomGuard({
  onBlocked: (method) => {
    // Once per session. The condition persists for as long as the translator is on, so
    // every event after the first repeats what the first already said.
    if (reportedTranslatedDom) return;
    reportedTranslatedDom = true;
    track('dom mutated outside react', { blocked_method: method });
  },
});

// The outermost boundary. The router has its own `errorElement` for everything
// inside the route tree; this only catches what is above or around it, so that
// a failure there is still a readable, copyable report rather than a blank page.
// Both reporting providers sit outside it so a caught error can still be
// reported — the boundary reaches them through their module singletons.
const root = createRoot(document.getElementById('root')!);
root.render(
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

// Alongside the first render rather than ahead of it: the probe is a blob worker's round
// trip, and only a negative answer changes anything. On a browser that starts a classic
// worker where a module one was asked for, no engine can ever come up, so the app is
// replaced with the reason (ORI-STUDIO-B) instead of failing one worker at a time.
void probeModuleWorkerSupport().then((support) => {
  if (support !== 'unsupported') return;
  track('browser unsupported', { capability: 'module_workers' });
  root.render(<UnsupportedBrowserNotice />);
});

// Last, and it waits for `load` on top of that: registration kicks off an
// install that refetches most of what the page is already downloading, and the
// only thing it buys on this visit is a cache for the next one. Production web
// builds only — see `pwa/register.ts`.
registerServiceWorker();
