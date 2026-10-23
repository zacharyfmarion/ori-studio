/**
 * An Import CP that did not land, as the dialog says it (plan D16): the
 * engine's refusal — the sheet it found, the faces and how many there are,
 * how deeply they stack, flat-foldability, the layer-order search — or the
 * dialog's own reason, as a
 * title and a sentence a folder reads, with the one fix the engine leaves
 * open: a search that ran out of budget may be asked again with more.
 *
 * The step tools word a refused fold (`fold/tools/refusalNotice.ts`); a
 * stored `cp-jump` that no longer replays is theirs to word as well. These
 * are the words for the dialog, where the user just picked the file.
 *
 * React-free and store-free.
 */

import type { TFunction } from 'i18next';
import type { NoticeAction } from '../../components/ui/Notice';
import type { FoldImportRefusalCode } from '../engine/foldEngineIoWire';
import type { FoldEngineRefused } from '../engine/foldEngineWire';
import { foldCapOf, foldCapWords } from '../foldCaps';

/**
 * The dialog's own reasons, before the engine is asked:
 *
 * - `unsupported_file`: the file's extension names no format the kernel reads;
 * - `unreadable_file`: the platform could not read the file;
 * - `no_folded_figure`: Edit has no solved flat folded figure to start from;
 * - `no_state`: the step on screen has no state to add a step after (it is
 *   broken, locked, or the replay stopped);
 * - `read_only`: the sequence is a newer build's;
 * - `changed`: the sequence or the step on screen changed while the pattern
 *   was being imported, so it no longer goes where it was landed;
 * - for Import starting sheet (`foldStartingSheet`), an outline that is no
 *   sheet Fold starts from: `sheet_not_convex` (it bends inward),
 *   `sheet_side_short` (a side under the minimum feature), `sheet_sides`
 *   (fewer than 3 or more than 8 corners, with how many it has).
 */
export type FoldImportLocalCode =
  | 'unsupported_file'
  | 'unreadable_file'
  | 'no_folded_figure'
  | 'no_project_cp'
  | 'no_state'
  | 'read_only'
  | 'changed'
  | 'sheet_not_convex'
  | 'sheet_side_short'
  | 'sheet_sides';

export type FoldImportNoticeCode = FoldImportRefusalCode | FoldImportLocalCode;

/** Why an import did not land: the engine's refusal, or the dialog's own reason. */
export type FoldImportRefusal =
  | { readonly kind: 'engine'; readonly refused: Pick<FoldEngineRefused, 'refusal'> }
  | { readonly kind: 'local'; readonly code: FoldImportLocalCode; readonly name?: string; readonly sides?: number };

export interface FoldImportNoticeModel {
  code: FoldImportNoticeCode;
  title: string;
  text: string;
  actions: readonly NoticeAction[];
}

/** The calls a notice's fixes make. */
export interface FoldImportFixVerbs {
  /** Ask the layer-order search again with a larger budget. */
  searchLonger: () => void;
}

/** A sheet's `width : height`, longer side 1, as a person reads a ratio. */
function aspectText(aspect: unknown): string | null {
  if (!Array.isArray(aspect) || aspect.length !== 2) return null;
  const [width, height] = aspect as unknown[];
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) return null;
  const shorter = Math.min(width, height) / Math.max(width, height);
  return shorter > 0.999 ? '1 : 1' : `1 : ${Math.round(1000 / shorter) / 1000}`;
}

/** A crease-pattern format's file extension, as the dialog names the file. */
function extensionText(format: unknown): string {
  return typeof format === 'string' && /^[a-z]+$/.test(format) ? `.${format}` : '';
}

function engineWords(t: TFunction, refusal: FoldEngineRefused['refusal']): { title: string; text: string } {
  const code = refusal.code as FoldImportRefusalCode;
  // Every import code carries its Rust fields untyped (`FoldRefusalBody`).
  const fields = refusal as Readonly<Record<string, unknown>>;
  switch (code) {
    case 'import_unreadable':
      return {
        title: t('dialogs:foldImport.refusal.unreadable.title', 'Not a crease pattern'),
        text: t(
          'dialogs:foldImport.refusal.unreadable.text',
          'The file could not be read as a {{extension}} crease pattern.',
          { extension: extensionText(fields.format) }
        ),
      };
    case 'import_folded_form':
      return {
        title: t('dialogs:foldImport.refusal.foldedForm.title', 'A folded form, not a crease pattern'),
        text: t(
          'dialogs:foldImport.refusal.foldedForm.text',
          'This FOLD file describes paper already folded. Import the flat crease pattern instead.'
        ),
      };
    case 'import_not_finite':
    case 'import_no_border':
    case 'import_outline_loops':
    case 'import_outline_invalid':
      return {
        title: t('dialogs:foldImport.refusal.outline.title', 'No sheet found'),
        text: t(
          'dialogs:foldImport.refusal.outline.text',
          'The pattern’s border is not one closed outline around the paper, so there is no sheet to fold.'
        ),
      };
    case 'import_shape_unsupported':
      return {
        title: t('dialogs:foldImport.refusal.shapeUnsupported.title', 'Square and rectangle sheets only'),
        text: t(
          'dialogs:foldImport.refusal.shapeUnsupported.text',
          'Fold imports crease patterns on a square or rectangle sheet. This one’s sheet is another shape.'
        ),
      };
    case 'import_shape_mismatch': {
      const expected = aspectText(fields.expected);
      const found = aspectText(fields.found);
      return {
        title: t('dialogs:foldImport.refusal.shapeMismatch.title', 'A different sheet'),
        text:
          expected && found
            ? t(
                'dialogs:foldImport.refusal.shapeMismatch.textRatios',
                'This sequence folds a {{expected}} sheet, and the pattern is on a {{found}} sheet. Import it into an empty sequence instead.',
                { expected, found }
              )
            : t(
                'dialogs:foldImport.refusal.shapeMismatch.text',
                'The pattern’s sheet is not the shape of this sequence’s. Import it into an empty sequence instead.'
              ),
      };
    }
    case 'import_crease_off_sheet':
    case 'import_conflicting_creases':
    case 'import_crease_not_chord':
    case 'import_disconnected_creases':
      return {
        title: t('dialogs:foldImport.refusal.creases.title', 'Creases Fold cannot follow'),
        text: t(
          'dialogs:foldImport.refusal.creases.text',
          'A crease leaves the paper, lies on another of a different kind, or stops where nothing meets it. Every crease must run from an edge or a crease to an edge or a crease.'
        ),
      };
    case 'import_non_convex_face':
      return {
        title: t('dialogs:foldImport.refusal.nonConvex.title', 'A face with a reflex corner'),
        text: t(
          'dialogs:foldImport.refusal.nonConvex.text',
          'One of the pattern’s faces bends inward at a corner. Fold folds faces that are convex.'
        ),
      };
    case 'import_too_many_faces':
    case 'import_stacked_too_deep': {
      const cap = foldCapOf(refusal);
      if (cap) return foldCapWords(t, cap, 'pattern');
      break;
    }
    case 'import_not_flat_foldable':
    case 'import_ambiguous_overlap':
      return {
        title: t('dialogs:foldImport.refusal.notFlat.title', 'Does not fold flat'),
        text: t(
          'dialogs:foldImport.refusal.notFlat.text',
          'Folded along its mountains and valleys, the pattern does not lie flat.'
        ),
      };
    case 'import_no_order':
      return {
        title: t('dialogs:foldImport.refusal.noOrder.title', 'No layer order fits'),
        text: t(
          'dialogs:foldImport.refusal.noOrder.text',
          'The layers cannot be stacked without passing through each other, given the pattern’s mountains and valleys.'
        ),
      };
    case 'import_budget_exceeded':
      return {
        title: t('dialogs:foldImport.refusal.budget.title', 'The search ran long'),
        text: t(
          'dialogs:foldImport.refusal.budget.text',
          'Finding how the layers stack took longer than an import is given. Search longer, or import a simpler pattern.'
        ),
      };
    case 'import_order_open':
      return {
        title: t('dialogs:foldImport.refusal.orderOpen.title', 'More than one layer order'),
        text: t(
          'dialogs:foldImport.refusal.orderOpen.text',
          'Edit’s folded figure leaves the layer order open. Fold it to one solution in Edit, then start from it again.'
        ),
      };
    case 'import_figure_incomplete':
      return {
        title: t('dialogs:foldImport.refusal.figureIncomplete.title', 'The folded figure is incomplete'),
        text: t(
          'dialogs:foldImport.refusal.figureIncomplete.text',
          'Edit’s folded figure does not say how every layer lies. Fold it again in Edit, then start from it.'
        ),
      };
    case 'import_witness_not_in_face':
    case 'import_relation_one_face':
    case 'import_stored_unreadable':
    case 'import_order_broken':
    case 'import_internal':
    case 'fold_export_too_large':
      return {
        title: t('dialogs:foldImport.refusal.failed.title', 'Could not import'),
        text: t('dialogs:foldImport.refusal.failed.text', 'This crease pattern could not be imported.'),
      };
  }
  // A code a newer engine added: said plainly rather than not at all.
  return {
    title: t('dialogs:foldImport.refusal.failed.title', 'Could not import'),
    text: t('dialogs:foldImport.refusal.failed.text', 'This crease pattern could not be imported.'),
  };
}

function localWords(
  t: TFunction,
  code: FoldImportLocalCode,
  name: string | undefined,
  sides: number | undefined
): { title: string; text: string } {
  switch (code) {
    case 'sheet_not_convex':
      return {
        title: t('dialogs:foldImport.refusal.sheetNotConvex.title', 'The sheet bends inward'),
        text: t(
          'dialogs:foldImport.refusal.sheetNotConvex.text',
          'The pattern’s outline has a corner that points into the paper. Fold starts from sheets whose every corner points out: a square, a rectangle, a regular polygon, or any other convex shape.'
        ),
      };
    case 'sheet_side_short':
      return {
        title: t('dialogs:foldImport.refusal.sheetSideShort.title', 'A side too short to fold'),
        text: t(
          'dialogs:foldImport.refusal.sheetSideShort.text',
          'One side of the pattern’s outline is too short for Fold to tell its corners apart. Straighten or remove it, then import the sheet again.'
        ),
      };
    case 'sheet_sides':
      return {
        title: t('dialogs:foldImport.refusal.sheetSides.title', 'Sheets of 3 to 8 sides only'),
        text: t('dialogs:foldImport.refusal.sheetSides.text', {
          count: sides ?? 0,
          defaultValue_one: 'Fold starts from sheets of 3 to 8 sides. This outline has {{count}} side.',
          defaultValue_other: 'Fold starts from sheets of 3 to 8 sides. This outline has {{count}} sides.',
        }),
      };
    case 'unsupported_file':
      return {
        title: t('dialogs:foldImport.refusal.unsupportedFile.title', 'Not a crease pattern'),
        text: t(
          'dialogs:foldImport.refusal.unsupportedFile.text',
          '{{name}} is not a crease pattern Fold can import. Use a .cp, .fold, .ori or .orh file.',
          { name: name ?? '' }
        ),
      };
    case 'unreadable_file':
      return {
        title: t('dialogs:foldImport.refusal.unreadableFile.title', 'Could not read the file'),
        text: t('dialogs:foldImport.refusal.unreadableFile.text', '{{name}} could not be read.', { name: name ?? '' }),
      };
    case 'no_project_cp':
      return {
        title: t('dialogs:foldImport.refusal.noProjectCp.title', 'Source CP unavailable'),
        text: t('dialogs:foldImport.refusal.noProjectCp.text', 'Open or create the source crease pattern in Edit, then try again. The saved Collapse step is unchanged.'),
      };
    case 'no_folded_figure':
      return {
        title: t('dialogs:foldImport.refusal.noFigure.title', 'No folded figure in Edit'),
        text: t(
          'dialogs:foldImport.refusal.noFigure.text',
          'Fold the crease pattern flat in Edit first, then start from its folded figure.'
        ),
      };
    case 'no_state':
      return {
        title: t('dialogs:foldImport.refusal.noState.title', 'This step does not fold'),
        text: t(
          'dialogs:foldImport.refusal.noState.text',
          'The step on screen has no folded state, so nothing can be added after it. Go to a step that folds.'
        ),
      };
    case 'read_only':
      return {
        title: t('dialogs:foldImport.refusal.readOnly.title', 'Read-only sequence'),
        text: t(
          'dialogs:foldImport.refusal.readOnly.text',
          'Made with a newer Ori Studio: this sequence opens read-only.'
        ),
      };
    case 'changed':
      return {
        title: t('dialogs:foldImport.refusal.changed.title', 'The sequence changed'),
        text: t(
          'dialogs:foldImport.refusal.changed.text',
          'The steps changed while the pattern was being imported. Import it again.'
        ),
      };
  }
}

/** The notice for an import that did not land: its words, and the fix the engine leaves open. */
export function foldImportNotice(
  t: TFunction,
  refusal: FoldImportRefusal,
  verbs: FoldImportFixVerbs
): FoldImportNoticeModel {
  if (refusal.kind === 'local') {
    return { code: refusal.code, ...localWords(t, refusal.code, refusal.name, refusal.sides), actions: [] };
  }
  const { refusal: body } = refusal.refused;
  const code = body.code as FoldImportRefusalCode;
  return {
    code,
    ...engineWords(t, body),
    actions:
      code === 'import_budget_exceeded'
        ? [{ id: 'search-longer', label: t('dialogs:foldImport.fix.searchLonger', 'Search longer'), run: verbs.searchLonger }]
        : [],
  };
}
