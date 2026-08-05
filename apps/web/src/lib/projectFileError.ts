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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectFileFormatError';
  }
}

export function isProjectFileFormatError(error: unknown): boolean {
  return error instanceof ProjectFileFormatError;
}
