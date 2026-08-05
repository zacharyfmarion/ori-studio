import { useEffect } from 'react';
import { track } from './runtime';

/**
 * Module-level so StrictMode's dev double-mount — and any later remount — can't
 * refire the event. In prod StrictMode does not re-invoke effects, but the guard
 * makes the "once per launch" guarantee hold regardless.
 */
let appOpenedCaptured = false;

/** Fire `app opened` exactly once per app launch. No-op when analytics is off. */
export function useAppOpenedEvent(): void {
  useEffect(() => {
    if (appOpenedCaptured) return;
    appOpenedCaptured = true;
    track('app opened');
  }, []);
}

/** Test-only: reset the once-guard so each case starts fresh. */
export function resetAppOpenedForTest(): void {
  appOpenedCaptured = false;
}
