import { describe, expect, it } from 'vitest';
import {
  buildErrorReport,
  describeCpDocument,
  describeError,
  describeTreeDocument,
  errorStack,
  redactPaths,
  unavailableContext,
  UNAVAILABLE,
  type ErrorReportContext,
} from './errorReport';

const context: ErrorReportContext = {
  surface: 'panel:crease-pattern',
  runtime: 'web',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/141',
  locale: 'en',
  workspace: 'edit',
  editingContext: 'crease-pattern',
  document: 'crease pattern · 1284 lines',
};

function report(overrides: Partial<Parameters<typeof buildErrorReport>[0]> = {}): string {
  return buildErrorReport({
    error: new Error('boom'),
    context,
    timestamp: '2026-07-27T18:22:04.113Z',
    build: { version: '0.1.2', commit: 'a1b2c3d' },
    ...overrides,
  });
}

describe('describeError', () => {
  it('names the error class', () => {
    expect(describeError(new TypeError('nope'))).toBe('TypeError: nope');
  });

  it('reads the engine error envelope', () => {
    expect(describeError({ code: 'fold_contradiction', message: 'no order' })).toBe(
      'fold_contradiction: no order'
    );
  });

  it('handles thrown non-errors', () => {
    expect(describeError('a string')).toBe('a string');
    expect(describeError(null)).toBe('null');
  });

  it('survives a value whose toString throws', () => {
    const hostile = {
      toString() {
        throw new Error('nope');
      },
    };
    expect(describeError(hostile)).toBe('Unserializable thrown value');
  });

  it('truncates a message that is really serialized state', () => {
    const described = describeError(new Error('x'.repeat(2000)));
    expect(described.length).toBeLessThan(600);
    expect(described).toContain('(truncated)');
  });
});

describe('redactPaths', () => {
  it('removes the username from every host convention', () => {
    expect(redactPaths('/@fs/Users/zacharymarion/code/app.ts:12')).toBe('/@fs/Users/~/code/app.ts:12');
    expect(redactPaths('at /home/zach/src/app.ts')).toBe('at /home/~/src/app.ts');
    expect(redactPaths('C:\\Users\\Zach\\app.ts')).toBe('C:\\Users\\~\\app.ts');
  });

  it('leaves ordinary module URLs alone', () => {
    const url = 'http://localhost:5191/src/lib/errorReport.ts:88:21';
    expect(redactPaths(url)).toBe(url);
  });
});

describe('errorStack', () => {
  it('is null when the thrown value carries no stack', () => {
    expect(errorStack('a string')).toBeNull();
  });

  it('clamps a runaway stack', () => {
    const error = new Error('deep');
    error.stack = ['Error: deep', ...Array.from({ length: 200 }, (_, i) => `    at f${i} ()`)].join(
      '\n'
    );
    const stack = errorStack(error);
    expect(stack).not.toBeNull();
    expect((stack as string).split('\n').length).toBeLessThanOrEqual(41);
    expect(stack).toContain('more frames');
  });

  it('redacts the home directory out of frames', () => {
    const error = new Error('leaky');
    error.stack = 'Error: leaky\n    at fn (/@fs/Users/zacharymarion/app.ts:1:1)';
    expect(errorStack(error)).toContain('/Users/~/app.ts');
    expect(errorStack(error)).not.toContain('zacharymarion');
  });
});

describe('document descriptions', () => {
  it('reports crease-pattern shape as counts only', () => {
    const described = describeCpDocument({
      lineSegments: 1284,
      auxLineSegments: 12,
      circles: 0,
      points: 3,
      texts: 1,
    });
    expect(described).toBe('crease pattern · 1284 lines · 12 aux lines · 0 circles · 3 points · 1 texts');
  });

  it('reports tree shape as counts only', () => {
    expect(describeTreeDocument({ nodes: 6, edges: 5, paths: 15, conditions: 2 })).toBe(
      'tree · 6 nodes · 5 edges · 15 paths · 2 conditions'
    );
  });
});

describe('buildErrorReport', () => {
  it('includes the context, the build, and the error', () => {
    const text = report();
    expect(text).toContain('### Ori Studio error report');
    expect(text).toContain('2026-07-27T18:22:04.113Z');
    expect(text).toContain('panel:crease-pattern');
    expect(text).toContain('0.1.2 (build a1b2c3d)');
    expect(text).toContain('edit · context crease-pattern');
    expect(text).toContain('Error: boom');
  });

  it('omits the version build suffix when the commit is unknown', () => {
    expect(report({ build: { version: '0.1.2', commit: 'unknown' } })).toContain(
      '**Version**: 0.1.2\n'
    );
  });

  it('includes the component stack only when there is one', () => {
    expect(report()).not.toContain('Component stack');
    expect(report({ componentStack: '\n    at CreasePatternPanel' })).toContain('Component stack');
  });

  it('renders an unavailable context honestly rather than guessing', () => {
    const text = buildErrorReport({
      error: new Error('boom'),
      context: unavailableContext('app'),
      timestamp: '2026-07-27T18:22:04.113Z',
    });
    expect(text).toContain(`**Workspace**: ${UNAVAILABLE} · context ${UNAVAILABLE}`);
  });

  // The report is meant to be pasted into a public issue tracker.
  it('leaks no home directory through any field', () => {
    const error = new Error('open /Users/zacharymarion/models/secret.cp failed');
    error.stack = 'Error\n    at load (/@fs/Users/zacharymarion/app.ts:1:1)';
    const text = buildErrorReport({
      error,
      componentStack: '\n    at Panel (/home/zacharymarion/app.tsx:2:2)',
      context: { ...context, userAgent: 'Agent /Users/zacharymarion/bin/x' },
      timestamp: '2026-07-27T18:22:04.113Z',
    });
    expect(text).not.toContain('zacharymarion');
  });
});
