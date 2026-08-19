import { beforeEach, describe, expect, it } from 'vitest';
import { renderSharedCpHtml, type ShareCardMeta } from '../../../functions/_lib/cpShareHtml';
import { inlinedSharedCp, resetInlinedSharedCp } from './sharedCpBootstrap';

/**
 * The seam between the Worker that writes the inlined payload and the client that reads it.
 *
 * Both sides can pass their own unit tests while disagreeing completely, and the
 * disagreement is **silent**: the client finds nothing, falls back to fetching by id, and
 * everything still works — just with the extra KV read and the first-paint delay that
 * inlining exists to remove. Nothing throws, so the only symptom is a slow, unexplained
 * rise in read volume.
 *
 * The script id itself can no longer drift — `lib/sharedCpContract.ts` owns it and both
 * sides import it, so a change moves both. What is still free to drift is everything the
 * constant does not cover: the element type, the JSON field names, and whether the Worker's
 * escaping and the client's parsing agree. Verified against a renamed `payload` field —
 * three of the four cases below fail.
 */
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Ori Studio</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const META: ShareCardMeta = {
  id: 'a3bK9xmQwe',
  title: 'Lizard V1',
  author: 'Zachary Marion',
  shareUrl: 'https://oristudio.pages.dev/s/a3bK9xmQwe',
  imageUrl: 'https://oristudio.pages.dev/api/cp/a3bK9xmQwe/thumbnail',
};

const PAYLOAD = 'T0NTMQEBPQAAAAEAxVrUT1XHwQkAIAxD0SSUDlIc1E10U02P_ZAHIZYUgded3N3N-QTKszQ2LKvwAQ';

/** Serve what the Worker produced, exactly as a browser would receive it. */
function serve(html: string): void {
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/i, '')
    .replace(/<\/html>[\s\S]*$/i, '');
  resetInlinedSharedCp();
}

describe('inlined share payload round trip', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    resetInlinedSharedCp();
  });

  it('the client reads back exactly what the Worker inlined', () => {
    serve(renderSharedCpHtml(INDEX_HTML, META, PAYLOAD));

    const inlined = inlinedSharedCp();
    expect(inlined).not.toBeNull();
    expect(inlined).toEqual({
      id: META.id,
      payload: PAYLOAD,
      title: META.title,
      author: META.author,
    });
  });

  it('survives a title that would otherwise break out of the script element', () => {
    // The escaping is the Worker's, the parsing is the client's; only together do they
    // prove a hostile title round-trips rather than truncating the payload.
    serve(
      renderSharedCpHtml(
        INDEX_HTML,
        { ...META, title: '</script><img src=x onerror=alert(1)>', author: 'a" onload="x' },
        PAYLOAD,
      ),
    );

    const inlined = inlinedSharedCp();
    expect(inlined?.payload).toBe(PAYLOAD);
    expect(inlined?.title).toBe('</script><img src=x onerror=alert(1)>');
    expect(inlined?.author).toBe('a" onload="x');
  });

  it('reads nothing from a page the Worker did not touch', () => {
    // A normal page load must not look like a share, or every visit would try to open one.
    serve(INDEX_HTML);
    expect(inlinedSharedCp()).toBeNull();
  });

  it('consumes the payload, so a later read cannot resurrect a stale pattern', () => {
    serve(renderSharedCpHtml(INDEX_HTML, META, PAYLOAD));
    expect(inlinedSharedCp()?.payload).toBe(PAYLOAD);

    resetInlinedSharedCp();
    expect(inlinedSharedCp()).toBeNull();
  });
});
