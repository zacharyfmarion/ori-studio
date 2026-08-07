import { describe, expect, it } from 'vitest';
import { orieditaDocumentTitle } from './orieditaDocumentTitle';

/**
 * What a `.ori` file's `title` field is worth as a document name.
 *
 * Upstream, almost nothing: Oriedita titles its window from the *filename*
 * (`FileModel.determineFrameTitle`) and never reads this field, while
 * `FoldLineSet.getSave(save)` fills it with `"_"`. Every real Oriedita-authored
 * file in the local corpus carries exactly that.
 */
describe('orieditaDocumentTitle', () => {
  it('drops the placeholder Oriedita writes when a document has no title', () => {
    expect(orieditaDocumentTitle('_')).toBeNull();
    // Padded the same way, since the field is free text.
    expect(orieditaDocumentTitle('  _  ')).toBeNull();
  });

  it('drops an absent or blank title', () => {
    expect(orieditaDocumentTitle(null)).toBeNull();
    expect(orieditaDocumentTitle(undefined)).toBeNull();
    expect(orieditaDocumentTitle('')).toBeNull();
    expect(orieditaDocumentTitle('   ')).toBeNull();
  });

  it('keeps a title someone actually gave the document', () => {
    expect(orieditaDocumentTitle('folded model metadata')).toBe('folded model metadata');
    expect(orieditaDocumentTitle('  lamprey  ')).toBe('lamprey');
    // Our own default, written into `.ori` files this app exports. It is a name
    // the user was shown and can rename, not a format placeholder.
    expect(orieditaDocumentTitle('Untitled CP')).toBe('Untitled CP');
  });

  it('keeps a title that merely contains the placeholder character', () => {
    expect(orieditaDocumentTitle('__')).toBe('__');
    expect(orieditaDocumentTitle('_draft')).toBe('_draft');
    expect(orieditaDocumentTitle('lamprey_v2')).toBe('lamprey_v2');
  });
});
