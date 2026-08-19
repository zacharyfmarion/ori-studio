/**
 * Redacting free text before it leaves the machine.
 *
 * One implementation, two callers: the analytics layer folds it into an error
 * fingerprint, and the monitoring layer runs it over every message and
 * breadcrumb Sentry is about to send. Both answer the same question — "what in
 * this string is the user's content rather than ours?" — so they must not drift
 * apart.
 *
 * What counts as user content here is deliberately broad, because this app's
 * error messages routinely interpolate exactly what the privacy contract
 * forbids sending: paths and filenames of opened models, quoted labels from the
 * text tool, and measured geometry. See `docs/analytics.md`.
 */

export interface RedactOptions {
  /**
   * Replace bare numbers with `<n>`. On by default: fingerprints need it so
   * `at index 12` and `at index 99` collapse to one key, and the privacy
   * contract lists measured values as user content.
   */
  redactNumbers?: boolean;
  /** Truncate the result to this many characters. */
  maxLength?: number;
}

/**
 * Replace anything that could be user content with a placeholder token.
 *
 * Ordering matters and is load-bearing: paths are matched before bare filenames
 * so that `/Users/someone/Bird base.osf` collapses to a single `<path>` rather
 * than leaking the directory around a `<file>`.
 */
export function redactSensitiveText(
  raw: string,
  { redactNumbers = true, maxLength }: RedactOptions = {},
): string {
  let text = raw
    .replace(/https?:\/\/\S+/g, '<url>')
    // Filesystem paths first (Windows drive paths, then any token with a
    // slash), so a filename or absolute path can never survive into the output.
    .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
    .replace(/\S*\/\S*/g, '<path>')
    // Bare filenames (name.ext) that weren't part of a path.
    .replace(/\b[\w-]+\.[A-Za-z0-9]{1,6}\b/g, '<file>')
    .replace(/["'`][^"'`]*["'`]/g, '<str>')
    .replace(/0x[0-9a-f]+/gi, '<hex>');

  if (redactNumbers) text = text.replace(/\d+/g, '<n>');

  return maxLength === undefined ? text : text.slice(0, maxLength);
}
