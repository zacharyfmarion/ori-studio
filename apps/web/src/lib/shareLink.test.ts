import { describe, expect, it } from 'vitest';
import { buildShareUrl, isShareId, readShareFragment } from './shareLink';

describe('buildShareUrl', () => {
  it('targets the share route with the id in the path', () => {
    // A path, not a fragment: a fragment is never sent to the server, so the Worker
    // could not look up the title or emit an og:image — and the preview card is the
    // entire reason this scheme is server-backed.
    expect(buildShareUrl('a3bK9xmQ', 'https://ori.studio')).toBe('https://ori.studio/s/a3bK9xmQ');
  });

  it('produces a link short enough that length stops being a concern', () => {
    // The fragment scheme measured p90 2,628 characters and a 23,675-character worst
    // case; 16% of real patterns crossed the threshold where chat clients truncate.
    expect(buildShareUrl('a3bK9xmQ', 'https://ori.studio').length).toBeLessThan(40);
  });

  it('emits no characters that need escaping', () => {
    const url = buildShareUrl('AZaz0918', 'https://ori.studio');
    expect(url).not.toContain('%');
    expect(url).not.toContain('?');
  });
});

describe('isShareId', () => {
  it('accepts the range the Worker mints and has minted', () => {
    // Kept in step with SHARE_ID_PATTERN in functions/_lib/cpShare.ts. Eight-character links
    // predate the widening and must keep resolving.
    expect(isShareId('a3bK9xmQ')).toBe(true);
    expect(isShareId('a3bK9xmQwe')).toBe(true);
    expect(isShareId('a3bK9xmQwert')).toBe(true);
  });

  it('rejects everything else', () => {
    for (const bad of ['a3bK9xm', 'a3bK9xmQwertyu', 'a3bK-xmQ', 'a3bK_xmQ', '', '../../etc']) {
      expect(isShareId(bad)).toBe(false);
    }
  });
});

describe('readShareFragment', () => {
  // The original `/s#<payload>` scheme. Links already shared must keep working, and a
  // fragment payload is self-contained, so honouring it costs one branch and no network.
  it('reads the payload with or without a leading hash', () => {
    expect(readShareFragment('#ABC')).toBe('ABC');
    expect(readShareFragment('ABC')).toBe('ABC');
  });

  it('rejects anything that is not a bare base64url payload', () => {
    // `/s` can be reached with any fragment at all, so shape-check here rather than
    // handing junk to the decoder.
    expect(readShareFragment('#section 3')).toBeNull();
    expect(readShareFragment('#other=ABC')).toBeNull();
    expect(readShareFragment('#AB+CD/EF')).toBeNull();
    expect(readShareFragment('')).toBeNull();
    expect(readShareFragment('#')).toBeNull();
  });

  it('accepts the full base64url alphabet', () => {
    expect(readShareFragment('#AZaz09-_')).toBe('AZaz09-_');
  });
});
