/**
 * The single predicate for "may we emit bootstrap-time analytics right now" —
 * PostHog must have actually initialized (a live key was present) and the user
 * must not have opted out. Extracted so the entry point and its test agree.
 */
export function shouldCaptureBootstrapAnalytics(
  posthogReady: boolean,
  analyticsEnabled: boolean
): boolean {
  return posthogReady && analyticsEnabled;
}
