/**
 * Everything Sentry is about to transmit passes through here first.
 *
 * Sentry's defaults are generous by design — full URLs, console output,
 * arbitrary `extra` — and several collide head-on with the privacy contract in
 * AGENTS.md: never send raw user content (text-tool text, filenames or paths,
 * geometry / coordinates / measured values, node/edge data, or image data).
 *
 * The line this module draws is **stack frames are ours, free text is theirs**.
 * Module paths, function names, line numbers and the exception type all
 * describe our code and travel untouched — they are the entire diagnostic value
 * of a crash report. Anything a message or breadcrumb *interpolated* is assumed
 * to be the user's until proven otherwise, and is redacted.
 *
 * The practical consequence, worth knowing before reading an issue in Sentry:
 * messages arrive partly redacted (`Cannot open <file>`), stacks arrive intact.
 * If a message ever needs to be readable, add the specific fact as a tag with a
 * bounded value rather than loosening the redaction.
 */

import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { redactSensitiveText } from '../lib/redact';

/**
 * Origin and path only.
 *
 * The query and hash are where handles and payloads ride, and non-HTTP schemes
 * are worse: a `blob:` or `data:` URL can carry an entire reference image or
 * detected crease pattern inline. Those collapse to just the scheme.
 */
export function scrubUrl(raw: string): string {
  if (!raw) return raw;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  try {
    const url = new URL(raw, 'http://ori.invalid');
    if (absolute && url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `<${url.protocol.replace(':', '')}>`;
    }
    return absolute ? `${url.origin}${url.pathname}` : url.pathname;
  } catch {
    return '<url>';
  }
}

/**
 * Per-category breadcrumb policy, written as an allowlist.
 *
 * A denylist would be the wrong shape here: a future Sentry release adding a
 * new breadcrumb category would ship its payload by default, and we would find
 * out from the dashboard. Unrecognized categories fall through to the strictest
 * branch instead.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const category = breadcrumb.category ?? '';
  const data = breadcrumb.data ?? {};

  if (category === 'fetch' || category === 'xhr') {
    return {
      ...breadcrumb,
      data: {
        method: data.method,
        status_code: data.status_code,
        url: typeof data.url === 'string' ? scrubUrl(data.url) : undefined,
      },
    };
  }

  if (category === 'navigation') {
    return {
      ...breadcrumb,
      data: {
        from: typeof data.from === 'string' ? scrubUrl(data.from) : undefined,
        to: typeof data.to === 'string' ? scrubUrl(data.to) : undefined,
      },
    };
  }

  // `ui.click` / `ui.input` messages are DOM selectors built from our own
  // markup — tag, id and class, never rendered text — so the message stays.
  if (category.startsWith('ui.')) {
    return { ...breadcrumb, data: undefined };
  }

  // Console output and everything unrecognized. The app logs freely, and a
  // logged value can be anything at all, so the message is redacted and the
  // raw arguments in `data` are dropped outright.
  return {
    ...breadcrumb,
    message: breadcrumb.message ? redactSensitiveText(breadcrumb.message) : undefined,
    data: undefined,
  };
}

/**
 * Where this app's own JavaScript lives, in every build that reports.
 *
 * Vite emits one content-hashed bundle under `/assets/`, and the service worker
 * treats that prefix as the whole of the build output (`swRoutes.ts`). Workers
 * ship there too. The desktop shell serves the same tree from `tauri://`, so the
 * path is what identifies us rather than the origin.
 */
const APP_SCRIPT_PATH = '/assets/';

/**
 * Whether an event's stack is entirely somebody else's code.
 *
 * `denyUrls` already drops the easy half of this — anything whose frames name a
 * `chrome-extension://` URL. What it cannot drop is an extension or in-app
 * browser that *injects* a script into the document, because injected inline
 * code is attributed to the page's own URL. Those arrived looking exactly like a
 * crash in the welcome screen (ORI-STUDIO-3: `Properties can only be defined on
 * Objects`, whose entire stack was `/welcome` plus `[native code]`), and the app
 * has no inline script for them to have come from — `index.html` carries one
 * module tag pointing at `/assets/`, and the only thing ever injected into it is
 * a `type="application/json"` block on the share route, which does not execute.
 *
 * So the test is positive, not a denylist: an event whose stack contains no
 * frame from our bundle at all is not about our bundle. It is deliberately
 * conservative in the two directions that matter —
 *
 * - **No frames at all is not foreign.** A rejected `import()` reports no
 *   stacktrace in several engines, and those are real (ORI-STUDIO-5/6). Only a
 *   stack that exists and names only strangers counts.
 * - **One frame of ours is enough.** Third-party code sitting between our frames
 *   — a polyfill, a wrapper an extension monkey-patched over a DOM method — is
 *   still our crash to explain.
 *
 * Runs before symbolication, on the client, so `filename` here is the URL the
 * browser loaded and not the source path Sentry later maps it to.
 */
export function isForeignScriptEvent(event: ErrorEvent): boolean {
  const frames = (event.exception?.values ?? []).flatMap(
    (value) => value.stacktrace?.frames ?? []
  );
  if (frames.length === 0) return false;
  return !frames.some((frame) =>
    [frame.filename, frame.abs_path].some((path) => path?.includes(APP_SCRIPT_PATH))
  );
}

/** Redact an event in place and return it, per Sentry's `beforeSend` contract. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = redactSensitiveText(event.message);

  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactSensitiveText(value.value);
  }

  // `httpContextIntegration` fills this with the full URL plus referrer and
  // user-agent headers. Rebuild it rather than editing it, so a field added
  // upstream is dropped by default instead of forwarded.
  if (event.request) {
    event.request = {
      url: typeof event.request.url === 'string' ? scrubUrl(event.request.url) : undefined,
      method: event.request.method,
    };
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }

  // This layer never sets `extra`, so anything here came from an integration or
  // a third-party `captureException` call. Unknown provenance — drop it.
  delete event.extra;

  // `initialScope` sets `user.id` to the anonymous analytics id and nothing
  // else. Re-assert that: `sendDefaultPii` is off, but an integration that adds
  // `ip_address` or `email` must not survive this function.
  if (event.user) {
    event.user = typeof event.user.id === 'string' ? { id: event.user.id } : undefined;
  }

  return event;
}
