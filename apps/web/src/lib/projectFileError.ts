/**
 * Why a project file was rejected, in the terms a user can act on.
 *
 * The reader knows far more than this — which field was malformed, which
 * document kind it did not recognize — but none of that is actionable, so the
 * detail stays in the thrown message for diagnostics and the code carries only
 * the distinction that changes what the user should do next.
 */
export type ProjectFileErrorCode =
  /** Written by a build newer than this one. Updating Ori Studio fixes it. */
  | 'project_file_too_new'
  /** Not an Ori Studio project at all. Nothing to fix; it's the wrong file. */
  | 'project_file_unrecognized'
  /** Ours, but unreadable — truncated, hand-edited, or from an incompatible build. */
  | 'project_file_damaged';

/**
 * A file we read successfully and then definitively rejected: the content is
 * understood, and it is not something this build can open.
 *
 * The distinction matters to error reporting. An opaque load failure invites
 * callers to guess at a cause (see `annotateLargeSourceError` in the project
 * slice, which blames available memory on very large files); this error already
 * states the whole reason, so nothing may be appended to it.
 */
export class ProjectFileFormatError extends Error {
  readonly code: ProjectFileErrorCode;

  constructor(code: ProjectFileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectFileFormatError';
    this.code = code;
  }
}

export function isProjectFileFormatError(error: unknown): error is ProjectFileFormatError {
  return error instanceof ProjectFileFormatError;
}
