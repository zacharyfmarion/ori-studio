/**
 * One-time PostHog initialization and the properties attached to every event.
 *
 * The client is passed in (dependency-injected) rather than imported here, so
 * tests can drive `initializePostHog` with a fake and assert the exact config.
 * Real wiring lives in `main.tsx`, which passes the `posthog-js` singleton.
 */

import { appBuildInfo } from '../lib/appBuildInfo';
import { redactSensitiveText } from '../lib/redact';
import { getRuntimeSurface } from '../platform/runtime';
import type { AnalyticsErrorDomain } from './events';
import { getOrCreateStableId } from './stableId';

/** The subset of the PostHog client surface this layer uses. */
export interface PostHogClientLike {
  init(token: string, config?: Record<string, unknown>, name?: string): unknown;
  register(properties: Record<string, unknown>, days?: number): unknown;
  opt_in_capturing(options?: { captureEventName?: string | null | false }): void;
  opt_out_capturing(options?: Record<string, unknown>): void;
  identify(distinctId?: string): void;
  capture(event: string, properties?: Record<string, unknown> | null, options?: Record<string, unknown>): unknown;
  reset(resetDeviceId?: boolean): void;
}

/** The build-time env values init reads. Injectable for tests. */
export interface PostHogEnvironment {
  VITE_PUBLIC_POSTHOG_KEY?: string;
  VITE_PUBLIC_POSTHOG_HOST?: string;
  DEV?: boolean;
}

export interface BootstrapOptions {
  /** The user's current consent, decided before init runs. */
  analyticsEnabled: boolean;
}

/**
 * Super properties registered on the client and therefore attached to every
 * event. Deliberately small and non-identifying: build identity, which surface,
 * and the consent flag (so an opted-out no-op is distinguishable in the data
 * model even though nothing is sent while opted out).
 */
export function getBootstrapSharedProperties(options: BootstrapOptions): Record<string, unknown> {
  const build = appBuildInfo();
  return {
    app_version: build.version,
    app_commit: build.commit,
    runtime_surface: getRuntimeSurface(),
    analytics_enabled: options.analyticsEnabled,
  };
}

/**
 * Initialize PostHog if — and only if — both build-time keys are present.
 *
 * Absence is the dev/prod firewall: local and preview builds don't set the vars,
 * so `init` never runs and nothing is ever captured. Returns whether PostHog was
 * actually initialized, so callers know if a live client exists.
 */
export function initializePostHog(
  client: PostHogClientLike,
  options: BootstrapOptions,
  env: PostHogEnvironment
): boolean {
  const key = env.VITE_PUBLIC_POSTHOG_KEY;
  const host = env.VITE_PUBLIC_POSTHOG_HOST;

  if (!key || !host) {
    if (env.DEV) {
      console.info('[analytics] PostHog disabled: VITE_PUBLIC_POSTHOG_KEY / _HOST not set');
    }
    return false;
  }

  client.init(key, {
    api_host: host,
    // Pin the newest dated defaults bundle so behavior is stable across
    // posthog-js upgrades rather than silently shifting.
    defaults: '2026-06-25',
    autocapture: true,
    // SPA: capture a virtual pageview on history changes (react-router).
    capture_pageview: 'history_change',
    capture_pageleave: false,
    capture_dead_clicks: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    // Privacy: autocapture never ships rendered text or element attribute values.
    mask_all_text: true,
    mask_all_element_attributes: true,
    // Anonymous until we explicitly identify() below.
    person_profiles: 'identified_only',
  });

  client.register(getBootstrapSharedProperties(options));

  if (options.analyticsEnabled) {
    // `captureEventName: false` suppresses PostHog's automatic `$opt_in` event.
    client.opt_in_capturing({ captureEventName: false });
    client.identify(getOrCreateStableId());
  } else {
    client.opt_out_capturing();
  }

  return true;
}

/**
 * A stable, non-identifying key for an error, so `trackError` can dedupe bursts
 * of the same failure. Built from the error's name + a normalized message with
 * volatile bits (numbers, quoted strings, URLs, hex) stripped — never the raw
 * message, which could contain a filename or path.
 *
 * The normalization itself lives in `lib/redact.ts`, shared with the monitoring
 * layer so the two never disagree about what counts as user content.
 */
export function fingerprintError(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return `${name}:${redactSensitiveText(raw, { maxLength: 80 })}`;
}

/** Best-effort domain classification for an error, defaulting to `runtime`. */
export function inferErrorDomain(source: string | undefined): AnalyticsErrorDomain {
  if (!source) return 'runtime';
  const s = source.toLowerCase();
  if (s.includes('render') || s.includes('canvas') || s.includes('webgl')) return 'render';
  if (s.includes('file') || s.includes('export') || s.includes('import')) return 'file_io';
  if (s.includes('setting')) return 'settings';
  if (s.includes('panel')) return 'panel';
  if (s.includes('bootstrap')) return 'bootstrap';
  return 'runtime';
}
