import { describe, expect, it } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { scrubBreadcrumb, scrubEvent, scrubUrl } from '../scrub';

describe('scrubUrl', () => {
  it('keeps origin and path but drops the query and hash', () => {
    expect(scrubUrl('https://oristudio.pages.dev/s/abc123?token=xyz#payload')).toBe(
      'https://oristudio.pages.dev/s/abc123'
    );
  });

  it('keeps the path of a relative URL', () => {
    expect(scrubUrl('/api/cp/abc?full=1')).toBe('/api/cp/abc');
  });

  it('collapses blob and data URLs, which can inline an entire image', () => {
    expect(scrubUrl('data:image/png;base64,iVBORw0KGgoAAAANSU')).toBe('<data>');
    expect(scrubUrl('blob:https://oristudio.pages.dev/9f1c-4a')).toBe('<blob>');
  });

  it('falls back to a placeholder rather than passing an unparseable value through', () => {
    expect(scrubUrl('http://[::bad')).toBe('<url>');
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs the URL on a fetch crumb but keeps method and status', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { method: 'GET', status_code: 500, url: 'https://x.dev/api/cp/a?secret=1' },
    });
    expect(crumb?.data).toEqual({
      method: 'GET',
      status_code: 500,
      url: 'https://x.dev/api/cp/a',
    });
  });

  it('scrubs both endpoints of a navigation crumb', () => {
    const crumb = scrubBreadcrumb({
      category: 'navigation',
      data: { from: '/edit?doc=Bird%20base', to: '/s/abc?payload=zzz' },
    });
    expect(crumb?.data).toEqual({ from: '/edit', to: '/s/abc' });
  });

  it('drops console arguments and redacts the console message', () => {
    const crumb = scrubBreadcrumb({
      category: 'console',
      message: 'failed to open /Users/someone/Bird base.osf',
      data: { arguments: ['/Users/someone/Bird base.osf'] },
    });
    expect(crumb?.data).toBeUndefined();
    expect(crumb?.message).not.toContain('someone');
    expect(crumb?.message).not.toContain('Bird');
  });

  it('keeps a ui.click selector but drops its data', () => {
    const crumb = scrubBreadcrumb({
      category: 'ui.click',
      message: 'button.cp-toolbar__item#fold',
      data: { somethingNew: 'unknown' },
    });
    expect(crumb?.message).toBe('button.cp-toolbar__item#fold');
    expect(crumb?.data).toBeUndefined();
  });

  it('treats an unrecognized category strictly rather than passing it through', () => {
    const crumb = scrubBreadcrumb({
      category: 'some.future.category',
      message: 'opened /Users/someone/secret.osf',
      data: { raw: 'anything at all' },
    } as Breadcrumb);
    expect(crumb?.data).toBeUndefined();
    expect(crumb?.message).not.toContain('secret');
  });
});

describe('scrubEvent', () => {
  function eventWith(overrides: Partial<ErrorEvent>): ErrorEvent {
    return { type: undefined, ...overrides } as ErrorEvent;
  }

  it('redacts the exception message but leaves the stack frames intact', () => {
    const event = scrubEvent(
      eventWith({
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'cannot read /Users/someone/Bird base.osf',
              stacktrace: {
                frames: [{ filename: 'app.js', function: 'foldDocument', lineno: 42 }],
              },
            },
          ],
        },
      })
    );

    const value = event.exception?.values?.[0];
    expect(value?.value).not.toContain('someone');
    expect(value?.type).toBe('TypeError');
    // The diagnostic payload survives: this is the whole point of the split.
    expect(value?.stacktrace?.frames?.[0]).toMatchObject({
      function: 'foldDocument',
      lineno: 42,
    });
  });

  it('rebuilds request so an upstream-added field cannot be forwarded', () => {
    const event = scrubEvent(
      eventWith({
        request: {
          url: 'https://x.dev/s/abc?payload=zzz',
          method: 'GET',
          headers: { Referer: 'https://x.dev/edit?doc=secret' },
          cookies: { session: 'nope' },
        },
      })
    );
    expect(event.request).toEqual({ url: 'https://x.dev/s/abc', method: 'GET' });
  });

  it('drops extra entirely', () => {
    const event = scrubEvent(eventWith({ extra: { geometry: [1.5, 2.5] } }));
    expect(event.extra).toBeUndefined();
  });

  it('reduces user to the anonymous id, dropping anything else', () => {
    const event = scrubEvent(
      eventWith({ user: { id: 'anon-1', ip_address: '1.2.3.4', email: 'x@y.z' } })
    );
    expect(event.user).toEqual({ id: 'anon-1' });
  });

  it('scrubs breadcrumbs carried on the event', () => {
    const event = scrubEvent(
      eventWith({
        breadcrumbs: [
          { category: 'fetch', data: { url: 'https://x.dev/api/cp/a?secret=1' } },
        ],
      })
    );
    expect(event.breadcrumbs?.[0]?.data?.url).toBe('https://x.dev/api/cp/a');
  });
});
