import { describe, expect, it } from 'vitest';
import {
  OPENABLE_FILE_EXTENSIONS,
  classifyDroppedFile,
  dragCarriesFiles,
  droppedFileExtension,
  isImageOnlyDrag,
  isOpenableKind,
  resolveDropDecision,
  selectDroppedFile,
  type DropDecisionInput,
} from './fileDrop';
import { isCreasePatternFilename } from './creasePatternImport';
import { isNativeProjectFilename } from './nativeProjectFile';

function file(name: string, type = ''): File {
  return new File(['x'], name, { type });
}

describe('droppedFileExtension', () => {
  it('lowercases and drops the dot', () => {
    expect(droppedFileExtension('Design.CP')).toBe('cp');
    expect(droppedFileExtension('a.b.tmd5')).toBe('tmd5');
  });

  it('is empty for a name with no extension', () => {
    expect(droppedFileExtension('Documents')).toBe('');
    expect(droppedFileExtension('')).toBe('');
  });

  it('ignores dots in parent directories', () => {
    expect(droppedFileExtension('my.folder/design')).toBe('');
  });
});

describe('classifyDroppedFile', () => {
  it('classifies each openable document kind', () => {
    expect(classifyDroppedFile(file('a.osf'))).toEqual({ kind: 'project' });
    expect(classifyDroppedFile(file('a.bps'))).toEqual({ kind: 'box-pleat' });
    expect(classifyDroppedFile(file('a.tmd'))).toEqual({ kind: 'tree' });
    expect(classifyDroppedFile(file('a.tmd4'))).toEqual({ kind: 'tree' });
    expect(classifyDroppedFile(file('a.tmd5'))).toEqual({ kind: 'tree' });
  });

  it('carries the crease-pattern format through', () => {
    expect(classifyDroppedFile(file('a.cp'))).toEqual({ kind: 'crease-pattern', format: 'cp' });
    expect(classifyDroppedFile(file('a.fold'))).toEqual({ kind: 'crease-pattern', format: 'fold' });
    expect(classifyDroppedFile(file('a.ori'))).toEqual({ kind: 'crease-pattern', format: 'ori' });
    expect(classifyDroppedFile(file('a.orh'))).toEqual({ kind: 'crease-pattern', format: 'orh' });
  });

  it('is case-insensitive', () => {
    expect(classifyDroppedFile(file('Design.OSF'))).toEqual({ kind: 'project' });
    expect(classifyDroppedFile(file('Design.Cp'))).toEqual({ kind: 'crease-pattern', format: 'cp' });
  });

  it('classifies images by MIME type, whatever the extension', () => {
    expect(classifyDroppedFile(file('a.png', 'image/png'))).toEqual({ kind: 'image' });
    expect(classifyDroppedFile(file('scan', 'image/jpeg'))).toEqual({ kind: 'image' });
  });

  it('rejects unknown extensions', () => {
    expect(classifyDroppedFile(file('notes.txt'))).toEqual({ kind: 'unsupported' });
    expect(classifyDroppedFile(file('archive.zip'))).toEqual({ kind: 'unsupported' });
  });

  it('rejects a dropped folder, which arrives with no extension and no type', () => {
    expect(classifyDroppedFile(new File([], 'My Designs', { type: '' }))).toEqual({
      kind: 'unsupported',
    });
  });
});

describe('extension table agrees with the rest of the app', () => {
  it('classifies every File ▸ Open extension as openable', () => {
    for (const extension of OPENABLE_FILE_EXTENSIONS) {
      expect(isOpenableKind(classifyDroppedFile(file(`design.${extension}`)))).toBe(true);
    }
  });

  it('agrees with isCreasePatternFilename', () => {
    for (const extension of OPENABLE_FILE_EXTENSIONS) {
      const name = `design.${extension}`;
      const isCreasePattern = classifyDroppedFile(file(name)).kind === 'crease-pattern';
      expect(isCreasePattern).toBe(isCreasePatternFilename(name));
    }
  });

  it('agrees with isNativeProjectFilename', () => {
    for (const extension of OPENABLE_FILE_EXTENSIONS) {
      const name = `design.${extension}`;
      const isProject = classifyDroppedFile(file(name)).kind === 'project';
      expect(isProject).toBe(isNativeProjectFilename(name));
    }
  });
});

describe('resolveDropDecision', () => {
  const base: DropDecisionInput = {
    kind: { kind: 'crease-pattern', format: 'cp' },
    policy: 'open-or-import',
    canImportAdd: true,
    dirty: false,
  };

  it('offers the choice for a crease pattern when a CP can be merged into', () => {
    expect(resolveDropDecision(base)).toEqual({ outcome: 'choose', warnsDiscard: false });
  });

  it('warns about discarding on the open branch of the choice', () => {
    expect(resolveDropDecision({ ...base, dirty: true })).toEqual({
      outcome: 'choose',
      warnsDiscard: true,
    });
  });

  it('opens directly when no crease pattern can be merged into', () => {
    expect(resolveDropDecision({ ...base, canImportAdd: false })).toEqual({
      outcome: 'open',
      warnsDiscard: false,
    });
  });

  it('never offers import on an open-only target, even with a CP loaded', () => {
    // The welcome screen: the Edit canvas is always-live, so a crease pattern
    // can be loaded while sitting there, but merging into it makes no sense.
    expect(resolveDropDecision({ ...base, policy: 'open-only' })).toEqual({
      outcome: 'open',
      warnsDiscard: false,
    });
  });

  it('opens unmergeable documents without a choice', () => {
    for (const kind of [{ kind: 'project' }, { kind: 'box-pleat' }, { kind: 'tree' }] as const) {
      expect(resolveDropDecision({ ...base, kind })).toEqual({
        outcome: 'open',
        warnsDiscard: false,
      });
      expect(resolveDropDecision({ ...base, kind, dirty: true })).toEqual({
        outcome: 'open',
        warnsDiscard: true,
      });
    }
  });

  it('rejects unsupported files and images', () => {
    expect(resolveDropDecision({ ...base, kind: { kind: 'unsupported' } })).toEqual({
      outcome: 'reject',
      reason: 'unsupported-file',
    });
    expect(resolveDropDecision({ ...base, kind: { kind: 'image' } })).toEqual({
      outcome: 'reject',
      reason: 'image-not-here',
    });
  });
});

describe('selectDroppedFile', () => {
  it('is null for an empty drop', () => {
    expect(selectDroppedFile([])).toBeNull();
  });

  it('takes the only file and reports nothing ignored', () => {
    const selection = selectDroppedFile([file('a.cp')]);
    expect(selection?.file.name).toBe('a.cp');
    expect(selection?.ignoredCount).toBe(0);
  });

  it('prefers the first openable document over other files', () => {
    const selection = selectDroppedFile([
      file('notes.txt'),
      file('photo.png', 'image/png'),
      file('design.fold'),
      file('other.cp'),
    ]);
    expect(selection?.file.name).toBe('design.fold');
    expect(selection?.kind).toEqual({ kind: 'crease-pattern', format: 'fold' });
    expect(selection?.ignoredCount).toBe(3);
  });

  it('falls back to the first file so a refusal can name something real', () => {
    const selection = selectDroppedFile([file('notes.txt'), file('archive.zip')]);
    expect(selection?.file.name).toBe('notes.txt');
    expect(selection?.kind).toEqual({ kind: 'unsupported' });
    expect(selection?.ignoredCount).toBe(1);
  });
});

describe('drag-in-flight predicates', () => {
  function items(entries: { kind: string; type: string }[]): DataTransferItemList {
    return entries as unknown as DataTransferItemList;
  }

  it('detects an image-only drag', () => {
    expect(isImageOnlyDrag(items([{ kind: 'file', type: 'image/png' }]))).toBe(true);
    expect(
      isImageOnlyDrag(items([
        { kind: 'file', type: 'image/png' },
        { kind: 'file', type: 'image/jpeg' },
      ]))
    ).toBe(true);
  });

  it('is not image-only when any entry is a document', () => {
    expect(
      isImageOnlyDrag(items([
        { kind: 'file', type: 'image/png' },
        { kind: 'file', type: '' },
      ]))
    ).toBe(false);
  });

  it('ignores non-file entries and empty lists', () => {
    expect(isImageOnlyDrag(items([{ kind: 'string', type: 'text/plain' }]))).toBe(false);
    expect(isImageOnlyDrag(items([]))).toBe(false);
    expect(isImageOnlyDrag(null)).toBe(false);
  });

  it('only treats a drag as ours when it carries files', () => {
    expect(dragCarriesFiles(['Files'])).toBe(true);
    expect(dragCarriesFiles(['text/plain'])).toBe(false);
    // Dockview's panel drags carry their own payload type, never 'Files'.
    expect(dragCarriesFiles(['application/vnd.dockview.tab'])).toBe(false);
  });
});
