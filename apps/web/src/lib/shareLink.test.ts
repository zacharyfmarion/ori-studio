import { describe, expect, it } from 'vitest';
import { SHARE_LENGTH_WARNING, buildShareUrl, isShareLinkLong, readShareFragment } from './shareLink';

describe('buildShareUrl', () => {
  it('targets the share route with the payload in the fragment', () => {
    const url = buildShareUrl('AAAA', 'https://ori.studio');
    expect(url).toBe('https://ori.studio/s#AAAA');
    // The fragment is the whole point: it is never sent to a server, so it
    // escapes request-line limits, access logs, and Referer leakage. Putting the
    // payload in the path instead would give all three back.
    expect(url).not.toContain('?');
    expect(url.slice(0, url.indexOf('#'))).toBe('https://ori.studio/s');
  });

  it('leaves a base64url payload unescaped', () => {
    const payload = 'AZaz09-_';
    const url = buildShareUrl(payload, 'https://ori.studio');
    expect(url.endsWith(payload)).toBe(true);
    expect(url).not.toContain('%');
  });
});

describe('readShareFragment', () => {
  it('reads the payload with or without a leading hash', () => {
    expect(readShareFragment('#ABC')).toBe('ABC');
    expect(readShareFragment('ABC')).toBe('ABC');
  });

  it('round-trips what buildShareUrl produced', () => {
    const payload = 'T0NTMQEB-_09';
    const url = buildShareUrl(payload, 'https://ori.studio');
    expect(readShareFragment(url.slice(url.indexOf('#')))).toBe(payload);
  });

  it('rejects anything that is not a bare base64url payload', () => {
    // `/s` can be reached with any fragment at all, so shape-check here rather
    // than handing junk to the decoder.
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

describe('isShareLinkLong', () => {
  it('flags only links past the truncation threshold', () => {
    expect(isShareLinkLong('x'.repeat(SHARE_LENGTH_WARNING))).toBe(false);
    expect(isShareLinkLong('x'.repeat(SHARE_LENGTH_WARNING + 1))).toBe(true);
  });

  it('does not flag a typical crease pattern', () => {
    // A median real crease pattern measures ~838 payload characters.
    expect(isShareLinkLong(buildShareUrl('x'.repeat(838), 'https://ori.studio'))).toBe(false);
  });
});
