import { describe, expect, it } from 'vitest';
import { classifyUpdateError, compareVersions } from './updateController';

describe('compareVersions', () => {
  it('orders by numeric component, not lexically', () => {
    // The case that makes a string compare wrong: "0.10.0" < "0.9.0" as text.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
  });

  it('treats a missing component as zero', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.1', '0.3')).toBeGreaterThan(0);
  });

  it('does not throw on a shape it does not recognize', () => {
    // It gates a security decision (refusing a stale manifest), so an
    // unparseable version must degrade rather than crash the check.
    expect(() => compareVersions('nightly', '0.3.0')).not.toThrow();
    expect(compareVersions('nightly', '0.3.0')).toBeLessThan(0);
  });
});

describe('classifyUpdateError', () => {
  it('identifies a signature failure', () => {
    // The one reason that is alerted on: it means the payload did not verify
    // against the key compiled into this binary, which if it is a key mismatch
    // is fleet-wide.
    expect(classifyUpdateError(new Error('Signature verification failed'))).toBe('signature');
    expect(classifyUpdateError(new Error('minisign: bad signature'))).toBe('signature');
  });

  it('identifies transport failures, which are expected and silent', () => {
    expect(classifyUpdateError(new Error('network error'))).toBe('network');
    expect(classifyUpdateError(new Error('failed to fetch'))).toBe('network');
    expect(classifyUpdateError(new Error('connect ETIMEDOUT'))).toBe('network');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyUpdateError(new Error('something else entirely'))).toBe('unknown');
    expect(classifyUpdateError('a bare string')).toBe('unknown');
  });
});
