import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import posthog from 'posthog-js';
import {
  AnalyticsRuntimeProvider,
  initializePostHog,
  type PostHogClientLike,
} from './analytics';
import { AppErrorBoundary } from './components/errors/AppErrorBoundary';
import { readBoolean, storageKey, STORAGE_KEYS } from './lib/storage';
import { createAppRouter, setAppRouter } from './routing/appRouter';
import './i18n';
import './index.css';
import './styles/theme.css';
import './App.css';

const router = createAppRouter();
setAppRouter(router);

// Initialize PostHog before the first render so autocapture/pageview see the
// full session. This is a no-op (returns false) unless both build-time keys are
// present — the dev/prod firewall — so local and preview builds never capture.
const analyticsEnabled = readBoolean(storageKey(STORAGE_KEYS.analyticsEnabled), true);
const analyticsReady = initializePostHog(
  posthog as unknown as PostHogClientLike,
  { analyticsEnabled },
  import.meta.env
);
const analyticsClient = analyticsReady ? (posthog as unknown as PostHogClientLike) : null;

// The outermost boundary. The router has its own `errorElement` for everything
// inside the route tree; this only catches what is above or around it, so that
// a failure there is still a readable, copyable report rather than a blank page.
// The analytics provider sits outside it so a caught error can still be reported.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalyticsRuntimeProvider client={analyticsClient}>
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    </AnalyticsRuntimeProvider>
  </StrictMode>
);
