import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { formatUnknownError, humanizeError } from './toastMessages';

// Stand-in that returns the English fallback, like i18next with a missing key.
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('toast message helpers', () => {
  it('formats error-like values for global error toasts', () => {
    expect(formatUnknownError(new Error('boom'))).toBe('boom');
    expect(formatUnknownError({ message: 'bad fold' })).toBe('bad fold');
    expect(formatUnknownError('plain failure')).toBe('plain failure');
  });

  it('humanizes structural fold error codes', () => {
    expect(
      humanizeError({ code: 'fold_same_parity', message: 'InitialHierarchy(...)' }, t)
    ).toContain("can't be folded flat");
    expect(
      humanizeError({ code: 'fold_layer_search', message: 'WorkerOverlap(SubFace(...))' }, t)
    ).toContain("couldn't be folded");
  });

  // Every code the kernel mints for a fold has to land in a case here, or the
  // Rust `Debug` string reaches the user untranslated in all eight locales.
  it('covers every fold and FOLD-import code the kernel mints', () => {
    const rawRustDebug = 'Setup(FoldGraph(DisconnectedFaces { reached: 225, unreached: 1 }))';
    expect(humanizeError({ code: 'fold_disconnected', message: rawRustDebug }, t)).not.toContain(
      'DisconnectedFaces'
    );
    expect(humanizeError({ code: 'fold_disconnected', message: rawRustDebug }, t)).toContain(
      'separate pieces'
    );

    const rawIoDisplay =
      'folded form, not a crease pattern: FOLD folded-form frames (this frame declares frame_classes)';
    expect(humanizeError({ code: 'fold_folded_form', message: rawIoDisplay }, t)).not.toContain(
      'frame_classes'
    );
    expect(humanizeError({ code: 'fold_folded_form', message: rawIoDisplay }, t)).toContain(
      'folded model'
    );
  });

  // The reader's own messages name internal fields; none of that reaches the user.
  it('replaces project-file rejections with what the user can act on', () => {
    expect(
      humanizeError(
        { code: 'project_file_too_new', message: 'Unsupported Ori Studio project schemaVersion 9' },
        t
      )
    ).toContain('newer version of Ori Studio');
    expect(
      humanizeError({ code: 'project_file_unrecognized', message: 'File is not an Ori Studio project' }, t)
    ).toContain("isn't an Ori Studio project");
    expect(
      humanizeError(
        { code: 'project_file_damaged', message: 'Ori Studio project field workspace must be an object' },
        t
      )
    ).not.toContain('workspace');
  });

  it('falls back to the raw message for unknown codes', () => {
    expect(humanizeError({ code: 'some_other_error', message: 'raw detail' }, t)).toBe('raw detail');
    expect(humanizeError(new Error('boom'), t)).toBe('boom');
  });
});
