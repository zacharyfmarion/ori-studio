import { formatBuildInfo, type AppBuildInfo } from './appBuildInfo';

/**
 * Builds the markdown block behind an error fallback's "Copy details" button.
 *
 * Pure by design: it reads no stores and touches no globals, so it cannot throw
 * on the same broken state that produced the error it is describing. The caller
 * collects the context (see `components/errors/errorContext.ts`) and passes it
 * in already reduced to strings.
 *
 * **What may not go in here.** The report is meant to be pasted into a public
 * issue tracker, so it carries the *shape* of the user's work and never its
 * content: no geometry, no node or crease labels, no project titles, no
 * filenames, and no filesystem paths. `describeCpDocument`/`describeTreeDocument`
 * exist so callers have a safe way to say "a crease pattern with 1284 lines"
 * without reaching for the document itself, and `redactPaths` scrubs the home
 * directory out of stack frames (the Vite dev server serves out-of-root modules
 * as `/@fs/Users/<name>/…`, which would otherwise name the user).
 */

export interface ErrorReportContext {
  /** Which boundary caught it — `panel:crease-pattern`, `app`, `overlay:settings`. */
  surface: string;
  /** `web` or `desktop`. */
  runtime: string;
  userAgent: string;
  locale: string;
  /** Active workspace id, or a placeholder when the store could not be read. */
  workspace: string;
  /** Active editing context, or a placeholder. */
  editingContext: string;
  /** Shape-only document description — counts and kind, never contents. */
  document: string;
}

export interface ErrorReportInput {
  error: unknown;
  /** React's component stack, when a boundary caught this. */
  componentStack?: string | null;
  context: ErrorReportContext;
  /** Injected so the output is deterministic under test. */
  timestamp: string;
  build?: AppBuildInfo;
}

/** Placeholder for a context field whose source was unreadable. */
export const UNAVAILABLE = 'unavailable';

/**
 * A context with every field honestly marked unavailable, for the cases where
 * collection has not run yet or failed outright. Not guessed defaults — a
 * report that claims the wrong workspace is worse than one that admits it does
 * not know.
 */
export function unavailableContext(surface: string): ErrorReportContext {
  return {
    surface,
    runtime: UNAVAILABLE,
    userAgent: UNAVAILABLE,
    locale: UNAVAILABLE,
    workspace: UNAVAILABLE,
    editingContext: UNAVAILABLE,
    document: UNAVAILABLE,
  };
}

/**
 * Stack traces get long and a paste-into-an-issue payload should stay readable.
 * Deep frames are almost never the interesting ones.
 */
const MAX_STACK_LINES = 40;
const MAX_COMPONENT_STACK_LINES = 30;
/** Enough of the message to recognize a repeat; not a wall of serialized state. */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Replace the user's home-directory segment in any path-like text. Matches the
 * three host conventions; the username is the only part that identifies a
 * person, so the rest of the path stays for debugging value.
 */
export function redactPaths(text: string): string {
  return text
    .replace(/(\/Users\/)[^/\\\s:)"']+/g, '$1~')
    .replace(/(\/home\/)[^/\\\s:)"']+/g, '$1~')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s:)"']+/g, '$1~');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated)`;
}

function clampLines(text: string, max: number): string {
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  return [...lines.slice(0, max), `    … ${lines.length - max} more frames`].join('\n');
}

/** `TypeError: Cannot read properties of undefined`, for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    return truncate(error.message ? `${name}: ${error.message}` : name, MAX_MESSAGE_LENGTH);
  }
  if (typeof error === 'string') return truncate(error, MAX_MESSAGE_LENGTH);
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; message?: unknown };
    if (typeof record.message === 'string') {
      const prefix = typeof record.code === 'string' ? `${record.code}: ` : '';
      return truncate(`${prefix}${record.message}`, MAX_MESSAGE_LENGTH);
    }
  }
  try {
    return truncate(String(error), MAX_MESSAGE_LENGTH);
  } catch {
    return 'Unserializable thrown value';
  }
}

/** The thrown value's stack, redacted and clamped, or null when there is none. */
export function errorStack(error: unknown): string | null {
  const stack = error instanceof Error ? error.stack : null;
  if (typeof stack !== 'string' || stack.trim() === '') return null;
  return clampLines(redactPaths(stack.trim()), MAX_STACK_LINES);
}

/**
 * A one-line, contents-free description of an open crease pattern. Deliberately
 * takes the counts rather than the document, so there is no path by which a
 * caller can hand this function something it should not print.
 */
export function describeCpDocument(counts: {
  lineSegments: number;
  auxLineSegments: number;
  circles: number;
  points: number;
  texts: number;
}): string {
  const parts = [
    `${counts.lineSegments} lines`,
    `${counts.auxLineSegments} aux lines`,
    `${counts.circles} circles`,
    `${counts.points} points`,
    `${counts.texts} texts`,
  ];
  return `crease pattern · ${parts.join(' · ')}`;
}

/** The same, for a TreeMaker tree. */
export function describeTreeDocument(counts: {
  nodes: number;
  edges: number;
  paths: number;
  conditions: number;
}): string {
  return `tree · ${counts.nodes} nodes · ${counts.edges} edges · ${counts.paths} paths · ${counts.conditions} conditions`;
}

function section(heading: string, body: string): string {
  return `**${heading}**\n${body}`;
}

function field(label: string, value: string): string {
  return `- **${label}**: ${value}`;
}

/**
 * Render the full report. Markdown, because its only destination is a GitHub
 * issue: fenced blocks keep the stacks from being mangled by the comment box.
 */
export function buildErrorReport(input: ErrorReportInput): string {
  const { context } = input;
  const blocks: string[] = [
    '### Ori Studio error report',
    [
      field('When', input.timestamp),
      field('Surface', context.surface),
      field('Version', formatBuildInfo(input.build)),
      field('Runtime', context.runtime),
      field('User agent', redactPaths(context.userAgent)),
      field('Locale', context.locale),
      field('Workspace', `${context.workspace} · context ${context.editingContext}`),
      field('Document', context.document),
    ].join('\n'),
    section('Error', ['```', redactPaths(describeError(input.error)), '```'].join('\n')),
  ];

  const stack = errorStack(input.error);
  if (stack) blocks.push(section('Stack', ['```', stack, '```'].join('\n')));

  const componentStack = input.componentStack?.trim();
  if (componentStack) {
    blocks.push(
      section(
        'Component stack',
        ['```', clampLines(redactPaths(componentStack), MAX_COMPONENT_STACK_LINES), '```'].join('\n')
      )
    );
  }

  return `${blocks.join('\n\n')}\n`;
}
