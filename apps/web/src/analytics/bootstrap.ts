/**
 * One-time PostHog initialization and the properties attached to every event.
 *
 * The client is passed in (dependency-injected) rather than imported here, so
 * tests can drive `initializePostHog` with a fake and assert the exact config.
 * Real wiring lives in `main.tsx`, which passes the `posthog-js` singleton.
 */

import {
  normalizeLocale,
  readStoredPreference,
  resolveLanguage,
  SYSTEM_LOCALE,
  type LocalePreference,
} from '../i18n/locales';
import { appBuildInfo } from '../lib/appBuildInfo';
import { redactSensitiveText } from '../lib/redact';
import { getRuntimeSurface } from '../platform/runtime';
import { getDisplayMode } from '../pwa/register';
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
 * The language the app is actually running in, as two bounded enums: the
 * resolved locale (always one of `SUPPORTED_LOCALE_CODES`) and whether the user
 * pinned it or is following the OS.
 *
 * These ride on *every* event rather than only on `locale changed`, because
 * that event answers a different question — who went looking for the language
 * switcher — and the people who never touch it are the overwhelming majority.
 * PostHog's own `$browser_language` is not a substitute either: it is what the
 * browser asked for, before `normalizeLocale` maps it onto a language we ship,
 * so an `it-IT` browser reads as Italian there while the app in front of that
 * person is in English. Keeping both is the point — the gap between them is the
 * demand for a locale we don't have yet.
 */
export function getLocaleProperties(
  locale: string,
  preference: LocalePreference
): Record<string, unknown> {
  return {
    locale: normalizeLocale(locale),
    locale_source: preference === SYSTEM_LOCALE ? 'system' : 'pinned',
  };
}

/**
 * Super properties registered on the client and therefore attached to every
 * event. Deliberately small and non-identifying: build identity, which surface,
 * the active language, and the consent flag (so an opted-out no-op is
 * distinguishable in the data model even though nothing is sent while opted
 * out).
 *
 * The locale is resolved from storage rather than read off the i18next
 * singleton, because this runs before React mounts — `resolveLanguage` is the
 * same resolution i18next itself was initialized with, so the two agree.
 * `AnalyticsRuntimeProvider` re-registers from the locale store afterwards,
 * which is what keeps this current when the language changes mid-session.
 */
export function getBootstrapSharedProperties(options: BootstrapOptions): Record<string, unknown> {
  const build = appBuildInfo();
  const preference = readStoredPreference();
  return {
    app_version: build.version,
    app_commit: build.commit,
    runtime_surface: getRuntimeSurface(),
    // A super property rather than an event, because the question it exists to
    // answer is about the *population*: what share of sessions come off a home
    // screen rather than a browser tab. That is the kill gate for the PWA phase
    // — "if nobody uses it on an iPad, stop here" — and an `installed` event
    // could only ever count the people who installed while instrumented, never
    // the ones who already had it. Registered before the first event for the
    // same reason `runtime_surface` is.
    display_mode: getDisplayMode(),
    analytics_enabled: options.analyticsEnabled,
    ...getLocaleProperties(resolveLanguage(preference), preference),
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
